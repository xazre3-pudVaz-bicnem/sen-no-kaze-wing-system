-- 商品の変更履歴のトリガー関数から、利用者のロールの EXECUTE を外す corrective（2026-10-30 の先方の確認事項。#537 の本番適用の前提）
--
-- public.trg_audit_option() は、商品（options）の追加・更新で変更履歴（audit_logs）を書くトリガー（trg_options_audit）専用の関数。
-- 0012 で作ったときの既定権限のまま PUBLIC・anon・authenticated・service_role に EXECUTE が残っている
-- （20261016112000 は create or replace のため、権限はそのまま引き継ぐ）。トリガー以外から実行する必要はないので外す。
--
-- PostgreSQL は、トリガー関数の EXECUTE をトリガーを作るときだけ確かめ、トリガーが動くときは確かめない。
-- そのため外しても変更履歴の書き込みは変わらない（実 DB の検査 PSS-24・PSS-29 で確かめる）。
--
-- 20261016112000 は main へマージ済みのため編集しない。テーブル・データ・関数の本文は変えない。

begin;

-- ---------- preflight ----------

do $preflight$
declare
  v_oid oid := to_regprocedure('public.trg_audit_option()');
begin
  if v_oid is null then
    raise exception 'PRECONDITION: public.trg_audit_option() is missing';
  end if;
  if (select p.prorettype <> 'trigger'::regtype from pg_catalog.pg_proc p where p.oid = v_oid) then
    raise exception 'PRECONDITION: public.trg_audit_option() must be a trigger function';
  end if;
  -- 使っているのは商品の変更履歴のトリガー 1 本だけ
  if (select count(*) from pg_catalog.pg_trigger t where t.tgfoid = v_oid and not t.tgisinternal) <> 1
     or not exists (
       select 1 from pg_catalog.pg_trigger t
        where t.tgfoid = v_oid and t.tgrelid = 'public.options'::regclass and t.tgname = 'trg_options_audit' and not t.tgisinternal
     ) then
    raise exception 'PRECONDITION: public.trg_audit_option() must be used only by trg_options_audit on public.options';
  end if;
  -- ほかの関数の本文からも呼んでいない
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.oid <> v_oid and p.prosrc like '%trg_audit_option%'
  ) then
    raise exception 'PRECONDITION: public.trg_audit_option() is referenced by another function; review before applying';
  end if;
end;
$preflight$;

-- ---------- 権限 ----------

revoke execute on function public.trg_audit_option() from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postconditions$
declare
  v_oid oid := to_regprocedure('public.trg_audit_option()');
begin
  if exists (
       select 1 from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'POSTCONDITION: public.trg_audit_option() must not be executable by PUBLIC / anon / authenticated / service_role';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgfoid = v_oid and t.tgrelid = 'public.options'::regclass and t.tgname = 'trg_options_audit' and t.tgenabled = 'O'
  ) then
    raise exception 'POSTCONDITION: trigger trg_options_audit must stay enabled';
  end if;
end;
$postconditions$;

commit;
