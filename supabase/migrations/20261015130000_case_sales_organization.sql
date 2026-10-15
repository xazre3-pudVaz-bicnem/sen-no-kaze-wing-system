-- 案件の営業担当組織・主担当者・製造担当組織（2026-10-15 先方確定）。
--
-- 先方の決まり：
-- * 営業担当組織（本部・総代理店・代理店のどれでも）と製造担当組織（総代理店）は別々に持つ
-- * 通常の Web 案件は、お客様が選んだ代理店が営業担当。その代理店の管理者が主担当者を決める。
--   代理店を選べない・対応代理店が無いときは本部に相談（営業担当組織が未定＝本部が受付中）
-- * 製造担当は原則、営業担当の所属総代理店（代理店なら直属の総代理店、総代理店なら自身）。本部は案件ごとに変えられる
-- * 代理店の担当者は自分の担当案件だけを閲覧・編集できる。管理者は自社の全案件を確認でき、主担当者を割り当て・変更できる
--
-- 作り：
-- * case_workflows に営業担当組織・製造担当組織（と自動で決めたか）を持たせる
-- * 組織の案件では、主担当者（営業担当組織の有効なメンバー）が「担当」。主担当者を決めると、案件の見積の担当（quotes.dealer_id）を
--   主担当者にそろえる（前の担当者が過去の見積から案件を見続けないように。dealer_id は印字・金額に使っておらず、スナップショットは変わらない）
-- * 管理者（営業担当組織）の閲覧は、読み取りの判定 case_role() に「manager」を足して表す。書き込みの判定 case_access() は従来どおり
--   admin／staff／manufacturer／customer（管理者が担当として動くときは、自分を主担当者にする）
-- * 総代理店の配下の閲覧（supervisor）は case_role() で判定だけ用意し、表の読み取りは次の段階で、顧客情報を含まない形で開く
-- * 製造担当組織のメンバー（manufacturer）が読めるのは、製造・施工の記録（製造依頼・個体・工程・施工の記録と写真・完了確認・是正・
--   回されたアフター）と自分たちの技術検討だけ。現地確認・打合せ記録や相談・設置予定地と土地・そのほかの資料は、総代理店に見せる
--   顧客情報の項目が先方の確認で決まるまで見せない（これまでの案件で本部が個人として選んだ製造の担当は従来どおり）
-- * 営業担当組織が無い案件（これまでの案件）は、従来どおり見積の担当（dealer_id）で判定する

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.is_organization_manager(uuid)') is null
     or to_regclass('public.organization_invitations') is null then
    raise exception 'PRECONDITION: organization accounts (20261015120000) must be applied first';
  end if;
  if to_regprocedure('public.case_access(uuid)') is null
     or to_regclass('public.case_workflows') is null
     or to_regclass('public.quote_request_preferences') is null
     or to_regclass('public.manufacturing_orders') is null then
    raise exception 'PRECONDITION: case flow (20261013220000 and later) must be applied first';
  end if;
end;
$preflight$;

-- ---------- 列 ----------

alter table public.case_workflows
  add column sales_organization_id uuid references public.organizations(id) on delete restrict,
  add column sales_assigned_at timestamptz,
  add column sales_assigned_by uuid references public.profiles(id) on delete set null,
  add column manufacturing_organization_id uuid references public.organizations(id) on delete restrict,
  add column manufacturing_auto boolean not null default true,
  add column manufacturing_assigned_at timestamptz;

comment on column public.case_workflows.sales_organization_id is
  '営業担当組織（本部・総代理店・代理店）。NULL は本部が受付中（相談）または従来の案件。';
comment on column public.case_workflows.manufacturing_organization_id is
  '製造担当組織（総代理店）。manufacturing_auto が true のときは営業担当組織から自動で決める。';

create index case_workflows_sales_org_idx on public.case_workflows(sales_organization_id) where sales_organization_id is not null;
create index case_workflows_manufacturing_org_idx on public.case_workflows(manufacturing_organization_id) where manufacturing_organization_id is not null;

alter table public.quote_request_preferences
  add column preferred_organization_id uuid references public.organizations(id) on delete set null;

comment on column public.quote_request_preferences.preferred_organization_id is
  'お客様が選んだ代理店（組織）。営業担当組織が未定なら、その組織を営業担当にする。';

alter table public.manufacturing_orders
  add column manufacturing_organization_id uuid references public.organizations(id) on delete restrict;

-- 送った製造依頼は、製造の担当（これまでの案件は総代理店の利用者、組織の案件は製造担当組織）が決まっていること
alter table public.manufacturing_orders drop constraint manufacturing_orders_sent_fields;
alter table public.manufacturing_orders add constraint manufacturing_orders_sent_fields check (
  status in ('draft', 'canceled')
  or (sent_at is not null and (manufacturer_id is not null or manufacturing_organization_id is not null) and spec_snapshot is not null)
);

