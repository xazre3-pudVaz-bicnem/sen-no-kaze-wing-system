-- 20261025101000（下書き商品の選択項目・選択肢の安全削除）の適用直前の確認。読み取りだけ（件数・真偽・権限だけを返す）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-unused-draft-variant-delete.sql
--
-- 止める条件：guard_present・variant_tables_present・rpc_absent のどれかが false
-- （migration の中の確認でも止まる）。dangling_* は適用を止めないが、0 でなければ報告する（表示条件の参照先が既に無い行）。
select
  to_regprocedure('public.assert_option_unreferenced(uuid, text)') is not null
    and to_regprocedure('public.can_edit_catalog()') is not null as guard_present,
  to_regclass('public.option_variant_groups') is not null
    and to_regclass('public.option_variant_choices') is not null as variant_tables_present,
  to_regprocedure('public.delete_unused_variant_choice(uuid, uuid)') is null
    and to_regprocedure('public.delete_unused_variant_group(uuid, uuid)') is null as rpc_absent,
  has_table_privilege('authenticated', 'public.option_variant_choices', 'delete') as authenticated_can_delete_choices,
  has_table_privilege('service_role', 'public.option_variant_choices', 'delete') as service_role_can_delete_choices,
  (select count(*) from public.options where status = 'draft') as draft_products,
  (select count(*) from public.option_variant_groups g join public.options o on o.id = g.option_id where o.status = 'draft') as draft_variant_groups,
  (select count(*) from public.option_variant_choices c join public.option_variant_groups g on g.id = c.group_id
     join public.options o on o.id = g.option_id where o.status = 'draft') as draft_variant_choices,
  (select count(*) from public.option_variant_groups child
    where child.depends_on_group_code is not null
      and not exists (select 1 from public.option_variant_groups parent
                       where parent.option_id = child.option_id and parent.code = child.depends_on_group_code)) as dangling_group_conditions,
  (select count(*) from public.option_variant_groups child
     cross join lateral unnest(coalesce(child.depends_on_choice_codes, '{}'::text[])) as dep(code)
    where child.depends_on_group_code is not null
      and not exists (select 1 from public.option_variant_groups parent
                        join public.option_variant_choices pc on pc.group_id = parent.id
                       where parent.option_id = child.option_id and parent.code = child.depends_on_group_code
                         and pc.code = dep.code)) as dangling_choice_conditions;
