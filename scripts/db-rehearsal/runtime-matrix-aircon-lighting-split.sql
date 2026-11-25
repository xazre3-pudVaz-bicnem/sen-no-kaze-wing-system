-- Issue #707（20261123150000）：空調・照明器具を「その他」から独立させた後の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 項目 17（空調・照明器具が増えた）・本番相当のデータがある DB では対応表の移し替え・
-- 管理画面の保存（update_matrix_row）で空調と照明を別々にオン・オフできること・古い版の保存は止まること・
-- お客様の選択判定と構成の明細の確かめ（トリガー）が空調・照明の値に別々に従うこと・本部以外は変えられないことを確かめる。
-- 検査用の機種・仕様・サイズ・行・カテゴリー・商品は runtime-al-* の名前で作る（空の DB でも、本番相当のデータがある DB でも動く）
begin;

create temp table _al_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _al_result to public;

create function pg_temp.al_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

-- DB の管理者（SECURITY DEFINER の RPC と同じ立場）として実行し、失敗した文は取り消す
create function pg_temp.al_try(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text := 'ok';
begin
  begin
    execute p_sql;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  return v_out;
end;
$fn$;

create function pg_temp.al_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _al_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.al_expect_like(p_step text, p_pattern text, p_actual text) returns void
language sql as $fn$
  insert into _al_result (step, expected, actual, ok) values (p_step, p_pattern, p_actual, p_actual like p_pattern);
$fn$;

create function pg_temp.al_cells(p_row uuid) returns text
language sql as $fn$
  select coalesce(string_agg(c.matrix_item_code || '=' || c.selectable, ',' order by c.matrix_item_code), '')
    from public.matrix_cells c where c.matrix_row_id = p_row and c.matrix_item_code in ('aircon', 'lighting', 'other');
$fn$;

do $test$
declare
  u_admin constant uuid := '70740000-0000-4000-8000-000000000001';
  u_customer constant uuid := '70740000-0000-4000-8000-000000000002';
  m_model constant uuid := '70740000-0000-4000-8000-000000000101';
  row_on constant uuid := '70740000-0000-4000-8000-000000000201';
  row_off constant uuid := '70740000-0000-4000-8000-000000000202';
  cat_aircon constant uuid := '70740000-0000-4000-8000-000000000301';
  cat_lighting constant uuid := '70740000-0000-4000-8000-000000000302';
  cat_other constant uuid := '70740000-0000-4000-8000-000000000303';
  p_aircon constant uuid := '70740000-0000-4000-8000-000000000401';
  p_lighting constant uuid := '70740000-0000-4000-8000-000000000402';
  p_other constant uuid := '70740000-0000-4000-8000-000000000403';
  c_on constant uuid := '70740000-0000-4000-8000-000000000501';
  c_off constant uuid := '70740000-0000-4000-8000-000000000502';
  v_items text[];
begin
  -- 1. 項目：空調（エアコン）145・照明器具 146 が増え、有効な項目は 17
  perform pg_temp.al_expect_eq('AL-1 有効な項目は 17（空調（エアコン）145・照明器具 146 が増えた）',
    '17|aircon:空調（エアコン）:145:active,lighting:照明器具:146:active',
    (select count(*)::text from public.matrix_items where status = 'active') || '|' ||
    (select string_agg(code || ':' || label || ':' || sort_order || ':' || status, ',' order by sort_order)
       from public.matrix_items where code in ('aircon', 'lighting')));

  -- 2. 本番相当のデータがある DB：空調・照明のカテゴリーだけが自分の項目へ移り、スマートロック・外構部品は「その他」のまま
  if exists (select 1 from public.option_category_matrix_items) then
    perform pg_temp.al_expect_eq('AL-2 対応表：空調→空調・照明→照明、スマートロック・外構部品→その他',
      'aircon=aircon,exterior-parts=other,lighting=lighting,smartlock=other',
      (select string_agg(c.code || '=' || x.matrix_item_code, ',' order by c.code)
         from public.option_category_matrix_items x join public.option_categories c on c.id = x.category_id
        where c.code in ('aircon', 'lighting', 'smartlock', 'exterior-parts')));
    -- どの行にも有効な項目すべての値がある（空調・照明の値の無い行が無い）。値は移行の後に管理画面で変えられるので、
    -- 「その他」と同じことは、移行の直後（版 2）の行がある DB でだけ確かめる
    perform pg_temp.al_expect_eq('AL-2b どの行にも空調・照明の値がある（各行の値の数 = 有効な項目の数）', '0',
      (select count(*)::text from public.matrix_rows r
        where (select count(*) from public.matrix_cells c join public.matrix_items i on i.code = c.matrix_item_code and i.status = 'active'
                where c.matrix_row_id = r.id) <> (select count(*) from public.matrix_items where status = 'active')
           or not exists (select 1 from public.matrix_cells c where c.matrix_row_id = r.id and c.matrix_item_code = 'aircon')
           or not exists (select 1 from public.matrix_cells c where c.matrix_row_id = r.id and c.matrix_item_code = 'lighting')));
    if exists (select 1 from public.matrix_rows where lock_version = 2) then
      perform pg_temp.al_expect_eq('AL-2c 移行の直後（版 2）の行は、空調・照明の値が「その他」と同じ',
        (select count(*)::text from public.matrix_rows where lock_version = 2) || ' 行・違い 0',
        (select count(*)::text from public.matrix_rows where lock_version = 2) || ' 行・違い ' ||
        (select count(*)::text from public.matrix_cells c
           join public.matrix_cells o on o.matrix_row_id = c.matrix_row_id and o.matrix_item_code = 'other'
           join public.matrix_rows r on r.id = c.matrix_row_id and r.lock_version = 2
          where c.matrix_item_code in ('aircon', 'lighting') and c.selectable is distinct from o.selectable));
    end if;
  else
    perform pg_temp.al_expect_eq('AL-2 対応表（本番相当のデータが無い DB のため省略）', 'skipped', 'skipped');
  end if;

  -- 検査用のデータ（runtime-al-*）
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'al-admin@runtime.invalid', '{}'), (u_customer, 'al-customer@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'al-admin@runtime.invalid', 'AL 本部', 'admin'), (u_customer, 'al-customer@runtime.invalid', 'AL お客様', 'customer');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-al-model', '#707 検査用モデル', 1000000, 'published',
          '[{"code": "rtal-on", "name": "オン", "option_codes": []}, {"code": "rtal-off", "name": "オフ", "option_codes": []}]'::jsonb);
  insert into public.matrix_specs (code, label) values ('rtal-on', 'AL オン'), ('rtal-off', 'AL オフ') on conflict (code) do nothing;
  insert into public.matrix_sizes (code, width_mm, depth_mm, label) values ('9970x9970', 9970, 9970, 'AL') on conflict (code) do nothing;
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable, status, lock_version)
  values (row_on, m_model, 'rtal-on', '9970x9970', false, 'active', 1),
         (row_off, m_model, 'rtal-off', '9970x9970', false, 'active', 1);
  -- 「その他」がオンの行（空調・照明もオン）と、どれもオフの行。有効な項目すべての値を持たせる
  insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
  select r.id, i.code, r.id = row_on and i.code in ('aircon', 'lighting', 'other')
    from (values (row_on), (row_off)) as r(id) cross join public.matrix_items i where i.status = 'active';
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (cat_aircon, 'runtime-al-aircon', 'AL 空調', 'single', false, 'equipment', 'published'),
         (cat_lighting, 'runtime-al-lighting', 'AL 照明', 'multi', false, 'equipment', 'published'),
         (cat_other, 'runtime-al-other', 'AL その他', 'multi', false, 'equipment', 'published');
  insert into public.option_category_matrix_items (category_id, matrix_item_code)
  values (cat_aircon, 'aircon'), (cat_lighting, 'lighting'), (cat_other, 'other');
  insert into public.options (id, category_id, code, name, price, status, spec_codes, base_model_id, product_no, simulator_visible)
  values (p_aircon, cat_aircon, 'runtime-al-aircon', 'AL エアコン', 1000, 'published', '{}', null, 'PRD-970741', true),
         (p_lighting, cat_lighting, 'runtime-al-lighting', 'AL 照明', 1000, 'published', '{}', null, 'PRD-970742', true),
         (p_other, cat_other, 'runtime-al-other', 'AL その他', 1000, 'published', '{}', null, 'PRD-970743', true);
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_on, u_customer, m_model, 'AL オンの Draft', 'draft', 'rtal-on', 'equipment'),
         (c_off, u_customer, m_model, 'AL オフの Draft', 'draft', 'rtal-off', 'equipment');
  set local session_replication_role = origin;

  -- 3. 管理画面の保存：空調だけをオフ（照明・その他はオンのまま）
  v_items := array(select c.matrix_item_code from public.matrix_cells c where c.matrix_row_id = row_on and c.selectable and c.matrix_item_code <> 'aircon');
  perform pg_temp.al_expect_eq('AL-3 空調だけをオフにして保存できる（版 1 → 2）', '2',
    pg_temp.al_run_as('authenticated', u_admin, format(
      'select lock_version::text from public.update_matrix_row(%L, false, %L::text[], 1)', row_on, v_items)));
  perform pg_temp.al_expect_eq('AL-3b 保存の後：空調はオフ、照明・その他はオン', 'aircon=false,lighting=true,other=true', pg_temp.al_cells(row_on));
  perform pg_temp.al_expect_like('AL-4 古い版（1）からの保存は LOCKED で止まる（空調・照明は変わらない）', 'ERROR P0001: LOCKED:%',
    pg_temp.al_run_as('authenticated', u_admin, format(
      'select lock_version::text from public.update_matrix_row(%L, false, %L::text[], 1)', row_on, array['other'])));
  perform pg_temp.al_expect_eq('AL-4b 止めた後も値はそのまま', 'aircon=false,lighting=true,other=true', pg_temp.al_cells(row_on));
  -- 4. 「その他」がオフの行で照明だけをオン
  perform pg_temp.al_expect_eq('AL-5 照明だけをオンにして保存できる（その他・空調はオフのまま）', '2|aircon=false,lighting=true,other=false',
    pg_temp.al_run_as('authenticated', u_admin, format(
      'select lock_version::text from public.update_matrix_row(%L, false, %L::text[], 1)', row_off, array['lighting'])) || '|' ||
    pg_temp.al_cells(row_off));
  perform pg_temp.al_expect_like('AL-6 お客様は保存できない', 'ERROR 42501:%',
    pg_temp.al_run_as('authenticated', u_customer, format(
      'select lock_version::text from public.update_matrix_row(%L, false, %L::text[], 2)', row_on, array['aircon'])));

  -- 5. お客様の選択判定：空調・照明・その他の値に別々に従う
  perform pg_temp.al_expect_eq('AL-7 判定：オンの行は 空調× 照明○ その他○、オフの行は 空調× 照明○ その他×', 'false,true,true|false,true,false',
    public.customer_category_selectable('runtime-al-model', 'rtal-on', 'runtime-al-aircon')::text || ',' ||
    public.customer_category_selectable('runtime-al-model', 'rtal-on', 'runtime-al-lighting')::text || ',' ||
    public.customer_category_selectable('runtime-al-model', 'rtal-on', 'runtime-al-other')::text || '|' ||
    public.customer_category_selectable('runtime-al-model', 'rtal-off', 'runtime-al-aircon')::text || ',' ||
    public.customer_category_selectable('runtime-al-model', 'rtal-off', 'runtime-al-lighting')::text || ',' ||
    public.customer_category_selectable('runtime-al-model', 'rtal-off', 'runtime-al-other')::text);

  -- 6. 構成の明細の確かめ（トリガー。保存の RPC の中でも同じ）
  perform pg_temp.al_expect_like('AL-8 空調がオフの仕様の Draft には空調の商品を足せない', 'ERROR P0001: VALIDATION:%runtime-al-aircon%',
    pg_temp.al_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_on, p_aircon)));
  perform pg_temp.al_expect_eq('AL-8b 同じ Draft に照明・その他の商品は足せる', 'ok/ok',
    pg_temp.al_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_on, p_lighting)) || '/' ||
    pg_temp.al_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_on, p_other)));
  perform pg_temp.al_expect_eq('AL-8c その他がオフでも、照明がオンの仕様なら照明の商品は足せる', 'ok',
    pg_temp.al_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_off, p_lighting)));
  perform pg_temp.al_expect_like('AL-8d その他がオフの仕様には、その他の商品を足せない', 'ERROR P0001: VALIDATION:%runtime-al-other%',
    pg_temp.al_try(format('insert into public.configuration_items (configuration_id, option_id) values (%L, %L)', c_off, p_other)));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _al_result;

rollback;