-- 製造担当組織は総代理店だけ
create function public.validate_case_workflow_organizations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manufacturing_organization_id is not null and not exists (
    select 1 from public.organizations o where o.id = new.manufacturing_organization_id and o.organization_type = 'master_dealer'
  ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 製造担当は総代理店から選んでください';
  end if;
  return new;
end;
$$;

create trigger case_workflows_organizations_validate
before insert or update of manufacturing_organization_id on public.case_workflows
for each row execute function public.validate_case_workflow_organizations();

-- ---------- 判定 ----------

-- 組織の有効なメンバーか（所属・組織とも有効）。内部用（ほかの人の所属を調べられるため、利用者からは呼ばせない）
create function public.is_active_organization_member(p_organization_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = p_organization_id
       and m.profile_id = p_profile_id
       and m.status = 'active'
       and o.status = 'active'
  );
$$;

-- 自分が案件の営業担当組織の管理者か
create function public.is_case_sales_manager(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.case_workflows w
      join public.organizations o on o.id = w.sales_organization_id
      join public.organization_memberships m on m.organization_id = o.id
     where w.quote_request_id = p_request_id
       and o.status = 'active'
       and o.organization_type in ('master_dealer', 'dealer')
       and m.profile_id = auth.uid()
       and m.status = 'active'
       and m.member_role in ('owner', 'admin')
  );
$$;

-- 自分が、案件の営業担当（代理店）の直属の総代理店の管理者か（配下の進み具合を確認する立場）
create function public.is_case_supervisor(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.case_workflows w
      join public.organizations s on s.id = w.sales_organization_id and s.organization_type = 'dealer'
      join public.organizations p on p.id = s.parent_organization_id and p.status = 'active'
      join public.organization_memberships m on m.organization_id = p.id
     where w.quote_request_id = p_request_id
       and m.profile_id = auth.uid()
       and m.status = 'active'
       and m.member_role in ('owner', 'admin')
  );
$$;

-- 営業担当組織から決まる製造担当（代理店なら直属の総代理店、総代理店なら自身、本部なら未定）
create function public.default_manufacturing_organization(p_sales_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case o.organization_type
           when 'dealer' then o.parent_organization_id
           when 'master_dealer' then o.id
           else null
         end
    from public.organizations o
   where o.id = p_sales_organization_id;
$$;

-- 組織の有効な管理者へ通知する
create function public.notify_organization_managers(p_organization_id uuid, p_kind text, p_title text, p_body text, p_link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, audience, kind, title, body, link)
  select m.profile_id, 'dealer', p_kind, p_title, p_body, p_link
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
   where m.organization_id = p_organization_id
     and m.status = 'active'
     and m.member_role in ('owner', 'admin')
     and o.status = 'active';
$$;

-- 書き込みの判定（従来の 4 つ：admin／staff／manufacturer／customer）
create or replace function public.case_access(p_request_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer := coalesce(public.current_role_rank(), 0);
  w public.case_workflows;
begin
  if v_uid is null or p_request_id is null then
    return null;
  end if;
  if v_rank >= 3 then
    return 'admin';
  end if;
  select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id;

  if w.sales_organization_id is not null then
    -- 組織の案件：主担当者（営業担当組織の有効なメンバー）だけが担当
    if v_rank >= 1 and w.primary_staff_id = v_uid and public.is_active_organization_member(w.sales_organization_id, v_uid) then
      return 'staff';
    end if;
  elsif v_rank >= 1 and exists (
    select 1
      from public.quote_requests r
      join public.quotes q on q.id = r.quote_id
     where r.id = p_request_id
       and q.dealer_id = v_uid
  ) then
    -- これまでの案件（営業担当組織が無い）：現在の見積の担当
    return 'staff';
  end if;

  if w.manufacturing_organization_id is not null then
    if v_rank >= 1 and public.is_active_organization_member(w.manufacturing_organization_id, v_uid) then
      return 'manufacturer';
    end if;
  elsif v_rank >= 2 and w.manufacturer_id = v_uid then
    return 'manufacturer';
  end if;

  if exists (select 1 from public.quote_requests r where r.id = p_request_id and r.user_id = v_uid) then
    return 'customer';
  end if;
  return null;
end;
$$;

comment on function public.case_access(uuid) is
  '案件への関わり方（書き込みの判定）：admin／staff（主担当者。これまでの案件は現在の見積の担当）／manufacturer（製造担当組織のメンバー）／customer／NULL。';

-- 読み取りの判定：case_access() に、営業担当組織の管理者（manager）と、直属の総代理店の管理者（supervisor）を足す
create function public.case_role(p_request_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access text := public.case_access(p_request_id);
begin
  if v_access in ('admin', 'staff') then
    return v_access;
  end if;
  if public.is_case_sales_manager(p_request_id) then
    return 'manager';
  end if;
  if v_access is not null then
    return v_access;
  end if;
  if public.is_case_supervisor(p_request_id) then
    return 'supervisor';
  end if;
  return null;
end;
$$;

comment on function public.case_role(uuid) is
  '案件への関わり方（読み取りの判定）：admin／staff／manager（営業担当組織の管理者）／manufacturer／customer／supervisor（直属の総代理店の管理者）／NULL。';

-- これまでの案件（製造担当組織が無い）で、本部が個人として選んだ製造の担当か。
-- 製造担当組織のメンバーには、総代理店に見せる顧客情報の項目が先方の確認で決まるまで、製造・施工の記録だけを見せる
-- （現地確認・打合せ記録や相談・設置予定地と土地・お客様の資料や契約書・引渡しの書類は、これまでの個人の製造担当にだけ従来どおり見せる）
create function public.is_case_legacy_manufacturer(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.case_workflows w
     where w.quote_request_id = p_request_id
       and w.manufacturing_organization_id is null
       and w.manufacturer_id = auth.uid()
       and coalesce(public.current_role_rank(), 0) >= 2
  );
$$;

-- ---------- 読み取りの権限：営業担当組織の管理者は、担当と同じものを見られる ----------

drop policy if exists after_service_requests_read on public.after_service_requests;
create policy after_service_requests_read on public.after_service_requests
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'customer')
  or (escalated_at is not null and public.case_access(quote_request_id) = 'manufacturer')
);

drop policy if exists case_appointments_read on public.case_appointments;
create policy case_appointments_read on public.case_appointments
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'customer'));

drop policy if exists case_files_read on public.case_files;
create policy case_files_read on public.case_files
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager')
  -- 製造担当組織は施工・製造の写真（progress）だけ。これまでの個人の製造担当は従来どおり
  or (public.case_role(quote_request_id) = 'manufacturer'
      and (context = 'progress' or public.is_case_legacy_manufacturer(quote_request_id)))
  or (customer_visible and public.case_role(quote_request_id) = 'customer')
);

drop policy if exists case_handovers_read on public.case_handovers;
create policy case_handovers_read on public.case_handovers
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer', 'customer'));

drop policy if exists case_notes_read on public.case_notes;
create policy case_notes_read on public.case_notes
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager')
  -- 製造担当組織は自分たちの技術検討だけ（打合せ記録・本部への相談は営業の記録）。これまでの個人の製造担当は従来どおり
  or (public.case_role(quote_request_id) = 'manufacturer'
      and (kind = 'tech_review' or public.is_case_legacy_manufacturer(quote_request_id)))
);

drop policy if exists case_progress_reports_read on public.case_progress_reports;
create policy case_progress_reports_read on public.case_progress_reports
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer')
  or (customer_visible and public.case_role(quote_request_id) = 'customer')
);

drop policy if exists case_punch_items_read on public.case_punch_items;
create policy case_punch_items_read on public.case_punch_items
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer', 'customer'));

drop policy if exists case_schedule_items_read on public.case_schedule_items;
create policy case_schedule_items_read on public.case_schedule_items
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer')
  or (customer_visible and public.case_role(quote_request_id) = 'customer')
);

drop policy if exists case_workflows_read on public.case_workflows;
create policy case_workflows_read on public.case_workflows
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer'));

drop policy if exists disaster_consents_read on public.disaster_consents;
create policy disaster_consents_read on public.disaster_consents
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'customer'));

drop policy if exists manufacturing_orders_read on public.manufacturing_orders;
create policy manufacturing_orders_read on public.manufacturing_orders
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer'));

drop policy if exists manufacturing_units_read on public.manufacturing_units;
create policy manufacturing_units_read on public.manufacturing_units
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer'));

drop policy if exists quote_change_requests_read on public.quote_change_requests;
create policy quote_change_requests_read on public.quote_change_requests
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'customer'));

drop policy if exists quote_request_preferences_read on public.quote_request_preferences;
create policy quote_request_preferences_read on public.quote_request_preferences
for select to authenticated
using (public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'customer'));

drop policy if exists site_surveys_read on public.site_surveys;
create policy site_surveys_read on public.site_surveys
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager')
  -- 現地確認は、総代理店に見せる顧客情報の項目が決まるまで製造担当組織には見せない。これまでの個人の製造担当は従来どおり
  or public.is_case_legacy_manufacturer(quote_request_id)
);

-- 見積：営業担当組織の管理者は、自社の案件の見積を読める（総代理店の配下の閲覧は、顧客情報を含まない専用の関数で次の段階に開く）
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
for select
using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.is_dealer() and dealer_id = auth.uid())
  or (quote_request_id is not null and public.is_case_sales_manager(quote_request_id))
);

drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items
for select
using (
  exists (
    select 1
      from public.quotes q
     where q.id = quote_items.quote_id
       and (
         q.user_id = auth.uid()
         or public.is_admin()
         or (public.is_dealer() and q.dealer_id = auth.uid())
         or (q.quote_request_id is not null and public.is_case_sales_manager(q.quote_request_id))
       )
  )
);

-- ---------- 主担当者を決める（内部） ----------

-- 主担当者を決め、案件の見積の担当（dealer_id）を主担当者にそろえる。主担当者が本部の利用者なら見積の担当は空にする。
-- 見積ごとの「担当になりました」の通知は止め、呼び出し側で 1 回だけ知らせる
create function public.apply_case_main_staff(p_request_id uuid, p_staff_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dealer uuid;
begin
  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, p_actor_id)
  on conflict (quote_request_id) do nothing;
  update public.case_workflows w
     set primary_staff_id = p_staff_id,
         primary_assigned_at = case when p_staff_id is null then null else now() end,
         primary_assigned_by = case when p_staff_id is null then null else p_actor_id end,
         updated_by = p_actor_id,
         updated_at = now()
   where w.quote_request_id = p_request_id;

  select case when public.role_rank(p.role_code) between 1 and 2 then p.id end
    into v_dealer
    from public.profiles p
   where p.id = p_staff_id;

  perform pg_catalog.set_config('wing.suppress_quote_assign_notify', 'on', true);
  update public.quotes q
     set dealer_id = v_dealer
   where q.quote_request_id = p_request_id
     and q.dealer_id is distinct from v_dealer;
  perform pg_catalog.set_config('wing.suppress_quote_assign_notify', 'off', true);
