-- 検査用：関数シグネチャ（引数名つき）・実効権限・テーブル列・RLS の状態を 1 つの JSON にまとめる。
select jsonb_build_object(
  'signatures', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'args', coalesce(p.proargnames[1:p.pronargs], '{}'),
      'nargs', p.pronargs,
      'ndefaults', p.pronargdefaults,
      'types', pg_get_function_identity_arguments(p.oid),
      'ret', pg_get_function_result(p.oid),
      'secdef', p.prosecdef,
      'owner', pg_get_userbyid(p.proowner),
      'config', p.proconfig,
      'anon', has_function_privilege('anon', p.oid, 'execute'),
      'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
      'service_role', has_function_privilege('service_role', p.oid, 'execute')
    ) order by p.proname, p.pronargs), '[]'::jsonb)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'),
  'columns', (select coalesce(jsonb_object_agg(t, cols), '{}'::jsonb) from (
      select k.relname as t, jsonb_agg(a.attname order by a.attnum) as cols
        from pg_class k
        join pg_attribute a on a.attrelid = k.oid and a.attnum > 0 and not a.attisdropped
       where k.relnamespace = 'public'::regnamespace and k.relkind in ('r', 'v', 'm', 'p')
       group by k.relname) s),
  'tables', (select coalesce(jsonb_agg(jsonb_build_object(
      't', k.relname, 'kind', k.relkind, 'rls', k.relrowsecurity,
      'policies', (select count(*) from pg_policy pol where pol.polrelid = k.oid),
      'anon', (select coalesce(string_agg(x, ',' order by x), '') from unnest(array['SELECT','INSERT','UPDATE','DELETE']) x where has_table_privilege('anon', k.oid, x)),
      'authenticated', (select coalesce(string_agg(x, ',' order by x), '') from unnest(array['SELECT','INSERT','UPDATE','DELETE']) x where has_table_privilege('authenticated', k.oid, x))
    ) order by k.relname), '[]'::jsonb)
    from pg_class k
    where k.relnamespace = 'public'::regnamespace and k.relkind in ('r', 'p')),
  -- 旧価格の列（v2.5 PR-C1b）を持つ表の列ごとの読み取りの権限（lib/data/legacy-price-columns.json と照合する）
  'price_table_columns', (select coalesce(jsonb_agg(jsonb_build_object(
      't', k.relname, 'col', a.attname,
      'anon', has_column_privilege('anon', k.oid, a.attnum, 'SELECT'),
      'authenticated', has_column_privilege('authenticated', k.oid, a.attnum, 'SELECT')
    ) order by k.relname, a.attnum), '[]'::jsonb)
    from pg_class k
    join pg_attribute a on a.attrelid = k.oid and a.attnum > 0 and not a.attisdropped
    where k.relnamespace = 'public'::regnamespace
      and k.relname in ('options', 'option_variant_choices', 'base_models', 'base_breakdown_items',
                        'estimate_templates', 'estimate_template_sections', 'estimate_template_lines'))
) as j
