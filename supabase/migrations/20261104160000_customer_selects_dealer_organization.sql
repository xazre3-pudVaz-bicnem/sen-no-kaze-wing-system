-- お客様が代理店を選ぶ（2026-10-15 先方確定：通常の Web 案件は、お客様が対応代理店を選び、その代理店の管理者が主担当者を決める）。
--
-- 見積依頼の「相談したい代理店」は、公開中の紹介ページ（dealer_profiles。代理店の利用者ごと）から選ぶ。
-- 選んだ代理店が組織（1 代理店＝1 組織）の有効なメンバーで、その組織が有効・管理者がいれば、その組織を営業担当にする
-- （20261104130000 の規則：製造担当は直属の総代理店に自動で決まる）。
--
-- 営業担当組織を決める条件（2026-11-09 の独立レビューを受けて、決める場面を絞った）：
-- * お客様本人が、見積依頼の直後に初めて希望を保存したときだけ（依頼から 1 時間以内・希望の行がまだ無い。
--   見積依頼の画面の送信で 1 回だけ保存する）
-- * 案件の営業担当組織が一度も決まっていない（本部が決めた・外した案件は本部だけが変える）・受付の前・主担当者がいない・
--   見積の担当がいない・契約と製造依頼が無い
-- * 選んだ代理店は、公開中の紹介ページがあり、設置予定地に対応している（画面の絞り込み dealerServesArea と同じ）
-- * 組織を直接指定する入力（preferred_organization_id）は受け付けない
-- 条件に合わないとき（組織に所属していない代理店など）は、これまでどおり本部へ知らせ、本部が担当を決める。
-- 営業担当組織を決めたら、監査ログを残し、組織の管理者・製造担当組織の管理者・本部へ知らせる。
-- 見積依頼の画面の候補は list_selectable_dealer_ids（公開中で、有効な組織の有効なメンバー・組織に管理者がいる代理店）だけにする

begin;

do $preflight$
begin
  if to_regprocedure('public.set_quote_request_preferences(uuid, jsonb)') is null
     or to_regprocedure('public.default_manufacturing_organization(uuid)') is null
     or to_regprocedure('public.write_case_audit(uuid, text, text, jsonb, jsonb)') is null
     or to_regprocedure('public.notify_organization_managers(uuid, text, text, text, text)') is null then
    raise exception 'PRECONDITION: case sales organization (20261104130000) must be applied first';
  end if;
end;
$preflight$;

-- ---------- 判定（内部用） ----------