end;
$$;

-- 監査ログ（案件）
create function public.write_case_audit(p_request_id uuid, p_action text, p_summary text, p_before jsonb, p_after jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, summary, before, after)
  select auth.uid(), (select p.email from public.profiles p where p.id = auth.uid()),
         p_action, 'quote_request', p_request_id, p_summary, p_before, p_after;
$$;

-- ---------- 営業担当組織（本部だけが決める・変える） ----------

create function public.set_case_sales_organization(p_request_id uuid, p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  w public.case_workflows;
  v_org public.organizations%rowtype;
  v_mfg uuid;
  v_keep_staff boolean := false;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 営業担当組織を決められるのは本部だけです';
  end if;
  if not exists (select 1 from public.quote_requests r where r.id = p_request_id) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 案件が見つかりません';
  end if;
  if p_organization_id is not null then
    select * into v_org from public.organizations o where o.id = p_organization_id;
    if not found or v_org.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 営業担当組織は、有効な本部・総代理店・代理店から選んでください';
    end if;
  end if;

  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id for update;
  if w.sales_organization_id is not distinct from p_organization_id then
    return;
  end if;

  v_mfg := case
             when w.manufacturing_auto or w.manufacturing_organization_id is null then public.default_manufacturing_organization(p_organization_id)
             else w.manufacturing_organization_id
           end;
  update public.case_workflows cw
     set sales_organization_id = p_organization_id,
         sales_assigned_at = case when p_organization_id is null then null else now() end,
         sales_assigned_by = case when p_organization_id is null then null else v_uid end,
         manufacturing_organization_id = v_mfg,
         manufacturing_auto = case when w.manufacturing_auto or w.manufacturing_organization_id is null then true else false end,
         manufacturing_assigned_at = case when v_mfg is distinct from w.manufacturing_organization_id then now() else cw.manufacturing_assigned_at end,
         updated_by = v_uid,
         updated_at = now()
   where cw.quote_request_id = p_request_id;

  -- 主担当者は、新しい営業担当組織のメンバー（本部なら本部の利用者）のときだけ残す。残さないときは見積の担当も外す
  if w.primary_staff_id is not null and p_organization_id is not null then
    v_keep_staff := case
                      when v_org.organization_type = 'headquarters' then exists (
                        select 1 from public.profiles p where p.id = w.primary_staff_id and public.role_rank(p.role_code) >= 3
                      ) or public.is_active_organization_member(p_organization_id, w.primary_staff_id)
                      else public.is_active_organization_member(p_organization_id, w.primary_staff_id)
                    end;
  end if;
  if v_keep_staff then
    perform public.apply_case_main_staff(p_request_id, w.primary_staff_id, v_uid);
  else
    perform public.apply_case_main_staff(p_request_id, null, v_uid);
  end if;

  if p_organization_id is not null and v_org.organization_type in ('master_dealer', 'dealer') then
    perform public.notify_organization_managers(p_organization_id, 'case_sales_assigned',
      '新しい案件が届きました',
      '案件の内容を確認し、主担当者を決めてください。',
      '/admin/quotes?request=' || p_request_id::text);
  end if;
  if v_mfg is not null and v_mfg is distinct from w.manufacturing_organization_id then
    perform public.notify_organization_managers(v_mfg, 'case_manufacturer_assigned',
      '製造担当の案件になりました',
      '案件の仕様と現地確認の内容を確認してください。',
      '/admin/manufacturing?request=' || p_request_id::text);
  end if;
  perform public.write_case_audit(p_request_id, 'case_sales_organization', '営業担当組織を変更',
    pg_catalog.jsonb_build_object('sales_organization_id', w.sales_organization_id, 'manufacturing_organization_id', w.manufacturing_organization_id),
    pg_catalog.jsonb_build_object('sales_organization_id', p_organization_id, 'manufacturing_organization_id', v_mfg));
end;
$$;

-- ---------- 製造担当組織（本部だけが変える。NULL で営業担当組織からの自動に戻す） ----------

create function public.set_case_manufacturing_organization(p_request_id uuid, p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  w public.case_workflows;
  v_mfg uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 製造担当を変えられるのは本部だけです';
  end if;
  if not exists (select 1 from public.quote_requests r where r.id = p_request_id) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 案件が見つかりません';
  end if;
  if p_organization_id is not null and not exists (
    select 1 from public.organizations o where o.id = p_organization_id and o.organization_type = 'master_dealer' and o.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 製造担当は、有効な総代理店から選んでください';
  end if;

  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id for update;
  v_mfg := coalesce(p_organization_id, public.default_manufacturing_organization(w.sales_organization_id));
  if v_mfg is distinct from w.manufacturing_organization_id and exists (
    select 1 from public.manufacturing_orders o
     where o.quote_request_id = p_request_id and o.status not in ('draft', 'canceled')
  ) then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 製造依頼を送った後は製造担当を変えられません（製造依頼を取り消してから変えてください）';
  end if;

  update public.case_workflows cw
     set manufacturing_organization_id = v_mfg,
         manufacturing_auto = (p_organization_id is null),
         manufacturing_assigned_at = case when v_mfg is distinct from w.manufacturing_organization_id then now() else cw.manufacturing_assigned_at end,
         updated_by = v_uid,
         updated_at = now()
   where cw.quote_request_id = p_request_id;

  if v_mfg is not null and v_mfg is distinct from w.manufacturing_organization_id then
    perform public.notify_organization_managers(v_mfg, 'case_manufacturer_assigned',
      '製造担当の案件になりました',
      '案件の仕様と現地確認の内容を確認してください。',
      '/admin/manufacturing?request=' || p_request_id::text);
  end if;
  perform public.write_case_audit(p_request_id, 'case_manufacturing_organization', '製造担当を変更',
    pg_catalog.jsonb_build_object('manufacturing_organization_id', w.manufacturing_organization_id, 'manufacturing_auto', w.manufacturing_auto),
    pg_catalog.jsonb_build_object('manufacturing_organization_id', v_mfg, 'manufacturing_auto', p_organization_id is null));
end;
$$;

-- ---------- 主担当者（組織の案件は本部と営業担当組織の管理者。これまでの案件は従来どおり） ----------

create or replace function public.assign_case_primary_staff(p_request_id uuid, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_dealer uuid;
  v_role text;
  w public.case_workflows;
  v_org public.organizations%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id;
  if w.sales_organization_id is not null then
    -- 組織の案件：主担当者を決めるのは本部と、営業担当組織の管理者
    if not (coalesce(public.current_role_rank(), 0) >= 3 or public.is_case_sales_manager(p_request_id)) then
      raise exception 'FORBIDDEN: 主担当者を決められるのは、本部と営業担当組織の管理者だけです' using errcode = '42501';
    end if;
    select * into v_org from public.organizations o where o.id = w.sales_organization_id;
    if p_staff_id is not null then
      select p.role_code into v_role from public.profiles p where p.id = p_staff_id;
      if v_role is null or not (
        public.is_active_organization_member(w.sales_organization_id, p_staff_id)
        or (v_org.organization_type = 'headquarters' and public.role_rank(v_role) >= 3)
      ) then
        raise exception 'VALIDATION: 主担当者は、営業担当組織のメンバーから選んでください' using errcode = 'P0001';
      end if;
    end if;
    perform 1 from public.case_workflows cw where cw.quote_request_id = p_request_id for update;
    perform public.apply_case_main_staff(p_request_id, p_staff_id, v_uid);
    if p_staff_id is not null and p_staff_id <> v_uid then
      perform public.notify(p_staff_id, case when public.role_rank(v_role) >= 3 then 'admin' else 'dealer' end, 'case_primary_assigned',
        '案件の主担当者になりました', 'お客様への連絡と日程の調整をお願いします。', '/admin/quotes?request=' || p_request_id::text);
    end if;
    perform public.write_case_audit(p_request_id, 'case_primary_staff', '主担当者を変更',
      pg_catalog.jsonb_build_object('primary_staff_id', w.primary_staff_id),
      pg_catalog.jsonb_build_object('primary_staff_id', p_staff_id));
    return;
  end if;

  -- これまでの案件（営業担当組織が無い）
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 主担当者を決められるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  select q.dealer_id into v_dealer
    from public.quote_requests r join public.quotes q on q.id = r.quote_id where r.id = p_request_id;
  if p_staff_id is not null then
    select p.role_code into v_role from public.profiles p where p.id = p_staff_id;
    -- 主担当者は本部の担当者か、この案件の担当代理店（担当でない人へ案件の閲覧を広げない）
    if v_role is null or not (v_role = 'admin' or p_staff_id = v_dealer) then
      raise exception 'VALIDATION: 主担当者は本部の担当者か、この案件の担当代理店から選んでください' using errcode = 'P0001';
    end if;
  end if;
  if v_access = 'staff' and p_staff_id is distinct from v_uid then
    raise exception 'FORBIDDEN: 担当代理店は自分を主担当者にすることだけできます' using errcode = '42501';
  end if;

  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  perform 1 from public.case_workflows w where w.quote_request_id = p_request_id for update;
  update public.case_workflows
     set primary_staff_id = p_staff_id,
         primary_assigned_at = case when p_staff_id is null then null else now() end,
         primary_assigned_by = case when p_staff_id is null then null else v_uid end,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  if p_staff_id is not null and p_staff_id <> v_uid then
    perform public.notify(p_staff_id, case when v_role = 'admin' then 'admin' else 'dealer' end, 'case_primary_assigned',
      '案件の主担当者になりました', 'お客様への連絡と日程の調整をお願いします。', '/admin/quotes?request=' || p_request_id::text);
  end if;
end;
$$;

-- ---------- 受付：営業担当組織の管理者も受付できる ----------

create or replace function public.acknowledge_case(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_customer uuid;
  v_quote uuid;
  v_done boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  -- 担当でない人は v_access が NULL になる。NULL のまま not (...) に入れると拒否をすり抜けるので、偽として扱う
  if not (coalesce(v_access in ('admin', 'staff'), false) or public.is_case_sales_manager(p_request_id)) then
    raise exception 'FORBIDDEN: 受付できるのは本部と担当（営業担当組織の管理者を含む）だけです' using errcode = '42501';
  end if;
  select r.user_id, r.quote_id into v_customer, v_quote from public.quote_requests r where r.id = p_request_id;

  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  select w.acknowledged_at is not null into v_done from public.case_workflows w where w.quote_request_id = p_request_id for update;
  if v_done then
    return;
  end if;
  update public.case_workflows
     set acknowledged_at = now(), acknowledged_by = v_uid, updated_by = v_uid
   where quote_request_id = p_request_id;
  if v_customer is not null then
    perform public.notify(v_customer, 'customer', 'case_acknowledged', 'ご依頼を受け付けました',
      '担当より、打合せの日程などのご連絡をいたします。進み具合はマイページで確認できます。',
      '/mypage/cases/' || p_request_id::text);
  end if;
end;
$$;

-- ---------- お客様が選んだ代理店（組織）を営業担当にする ----------

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

  if v_dealer is not null and v_dealer is distinct from v_before then
    perform public.notify(null, 'admin', 'case_preferred_dealer', 'お客様が相談したい代理店を指定しました',
      '案件の「受付・担当」で、担当代理店を割り当ててください。', '/admin/quotes?request=' || p_request_id::text);
  end if;

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
    end if;
  end if;
end;
$$;

-- ---------- 進み具合・土地の情報・プラン：営業担当組織の管理者（と直属の総代理店の管理者の進み具合）にも返す ----------

create or replace function public.get_case_progress(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access text := public.case_role(p_request_id);
  w public.case_workflows;
  s public.site_surveys;
  o public.manufacturing_orders;
  h public.case_handovers;
  v_primary_name text;
begin
  if v_access is null then
    return null;
  end if;
  select * into w from public.case_workflows where quote_request_id = p_request_id;
  select * into s from public.site_surveys where quote_request_id = p_request_id;
  select * into o from public.manufacturing_orders where quote_request_id = p_request_id and status <> 'canceled';
  select * into h from public.case_handovers where quote_request_id = p_request_id;
  if w.primary_staff_id is not null then
    select p.full_name into v_primary_name from public.profiles p where p.id = w.primary_staff_id;
  end if;
  return jsonb_build_object(
    'acknowledged_at', w.acknowledged_at,
    'primary_staff_name', v_primary_name,
    'site_survey_status', coalesce(s.status, 'none'),
    'site_survey_completed_at', s.completed_at,
    -- 製造：状態と棟数・出荷済み・設置済みの数だけ（仕様のスナップショット・供給手配のメモは返さない）
    'manufacturing_status', coalesce(case when o.status = 'draft' then null else o.status end, 'none'),
    'unit_count', o.unit_count,
    'units_shipped', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('shipped', 'installed', 'handed_over')),
    'units_installed', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('installed', 'handed_over')),
    -- 契約は締結済みかどうかだけ（契約の中身は本部とお客様だけが読める）。担当代理店・製造の担当の画面の判定に使う
    'contract_signed', exists (select 1 from public.contracts c where c.quote_request_id = p_request_id and c.status = 'signed'),
    'handover_status', coalesce(h.status, 'none')
  );
end;
$$;

create or replace function public.configuration_site_profile_access(p_configuration_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when auth.uid() is null then null
           when exists (select 1 from public.configurations c where c.id = p_configuration_id and c.user_id = auth.uid()) then 'owner'
           when coalesce(public.current_role_rank(), 0) >= 3 then 'admin'
           when exists (
             select 1 from public.quote_requests r
              where r.configuration_id = p_configuration_id
                and (public.case_access(r.id) = 'staff' or public.is_case_legacy_manufacturer(r.id) or public.is_case_sales_manager(r.id))
           ) then 'staff'
           else null
         end;
$$;

create or replace function public.get_case_plan_configuration(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_quote public.quotes;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if v_rank < 1 then
    raise exception 'FORBIDDEN: 案件プランボードを確認できるのは担当者以上です'
      using errcode = '42501';
  end if;

  select *
    into v_quote
    from public.quotes
   where id = p_quote_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (
    v_rank >= 3
    or (v_rank >= 1 and coalesce(v_quote.dealer_id = v_uid, false))
    or (v_quote.quote_request_id is not null and public.is_case_sales_manager(v_quote.quote_request_id))
  ) then
    raise exception 'FORBIDDEN: この見積の担当者ではありません'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'configuration', jsonb_build_object(
             'id', c.id,
             'name', c.name,
             'base_model_id', c.base_model_id,
             'status', c.status,
             'finish_level', c.finish_level,
             'spec_code', c.spec_code,
             'site_prefecture', c.site_prefecture,
             'site_municipality', c.site_municipality,
             'site_location_undecided', c.site_location_undecided
           ),
           'items', coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object(
                          'option_id', ci.option_id,
                          'quantity', ci.quantity,
                          'variant_choice_ids', ci.variant_choice_ids
                        )
                        order by ci.id
                      )
                 from public.configuration_items ci
                where ci.configuration_id = c.id
             ),
             '[]'::jsonb
           ),
           'exterior_faces', coalesce(c.exterior_faces, '[]'::jsonb)
         )
    into v_result
    from public.configurations c
   where c.id = v_quote.configuration_id;

  if v_result is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

-- ---------- 製造依頼：製造担当組織へ送る（これまでの案件は従来どおり総代理店の利用者へ） ----------

create or replace function public.send_manufacturing_order(p_order_id uuid, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  o public.manufacturing_orders;
  v_access text;
  v_manufacturer uuid;
  v_mfg_org uuid;
  q public.quotes;
  v_snapshot jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into o from public.manufacturing_orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(o.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 製造依頼を送れるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if o.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で製造依頼が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if o.status <> 'draft' then
    raise exception 'LOCKED: この製造依頼はすでに送っています' using errcode = 'P0001';
  end if;
  select w.manufacturer_id, w.manufacturing_organization_id into v_manufacturer, v_mfg_org
    from public.case_workflows w where w.quote_request_id = o.quote_request_id;
  if v_mfg_org is null and v_manufacturer is null then
    raise exception 'LOCKED: 先に製造の担当（総代理店）を決めてください' using errcode = 'P0001';
  end if;

  -- 契約した見積の明細を、製造仕様のスナップショットとして残す（品名・数量だけ。価格は写さない）
  select * into q from public.quotes where id = o.quote_id;
  v_snapshot := jsonb_build_object(
    'quote_no', q.quote_no,
    'revision', q.revision,
    'base_model_name', q.base_model_name,
    'spec_code', to_jsonb(q) ->> 'spec_code',
    'finish_level', to_jsonb(q) ->> 'finish_level',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', qi.kind,
               'name', qi.name,
               'quantity', qi.quantity,
               'unit', to_jsonb(qi) ->> 'unit'
             ) order by qi.sort_order)
        from public.quote_items qi where qi.quote_id = q.id
    ), '[]'::jsonb)
  );

  update public.manufacturing_orders
     set status = 'sent',
         manufacturer_id = case when v_mfg_org is null then v_manufacturer else null end,
         manufacturing_organization_id = v_mfg_org,
         spec_snapshot = v_snapshot, sent_at = now(),
         lock_version = lock_version + 1, updated_by = v_uid
   where id = o.id;
  if v_mfg_org is not null then
    perform public.notify_organization_managers(v_mfg_org, 'manufacturing_order_sent', '製造依頼が届きました',
      '製造仕様・棟数・希望納期を確認し、受領してください。', '/admin/manufacturing');
  else
    perform public.notify(v_manufacturer, 'dealer', 'manufacturing_order_sent', '製造依頼が届きました',
      '製造仕様・棟数・希望納期を確認し、受領してください。', '/admin/manufacturing');
  end if;
  perform public.notify(null, 'admin', 'manufacturing_order_sent', '製造依頼を総代理店へ送りました',
    '案件の「製造・施工」タブで状況を確認できます。', '/admin/manufacturing');
  return o.lock_version + 1;
