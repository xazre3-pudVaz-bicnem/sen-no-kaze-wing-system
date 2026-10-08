-- public スキーマの定義（テーブル・列・制約・索引・関数・ポリシー・トリガー・バケット）を 1 つの JSON にまとめる。
-- 本番とマイグレーション再現の差分比較（ドリフト検査）に使う。データは読まない。
select jsonb_build_object(
 'tables', (select jsonb_agg(jsonb_build_object('t', k.relname, 'kind', k.relkind, 'owner', pg_get_userbyid(k.relowner), 'rls', k.relrowsecurity, 'force', k.relforcerowsecurity, 'acl', (select array_agg(a::text order by a::text) from unnest(k.relacl) a)) order by k.relname)
            from pg_class k where k.relnamespace = 'public'::regnamespace and k.relkind in ('r','v','m','p','S')),
 'columns', (select jsonb_agg(jsonb_build_object('t', k.relname, 'c', a.attname, 'n', a.attnum, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid), 'gen', a.attgenerated, 'ident', a.attidentity) order by k.relname, a.attnum)
            from pg_class k join pg_attribute a on a.attrelid = k.oid and a.attnum > 0 and not a.attisdropped left join pg_attrdef d on d.adrelid = k.oid and d.adnum = a.attnum
            where k.relnamespace = 'public'::regnamespace and k.relkind in ('r','v','m','p')),
 'constraints', (select jsonb_agg(jsonb_build_object('t', c.conrelid::regclass::text, 'name', c.conname, 'type', c.contype, 'def', pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text, c.conname)
            from pg_constraint c where c.connamespace = 'public'::regnamespace and c.conrelid <> 0),
 'indexes', (select jsonb_agg(jsonb_build_object('t', tablename, 'name', indexname, 'def', indexdef) order by tablename, indexname) from pg_indexes where schemaname = 'public'),
 'functions', (select jsonb_agg(jsonb_build_object('f', p.oid::regprocedure::text, 'kind', p.prokind, 'ret', pg_get_function_result(p.oid), 'lang', l.lanname, 'secdef', p.prosecdef, 'vol', p.provolatile, 'config', p.proconfig, 'owner', pg_get_userbyid(p.proowner), 'acl', (select array_agg(a::text order by a::text) from unnest(p.proacl) a), 'src_md5', md5(p.prosrc), 'src', p.prosrc) order by p.oid::regprocedure::text)
            from pg_proc p join pg_language l on l.oid = p.prolang where p.pronamespace = 'public'::regnamespace),
 'policies', (select jsonb_agg(jsonb_build_object('t', schemaname || '.' || tablename, 'name', policyname, 'permissive', permissive, 'cmd', cmd, 'roles', roles, 'qual', qual, 'check', with_check) order by schemaname, tablename, policyname) from pg_policies where schemaname in ('public','storage')),
 'triggers', (select jsonb_agg(jsonb_build_object('t', t.tgrelid::regclass::text, 'name', t.tgname, 'enabled', t.tgenabled, 'def', pg_get_triggerdef(t.oid)) order by t.tgrelid::regclass::text, t.tgname)
            from pg_trigger t join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace where not t.tgisinternal and (n.nspname = 'public' or (n.nspname = 'auth' and k.relname = 'users'))),
 'types', (select jsonb_agg(jsonb_build_object('name', t.typname, 'type', t.typtype, 'labels', (select array_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), 'domain_base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end) order by t.typname)
            from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e','d')),
 'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mime', allowed_mime_types) order by id) from storage.buckets),
 'publications', (select jsonb_agg(jsonb_build_object('pub', pubname, 't', schemaname || '.' || tablename) order by 1) from pg_publication_tables where schemaname = 'public')
) as j
