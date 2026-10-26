-- 20261025101000（下書き商品の選択項目・選択肢の安全削除）の適用後の確認。読み取りだけ（真偽・関数の属性だけを返す）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/postflight-unused-draft-variant-delete.sql
--
-- 合格の条件：rpc_present・rpc_authenticated_only・direct_delete_closed がすべて true、rpc_attributes が postgres・SECURITY DEFINER・search_path 空。
select
  to_regprocedure('public.delete_unused_variant_choice(uuid, uuid)') is not null
    and to_regprocedure('public.delete_unused_variant_group(uuid, uuid)') is not null as rpc_present,
  has_function_privilege('authenticated', 'public.delete_unused_variant_choice(uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.delete_unused_variant_group(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.delete_unused_variant_choice(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.delete_unused_variant_group(uuid, uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.delete_unused_variant_choice(uuid, uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.delete_unused_variant_group(uuid, uuid)', 'execute') as rpc_authenticated_only,
  not has_table_privilege('authenticated', 'public.option_variant_choices', 'delete')
    and not has_table_privilege('authenticated', 'public.option_variant_groups', 'delete')
    and not has_table_privilege('service_role', 'public.option_variant_choices', 'delete')
    and not has_table_privilege('service_role', 'public.option_variant_groups', 'delete')
    and not has_table_privilege('anon', 'public.option_variant_choices', 'delete')
    and not has_table_privilege('anon', 'public.option_variant_groups', 'delete') as direct_delete_closed,
  (select json_agg(json_build_object('fn', p.oid::regprocedure::text, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
                                     'security_definer', p.prosecdef, 'config', p.proconfig)
                   order by p.oid::regprocedure::text)
     from pg_catalog.pg_proc p
    where p.oid in (to_regprocedure('public.delete_unused_variant_choice(uuid, uuid)'),
                    to_regprocedure('public.delete_unused_variant_group(uuid, uuid)'))) as rpc_attributes;
