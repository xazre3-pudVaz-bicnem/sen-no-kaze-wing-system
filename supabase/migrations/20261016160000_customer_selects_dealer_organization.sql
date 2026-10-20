-- お客様が代理店を選ぶ（2026-10-15 先方確定：通常の Web 案件は、お客様が対応代理店を選び、その代理店の管理者が主担当者を決める）。
--
-- 見積依頼の「相談したい代理店」は、公開中の紹介ページ（dealer_profiles。代理店の利用者ごと）から選ぶ。
-- 選んだ代理店が組織（1 代理店＝1 組織）に所属していれば、その組織を営業担当の候補にして、20261016130000 の規則
-- （営業担当組織が未定なら決める・組織の管理者へ知らせる・製造担当は直属の総代理店）に乗せる。
-- 組織に所属していない代理店を選んだときは、これまでどおり本部が担当を決める。

begin;

do $preflight$
begin
  if to_regprocedure('public.set_quote_request_preferences(uuid, jsonb)') is null
     or to_regprocedure('public.default_manufacturing_organization(uuid)') is null then
    raise exception 'PRECONDITION: case sales organization (20261016130000) must be applied first';
  end if;
end;
$preflight$;

create or replace function public.set_quote_request_preferences(p_request_id uuid, p_preferences jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_before uuid;
  v_dealer uuid;
  v_org uuid;
  v_method text;
  v_slots jsonb := '[]'::jsonb;
  e jsonb;
  v_date date;
  v_period text;
  v_sales uuid;
  v_assigned boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('customer', 'admin') then
    raise exception 'FORBIDDEN: ご依頼の希望を変更できるのは、ご依頼のお客様と本部だけです' using errcode = '42501';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_preferences ->> 'preferred_dealer_id', '')), '') is not null then
    begin
      v_dealer := (p_preferences ->> 'preferred_dealer_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: 相談したい代理店の指定が正しくありません' using errcode = 'P0001';
    end;
    if not exists (select 1 from public.dealer_profiles d where d.dealer_id = v_dealer and d.published) then
      raise exception 'VALIDATION: 指定した代理店は選べません' using errcode = 'P0001';
    end if;
  end if;
  -- お客様が選んだ代理店（組織）。有効な代理店・総代理店で、管理者がいる組織だけ選べる
  if nullif(btrim(coalesce(p_preferences ->> 'preferred_organization_id', '')), '') is not null then
    begin
      v_org := (p_preferences ->> 'preferred_organization_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: 相談したい代理店の指定が正しくありません' using errcode = 'P0001';
    end;
    if not exists (
      select 1
        from public.organizations o
       where o.id = v_org
         and o.status = 'active'
         and o.organization_type in ('master_dealer', 'dealer')
         and exists (
           select 1 from public.organization_memberships m
            where m.organization_id = o.id and m.status = 'active' and m.member_role in ('owner', 'admin')
         )
    ) then
      raise exception 'VALIDATION: 指定した代理店は選べません' using errcode = 'P0001';
    end if;
  end if;
  -- 公開中の紹介ページの代理店を選んだときは、その代理店が所属する組織（有効で管理者がいる代理店・総代理店）を
  -- 営業担当の候補にする（1 代理店＝1 組織。所属は 1 人 1 つ。組織に所属していない代理店は、これまでどおり本部が担当を決める）
  if v_org is null and v_dealer is not null then
    select o.id into v_org
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
     where m.profile_id = v_dealer
       and m.status = 'active'
       and o.status = 'active'
       and o.organization_type in ('master_dealer', 'dealer')
       and exists (
         select 1 from public.organization_memberships mm
          where mm.organization_id = o.id and mm.status = 'active' and mm.member_role in ('owner', 'admin')
       )
     limit 1;
  end if;
  v_method := public.cf_text(p_preferences, 'meeting_method', 20, '打合せの方法');
  if v_method is not null and v_method not in ('onsite', 'online', 'visit', 'phone') then
    raise exception 'VALIDATION: 打合せの方法が正しくありません' using errcode = 'P0001';
  end if;
  if p_preferences ? 'preferred_slots' and jsonb_typeof(p_preferences -> 'preferred_slots') <> 'null' then
    if jsonb_typeof(p_preferences -> 'preferred_slots') <> 'array' or jsonb_array_length(p_preferences -> 'preferred_slots') > 3 then
      raise exception 'VALIDATION: 打合せの希望日は 3 つまでです' using errcode = 'P0001';
    end if;
    for e in select value from jsonb_array_elements(p_preferences -> 'preferred_slots')
    loop
      begin
        v_date := (e ->> 'date')::date;
      exception when others then
        raise exception 'VALIDATION: 打合せの希望日の形式が正しくありません' using errcode = 'P0001';
      end;
      v_period := coalesce(nullif(e ->> 'period', ''), 'any');
      if v_date is null or v_date < current_date or v_date > current_date + 365 then
        raise exception 'VALIDATION: 打合せの希望日は今日から 1 年以内の日付にしてください' using errcode = 'P0001';
      end if;
      if v_period not in ('am', 'pm', 'evening', 'any') then
        raise exception 'VALIDATION: 打合せの希望の時間帯が正しくありません' using errcode = 'P0001';
      end if;
      v_slots := v_slots || jsonb_build_array(jsonb_build_object('date', v_date::text, 'period', v_period));
    end loop;
  end if;

  select preferred_dealer_id into v_before from public.quote_request_preferences where quote_request_id = p_request_id for update;
  insert into public.quote_request_preferences (quote_request_id, preferred_dealer_id, preferred_organization_id, meeting_method, preferred_slots, note, updated_by)
  values (p_request_id, v_dealer, v_org, v_method, v_slots, public.cf_text(p_preferences, 'note', 1000, '日程のご要望'), v_uid)
  on conflict (quote_request_id) do update
    set preferred_dealer_id = excluded.preferred_dealer_id,
        preferred_organization_id = excluded.preferred_organization_id,
        meeting_method = excluded.meeting_method,
        preferred_slots = excluded.preferred_slots,
        note = excluded.note,
        updated_by = excluded.updated_by;

  -- 営業担当組織が未定なら、お客様が選んだ代理店を営業担当にする（いったん決まった後は、本部だけが変える）
  if v_org is not null then
    insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
    on conflict (quote_request_id) do nothing;
    select w.sales_organization_id into v_sales from public.case_workflows w where w.quote_request_id = p_request_id for update;
    if v_sales is null then
      update public.case_workflows w
         set sales_organization_id = v_org,
             sales_assigned_at = now(),
             sales_assigned_by = v_uid,
             manufacturing_organization_id = case when w.manufacturing_auto or w.manufacturing_organization_id is null
                                                  then public.default_manufacturing_organization(v_org)
                                                  else w.manufacturing_organization_id end,
             manufacturing_auto = (w.manufacturing_auto or w.manufacturing_organization_id is null),
             manufacturing_assigned_at = now(),
             updated_by = v_uid,
             updated_at = now()
       where w.quote_request_id = p_request_id;
      -- 営業担当が決まる前の見積の担当は外す（担当は組織の管理者が決める）
      perform public.apply_case_main_staff(p_request_id, null, v_uid);
      perform public.notify_organization_managers(v_org, 'case_sales_assigned',
        'お客様から見積のご依頼が届きました',
        'お客様があなたの組織を選びました。案件の内容を確認し、主担当者を決めてください。',
        '/admin/quotes?request=' || p_request_id::text);
      perform public.notify(null, 'admin', 'case_sales_assigned', 'お客様が代理店を選びました',
        '選ばれた代理店を営業担当にしました。必要なら案件の「受付・担当」で変えられます。', '/admin/quotes?request=' || p_request_id::text);
      v_assigned := true;
    end if;
  end if;

  -- 営業担当を決めなかったとき（組織に所属していない代理店・営業担当が決まった後の変更）は、これまでどおり本部へ知らせる
  if v_dealer is not null and v_dealer is distinct from v_before and not v_assigned then
    perform public.notify(null, 'admin', 'case_preferred_dealer', 'お客様が相談したい代理店を指定しました',
      '案件の「受付・担当」で、担当代理店を割り当ててください。', '/admin/quotes?request=' || p_request_id::text);
  end if;
end;
$$;


alter function public.set_quote_request_preferences(uuid, jsonb) owner to postgres;
revoke all on function public.set_quote_request_preferences(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_quote_request_preferences(uuid, jsonb) to authenticated;

do $postcondition$
declare
  v_fn record;
begin
  select p.oid, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
    into v_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_quote_request_preferences';
  if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
    raise exception 'POSTCONDITION: set_quote_request_preferences must be postgres-owned SECURITY DEFINER';
  end if;
  if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
    raise exception 'POSTCONDITION: set_quote_request_preferences search_path must be empty';
  end if;
  if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
    raise exception 'POSTCONDITION: set_quote_request_preferences EXECUTE must be authenticated only';
  end if;
end;
$postcondition$;

commit;
