-- 商品台帳の公開価格とは分離して、本部だけが扱う現在の基準原価を保持する。
-- この値は実仕入価格・案件実原価・Published Standard Estimate / issued Quote の正本ではない。
-- Standard Estimate / Quote への自動連携はこの migration の責務外。

create table public.option_hq_standard_costs (
  option_id uuid primary key references public.options(id) on delete restrict,
  standard_cost integer not null check (standard_cost >= 0),
  lock_version integer not null default 1 check (lock_version >= 1),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.option_hq_standard_costs enable row level security;

-- 本部商品基準原価は公開商品テーブルと同じACLにしない。
revoke all on table public.option_hq_standard_costs from public, anon, authenticated, service_role;
grant select on table public.option_hq_standard_costs to authenticated;

create or replace function public.can_view_option_hq_standard_cost()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role_code = 'admin'
    )
    or exists (
      select 1
      from public.organization_memberships om
      join public.organizations o on o.id = om.organization_id
      where om.profile_id = auth.uid()
        and om.status = 'active'
        and om.member_role in ('owner', 'admin', 'editor')
        and o.status = 'active'
        and o.organization_type = 'headquarters'
    );
$$;

create or replace function public.can_manage_option_hq_standard_cost()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role_code = 'admin'
    )
    or exists (
      select 1
      from public.organization_memberships om
      join public.organizations o on o.id = om.organization_id
      where om.profile_id = auth.uid()
        and om.status = 'active'
        and om.member_role in ('owner', 'admin')
        and o.status = 'active'
        and o.organization_type = 'headquarters'
    );
$$;

alter function public.can_view_option_hq_standard_cost() owner to postgres;
alter function public.can_manage_option_hq_standard_cost() owner to postgres;
revoke all on function public.can_view_option_hq_standard_cost() from public, anon, authenticated, service_role;
revoke all on function public.can_manage_option_hq_standard_cost() from public, anon, authenticated, service_role;
grant execute on function public.can_view_option_hq_standard_cost() to authenticated;
grant execute on function public.can_manage_option_hq_standard_cost() to authenticated;

create policy option_hq_standard_costs_hq_read
on public.option_hq_standard_costs
for select
to authenticated
using (public.can_view_option_hq_standard_cost());