end;
$$;

-- これまでの「総代理店の利用者を製造の担当にする」は、営業担当組織が無い案件だけで使う
create or replace function public.set_case_manufacturer(p_request_id uuid, p_manufacturer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 技術検討・製造の担当を決められるのは本部だけです' using errcode = '42501';
  end if;
  if not exists (select 1 from public.quote_requests r where r.id = p_request_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.case_workflows w where w.quote_request_id = p_request_id and w.sales_organization_id is not null) then
    raise exception 'VALIDATION: 営業担当組織が決まっている案件の製造担当は、総代理店の組織から選んでください' using errcode = 'P0001';
  end if;
  if p_manufacturer_id is not null then
    select p.role_code into v_role from public.profiles p where p.id = p_manufacturer_id;
    if v_role is null or v_role <> 'master_dealer' then
      raise exception 'VALIDATION: 技術検討・製造の担当は総代理店から選んでください' using errcode = 'P0001';
    end if;
  end if;
  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  perform 1 from public.case_workflows w where w.quote_request_id = p_request_id for update;
  update public.case_workflows
     set manufacturer_id = p_manufacturer_id,
         manufacturer_assigned_at = case when p_manufacturer_id is null then null else now() end,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  if p_manufacturer_id is not null then
    perform public.notify(p_manufacturer_id, 'dealer', 'case_manufacturer_assigned',
      '技術検討・製造の担当に指定されました', '案件の仕様と現地確認の内容を確認し、技術検討を記録してください。',
      '/admin/manufacturing?request=' || p_request_id::text);
  end if;
end;
$$;

-- これまでの「見積に担当代理店を割り当てる」は、営業担当組織が無い案件だけで使う
create or replace function public.assign_quote_dealer(p_quote_id uuid, p_dealer_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (
    select 1
      from public.quotes x
      join public.case_workflows w on w.quote_request_id = x.quote_request_id
     where x.id = p_quote_id
       and w.sales_organization_id is not null
  ) then
    raise exception 'VALIDATION: 営業担当組織が決まっている案件は、組織の管理者（または本部）が主担当者を決めます'
      using errcode = 'P0001';
  end if;
  if p_dealer_id is not null
     and not exists (
       select 1
         from public.profiles p
        where p.id = p_dealer_id
          and public.role_rank(p.role_code) >= 1
     ) then
    raise exception 'VALIDATION: 代理店以上の権限を持つユーザーを指定してください'
      using errcode = 'P0001';
  end if;

  update public.quotes
     set dealer_id = p_dealer_id
   where id = p_quote_id
  returning * into q;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return q;
end;
$$;

-- 主担当者をそろえるときの、見積ごとの「担当になりました」の通知は止める（呼び出し側で 1 回だけ知らせる）
create or replace function public.trg_quote_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if new.revision = 1 then
      perform public.notify(null, 'admin', 'quote_requested',
        '新しい見積依頼：' || new.quote_no,
        new.customer_name || ' 様から見積依頼が届きました。担当代理店を割り当ててください。',
        '/admin/quotes/' || new.id);
    else
      perform public.notify(new.user_id, 'customer', 'quote_revised',
        '確定見積が届きました：' || new.quote_no,
        '代理店が別途工事を確認し、第' || new.revision || '版の確定見積を発行しました。',
        '/mypage/quotes/' || new.id);
    end if;
    return new;
  end if;

  if new.dealer_id is distinct from old.dealer_id and new.dealer_id is not null
     and coalesce(current_setting('wing.suppress_quote_assign_notify', true), '') <> 'on' then
    perform public.notify(new.dealer_id, 'dealer', 'quote_assigned',
      '別途工事の入力をお願いします：' || new.quote_no,
      new.customer_name || ' 様の見積です。下のリンクを開くと、そのまま別途工事とフリー商品を入力できます。',
      -- メールから 1 回で入力表まで飛べるようにする
      '/admin/quotes/' || new.id || '?from=mail#quote-editor');
  end if;

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    perform public.notify(null, 'admin', 'quote_' || new.status,
      '見積が' || (case new.status when 'accepted' then '承諾' else '辞退' end) || 'されました：' || new.quote_no,
      new.customer_name || ' 様が回答しました。',
      '/admin/quotes/' || new.id);
    if new.dealer_id is not null then
      perform public.notify(new.dealer_id, 'dealer', 'quote_' || new.status,
        '担当見積が' || (case new.status when 'accepted' then '承諾' else '辞退' end) || 'されました：' || new.quote_no,
        new.customer_name || ' 様が回答しました。',
        '/admin/quotes/' || new.id);
    end if;
  end if;
  return new;
end
$$;

-- ---------- 案件の担当・組織の情報（画面用） ----------

-- 案件の営業担当組織・製造担当組織・主担当者を返す（読める人だけ）。主担当者の候補（営業担当組織のメンバー）は、
-- 本部と営業担当組織の管理者にだけ返す
create function public.get_case_organizations(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.case_role(p_request_id);
  w public.case_workflows;
  v_can_assign boolean;
begin
  if v_role is null or v_role = 'customer' then
    return null;
  end if;
  select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id;
  v_can_assign := v_role = 'admin' or (w.sales_organization_id is not null and public.is_case_sales_manager(p_request_id));
  return jsonb_build_object(
    'sales_organization', (select jsonb_build_object('id', o.id, 'name', o.name, 'organization_type', o.organization_type)
                             from public.organizations o where o.id = w.sales_organization_id),
    'manufacturing_organization', (select jsonb_build_object('id', o.id, 'name', o.name)
                                     from public.organizations o where o.id = w.manufacturing_organization_id),
    'manufacturing_auto', coalesce(w.manufacturing_auto, true),
    'primary_staff', (select jsonb_build_object('id', p.id, 'full_name', p.full_name)
                        from public.profiles p where p.id = w.primary_staff_id),
    'viewer_role', v_role,
    'can_assign', v_can_assign,
    'candidates', case when v_can_assign and w.sales_organization_id is not null then coalesce((
                    select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name,
                             'member_role', m.member_role) order by case when m.member_role in ('owner', 'admin') then 0 else 1 end, p.full_name)
                      from public.organization_memberships m
                      join public.profiles p on p.id = m.profile_id
                     where m.organization_id = w.sales_organization_id and m.status = 'active'
                  ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- ---------- 代理店の案件一覧・顧客管理：営業担当組織の管理者を足す（最新の定義に条件を足したもの） ----------

-- 代理店の案件一覧：主担当者に加え、営業担当組織の管理者は自社の全案件を見られる
CREATE OR REPLACE FUNCTION public.list_dealer_quote_request_meta()
 RETURNS TABLE(quote_id uuid, request_status text, site_address text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    q.id,
    r.status,
    r.contact ->> 'site_address'
  from public.quotes as q
  join public.quote_requests as r on r.id = q.quote_request_id
  where (q.dealer_id = (select auth.uid()) or public.is_case_sales_manager(r.id))
    and (select public.is_dealer());
$function$;

-- 代理店の見積画面の案件情報：営業担当組織の管理者にも返す
CREATE OR REPLACE FUNCTION public.get_dealer_quote_request_current(p_quote_id uuid)
 RETURNS TABLE(quote_request_id uuid, is_current boolean, request_status text, site_address text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id,
         r.quote_id is not distinct from q.id,
         r.status,
         r.contact ->> 'site_address'
    from public.quotes q
    join public.quote_requests r on r.id = q.quote_request_id
   where q.id = p_quote_id
     and (q.dealer_id = (select auth.uid()) or public.is_case_sales_manager(r.id))
     and (select public.is_dealer());
$function$;

-- 顧客管理の一覧：営業担当組織の管理者は、自社の案件のお客様を見られる
CREATE OR REPLACE FUNCTION public.list_accessible_customers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rank integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  v_rank := public.current_role_rank();
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 顧客管理を閲覧できるのは代理店以上です'
      using errcode = '42501';
  end if;

  with accessible_requests as (
    select r.*
      from public.quote_requests as r
     where v_rank >= 3
        or exists (
          select 1
            from public.quotes as aq
           where aq.quote_request_id = r.id
             and aq.dealer_id = v_uid
        )
        or public.is_case_sales_manager(r.id)
  ),
  case_rows as (
    select
      r.id as case_id,
      r.user_id as request_user_id,
      r.status as request_status,
      r.contact,
      latest.id as latest_quote_id,
      latest.quote_no as latest_quote_no,
      latest.status as latest_quote_status,
      latest.base_model_name as latest_model_name,
      latest.dealer_id as latest_dealer_id,
      open_quote.id as open_quote_id,
      dealer.full_name as dealer_name,
      coalesce(
        nullif(btrim(r.contact ->> 'site_address'), ''),
        case
          when cfg.site_location_undecided then '未定'
          else nullif(concat_ws('', cfg.site_prefecture, cfg.site_municipality), '')
        end
      ) as site_address,
      coalesce(latest.base_model_name, model.name) as model_name,
      greatest(
        r.updated_at,
        r.created_at,
        coalesce(latest.updated_at, 'epoch'::timestamptz),
        coalesce(latest.issued_at, 'epoch'::timestamptz),
        coalesce(latest.created_at, 'epoch'::timestamptz),
        coalesce(cfg.updated_at, 'epoch'::timestamptz)
      ) as activity_at,
      case
        when latest.id is not null then latest.status in ('issued', 'accepted')
        else r.status in ('new', 'reviewing', 'sent')
      end as ongoing,
      case
        when exists (
          select 1
            from public.quotes as iq
           where iq.quote_request_id = r.id
             and iq.user_id <> r.user_id
        ) then 'inconsistent_user_id'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
        ) then 'missing_profile'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
             and ip.role_code = 'customer'
        ) then 'non_customer_profile'
        else 'none'
      end as identity_issue
    from accessible_requests as r
    left join public.configurations as cfg
      on cfg.id = r.configuration_id
    left join public.base_models as model
      on model.id = cfg.base_model_id
    left join lateral (
      select q.*
        from public.quotes as q
       where q.quote_request_id = r.id
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as latest on true
    left join lateral (
      select q.id
        from public.quotes as q
       where q.quote_request_id = r.id
         and (v_rank >= 3 or q.dealer_id = v_uid or public.is_case_sales_manager(r.id))
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as open_quote on true
    left join public.profiles as dealer
      on dealer.id = latest.dealer_id
  ),
  customer_rows as (
    select
      p.id,
      p.customer_no,
      p.full_name,
      p.company_name,
      p.email,
      p.phone,
      p.address,
      (
        select count(*)::integer
          from case_rows as oc
         where oc.identity_issue = 'none'
           and oc.request_user_id = p.id
           and oc.ongoing
      ) as ongoing_case_count,
      (
        select max(rc.activity_at)
          from case_rows as rc
         where rc.identity_issue = 'none'
           and rc.request_user_id = p.id
      ) as recent_activity,
      (
        select jsonb_build_object(
          'id', rc.case_id,
          'open_quote_id', rc.open_quote_id,
          'quote_no', rc.latest_quote_no,
          'model_name', rc.model_name,
          'site_address', rc.site_address,
          'activity_at', rc.activity_at,
          'dealer_name', rc.dealer_name
        )
          from case_rows as rc
         where rc.identity_issue = 'none'
           and rc.request_user_id = p.id
         order by rc.activity_at desc, rc.case_id desc
         limit 1
      ) as recent_case
    from public.profiles as p
    where p.role_code = 'customer'
      and (
        v_rank >= 3
        or exists (
          select 1
            from case_rows as ac
           where ac.identity_issue = 'none'
             and ac.request_user_id = p.id
        )
      )
  )
  select jsonb_build_object(
    'customers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'customer_no', c.customer_no,
            'full_name', c.full_name,
            'company_name', c.company_name,
            'email', c.email,
            'phone', c.phone,
            'address', c.address,
            'ongoing_case_count', c.ongoing_case_count,
            'recent_case', c.recent_case
          )
          order by c.recent_activity desc nulls last, c.full_name, c.id
        )
          from customer_rows as c
      ),
      '[]'::jsonb
    ),
    'unlinked_cases',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', uc.case_id,
            'full_name', coalesce(
              nullif(btrim(uc.contact ->> 'full_name'), ''),
              (
                select q.customer_name
                  from public.quotes as q
                 where q.quote_request_id = uc.case_id
                 order by q.revision desc, q.issued_at desc, q.id desc
                 limit 1
              ),
              '顧客名未登録'
            ),
            'company_name', coalesce(
              nullif(btrim(uc.contact ->> 'company_name'), ''),
              (
                select q.customer_company
                  from public.quotes as q
                 where q.quote_request_id = uc.case_id
                 order by q.revision desc, q.issued_at desc, q.id desc
                 limit 1
              )
            ),
            'identity_issue', uc.identity_issue,
            'open_quote_id', uc.open_quote_id,
            'quote_no', uc.latest_quote_no,
            'model_name', uc.model_name,
            'site_address', uc.site_address,
            'activity_at', uc.activity_at,
            'dealer_name', uc.dealer_name
          )
          order by uc.activity_at desc, uc.case_id desc
        )
          from case_rows as uc
         where uc.identity_issue <> 'none'
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- 顧客管理の詳細：営業担当組織の管理者は、自社の案件のお客様と見積を見られる
CREATE OR REPLACE FUNCTION public.get_accessible_customer_detail(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rank integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  v_rank := public.current_role_rank();
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 顧客管理を閲覧できるのは代理店以上です'
      using errcode = '42501';
  end if;

  with accessible_requests as (
    select r.*
      from public.quote_requests as r
     where v_rank >= 3
        or exists (
          select 1
            from public.quotes as aq
           where aq.quote_request_id = r.id
             and aq.dealer_id = v_uid
        )
        or public.is_case_sales_manager(r.id)
  ),
  case_rows as (
    select
      r.id as case_id,
      r.user_id as request_user_id,
      r.status as request_status,
      r.message,
      r.contact,
      latest.id as latest_quote_id,
      latest.quote_no as latest_quote_no,
      latest.status as latest_quote_status,
      latest.revision as latest_quote_revision,
      latest.base_model_name as latest_model_name,
      latest.issued_at as latest_issued_at,
      latest.total as latest_total,
      latest.dealer_id as latest_dealer_id,
      open_quote.id as open_quote_id,
      dealer.full_name as dealer_name,
      dealer.company_name as dealer_company,
      coalesce(
        nullif(btrim(r.contact ->> 'site_address'), ''),
        case
          when cfg.site_location_undecided then '未定'
          else nullif(concat_ws('', cfg.site_prefecture, cfg.site_municipality), '')
        end
      ) as site_address,
      case
        when nullif(btrim(r.contact ->> 'site_address'), '') is not null then 'quote_contact'
        when cfg.site_location_undecided
          or cfg.site_prefecture is not null
          or cfg.site_municipality is not null then 'configuration'
        else null
      end as site_source,
      coalesce(latest.base_model_name, model.name) as model_name,
      greatest(
        r.updated_at,
        r.created_at,
        coalesce(latest.updated_at, 'epoch'::timestamptz),
        coalesce(latest.issued_at, 'epoch'::timestamptz),
        coalesce(latest.created_at, 'epoch'::timestamptz),
        coalesce(cfg.updated_at, 'epoch'::timestamptz)
      ) as activity_at,
      case
        when latest.id is not null then latest.status in ('issued', 'accepted')
        else r.status in ('new', 'reviewing', 'sent')
      end as ongoing,
      case
        when exists (
          select 1
            from public.quotes as iq
           where iq.quote_request_id = r.id
             and iq.user_id <> r.user_id
        ) then 'inconsistent_user_id'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
        ) then 'missing_profile'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
             and ip.role_code = 'customer'
        ) then 'non_customer_profile'
        else 'none'
      end as identity_issue
    from accessible_requests as r
    left join public.configurations as cfg
      on cfg.id = r.configuration_id
    left join public.base_models as model
      on model.id = cfg.base_model_id
    left join lateral (
      select q.*
        from public.quotes as q
       where q.quote_request_id = r.id
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as latest on true
    left join lateral (
      select q.id
        from public.quotes as q
       where q.quote_request_id = r.id
         and (v_rank >= 3 or q.dealer_id = v_uid or public.is_case_sales_manager(r.id))
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as open_quote on true
    left join public.profiles as dealer
      on dealer.id = latest.dealer_id
  ),
  target_customer as (
    select
      p.id,
      p.customer_no,
      p.full_name,
      p.company_name,
      p.email,
      p.phone,
      p.postal_code,
      p.address,
      p.created_at
    from public.profiles as p
    where p.id = p_customer_id
      and p.role_code = 'customer'
      and (
        v_rank >= 3
        or exists (
          select 1
            from case_rows as ac
           where ac.identity_issue = 'none'
             and ac.request_user_id = p.id
        )
      )
  )
  select jsonb_build_object(
    'customer',
    jsonb_build_object(
      'id', p.id,
      'customer_no', p.customer_no,
      'full_name', p.full_name,
      'company_name', p.company_name,
      'email', p.email,
      'phone', p.phone,
      'postal_code', p.postal_code,
      'address', p.address,
      'created_at', p.created_at
    ),
    'latest_contact',
    (
      select jsonb_build_object(
        'full_name', coalesce(lc.contact ->> 'full_name', ''),
        'company_name', nullif(lc.contact ->> 'company_name', ''),
        'email', coalesce(lc.contact ->> 'email', ''),
        'phone', coalesce(lc.contact ->> 'phone', ''),
        'address', coalesce(lc.contact ->> 'address', ''),
        'site_address', nullif(lc.contact ->> 'site_address', '')
      )
        from case_rows as lc
       where lc.identity_issue = 'none'
         and lc.request_user_id = p.id
       order by lc.activity_at desc, lc.case_id desc
       limit 1
    ),
    'cases',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', cr.case_id,
            'request_status', cr.request_status,
            'message', cr.message,
            'contact', jsonb_build_object(
              'full_name', coalesce(cr.contact ->> 'full_name', ''),
              'company_name', nullif(cr.contact ->> 'company_name', ''),
              'email', coalesce(cr.contact ->> 'email', ''),
              'phone', coalesce(cr.contact ->> 'phone', ''),
              'address', coalesce(cr.contact ->> 'address', ''),
              'site_address', nullif(cr.contact ->> 'site_address', '')
            ),
            'site_address', cr.site_address,
            'site_source', cr.site_source,
            'ongoing', cr.ongoing,
            'activity_at', cr.activity_at,
            'model_name', cr.model_name,
            'dealer_name', cr.dealer_name,
            'dealer_company', cr.dealer_company,
            'open_quote_id', cr.open_quote_id,
            'latest_quote',
              case
                when cr.latest_quote_id is null then null
                else jsonb_build_object(
                  'id', cr.latest_quote_id,
                  'case_id', cr.case_id,
                  'quote_no', cr.latest_quote_no,
                  'revision', cr.latest_quote_revision,
                  'status', cr.latest_quote_status,
                  'base_model_name', cr.latest_model_name,
                  'issued_at', cr.latest_issued_at,
                  'total', cr.latest_total,
                  'can_open_quote', v_rank >= 3 or cr.latest_dealer_id = v_uid or public.is_case_sales_manager(cr.case_id)
                )
              end
          )
          order by cr.activity_at desc, cr.case_id desc
        )
          from case_rows as cr
         where cr.identity_issue = 'none'
           and cr.request_user_id = p.id
      ),
      '[]'::jsonb
    ),
    'quote_history',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', q.id,
            'case_id', cr.case_id,
            'quote_no', q.quote_no,
            'revision', q.revision,
            'status', q.status,
            'base_model_name', q.base_model_name,
            'issued_at', q.issued_at,
            'total', q.total,
            'can_open_quote', v_rank >= 3 or q.dealer_id = v_uid or public.is_case_sales_manager(cr.case_id)
          )
          order by q.issued_at desc, q.revision desc, q.updated_at desc, q.id desc
        )
          from case_rows as cr
          join public.quotes as q
            on q.quote_request_id = cr.case_id
         where cr.identity_issue = 'none'
           and cr.request_user_id = p.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from target_customer as p;

  -- 存在しない顧客と権限外の顧客はどちらもnullを返す。
  return v_result;
