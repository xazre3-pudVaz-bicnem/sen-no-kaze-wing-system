-- =============================================================
-- master_dealer案件閲覧境界 corrective
--
-- 商品台帳編集権限 can_edit_catalog() と案件・顧客閲覧権限を分離する。
-- 本部(admin)だけが全案件を閲覧でき、dealer / master_dealer は
-- dealer_id = auth.uid() の担当QuoteだけをData APIから閲覧できる。
--
-- quote_requests / profiles は担当者向けに直接開放しない。
-- 顧客管理・案件メタデータは専用SECURITY DEFINER RPCから返す。
-- =============================================================

begin;

-- ---------- 顧客・案件系 SELECT RLS ----------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select
using (
  id = auth.uid()
  or public.is_admin()
);

drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
for select
using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.is_dealer() and dealer_id = auth.uid())
);

drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items
for select
using (
  exists (
    select 1
      from public.quotes q
     where q.id = quote_id
       and (
         q.user_id = auth.uid()
         or public.is_admin()
         or (public.is_dealer() and q.dealer_id = auth.uid())
       )
  )
);

drop policy if exists quote_requests_select on public.quote_requests;
create policy quote_requests_select on public.quote_requests
for select
using (
  user_id = auth.uid()
  or public.is_admin()
);

-- ---------- 案件プランボード ----------
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

  if not (v_rank >= 3 or (v_rank >= 1 and v_quote.dealer_id = v_uid)) then
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

alter function public.get_case_plan_configuration(uuid) owner to postgres;

do $$
begin
  if pg_catalog.pg_get_userbyid(
       (
         select p.proowner
           from pg_catalog.pg_proc p
          where p.oid = 'public.get_case_plan_configuration(uuid)'::regprocedure
       )
     ) <> 'postgres' then
    raise exception 'CASE_PLAN_CONFIGURATION_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.get_case_plan_configuration(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_case_plan_configuration(uuid) to authenticated;

commit;
