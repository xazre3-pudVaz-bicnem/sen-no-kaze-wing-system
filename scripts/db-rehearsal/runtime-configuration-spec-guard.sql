-- #389（本体分類表の仕様別カテゴリー選択の corrective。10/13 に PR B #441 へそのまま移植し、本番適用済み）で
-- 「本番適用前に業者側で実 DB で確かめる」とした安全機構が、今の本体仕様マトリクス（20261013130000 ほか）でも効いていることの実行時検査。
-- 使い捨て DB 専用。最後に rollback する。2 本の接続が要る同時実行は runtime-configuration-spec-guard.mjs で確かめる。
begin;

create temp table _csg_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _csg_result to public;

create function pg_temp.csg_run_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_out, '(null)');
end;
$fn$;

-- DB の管理者（SECURITY DEFINER の RPC と同じ立場）として実行し、遅延する制約トリガーまで確かめる。失敗した文は取り消す
create function pg_temp.csg_try(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text := 'ok';
begin
  begin
    execute p_sql;
    set constraints all immediate;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  set constraints all deferred;
  return v_out;
end;
$fn$;

create function pg_temp.csg_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _csg_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.csg_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _csg_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

create function pg_temp.csg_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _csg_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

do $test$
declare
  u_owner constant uuid := '28900000-0000-4000-8000-000000000001';
  u_other constant uuid := '28900000-0000-4000-8000-000000000002';
  m_main constant uuid := '28900000-0000-4000-8000-000000000101';
  m_other constant uuid := '28900000-0000-4000-8000-000000000102';
  row_ok constant uuid := '28900000-0000-4000-8000-000000000201';
  row_ng constant uuid := '28900000-0000-4000-8000-000000000202';
  -- 本体分類表（マトリクス）の対象カテゴリーと、対象外のカテゴリー
  cat_matrix constant uuid := '28900000-0000-4000-8000-000000000301';
  cat_plain constant uuid := '28900000-0000-4000-8000-000000000302';
  p_matrix constant uuid := '28900000-0000-4000-8000-000000000401';
  p_plain constant uuid := '28900000-0000-4000-8000-000000000402';
  p_other_spec constant uuid := '28900000-0000-4000-8000-000000000403';
  p_other_model constant uuid := '28900000-0000-4000-8000-000000000404';
  p_residence constant uuid := '28900000-0000-4000-8000-000000000405';
  -- 仕様なしの Draft・選べる仕様の Draft・選べない仕様の Draft・見積済みの履歴・削除用の Draft
  c_nospec constant uuid := '28900000-0000-4000-8000-000000000501';
  c_ok constant uuid := '28900000-0000-4000-8000-000000000502';
  c_ng constant uuid := '28900000-0000-4000-8000-000000000503';
  c_quoted constant uuid := '28900000-0000-4000-8000-000000000504';
  c_del constant uuid := '28900000-0000-4000-8000-000000000505';
  c_other_quoted constant uuid := '28900000-0000-4000-8000-000000000506';
  v_out text;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_owner, 'csg-owner@runtime.invalid', '{}'::jsonb), (u_other, 'csg-other@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_owner, 'csg-owner@runtime.invalid', 'csg owner', 'customer'), (u_other, 'csg-other@runtime.invalid', 'csg other', 'customer');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_main, 'runtime-csg-model', '#389 検査用モデル', 1000000, 'published'),
         (m_other, 'runtime-csg-other', '#389 検査用モデル2', 1000000, 'published');
  insert into public.matrix_specs (code, label) values ('rtcsg-ok', 'RT 選択'), ('rtcsg-ng', 'RT ×'), ('rtcsg-other', 'RT 他') on conflict (code) do nothing;
  insert into public.matrix_sizes (code, width_mm, depth_mm, label) values ('9990x9990', 9990, 9990, 'RT') on conflict (code) do nothing;
  insert into public.matrix_items (code, label) values ('rtcsg-item', 'RT 項目') on conflict (code) do nothing;
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (row_ok, m_main, 'rtcsg-ok', '9990x9990', false), (row_ng, m_main, 'rtcsg-ng', '9990x9990', false);
  insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
  values (row_ok, 'rtcsg-item', true), (row_ng, 'rtcsg-item', false);
  insert into public.option_categories (id, code, name, status)
  values (cat_matrix, 'runtime-csg-matrix', '#389 検査 マトリクス対象', 'published'),
         (cat_plain, 'runtime-csg-plain', '#389 検査 マトリクス対象外', 'published');
  insert into public.option_category_matrix_items (category_id, matrix_item_code) values (cat_matrix, 'rtcsg-item');
  insert into public.options (id, category_id, code, name, price, status, spec_codes, base_model_id, product_no)
  values
    (p_matrix, cat_matrix, 'runtime-csg-matrix', '対象カテゴリーの商品', 1000, 'published', '{}', null, 'PRD-928901'),
    (p_plain, cat_plain, 'runtime-csg-plain', '対象外カテゴリーの商品', 1000, 'published', '{}', null, 'PRD-928902'),
    (p_other_spec, cat_plain, 'runtime-csg-other-spec', 'ほかの仕様だけの商品', 1000, 'published', array['rtcsg-other'], null, 'PRD-928903'),
    (p_other_model, cat_plain, 'runtime-csg-other-model', 'ほかのモデルの商品', 1000, 'published', '{}', m_other, 'PRD-928904');
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values
    (c_nospec, u_owner, m_main, '仕様なしの Draft', 'draft', null, 'full'),
    (c_ok, u_owner, m_main, '選べる仕様の Draft', 'draft', 'rtcsg-ok', 'full'),
    (c_ng, u_owner, m_main, '選べない仕様の Draft', 'draft', 'rtcsg-ng', 'full'),
    (c_quoted, u_owner, m_main, '見積済みの履歴', 'quoted', 'rtcsg-ok', 'full'),
    (c_del, u_owner, m_main, '削除する Draft', 'draft', 'rtcsg-ok', 'full'),
    (c_other_quoted, u_other, m_main, 'ほかの人の履歴', 'quoted', 'rtcsg-ok', 'full');
  -- 見積済みの履歴には、マトリクス対象の商品を持たせておく（後でその仕様の行を × に変える）
  insert into public.configuration_items (configuration_id, option_id, quantity)
  values (c_quoted, p_matrix, 1), (c_quoted, p_plain, 1), (c_del, p_matrix, 1), (c_del, p_plain, 1);
  set local session_replication_role = origin;

  -- 1. 明細の追加：Draft の仕様・モデル・本体分類表で判定する（DB の管理者・RPC の経路でも効く）
  perform pg_temp.csg_expect_error('CSG-1 仕様の無い Draft には明細を追加できない', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_nospec, p_plain)));
  perform pg_temp.csg_expect_eq('CSG-2 本体分類表で「選択」の仕様なら、対象カテゴリーの商品を追加できる', 'ok',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_ok, p_matrix)));
  perform pg_temp.csg_expect_error('CSG-3 本体分類表で「×」の仕様には、対象カテゴリーの商品を追加できない', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_ng, p_matrix)));
  perform pg_temp.csg_expect_eq('CSG-4 本体分類表の対象外のカテゴリーは、仕様で止めない', 'ok',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_ng, p_plain)));
  perform pg_temp.csg_expect_error('CSG-5 商品の対象仕様に無い仕様の Draft には追加できない', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_ok, p_other_spec)));
  perform pg_temp.csg_expect_error('CSG-6 ほかのモデル専用の商品は追加できない', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_ok, p_other_model)));

  -- 2. 履歴（Draft 以外）の明細は、DB の管理者の経路でも変えられない
  perform pg_temp.csg_expect_error('CSG-7 見積済みの履歴へ明細を追加できない', 'P0001', 'LOCKED',
    pg_temp.csg_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_quoted, p_other_spec)));
  perform pg_temp.csg_expect_error('CSG-8 見積済みの履歴の明細の数量を変えられない', 'P0001', 'LOCKED',
    pg_temp.csg_try(format('update public.configuration_items set quantity = 2 where configuration_id = %L and option_id = %L', c_quoted, p_plain)));
  perform pg_temp.csg_expect_error('CSG-9 見積済みの履歴の明細を削除できない', 'P0001', 'LOCKED',
    pg_temp.csg_try(format('delete from public.configuration_items where configuration_id = %L and option_id = %L', c_quoted, p_plain)));
  perform pg_temp.csg_expect_error('CSG-10 Draft の明細を履歴へ付け替えられない', 'P0001', 'LOCKED',
    pg_temp.csg_try(format('update public.configuration_items set configuration_id = %L where configuration_id = %L and option_id = %L', c_quoted, c_ok, p_matrix)));
  perform pg_temp.csg_expect_error('CSG-11 履歴の明細を Draft へ抜き取れない', 'P0001', 'LOCKED',
    pg_temp.csg_try(format('update public.configuration_items set configuration_id = %L where configuration_id = %L and option_id = %L', c_ok, c_quoted, p_plain)));
  perform pg_temp.csg_expect_eq('CSG-12 止めた操作の後も、履歴の明細はそのまま', '2/1',
    (select count(*) from public.configuration_items where configuration_id = c_quoted)::text || '/' ||
    (select max(quantity) from public.configuration_items where configuration_id = c_quoted)::text);

  -- 3. API のロールからの直接の書き込み（保存は RPC だけ）
  perform pg_temp.csg_expect_denied('CSG-13 本人でも自分の Draft の明細を直接追加できない（保存は RPC だけ）', '42501',
    pg_temp.csg_run_as('authenticated', u_owner, format(
      'insert into public.configuration_items (configuration_id, option_id) values (%L, %L) returning ''inserted''', c_ok, p_plain)));
  perform pg_temp.csg_expect_denied('CSG-14 ログインしていない人は明細を直接追加できない', '42501',
    pg_temp.csg_run_as('anon', null, format(
      'insert into public.configuration_items (configuration_id, option_id) values (%L, %L) returning ''inserted''', c_ok, p_plain)));
  perform pg_temp.csg_expect_denied('CSG-15 本人でも履歴の状態・仕様を直接書き換えられない', '42501',
    pg_temp.csg_run_as('authenticated', u_owner, format(
      'update public.configurations set spec_code = %L where id = %L returning ''updated''', 'rtcsg-ng', c_quoted)));

  -- 4. 削除：Draft は明細ごと削除できる（FK の CASCADE で明細の保護に止められない）。履歴は削除できない
  -- 削除と結果の読み取りは別の文にする（同じ文の中の副問い合わせは、削除の前の時点で読まれる）
  v_out := pg_temp.csg_run_as('authenticated', u_owner, format('delete from public.configurations where id = %L returning ''deleted''', c_del));
  perform pg_temp.csg_expect_eq('CSG-16 本人は自分の Draft を削除でき、明細も一緒に消える', 'deleted/0/0',
    v_out || '/' || (select count(*) from public.configurations where id = c_del)::text
    || '/' || (select count(*) from public.configuration_items where configuration_id = c_del)::text);
  v_out := pg_temp.csg_run_as('authenticated', u_owner, format('delete from public.configurations where id = %L returning ''deleted''', c_quoted));
  perform pg_temp.csg_expect_eq('CSG-17 本人でも見積済みの履歴は削除できない（対象にならない）', '(null)/1',
    v_out || '/' || (select count(*) from public.configurations where id = c_quoted)::text);
  v_out := pg_temp.csg_run_as('authenticated', u_owner, format('delete from public.configurations where id = %L returning ''deleted''', c_other_quoted));
  perform pg_temp.csg_expect_eq('CSG-18 ほかの人の履歴も削除できない', '(null)/1',
    v_out || '/' || (select count(*) from public.configurations where id = c_other_quoted)::text);

  -- 5. 本体分類表を後から × に変えても、履歴は状態の遷移だけならそのまま進められる（明細は書き換えない）
  update public.matrix_cells set selectable = false where matrix_row_id = row_ok and matrix_item_code = 'rtcsg-item';
  perform pg_temp.csg_expect_eq('CSG-19 × になった商品を含む履歴でも、見積済み → 承諾（closed）へ進められる', 'ok',
    pg_temp.csg_try(format('update public.configurations set status = %L where id = %L', 'closed', c_quoted)));
  perform pg_temp.csg_expect_eq('CSG-20 状態の遷移で履歴の明細は変わらない', '2',
    (select count(*) from public.configuration_items where configuration_id = c_quoted)::text);
  perform pg_temp.csg_expect_error('CSG-21 履歴の仕様は変えられない（今の本体分類表で検査して止める）', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('update public.configurations set spec_code = %L where id = %L', 'rtcsg-other', c_quoted)));
  perform pg_temp.csg_expect_error('CSG-22 Draft の仕様を、明細が × になる仕様へ変えられない', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('update public.configurations set spec_code = %L where id = %L', 'rtcsg-ng', c_ok)));
  update public.matrix_cells set selectable = true where matrix_row_id = row_ok and matrix_item_code = 'rtcsg-item';
  perform pg_temp.csg_expect_error('CSG-23 Draft を仕様なしへ戻せない', 'P0001', 'VALIDATION',
    pg_temp.csg_try(format('update public.configurations set spec_code = null where id = %L', c_ok)));

  -- 6. BOX の hotel-single（住居用と同じ商品を使う互換）の別名は、商品を保存し直しても消えない
  insert into public.options (id, category_id, code, name, price, status, spec_codes, product_no)
  values (p_residence, cat_plain, 'runtime-csg-residence', '住居用の商品', 1000, 'published', array['residence'], 'PRD-928905');
  perform pg_temp.csg_expect_eq('CSG-24 住居用の商品には hotel-single の別名が付く', 'true',
    ((select 'hotel-single' = any(spec_codes) from public.options where id = p_residence))::text);
  update public.options set spec_codes = array['residence', 'office'] where id = p_residence;
  perform pg_temp.csg_expect_eq('CSG-25 対象仕様を保存し直しても別名は消えない', 'true',
    ((select 'hotel-single' = any(spec_codes) from public.options where id = p_residence))::text);
  update public.options set spec_codes = array['office'] where id = p_residence;
  perform pg_temp.csg_expect_eq('CSG-26 住居用を外せば別名も付け直さない（入力どおり）', 'false',
    ((select 'hotel-single' = any(spec_codes) from public.options where id = p_residence))::text);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _csg_result;

rollback;
