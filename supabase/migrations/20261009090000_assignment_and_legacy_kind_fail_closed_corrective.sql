-- Security corrective（2026-10-09）：NULL で判定が素通りする条件を fail closed にする。
--
-- 実 DB の実行時検査で確認した 2 種類の素通りを是正する。
--
--   1. 担当判定   `if not (<本部> or (<代理店以上> and X.dealer_id = v_uid)) then raise FORBIDDEN`
--      担当未割当（dealer_id が NULL）の見積では比較が NULL になり、条件全体が NULL と評価されて
--      拒否の分岐に入らない。担当ではない代理店・総代理店が、担当未割当の見積に対して
--      プランの参照・改訂見積の作成まで進める状態だった。
--        - create_quote_revision
--        - get_case_plan_configuration
--        - get_legacy_accepted_formalization_state
--        - create_formal_quote_from_accepted_preliminary（先行の検証で到達しないが、同じ形のため揃える）
--
--   2. 旧形式の種別判定
--      quote_kind が NULL の旧形式で、親を持つ改訂版（確定見積）を legacy 第1版の preliminary 互換候補として
--      扱い得る三値論理を、状態問い合わせと書き込み RPC の双方で fail closed にする。
--        - get_legacy_accepted_formalization_state
--        - create_formal_quote_from_accepted_preliminary
--
-- 是正は、該当する比較を coalesce(..., false) で包むだけ。業務上の権限境界・見積の意味は変えない。
--
-- 関数全体を写し直すと 800 行超の複製になり、写し間違いの検出が難しい。
-- そのため、適用済みの定義（pg_get_functiondef）に対して「該当行がちょうど 1 箇所あること」を確認したうえで
-- その 1 行だけを置き換える。想定と違う定義なら何も変更せずに停止する。
-- owner・SECURITY DEFINER・search_path・EXECUTE は置き換えの前後で変わらないことを検算する。
-- 既存 migration は編集しない。テーブル・データは変更しない。

begin;

do $patch$
declare
  r record;
  v_oid oid;
  v_definition text;
  v_occurrences integer;
  v_before record;
  v_after record;
begin
  for r in
    select *
      from (values
        (1,
         'public.create_quote_revision(uuid, jsonb, text)',
         'if not (v_can_any or (v_rank >= 1 and parent.dealer_id = v_uid)) then',
         'if not (v_can_any or (v_rank >= 1 and coalesce(parent.dealer_id = v_uid, false))) then'),
        (2,
         'public.get_case_plan_configuration(uuid)',
         'if not (v_rank >= 3 or (v_rank >= 1 and v_quote.dealer_id = v_uid)) then',
         'if not (v_rank >= 3 or (v_rank >= 1 and coalesce(v_quote.dealer_id = v_uid, false))) then'),
        (3,
         'public.get_legacy_accepted_formalization_state(uuid)',
         'if not (v_rank >= 3 or (v_rank >= 1 and q.dealer_id = v_uid)) then',
         'if not (v_rank >= 3 or (v_rank >= 1 and coalesce(q.dealer_id = v_uid, false))) then'),
        (4,
         'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)',
         'if not (v_rank >= 3 or (v_rank >= 1 and parent.dealer_id = v_uid)) then',
         'if not (v_rank >= 3 or (v_rank >= 1 and coalesce(parent.dealer_id = v_uid, false))) then'),
        (5,
         'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)',
         '    parent.quote_kind = ''preliminary''',
         '    coalesce(parent.quote_kind = ''preliminary'', false)'),
        (6,
         'public.get_legacy_accepted_formalization_state(uuid)',
         '      q.quote_kind = ''preliminary''',
         '      coalesce(q.quote_kind = ''preliminary'', false)')
      ) as t(seq, signature, old_text, new_text)
     order by seq
  loop
    v_oid := to_regprocedure(r.signature);
    if v_oid is null then
      raise exception 'FAIL_CLOSED_CORRECTIVE: function % is missing; review migration order', r.signature
        using errcode = 'P0001';
    end if;

    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
      into v_before
      from pg_catalog.pg_proc p
     where p.oid = v_oid;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    v_occurrences := (length(v_definition) - length(replace(v_definition, r.old_text, ''))) / length(r.old_text);
    if v_occurrences <> 1 then
      raise exception 'FAIL_CLOSED_CORRECTIVE: expected exactly one target line in % but found %; definition differs from the reviewed one',
        r.signature, v_occurrences
        using errcode = 'P0001';
    end if;

    execute replace(v_definition, r.old_text, r.new_text);

    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
      into v_after
      from pg_catalog.pg_proc p
     where p.oid = v_oid;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if position(r.new_text in v_definition) = 0
       or (length(v_definition) - length(replace(v_definition, r.old_text, ''))) / length(r.old_text)
          <> (length(r.new_text) - length(replace(r.new_text, r.old_text, ''))) / length(r.old_text) then
      raise exception 'FAIL_CLOSED_CORRECTIVE: % was not replaced as expected', r.signature
        using errcode = 'P0001';
    end if;

    if v_after.proowner is distinct from v_before.proowner
       or v_after.prosecdef is distinct from v_before.prosecdef
       or v_after.proconfig is distinct from v_before.proconfig
       or v_after.acl is distinct from v_before.acl then
      raise exception 'FAIL_CLOSED_CORRECTIVE: owner / SECURITY DEFINER / search_path / EXECUTE of % changed unexpectedly', r.signature
        using errcode = 'P0001';
    end if;
  end loop;
end;
$patch$;

-- 置き換え後の実行境界を確認する（この migration は境界を変更しない。想定外なら適用を止める）
do $postcondition$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.create_quote_revision(uuid, jsonb, text)'::regprocedure,
    'public.get_case_plan_configuration(uuid)'::regprocedure,
    'public.get_legacy_accepted_formalization_state(uuid)'::regprocedure,
    'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure
  ]
  loop
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
      raise exception 'FAIL_CLOSED_CORRECTIVE: % must stay a postgres-owned SECURITY DEFINER function with an empty search_path', v_fn
        using errcode = 'P0001';
    end if;

    -- anon が true なら PUBLIC 経由の EXECUTE も検出できる。service_role への直接権限も明示的に拒否する。
    if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL_CLOSED_CORRECTIVE: % must be executable by authenticated only (not PUBLIC/anon/service_role)', v_fn
        using errcode = 'P0001';
    end if;
  end loop;
end;
$postcondition$;

commit;
