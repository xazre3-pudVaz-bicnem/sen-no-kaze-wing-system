-- 20261016112000（販売停止・廃番）と 20261016113000（商品の変更履歴のトリガー関数の EXECUTE を外す）の本番適用の前の確認。
-- 読み取りだけ（真偽・件数・関数の属性だけを返す）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-product-sales-stop.sql
--
-- 適用してよい条件：preconditions_present・discontinued_column_absent・audit_function_trigger_only が true、
-- specs_that_would_stop_accepting が 0（0 でなければ、その仕様の新しい受付が止まるため先方に確認する）。
-- audit_function_executable は適用前の状態の記録（PUBLIC・anon・authenticated・service_role の順）。
-- function_attributes は適用後の postflight と比べる。
--
-- 標準構成の集め方は product_lifecycle_baseline_option_ids（20261015113000）と同じ
-- （Excel 標準見積の基準商品・公開中の標準見積の標準状態・本体の仕様）。
with specs as (
  select t.base_model_id as model_id, t.spec_code from public.estimate_templates t
  union
  select m.base_model_id, m.spec_code from public.standard_estimate_masters m
  union
  select bm.id, p.value ->> 'code'
    from public.base_models bm
    cross join lateral jsonb_array_elements(coalesce(bm.presets, '[]'::jsonb)) as p(value)
),
baseline as (
  select s.model_id, s.spec_code, x.option_id
    from specs s
    cross join lateral (
      select unnest(t.baseline_option_ids) as option_id
        from public.estimate_templates t
       where t.base_model_id = s.model_id and t.spec_code = coalesce(s.spec_code, '')
      union
      select b.option_id
        from public.standard_estimate_masters m
        join public.standard_estimate_revision_baseline_items b on b.revision_id = m.current_published_revision_id
       where m.base_model_id = s.model_id and m.spec_code = s.spec_code
      union
      select o.id
        from public.base_models bm
        cross join lateral jsonb_array_elements(coalesce(bm.presets, '[]'::jsonb)) as preset(value)
        cross join lateral jsonb_array_elements_text(coalesce(preset.value -> 'option_codes', '[]'::jsonb)) as code(value)
        join public.options o on o.code = code.value and (o.base_model_id is null or o.base_model_id = bm.id)
       where bm.id = s.model_id and preset.value ->> 'code' = s.spec_code
    ) x
),
audit_fn as (
  select to_regprocedure('public.trg_audit_option()') as oid
)
select
  to_regprocedure('public.options_lifecycle_guard()') is not null
    and to_regprocedure('public.product_lifecycle_baseline_option_ids(uuid, text)') is not null
    and to_regprocedure('public.trg_audit_option()') is not null
    and to_regprocedure('public.write_audit(text, text, uuid, text, jsonb, jsonb)') is not null as preconditions_present,
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'options' and column_name = 'discontinued_at'
  ) as discontinued_column_absent,
  (select count(*) from public.options where archived_at is not null) as stopped_products,
  (select count(distinct (b.model_id, b.spec_code))
     from baseline b join public.options o on o.id = b.option_id
    where o.archived_at is not null) as specs_that_would_stop_accepting,
  (select count(*) from specs) as specs_checked,
  -- 20261016113000 の前提：戻り値が trigger で、商品の変更履歴のトリガー 1 本だけが使い、ほかの関数の本文から呼んでいない
  (select p.prorettype = 'trigger'::regtype from pg_catalog.pg_proc p, audit_fn f where p.oid = f.oid)
    and (select count(*) = 1 and bool_and(t.tgrelid = 'public.options'::regclass and t.tgname = 'trg_options_audit')
           from pg_catalog.pg_trigger t, audit_fn f where t.tgfoid = f.oid and not t.tgisinternal)
    and not exists (
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace, audit_fn f
       where n.nspname = 'public' and p.oid <> f.oid and p.prosrc like '%trg_audit_option%'
    ) as audit_function_trigger_only,
  (select json_build_array(
            exists (select 1 from pg_catalog.pg_proc p
                     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                     where p.oid = f.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
            has_function_privilege('anon', f.oid, 'EXECUTE'),
            has_function_privilege('authenticated', f.oid, 'EXECUTE'),
            has_function_privilege('service_role', f.oid, 'EXECUTE'))
     from audit_fn f) as audit_function_executable,
  (select json_agg(
            json_build_object('fn', p.oid::regprocedure::text, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
                              'security_definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
            order by p.oid::regprocedure::text)
     from pg_catalog.pg_proc p
    where p.oid in (
      to_regprocedure('public.options_lifecycle_guard()'), to_regprocedure('public.trg_audit_option()'),
      to_regprocedure('public.finalize_quote_draft(uuid, integer)'), to_regprocedure('public.finalize_quote_revision_draft(uuid, integer)'),
      to_regprocedure('public.configuration_items_lifecycle_guard()'), to_regprocedure('public.configurations_exterior_lifecycle_guard()'),
      to_regprocedure('public.estimate_templates_lifecycle_guard()'), to_regprocedure('public.quote_draft_items_lifecycle_guard()'),
      to_regprocedure('public.quote_items_lifecycle_guard()'), to_regprocedure('public.quote_requests_lifecycle_guard()'),
      to_regprocedure('public.standard_estimate_baseline_lifecycle_guard()'),
      to_regprocedure('public.standard_estimate_baseline_variant_lifecycle_guard()'),
      to_regprocedure('public.standard_estimate_publish_lifecycle_guard()'))) as function_attributes;
