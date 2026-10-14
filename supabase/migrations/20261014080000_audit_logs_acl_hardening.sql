-- audit_logs は管理者向け監査記録として RLS で保護しているが、旧 API grant により
-- anon / authenticated に SELECT 以外のテーブル権限も残っていた。
-- TRUNCATE / MAINTAIN は RLS の対象外なので、ブラウザ向けロールの不要権限を明示的に閉じる。
--
-- service_role は既存のサーバー側処理との互換のため、この corrective では変更しない。
-- public schema 全体の default privileges も本 migration の責務外とし、今後の機密テーブルは
-- 作成直後に個別 REVOKE / GRANT で閉じる。

revoke all on table public.audit_logs from public;
revoke all on table public.audit_logs from anon;
revoke all on table public.audit_logs from authenticated;

grant select on table public.audit_logs to authenticated;

-- postcondition: anon は audit_logs に一切の直接テーブル権限を持たない。
-- authenticated は管理画面の既存読取経路に必要な SELECT だけを持つ。
do $$
declare
  v_rls_enabled boolean;
  v_admin_policy_exists boolean;
begin
  if has_table_privilege('anon', 'public.audit_logs', 'SELECT')
     or has_table_privilege('anon', 'public.audit_logs', 'INSERT')
     or has_table_privilege('anon', 'public.audit_logs', 'UPDATE')
     or has_table_privilege('anon', 'public.audit_logs', 'DELETE')
     or has_table_privilege('anon', 'public.audit_logs', 'TRUNCATE')
     or has_table_privilege('anon', 'public.audit_logs', 'REFERENCES')
     or has_table_privilege('anon', 'public.audit_logs', 'TRIGGER')
     or has_table_privilege('anon', 'public.audit_logs', 'MAINTAIN') then
    raise exception 'POSTCONDITION: anon retains audit_logs table privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.audit_logs', 'SELECT') then
    raise exception 'POSTCONDITION: authenticated lost audit_logs SELECT';
  end if;

  if has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
     or has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
     or has_table_privilege('authenticated', 'public.audit_logs', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.audit_logs', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.audit_logs', 'TRIGGER')
     or has_table_privilege('authenticated', 'public.audit_logs', 'MAINTAIN') then
    raise exception 'POSTCONDITION: authenticated retains audit_logs non-SELECT privileges';
  end if;

  select c.relrowsecurity
    into v_rls_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'audit_logs'
    and c.relkind = 'r';

  if v_rls_enabled is distinct from true then
    raise exception 'POSTCONDITION: audit_logs RLS is not enabled';
  end if;

  select exists (
    select 1
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_logs'
      and p.polname = 'audit_logs_admin'
      and p.polcmd = 'r'
  ) into v_admin_policy_exists;

  if not v_admin_policy_exists then
    raise exception 'POSTCONDITION: audit_logs_admin SELECT policy is missing';
  end if;
end;
$$;