create or replace function public.set_option_hq_standard_cost(
  p_option_id uuid,
  p_standard_cost integer,
  p_expected_lock_version integer,
  p_change_reason text
)
returns table (
  option_id uuid,
  standard_cost integer,
  lock_version integer,
  changed boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := pg_catalog.btrim(coalesce(p_change_reason, ''));
  v_option public.options%rowtype;
  v_current public.option_hq_standard_costs%rowtype;
  v_next public.option_hq_standard_costs%rowtype;
  v_actor_email text;
  v_has_current boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;

  if not public.can_manage_option_hq_standard_cost() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 本部商品基準原価を変更する権限がありません';
  end if;

  if p_option_id is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 商品IDがありません';
  end if;
  if p_standard_cost is null or p_standard_cost < 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本部商品基準原価は0円以上で入力してください';
  end if;
  if p_expected_lock_version is null or p_expected_lock_version < 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 読み込んだ版が不正です';
  end if;
  if pg_catalog.char_length(v_reason) < 1 or pg_catalog.char_length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 変更理由は1〜500文字で入力してください';
  end if;

  -- 商品削除RPCとのlock順序を揃えるため、必ずoptionsを先にロックする。
  select *
    into v_option
  from public.options o
  where o.id = p_option_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 商品が見つかりません';
  end if;
  if v_option.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この状態の商品には本部商品基準原価を設定できません';
  end if;

  select *
    into v_current
  from public.option_hq_standard_costs c
  where c.option_id = p_option_id
  for update;
  v_has_current := found;

  select p.email into v_actor_email
  from public.profiles p
  where p.id = v_actor;

  if not v_has_current then
    if p_expected_lock_version <> 0 then
      raise exception using errcode = 'P0001', message = 'CONFLICT: 本部商品基準原価が他の担当者によって変更されています。再読み込みしてください';
    end if;

    insert into public.option_hq_standard_costs (
      option_id, standard_cost, lock_version, created_by, created_at, updated_by, updated_at
    ) values (
      p_option_id, p_standard_cost, 1, v_actor, now(), v_actor, now()
    )
    returning * into v_next;

    insert into public.audit_logs (
      actor_id, actor_email, action, entity, entity_id, summary, before, after
    ) values (
      v_actor,
      v_actor_email,
      'hq_standard_cost_set',
      'option_hq_standard_cost',
      p_option_id,
      '本部商品基準原価を設定',
      null,
      pg_catalog.jsonb_build_object(
        'standard_cost', v_next.standard_cost,
        'lock_version', v_next.lock_version,
        'product_no', v_option.product_no,
        'product_name', v_option.name,
        'actor_id', v_actor,
        'change_reason', v_reason
      )
    );

    return query select v_next.option_id, v_next.standard_cost, v_next.lock_version, true, v_next.updated_at;
    return;
  end if;

  if v_current.lock_version <> p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'CONFLICT: 本部商品基準原価が他の担当者によって変更されています。再読み込みしてください';
  end if;

  -- 同額かつversion一致はno-op。履歴もversionも増やさない。
  if v_current.standard_cost = p_standard_cost then
    return query select v_current.option_id, v_current.standard_cost, v_current.lock_version, false, v_current.updated_at;
    return;
  end if;

  update public.option_hq_standard_costs c
  set standard_cost = p_standard_cost,
      lock_version = c.lock_version + 1,
      updated_by = v_actor,
      updated_at = now()
  where c.option_id = p_option_id
  returning * into v_next;

  insert into public.audit_logs (
    actor_id, actor_email, action, entity, entity_id, summary, before, after
  ) values (
    v_actor,
    v_actor_email,
    'hq_standard_cost_update',
    'option_hq_standard_cost',
    p_option_id,
    '本部商品基準原価を変更',
    pg_catalog.jsonb_build_object(
      'standard_cost', v_current.standard_cost,
      'lock_version', v_current.lock_version,
      'product_no', v_option.product_no,
      'product_name', v_option.name,
      'actor_id', v_actor
    ),
    pg_catalog.jsonb_build_object(
      'standard_cost', v_next.standard_cost,
      'lock_version', v_next.lock_version,
      'product_no', v_option.product_no,
      'product_name', v_option.name,
      'actor_id', v_actor,
      'change_reason', v_reason
    )
  );

  return query select v_next.option_id, v_next.standard_cost, v_next.lock_version, true, v_next.updated_at;
end;
$$;

alter function public.set_option_hq_standard_cost(uuid, integer, integer, text) owner to postgres;
revoke all on function public.set_option_hq_standard_cost(uuid, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.set_option_hq_standard_cost(uuid, integer, integer, text) to authenticated;

-- migration自体で、機密テーブル・SECURITY DEFINERの最低限の契約をfail-closedで検査する。
do $$
declare
  v_table_oid oid := 'public.option_hq_standard_costs'::regclass;
  v_fk_delete "char";
  v_rls boolean;
  v_policy boolean;
  v_fn record;
begin
  select c.relrowsecurity into v_rls
  from pg_catalog.pg_class c
  where c.oid = v_table_oid;
  if v_rls is distinct from true then
    raise exception 'POSTCONDITION: option_hq_standard_costs RLS is not enabled';
  end if;

  select con.confdeltype into v_fk_delete
  from pg_catalog.pg_constraint con
  where con.conrelid = v_table_oid
    and con.contype = 'f'
    and con.confrelid = 'public.options'::regclass;
  if v_fk_delete is distinct from 'r'::"char" then
    raise exception 'POSTCONDITION: option FK must be ON DELETE RESTRICT';
  end if;

  if has_table_privilege('anon', v_table_oid, 'SELECT')
     or has_table_privilege('anon', v_table_oid, 'INSERT')
     or has_table_privilege('anon', v_table_oid, 'UPDATE')
     or has_table_privilege('anon', v_table_oid, 'DELETE')
     or has_table_privilege('anon', v_table_oid, 'TRUNCATE')
     or has_table_privilege('anon', v_table_oid, 'REFERENCES')
     or has_table_privilege('anon', v_table_oid, 'TRIGGER')
     or has_table_privilege('anon', v_table_oid, 'MAINTAIN') then
    raise exception 'POSTCONDITION: anon retains option_hq_standard_costs privileges';
  end if;

  if not has_table_privilege('authenticated', v_table_oid, 'SELECT')
     or has_table_privilege('authenticated', v_table_oid, 'INSERT')
     or has_table_privilege('authenticated', v_table_oid, 'UPDATE')
     or has_table_privilege('authenticated', v_table_oid, 'DELETE')
     or has_table_privilege('authenticated', v_table_oid, 'TRUNCATE')
     or has_table_privilege('authenticated', v_table_oid, 'REFERENCES')
     or has_table_privilege('authenticated', v_table_oid, 'TRIGGER')
     or has_table_privilege('authenticated', v_table_oid, 'MAINTAIN') then
    raise exception 'POSTCONDITION: authenticated option_hq_standard_costs ACL is not SELECT-only';
  end if;

  if has_table_privilege('service_role', v_table_oid, 'SELECT')
     or has_table_privilege('service_role', v_table_oid, 'INSERT')
     or has_table_privilege('service_role', v_table_oid, 'UPDATE')
     or has_table_privilege('service_role', v_table_oid, 'DELETE')
     or has_table_privilege('service_role', v_table_oid, 'TRUNCATE')
     or has_table_privilege('service_role', v_table_oid, 'REFERENCES')
     or has_table_privilege('service_role', v_table_oid, 'TRIGGER')
     or has_table_privilege('service_role', v_table_oid, 'MAINTAIN') then
    raise exception 'POSTCONDITION: service_role retains option_hq_standard_costs privileges';
  end if;

  select exists (
    select 1 from pg_catalog.pg_policy p
    where p.polrelid = v_table_oid
      and p.polname = 'option_hq_standard_costs_hq_read'
      and p.polcmd = 'r'
  ) into v_policy;
  if not v_policy then
    raise exception 'POSTCONDITION: HQ cost SELECT policy is missing';
  end if;

  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) as owner_name, p.proconfig
    from pg_catalog.pg_proc p
    where p.oid in (
      'public.can_view_option_hq_standard_cost()'::regprocedure,
      'public.can_manage_option_hq_standard_cost()'::regprocedure,
      'public.set_option_hq_standard_cost(uuid,integer,integer,text)'::regprocedure
    )
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % EXECUTE ACL mismatch', v_fn.proname;
    end if;
  end loop;
end;
$$;
