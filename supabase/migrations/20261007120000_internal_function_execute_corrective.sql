-- 内部専用関数の EXECUTE 是正（2026-10-07）
--
-- Supabase では、postgres が public に作成した関数へ anon / authenticated / service_role の
-- EXECUTE が既定権限（pg_default_acl）で自動付与される。`revoke ... from public` だけでは
-- この付与は外れないため、API から直接実行させない関数は対象ロールを明示して revoke する。
--
-- 対象
--   notify / write_audit      … SECURITY DEFINER のトリガー関数からのみ呼ぶ内部関数
--   duplicate_configuration   … ログイン済み利用者の操作。未ログイン（anon）には実行させない
--
-- 既存 migration は編集しない。テーブル・データは変更しない。

begin;

revoke execute on function public.notify(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.notify(uuid, text, text, text, text, text) to service_role;

revoke execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb) to service_role;

revoke execute on function public.duplicate_configuration(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.duplicate_configuration(uuid) to authenticated, service_role;

do $postcondition$
declare
  v_notify constant regprocedure := 'public.notify(uuid, text, text, text, text, text)'::regprocedure;
  v_audit constant regprocedure := 'public.write_audit(text, text, uuid, text, jsonb, jsonb)'::regprocedure;
  v_duplicate constant regprocedure := 'public.duplicate_configuration(uuid)'::regprocedure;
begin
  if has_function_privilege('anon', v_notify, 'execute')
     or has_function_privilege('authenticated', v_notify, 'execute')
     or has_function_privilege('anon', v_audit, 'execute')
     or has_function_privilege('authenticated', v_audit, 'execute')
     or has_function_privilege('anon', v_duplicate, 'execute') then
    raise exception 'INTERNAL_FUNCTION_EXECUTE_CORRECTIVE: API ロールに内部関数の EXECUTE が残っています'
      using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', v_duplicate, 'execute') then
    raise exception 'INTERNAL_FUNCTION_EXECUTE_CORRECTIVE: duplicate_configuration は authenticated から実行できる必要があります'
      using errcode = 'P0001';
  end if;

  -- 呼び出し元は SECURITY DEFINER で、その所有者が内部関数を実行できること（revoke 後も通知・監査が止まらない保証）
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname not in ('notify', 'write_audit')
       and (p.prosrc ~ '(^|[^_a-z])notify\s*\(' or p.prosrc ~ '(^|[^_a-z])write_audit\s*\(')
       and (
         not p.prosecdef
         or not has_function_privilege(p.proowner, v_notify, 'execute')
         or not has_function_privilege(p.proowner, v_audit, 'execute')
       )
  ) then
    raise exception 'INTERNAL_FUNCTION_EXECUTE_CORRECTIVE: 内部関数の呼び出し元が SECURITY DEFINER ではない、または実行権限を失います'
      using errcode = 'P0001';
  end if;
end;
$postcondition$;

commit;