end;
$function$;

-- アフターを製造担当へ回す：組織の案件は製造担当組織（の管理者）へ、これまでの案件は総代理店の利用者へ
CREATE OR REPLACE FUNCTION public.update_after_service_request(p_id uuid, p_update jsonb, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.after_service_requests;
  v_access text;
  v_status text;
  v_manufacturer uuid;
  v_mfg_org uuid;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_row from public.after_service_requests where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(v_row.quote_request_id);
  -- 回されていないものは、総代理店には存在も分からないようにする
  if v_access = 'manufacturer' and v_row.escalated_at is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_access is null or v_access = 'customer' then
    raise exception 'FORBIDDEN: このアフターを更新する権限がありません' using errcode = '42501';
  end if;
  if p_update is null or jsonb_typeof(p_update) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_status := coalesce(public.cf_text(p_update, 'status', 20, '状態'), v_row.status);
  if v_status not in ('open', 'in_progress', 'escalated', 'resolved') then
    raise exception 'VALIDATION: 状態が正しくありません' using errcode = 'P0001';
  end if;
  if v_access = 'manufacturer' and v_status not in ('escalated', 'resolved') then
    raise exception 'FORBIDDEN: 製造の担当は、回されたアフターの回答と完了だけ記録できます' using errcode = '42501';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でアフターが更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if v_row.status = 'resolved' and v_status <> 'resolved' then
    raise exception 'LOCKED: 完了したアフターは戻せません。新しいご依頼として登録してください' using errcode = 'P0001';
  end if;
  if v_status = 'escalated' and v_row.status <> 'escalated' then
    select w.manufacturer_id, w.manufacturing_organization_id into v_manufacturer, v_mfg_org
      from public.case_workflows w where w.quote_request_id = v_row.quote_request_id;
    if v_manufacturer is null and v_mfg_org is null then
      raise exception 'LOCKED: 製造の担当（総代理店）が決まっていない案件です。先に本部が製造の担当を決めてください' using errcode = 'P0001';
    end if;
  end if;

  update public.after_service_requests
     set status = v_status,
         response = case when p_update ? 'response' then public.cf_text(p_update, 'response', 2000, 'お客様への回答') else response end,
         escalated_at = case when v_status = 'escalated' and escalated_at is null then now() else escalated_at end,
         resolved_at = case when v_status = 'resolved' then coalesce(resolved_at, now()) else null end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = v_row.id;

  if v_mfg_org is not null then
    perform public.notify_organization_managers(v_mfg_org, 'after_service_escalated', '製造起因のアフターが回ってきました：' || v_row.title,
      '修補・部材供給の対応をお願いします。', '/admin/after-service');
  elsif v_manufacturer is not null then
    perform public.notify(v_manufacturer, 'dealer', 'after_service_escalated', '製造起因のアフターが回ってきました：' || v_row.title,
      '修補・部材供給の対応をお願いします。', '/admin/after-service');
  end if;
  if v_status = 'resolved' and v_row.status <> 'resolved' then
    select r.user_id into v_customer from public.quote_requests r where r.id = v_row.quote_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'after_service_resolved', 'アフターのご依頼に対応しました：' || v_row.title,
        'マイページの「ご依頼の進み具合」で回答をご確認ください。', '/mypage/cases/' || v_row.quote_request_id::text);
    end if;
  end if;
  return v_row.lock_version + 1;