-- 紹介ページの代理店が、設置予定地（都道府県・市区町村）に対応しているか（画面の dealerServesArea と同じ）。
-- 都道府県が未定なら対応している扱い。市区町村の指定がある代理店は、その市区町村だけ
create function public.dealer_serves_area(p_dealer_id uuid, p_prefecture text, p_municipality text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when nullif(pg_catalog.btrim(coalesce(p_prefecture, '')), '') is null then true
    else exists (
      select 1
        from public.dealer_profiles d
       where d.dealer_id = p_dealer_id
         and p_prefecture = any (d.service_prefectures)
         and (
           nullif(pg_catalog.btrim(coalesce(p_municipality, '')), '') is null
           or not exists (
             select 1 from pg_catalog.unnest(d.service_municipalities) m(v)
              where pg_catalog.left(m.v, pg_catalog.length(p_prefecture) + 1) = p_prefecture || '/'
           )
           or (p_prefecture || '/' || p_municipality) = any (d.service_municipalities)
         )
    )
  end;
$$;

-- 紹介ページの代理店の営業担当にできる組織（有効な組織の有効なメンバーで、その組織に有効な管理者がいる）。無ければ NULL
create function public.selectable_dealer_organization(p_dealer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
   where m.profile_id = p_dealer_id
     and m.status = 'active'
     and o.status = 'active'
     and o.organization_type in ('master_dealer', 'dealer')
     and exists (
       select 1 from public.organization_memberships mm
        where mm.organization_id = o.id and mm.status = 'active' and mm.member_role in ('owner', 'admin')
     )
   limit 1;
$$;

-- 見積依頼の画面で選べる代理店（公開中の紹介ページがあり、営業担当にできる組織がある）。お客様の画面から呼ぶ
create function public.list_selectable_dealer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.dealer_id
    from public.dealer_profiles d
   where d.published
     and public.selectable_dealer_organization(d.dealer_id) is not null;
$$;

-- ---------- ご依頼の希望（相談したい代理店・打合せ）を保存する ----------

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
  v_had_preferences boolean;
  v_dealer uuid;
  v_org uuid;
  v_method text;
  v_slots jsonb := '[]'::jsonb;
  e jsonb;
  v_date date;
  v_period text;
  v_request public.quote_requests;
  v_prefecture text;
  v_municipality text;
  w public.case_workflows;
  v_mfg uuid;
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
  -- 組織は、選んだ紹介ページの代理店の所属から決める（組織を直接指定させない）
  if p_preferences ? 'preferred_organization_id' then
    raise exception 'VALIDATION: 相談したい代理店は、紹介ページの一覧から選んでください' using errcode = 'P0001';
  end if;
  select * into v_request from public.quote_requests r where r.id = p_request_id;

  if nullif(btrim(coalesce(p_preferences ->> 'preferred_dealer_id', '')), '') is not null then
    begin
      v_dealer := (p_preferences ->> 'preferred_dealer_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: 相談したい代理店の指定が正しくありません' using errcode = 'P0001';
    end;
    if not exists (select 1 from public.dealer_profiles d where d.dealer_id = v_dealer and d.published) then
      raise exception 'VALIDATION: 指定した代理店は選べません' using errcode = 'P0001';
    end if;
    -- 設置予定地に対応している代理店だけ（見積依頼の画面の候補と同じ）
    select c.site_prefecture, c.site_municipality into v_prefecture, v_municipality
      from public.configurations c where c.id = v_request.configuration_id;
    if not public.dealer_serves_area(v_dealer, v_prefecture, v_municipality) then
      raise exception 'VALIDATION: 指定した代理店は、設置予定地に対応していません' using errcode = 'P0001';
    end if;
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

  select p.preferred_dealer_id into v_before
    from public.quote_request_preferences p where p.quote_request_id = p_request_id for update;
  v_had_preferences := found;
  insert into public.quote_request_preferences (quote_request_id, preferred_dealer_id, meeting_method, preferred_slots, note, updated_by)
  values (p_request_id, v_dealer, v_method, v_slots, public.cf_text(p_preferences, 'note', 1000, '日程のご要望'), v_uid)
  on conflict (quote_request_id) do update
    set preferred_dealer_id = excluded.preferred_dealer_id,
        meeting_method = excluded.meeting_method,
        preferred_slots = excluded.preferred_slots,
        note = excluded.note,
        updated_by = excluded.updated_by;

  -- 営業担当組織を決める：お客様本人が、見積依頼の直後に初めて希望を保存したときだけ
  if v_dealer is not null and v_access = 'customer' and not v_had_preferences
     and v_request.created_at >= pg_catalog.now() - interval '1 hour' then
    v_org := public.selectable_dealer_organization(v_dealer);
  end if;
  if v_org is not null then
    insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
    on conflict (quote_request_id) do nothing;
    select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id for update;
    -- 一度も営業担当組織が決まっていない・受付の前・主担当者も見積の担当もいない・契約も製造依頼も無い案件だけ
    if w.sales_organization_id is null and w.sales_assigned_at is null and w.acknowledged_at is null and w.primary_staff_id is null
       and not exists (select 1 from public.quotes q where q.quote_request_id = p_request_id and q.dealer_id is not null)
       and not exists (select 1 from public.contracts c where c.quote_request_id = p_request_id)
       and not exists (select 1 from public.manufacturing_orders o where o.quote_request_id = p_request_id) then
      v_mfg := case when w.manufacturing_auto or w.manufacturing_organization_id is null
                    then public.default_manufacturing_organization(v_org)
                    else w.manufacturing_organization_id end;
      update public.case_workflows cw
         set sales_organization_id = v_org,
             sales_assigned_at = now(),
             sales_assigned_by = v_uid,
             manufacturing_organization_id = v_mfg,
             manufacturing_auto = (w.manufacturing_auto or w.manufacturing_organization_id is null),
             manufacturing_assigned_at = case when v_mfg is distinct from w.manufacturing_organization_id then now() else cw.manufacturing_assigned_at end,
             updated_by = v_uid,
             updated_at = now()
       where cw.quote_request_id = p_request_id;
      perform public.write_case_audit(p_request_id, 'case_sales_organization', 'お客様が選んだ代理店の組織を営業担当にしました',
        pg_catalog.jsonb_build_object('sales_organization_id', null, 'manufacturing_organization_id', w.manufacturing_organization_id),
        pg_catalog.jsonb_build_object('sales_organization_id', v_org, 'manufacturing_organization_id', v_mfg,
                                      'preferred_dealer_id', v_dealer, 'by', 'customer'));
      perform public.notify_organization_managers(v_org, 'case_sales_assigned',
        'お客様から見積のご依頼が届きました',
        'お客様があなたの組織を選びました。案件の内容を確認し、主担当者を決めてください。',
        '/admin/quotes?request=' || p_request_id::text);
      if v_mfg is not null and v_mfg is distinct from w.manufacturing_organization_id then
        perform public.notify_organization_managers(v_mfg, 'case_manufacturer_assigned',
          '製造担当の案件になりました',
          '案件の仕様と現地確認の内容を確認してください。',
          '/admin/manufacturing?request=' || p_request_id::text);
      end if;
      perform public.notify(null, 'admin', 'case_sales_assigned', 'お客様が代理店を選びました',
        '選ばれた代理店を営業担当にしました。必要なら案件の「受付・担当」で変えられます。', '/admin/quotes?request=' || p_request_id::text);
      v_assigned := true;
    end if;
  end if;

  -- 営業担当を決めなかったとき（組織に所属していない代理店・見積依頼の直後でないなど）は、これまでどおり本部へ知らせる
  if v_dealer is not null and v_dealer is distinct from v_before and not v_assigned then
    perform public.notify(null, 'admin', 'case_preferred_dealer', 'お客様が相談したい代理店を指定しました',
      '案件の「受付・担当」で、担当代理店を割り当ててください。', '/admin/quotes?request=' || p_request_id::text);
  end if;
end;
$$;

alter function public.dealer_serves_area(uuid, text, text) owner to postgres;
alter function public.selectable_dealer_organization(uuid) owner to postgres;
alter function public.list_selectable_dealer_ids() owner to postgres;
alter function public.set_quote_request_preferences(uuid, jsonb) owner to postgres;
revoke all on function public.dealer_serves_area(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.selectable_dealer_organization(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_selectable_dealer_ids() from public, anon, authenticated, service_role;
revoke all on function public.set_quote_request_preferences(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.list_selectable_dealer_ids() to authenticated;
grant execute on function public.set_quote_request_preferences(uuid, jsonb) to authenticated;

do $postcondition$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('set_quote_request_preferences', 'dealer_serves_area', 'selectable_dealer_organization', 'list_selectable_dealer_ids')
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon / service_role', v_fn.proname;
    end if;
    if v_fn.proname in ('dealer_serves_area', 'selectable_dealer_organization') then
      if has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'POSTCONDITION: internal function % must not be executable by authenticated', v_fn.proname;
      end if;
    elsif not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated', v_fn.proname;
    end if;
  end loop;
end;
$postcondition$;

commit;
