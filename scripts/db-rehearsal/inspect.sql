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
    where k.relnamespace = 'public'::regnamespace and k.relkind in ('r', 'p'))
) as j
