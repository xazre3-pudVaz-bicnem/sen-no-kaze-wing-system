-- トリガー専用の関数 26 本から、利用者のロールの EXECUTE を外す corrective（2026-10-30 の先方の指示。20261016113000 の続き）
--
-- 対象は、SECURITY DEFINER のまま PUBLIC・anon・authenticated・service_role のどれかから直接実行できたトリガー関数 26 本。
-- 作ったときの既定権限が残っている（PUBLIC 経由が 7 本、anon・authenticated への付与が 1 本、
-- 「migration・管理処理用」として service_role に付与したものが 18 本）。
--
-- 1 本ずつ次を確かめたうえで外す（本番のカタログ・コードの検索・実 DB の検査）。
--   - 戻り値が trigger で、トリガーからしか呼ばれない（直接呼ぶと 0A000 になり、そもそも実行できない）
--   - アプリ・RPC から呼んでいない（lib・app・components・scripts に呼び出しが無い）
--   - ほかの関数の本文から呼んでいない（外壁の関数に、名前を挙げたコメントが 1 か所あるだけ）
--   - RLS のポリシー・ビュー・既定値・制約・索引から使っていない（PostgreSQL の依存関係がトリガーだけ）
--   - 外した後もトリガーは動く。PostgreSQL はトリガー関数の EXECUTE をトリガーを作るときだけ確かめ、動くときは確かめない
--     （31 本のトリガーの動作は scripts/db-rehearsal/runtime-trigger-function-execute.sql で確かめる）
-- migration は関数の所有者（postgres）で流すため、後の migration がこれらの関数でトリガーを作るときも影響しない。
--
-- 関数の本文・トリガー・テーブル・データは変えない。既存の migration は編集しない。
-- SECURITY INVOKER のトリガー関数（呼んだロールの権限で動くもの）は 26 本に含めず、今回は変えない。

begin;

-- 対象の関数と、それを使うトリガー（31 本）。preflight と postconditions で使う
create temp table _trigger_fn_expected (fn text not null, tbl text not null, trg text not null) on commit drop;
insert into _trigger_fn_expected (fn, tbl, trg) values
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
  ('public.validate_standard_estimate_master_refs()', 'public.standard_estimate_masters', 'standard_estimate_masters_refs');

-- ---------- preflight ----------

do $preflight$
declare
  v_fn text;
  v_oid oid;
begin
  if (select count(distinct fn) from _trigger_fn_expected) <> 26 or (select count(*) from _trigger_fn_expected) <> 31 then
    raise exception 'PRECONDITION: the expected list must have 26 functions and 31 triggers';
  end if;
  for v_fn in select distinct fn from _trigger_fn_expected order by 1 loop
    v_oid := to_regprocedure(v_fn);
    if v_oid is null then
      raise exception 'PRECONDITION: % is missing', v_fn;
    end if;
    if (select p.prorettype <> 'trigger'::regtype or not p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid) then
      raise exception 'PRECONDITION: % must be a SECURITY DEFINER trigger function', v_fn;
    end if;
    -- 使っているトリガーは一覧のとおり（ほかのトリガーからは使っていない）
    if exists (
         select t.tgrelid::regclass::text, t.tgname::text
           from pg_catalog.pg_trigger t
          where t.tgfoid = v_oid and not t.tgisinternal
         except
         select e.tbl::regclass::text, e.trg from _trigger_fn_expected e where e.fn = v_fn
       )
       or exists (
         select e.tbl::regclass::text, e.trg from _trigger_fn_expected e where e.fn = v_fn
         except
         select t.tgrelid::regclass::text, t.tgname::text
           from pg_catalog.pg_trigger t
          where t.tgfoid = v_oid and not t.tgisinternal
       ) then
      raise exception 'PRECONDITION: % must be used only by the expected triggers', v_fn;
    end if;
    -- トリガーのほかに、ポリシー・ビュー・既定値・制約・索引などから依存されていない
    if exists (
      select 1 from pg_catalog.pg_depend d
       where d.refclassid = 'pg_catalog.pg_proc'::regclass and d.refobjid = v_oid
         and d.classid <> 'pg_catalog.pg_trigger'::regclass
    ) then
      raise exception 'PRECONDITION: % has a non-trigger dependent; review before applying', v_fn;
    end if;
    -- ほかの関数の本文から、呼び出しの形（名前の直後に括弧）で参照していない
    if exists (
      select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where p.oid <> v_oid
         and n.nspname not in ('pg_catalog', 'information_schema')
         and p.prosrc ~ ('\m' || (select p0.proname from pg_catalog.pg_proc p0 where p0.oid = v_oid) || '\s*\(')
    ) then
      raise exception 'PRECONDITION: % is referenced by another function; review before applying', v_fn;
    end if;
  end loop;
  -- トリガーはすべて有効（外した後に同じであることを postconditions で確かめる）
  if exists (
    select 1 from _trigger_fn_expected e
      join pg_catalog.pg_trigger t on t.tgrelid = e.tbl::regclass and t.tgname = e.trg
     where t.tgfoid <> to_regprocedure(e.fn) or t.tgenabled <> 'O'
  ) then
    raise exception 'PRECONDITION: every expected trigger must be enabled and use the expected function';
  end if;