end;
$function$;

-- ---------- 所有者と実行権限 ----------

alter function public.validate_case_workflow_organizations() owner to postgres;
alter function public.is_active_organization_member(uuid, uuid) owner to postgres;
alter function public.is_case_sales_manager(uuid) owner to postgres;
alter function public.is_case_supervisor(uuid) owner to postgres;
alter function public.default_manufacturing_organization(uuid) owner to postgres;
alter function public.notify_organization_managers(uuid, text, text, text, text) owner to postgres;
alter function public.case_role(uuid) owner to postgres;
alter function public.is_case_legacy_manufacturer(uuid) owner to postgres;
alter function public.apply_case_main_staff(uuid, uuid, uuid) owner to postgres;
alter function public.write_case_audit(uuid, text, text, jsonb, jsonb) owner to postgres;
alter function public.set_case_sales_organization(uuid, uuid) owner to postgres;
alter function public.set_case_manufacturing_organization(uuid, uuid) owner to postgres;
alter function public.get_case_organizations(uuid) owner to postgres;

-- 内部用（利用者からは呼ばせない）
revoke all on function public.validate_case_workflow_organizations() from public, anon, authenticated, service_role;
revoke all on function public.is_active_organization_member(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_case_supervisor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.default_manufacturing_organization(uuid) from public, anon, authenticated, service_role;
revoke all on function public.notify_organization_managers(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.apply_case_main_staff(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.write_case_audit(uuid, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;

-- 権限の判定（RLS から呼ぶ。自分の関わり方だけを返す）。見積の表は未ログインでも RLS を通るため、is_case_sales_manager は anon にも許す
revoke all on function public.is_case_sales_manager(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_case_sales_manager(uuid) to anon, authenticated;
revoke all on function public.case_role(uuid) from public, anon, authenticated, service_role;
grant execute on function public.case_role(uuid) to authenticated;
revoke all on function public.is_case_legacy_manufacturer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_case_legacy_manufacturer(uuid) to authenticated;

-- 画面から呼ぶ RPC（中で本部・営業担当組織の管理者を確かめる）
revoke all on function public.set_case_sales_organization(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_case_manufacturing_organization(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_case_organizations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_case_sales_organization(uuid, uuid) to authenticated;
grant execute on function public.set_case_manufacturing_organization(uuid, uuid) to authenticated;
grant execute on function public.get_case_organizations(uuid) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn record;
  v_internal text[] := array['validate_case_workflow_organizations', 'is_active_organization_member', 'is_case_supervisor',
                             'default_manufacturing_organization', 'notify_organization_managers', 'apply_case_main_staff', 'write_case_audit'];
begin
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'validate_case_workflow_organizations', 'is_active_organization_member', 'is_case_sales_manager', 'is_case_supervisor',
         'default_manufacturing_organization', 'notify_organization_managers', 'case_role', 'is_case_legacy_manufacturer',
         'apply_case_main_staff', 'write_case_audit', 'set_case_sales_organization', 'set_case_manufacturing_organization', 'get_case_organizations',
         'case_access', 'assign_case_primary_staff', 'acknowledge_case', 'set_quote_request_preferences', 'get_case_progress',
         'configuration_site_profile_access', 'get_case_plan_configuration', 'send_manufacturing_order', 'set_case_manufacturer',
         'assign_quote_dealer', 'list_dealer_quote_request_meta', 'get_dealer_quote_request_current',
         'list_accessible_customers', 'get_accessible_customer_detail', 'update_after_service_request'
       )
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if v_fn.proname = any (v_internal) and (
      has_function_privilege('anon', v_fn.oid, 'EXECUTE')
      or has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
      or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
    ) then
      raise exception 'POSTCONDITION: internal function % must not be executable by application roles', v_fn.proname;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.case_role(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_case_legacy_manufacturer(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_case_sales_organization(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_case_manufacturing_organization(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_case_organizations(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: case organization RPCs must not be executable by anon';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.case_workflows'::regclass and tgname = 'case_workflows_organizations_validate' and not tgisinternal) then
    raise exception 'POSTCONDITION: case_workflows_organizations_validate trigger is missing';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and qual ~ 'case_role') < 15 then
    raise exception 'POSTCONDITION: case read policies must use case_role()';
  end if;
end;
$postcondition$;

commit;
