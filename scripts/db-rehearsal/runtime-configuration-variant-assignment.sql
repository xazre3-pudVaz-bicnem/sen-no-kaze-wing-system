-- 構成の保存で、選択肢をその明細の商品にだけ入れる（20261015100000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 商品マスターが空の DB で実行する（必須カテゴリーの検証に掛からない、検査用のカテゴリーと商品だけで保存するため）。
begin;

create temp table _cv_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _cv_result to public;

create function pg_temp.cv_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.cv_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _cv_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

do $test$
declare
  u_cust constant uuid := '78000000-0000-4000-8000-000000000001';
  m_model constant uuid := '78100000-0000-4000-8000-000000000001';
  c_items constant uuid := '78200000-0000-4000-8000-000000000001';
  o_a constant uuid := '78300000-0000-4000-8000-000000000001';
  o_b constant uuid := '78300000-0000-4000-8000-000000000002';
  o_c constant uuid := '78300000-0000-4000-8000-000000000003';
  g_a constant uuid := '78400000-0000-4000-8000-000000000001';
  g_b constant uuid := '78400000-0000-4000-8000-000000000002';
  a1 constant uuid := '78500000-0000-4000-8000-000000000001';
  b1 constant uuid := '78500000-0000-4000-8000-000000000002';
  v_cfg text;
  v_save text := $sql$
    select x.id::text from public.save_configuration_atomic(
      p_configuration_id => %L, p_base_model_id => %L, p_name => '選択肢の検査', p_option_ids => %L::uuid[],
      p_preview_image_url => null, p_notes => null, p_finish_level => 'shell', p_variant_choice_ids => %L::uuid[],
      p_spec_code => 'base', p_exterior_faces => '[]'::jsonb, p_site_prefecture => null, p_site_municipality => null,
      p_site_location_undecided => false, p_expected_lock_version => %s) x $sql$;
  v_lock integer;
  v_saved text;
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.cv_expect_eq('CV-0 商品マスターが空の DB で実行する検査のため省略', 'skipped', 'skipped');
    return;
  end if;

  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data) values (u_cust, 'cv-cust@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code) values (u_cust, 'cv-cust@runtime.invalid', 'お客様', 'customer');
  insert into public.base_models (id, slug, name, base_price, status) values (m_model, 'runtime-cv-model', '選択肢検査用モデル', 1000000, 'published');
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (c_items, 'runtime-cv-items', '選択肢検査の商品', 'multi', false, 'shell', 'published');
  insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no)
  values (o_a, m_model, c_items, 'runtime-cv-a', '選択肢のある商品A', 1000, 'published', 'PRD-980001'),
         (o_b, m_model, c_items, 'runtime-cv-b', '選択肢のある商品B', 1000, 'published', 'PRD-980002'),
         (o_c, m_model, c_items, 'runtime-cv-c', '選択肢のない商品', 1000, 'published', 'PRD-980003');
  insert into public.option_variant_groups (id, option_id, code, name, status, is_required)
  values (g_a, o_a, 'cv-color', '色', 'published', false), (g_b, o_b, 'cv-size', '大きさ', 'published', false);
  insert into public.option_variant_choices (id, group_id, code, name, status, extra_price)
  values (a1, g_a, 'white', '白', 'published', 500), (b1, g_b, 'large', '大', 'published', 300);
  set local session_replication_role = origin;

  v_cfg := pg_temp.cv_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_a, o_c], array[a1], 'null'));
  perform pg_temp.cv_expect_eq('CV-1 選択肢のある商品と無い商品を一緒に保存できる', 'true', (v_cfg ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.cv_expect_eq('CV-2 選択肢は、その商品の明細にだけ入る', 'a:' || a1::text || '/c:',
    coalesce((select string_agg(case ci.option_id when o_a then 'a' when o_b then 'b' else 'c' end || ':' || array_to_string(ci.variant_choice_ids, ','), '/'
                order by case ci.option_id when o_a then 1 when o_b then 2 else 3 end)
                from public.configuration_items ci where ci.configuration_id::text = v_cfg), '(none)'));
  select lock_version into v_lock from public.configurations where id::text = v_cfg;
  -- 保存と確認は別の文にする（同じ文の中の副問い合わせは、保存前の状態を読む）
  v_saved := pg_temp.cv_run_as('authenticated', u_cust, format(v_save, v_cfg, m_model, array[o_a, o_b, o_c], array[a1, b1], v_lock));
  perform pg_temp.cv_expect_eq('CV-3 2 つの商品の選択肢を同時に保存しても、それぞれの明細に分かれる', v_cfg || '/a:' || a1::text || '/b:' || b1::text || '/c:',
    v_saved || '/' ||
    coalesce((select string_agg(case ci.option_id when o_a then 'a' when o_b then 'b' else 'c' end || ':' || array_to_string(ci.variant_choice_ids, ','), '/'
                order by case ci.option_id when o_a then 1 when o_b then 2 else 3 end)
                from public.configuration_items ci where ci.configuration_id::text = v_cfg), '(none)'));
  perform pg_temp.cv_expect_eq('CV-4 選択肢の追加料金は、その商品の分だけ 1 回ずつ数える（合計 = 商品 3,000 円 + 選択肢 800 円）', '3800',
    (select c.option_subtotal::text from public.configurations c where c.id::text = v_cfg));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _cv_result;

rollback;
