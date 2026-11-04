-- トリガー専用の関数 26 本の EXECUTE を外す corrective（20261016114000）の本番適用前の確認
-- SELECT だけ（カタログの参照）。データ・個人情報は読まない。
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-trigger-functions-execute.sql
with expected (fn, tbl, trg) as (
  values
    ('public.assign_customer_no()', 'public.profiles', 'trg_profiles_customer_no'),
    ('public.enforce_base_master_owner_type()', 'public.base_masters', 'base_masters_owner_type'),
    ('public.handle_new_user()', 'auth.users', 'on_auth_user_created'),
    ('public.prevent_locked_base_breakdown_edit()', 'public.base_breakdown_items', 'base_breakdown_template_lock'),
    ('public.prevent_non_draft_base_master_line_write()', 'public.base_master_revision_lines', 'base_master_revision_lines_draft_only'),
    ('public.prevent_non_draft_standard_estimate_child_write()', 'public.standard_estimate_revision_baseline_items', 'standard_estimate_revision_baseline_items_draft_only'),
    ('public.prevent_non_draft_standard_estimate_child_write()', 'public.standard_estimate_revision_lines', 'standard_estimate_revision_lines_draft_only'),
    ('public.prevent_non_draft_standard_estimate_child_write()', 'public.standard_estimate_revision_sections', 'standard_estimate_revision_sections_draft_only'),
    ('public.prevent_non_draft_standard_estimate_variant_write()', 'public.standard_estimate_revision_baseline_variants', 'standard_estimate_revision_baseline_variants_draft_only'),
    ('public.prevent_published_base_master_revision_mutation()', 'public.base_master_revisions', 'base_master_revisions_immutable'),
    ('public.prevent_published_standard_estimate_revision_mutation()', 'public.standard_estimate_revisions', 'standard_estimate_revisions_immutable'),
    ('public.prevent_standard_estimate_master_identity_change_after_revision()', 'public.standard_estimate_masters', 'standard_estimate_masters_identity_immutable'),
    ('public.prevent_unreviewed_legacy_base_migration_publish()', 'public.base_master_revisions', 'legacy_base_migration_publish_guard'),
    ('public.trg_audit_model()', 'public.base_models', 'trg_base_models_audit'),
    ('public.trg_audit_role()', 'public.profiles', 'trg_profiles_audit'),
    ('public.trg_contact_notify()', 'public.contact_messages', 'trg_contact_messages_notify'),
    ('public.trg_quote_notify()', 'public.quotes', 'trg_quotes_notify_ins'),
    ('public.trg_quote_notify()', 'public.quotes', 'trg_quotes_notify_upd'),
    ('public.validate_base_master_current_pointer_at_commit()', 'public.base_master_revisions', 'base_master_current_pointer_consistency'),
    ('public.validate_base_master_revision_refs()', 'public.base_masters', 'base_masters_revision_refs'),
    ('public.validate_configuration_exterior_faces()', 'public.configurations', 'configurations_exterior_faces_validate'),
    ('public.validate_quote_base_revision_ref()', 'public.quote_drafts', 'quote_drafts_base_revision_ref'),
    ('public.validate_quote_base_revision_ref()', 'public.quotes', 'quotes_base_revision_ref'),
    ('public.validate_quote_draft_parent_ref()', 'public.quote_drafts', 'quote_drafts_parent_ref'),
    ('public.validate_standard_estimate_base_revision_ref()', 'public.standard_estimate_revisions', 'standard_estimate_revisions_base_ref'),
    ('public.validate_standard_estimate_baseline_item_refs()', 'public.standard_estimate_revision_baseline_items', 'standard_estimate_baseline_items_refs'),
    ('public.validate_standard_estimate_baseline_variant_refs()', 'public.standard_estimate_revision_baseline_variants', 'standard_estimate_baseline_variants_refs'),
    ('public.validate_standard_estimate_current_pointer()', 'public.standard_estimate_masters', 'standard_estimate_masters_current_pointer'),
    ('public.validate_standard_estimate_current_pointer_at_commit()', 'public.standard_estimate_masters', 'standard_estimate_master_current_pointer_consistency'),
    ('public.validate_standard_estimate_current_pointer_at_commit()', 'public.standard_estimate_revisions', 'standard_estimate_current_pointer_consistency'),
    ('public.validate_standard_estimate_master_refs()', 'public.standard_estimate_masters', 'standard_estimate_masters_refs')
),
fns as (
  select distinct e.fn, to_regprocedure(e.fn) as oid from expected e
)
select
  -- 26 本すべてがあり、どれも SECURITY DEFINER のトリガー関数
  (select count(*) from fns f where f.oid is not null) as functions_present,
  (select bool_and(p.prorettype = 'trigger'::regtype and p.prosecdef)
     from fns f join pg_catalog.pg_proc p on p.oid = f.oid) as all_security_definer_trigger,
  -- 使っているトリガーは一覧の 31 本だけ（ほかのトリガーからは使っていない）で、すべて有効
  (select count(*) from expected e
     join pg_catalog.pg_trigger t on t.tgrelid = to_regclass(e.tbl) and t.tgname = e.trg
    where t.tgfoid = to_regprocedure(e.fn) and t.tgenabled = 'O') as expected_triggers_enabled,
  (select count(*) from pg_catalog.pg_trigger t join fns f on f.oid = t.tgfoid where not t.tgisinternal) as triggers_using_functions,
  -- トリガーのほかに依存しているもの（ポリシー・ビュー・既定値・制約・索引など）。空であること
  (select coalesce(json_agg(f.fn || ' <- ' || d.classid::regclass::text order by f.fn), '[]'::json)
     from fns f join pg_catalog.pg_depend d on d.refclassid = 'pg_catalog.pg_proc'::regclass and d.refobjid = f.oid
    where d.classid <> 'pg_catalog.pg_trigger'::regclass) as non_trigger_dependents,
  -- ほかの関数の本文で、呼び出しの形（名前の直後に括弧）で参照しているもの。空であること
  (select coalesce(json_agg(f.fn || ' <- ' || p.oid::regprocedure::text order by f.fn), '[]'::json)
     from fns f
     join pg_catalog.pg_proc p0 on p0.oid = f.oid
     join pg_catalog.pg_proc p on p.oid <> f.oid
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace and n.nspname not in ('pg_catalog', 'information_schema')
    where p.prosrc ~ ('\m' || p0.proname || '\s*\(')) as call_references,
  -- 名前だけの言及（コメントなど。参考）
  (select coalesce(json_agg(f.fn || ' <- ' || p.oid::regprocedure::text order by f.fn), '[]'::json)
     from fns f
     join pg_catalog.pg_proc p0 on p0.oid = f.oid
     join pg_catalog.pg_proc p on p.oid <> f.oid
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace and n.nspname not in ('pg_catalog', 'information_schema')
    where p.prosrc ~ ('\m' || p0.proname || '\M')) as name_mentions,
  -- 今の直接実行の権限（PUBLIC・anon・authenticated・service_role の順）
  (select json_object_agg(f.fn, json_build_array(
            exists (select 1 from pg_catalog.pg_proc p
                     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                     where p.oid = f.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
            has_function_privilege('anon', f.oid, 'EXECUTE'),
            has_function_privilege('authenticated', f.oid, 'EXECUTE'),
            has_function_privilege('service_role', f.oid, 'EXECUTE')) order by f.fn)
     from fns f) as executable,
  -- 適用前後で比べる属性（変わるのは acl だけのはず）
  (select json_object_agg(f.fn, json_build_object(
            'owner', pg_get_userbyid(p.proowner), 'security_definer', p.prosecdef,
            'config', p.proconfig, 'acl', p.proacl::text, 'body_md5', md5(p.prosrc)) order by f.fn)
     from fns f join pg_catalog.pg_proc p on p.oid = f.oid) as function_attributes;