end;
$preflight$;

-- ---------- 権限 ----------

revoke execute on function public.assign_customer_no() from public, anon, authenticated, service_role;
revoke execute on function public.enforce_base_master_owner_type() from public, anon, authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_locked_base_breakdown_edit() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_non_draft_base_master_line_write() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_non_draft_standard_estimate_child_write() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_non_draft_standard_estimate_variant_write() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_published_base_master_revision_mutation() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_published_standard_estimate_revision_mutation() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_standard_estimate_master_identity_change_after_revision() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_unreviewed_legacy_base_migration_publish() from public, anon, authenticated, service_role;
revoke execute on function public.trg_audit_model() from public, anon, authenticated, service_role;
revoke execute on function public.trg_audit_role() from public, anon, authenticated, service_role;
revoke execute on function public.trg_contact_notify() from public, anon, authenticated, service_role;
revoke execute on function public.trg_quote_notify() from public, anon, authenticated, service_role;
revoke execute on function public.validate_base_master_current_pointer_at_commit() from public, anon, authenticated, service_role;
revoke execute on function public.validate_base_master_revision_refs() from public, anon, authenticated, service_role;
revoke execute on function public.validate_configuration_exterior_faces() from public, anon, authenticated, service_role;
revoke execute on function public.validate_quote_base_revision_ref() from public, anon, authenticated, service_role;
revoke execute on function public.validate_quote_draft_parent_ref() from public, anon, authenticated, service_role;
revoke execute on function public.validate_standard_estimate_base_revision_ref() from public, anon, authenticated, service_role;
revoke execute on function public.validate_standard_estimate_baseline_item_refs() from public, anon, authenticated, service_role;
revoke execute on function public.validate_standard_estimate_baseline_variant_refs() from public, anon, authenticated, service_role;
revoke execute on function public.validate_standard_estimate_current_pointer() from public, anon, authenticated, service_role;
revoke execute on function public.validate_standard_estimate_current_pointer_at_commit() from public, anon, authenticated, service_role;
revoke execute on function public.validate_standard_estimate_master_refs() from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postconditions$
declare
  v_fn text;
  v_oid oid;
begin
  for v_fn in select distinct fn from _trigger_fn_expected order by 1 loop
    v_oid := to_regprocedure(v_fn);
    if exists (
         select 1 from pg_catalog.pg_proc p
          cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
          where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by PUBLIC / anon / authenticated / service_role', v_fn;
    end if;
  end loop;
  if (select count(*) from _trigger_fn_expected e
        join pg_catalog.pg_trigger t on t.tgrelid = e.tbl::regclass and t.tgname = e.trg
       where t.tgfoid = to_regprocedure(e.fn) and t.tgenabled = 'O') <> 31 then
    raise exception 'POSTCONDITION: all 31 triggers must stay enabled';
  end if;
end;
$postconditions$;

commit;
