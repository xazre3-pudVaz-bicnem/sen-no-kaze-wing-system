-- Security corrective（2026-10-13）：概算→確定の互換処理で、担当権限を状態判定より前に確認する。
--
-- 独立レビュー（#406）の指摘への対応。
-- create_formal_quote_from_accepted_preliminary は、承諾状態・種別・現在の版・整合性を判定した後で
-- 担当権限を確認していた。権限のない利用者にも案件の状態に応じたエラーが返るため、
-- 見積の存在確認の直後（QuoteRequest の lock より前）へ権限確認を移し、
-- 権限のない利用者には案件の状態にかかわらず同じ FORBIDDEN を返す（fail closed）。
--
-- 方法は 20261009090000 と同じく、適用済みの定義（pg_get_functiondef）を検査してから置き換える。
--   1. 権限確認のブロック（20261009090000 適用後の内容）がちょうど 1 箇所あることを確認して取り除く
--   2. QuoteRequest の lock の直前（見積の lock と存在確認の直後）の 1 箇所へ、同じブロックを置く
-- 想定と違う定義なら何も変更せずに停止する。
-- 権限の条件そのもの・業務上の権限境界・lock の順序（Quote → QuoteRequest）・それ以外の行は変えない。
-- owner・SECURITY DEFINER・search_path・EXECUTE は置き換えの前後で変わらないことを検算する。
-- 既存 migration は編集しない。テーブル・データは変更しない。

begin;

do $patch$
declare
  v_signature constant text := 'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)';
  -- 20261009090000 適用後の権限確認（末尾の空行を含む 4 行）
  v_check constant text :=
    E'  if not (v_rank >= 3 or (v_rank >= 1 and coalesce(parent.dealer_id = v_uid, false))) then\n'
    || E'    raise exception ''FORBIDDEN: この案件の確定見積を発行できません'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || E'\n';
  -- 移動先の目印：QuoteRequest の lock（この直前に権限確認を置く）
  v_anchor constant text :=
    E'  select * into req\n'
    || E'    from public.quote_requests\n'
    || E'   where id = parent.quote_request_id\n'
    || E'   for update;\n';
  v_comment constant text :=
    E'  -- 担当権限は、承諾状態・種別・現在の版などの判定より前に確認する（権限のない利用者に案件の状態を返さない）。\n';
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
begin
  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: function % is missing; review migration order', v_signature
      using errcode = 'P0001';
  end if;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
    into v_before
    from pg_catalog.pg_proc p
   where p.oid = v_oid;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);

  if (length(v_definition) - length(replace(v_definition, v_check, ''))) / length(v_check) <> 1
     or (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: % differs from the reviewed definition (permission check or lock anchor is not unique)', v_signature
      using errcode = 'P0001';
  end if;

  -- 是正対象の定義であること：権限確認が、最初の状態判定（LOCKED）より後にある
  if position(v_check in v_definition) < position('''LOCKED:' in v_definition) then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: % already checks permission before state; definition differs from the reviewed one', v_signature
      using errcode = 'P0001';
  end if;

  v_expected := replace(replace(v_definition, v_check, ''), v_anchor, v_comment || v_check || v_anchor);

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
    into v_after
    from pg_catalog.pg_proc p
   where p.oid = v_oid;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if v_definition is distinct from v_expected then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: % was not replaced as expected', v_signature
      using errcode = 'P0001';
  end if;

  -- 順序：見積の存在確認（NOT_FOUND）→ 担当権限（FORBIDDEN）→ QuoteRequest の lock → 状態判定（LOCKED）
  if not (
    position('''NOT_FOUND''' in v_definition) < position(v_check in v_definition)
    and position(v_check in v_definition) < position(v_anchor in v_definition)
    and position(v_anchor in v_definition) < position('''LOCKED:' in v_definition)
  ) then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: % does not check permission before state after replacement', v_signature
      using errcode = 'P0001';
  end if;

  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: owner / SECURITY DEFINER / search_path / EXECUTE of % changed unexpectedly', v_signature
      using errcode = 'P0001';
  end if;
end;
$patch$;

-- 置き換え後の実行境界を確認する（この migration は境界を変更しない。想定外なら適用を止める）
do $postcondition$
declare
  v_fn constant regprocedure := 'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure;
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid = v_fn
       and (
         pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
         or not p.prosecdef
         or not exists (
           select 1
             from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as cfg(value)
            where cfg.value in ('search_path=', 'search_path=""')
         )
       )
  ) then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: % must stay a postgres-owned SECURITY DEFINER function with an empty search_path', v_fn
      using errcode = 'P0001';
  end if;

  if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'PERMISSION_FIRST_CORRECTIVE: % must be executable by authenticated only (not PUBLIC/anon/service_role)', v_fn
      using errcode = 'P0001';
  end if;
end;
$postcondition$;

commit;
