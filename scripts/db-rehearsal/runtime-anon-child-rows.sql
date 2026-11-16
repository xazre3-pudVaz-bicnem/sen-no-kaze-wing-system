-- 匿名・お客様に公開中の商品の子の行だけを返す（2026-11-13 の先方の依頼 A・20261110120000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 匿名（公開の鍵）・お客様（ログインした会員）・代理店・本部として、検査用の行のうち見える行を数える。
-- 検査用の行の ID で数えるので、商品マスターが入っている DB でも行える。
begin;

create temp table _acr_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _acr_result to public;

create function pg_temp.acr_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.acr_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _acr_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

do $acr$
declare
  u_cust constant uuid := '7e500000-0000-4000-8000-000000000001';
  u_dealer constant uuid := '7e500000-0000-4000-8000-000000000002';
  u_admin constant uuid := '7e500000-0000-4000-8000-000000000003';
  m_model constant uuid := '7e510000-0000-4000-8000-000000000001';
  c_items constant uuid := '7e520000-0000-4000-8000-000000000001';
  -- P・P2：公開中の商品、D：下書きの商品
  o_p constant uuid := '7e530000-0000-4000-8000-000000000001';
  o_p2 constant uuid := '7e530000-0000-4000-8000-000000000002';
  o_d constant uuid := '7e530000-0000-4000-8000-000000000003';
  -- グループ：G1＝公開中の親の公開中、G2＝公開中の親の下書き、G3＝下書きの親の公開中
  g1 constant uuid := '7e540000-0000-4000-8000-000000000001';
  g2 constant uuid := '7e540000-0000-4000-8000-000000000002';
  g3 constant uuid := '7e540000-0000-4000-8000-000000000003';
  -- 選択肢：C1＝G1 の公開中、C2＝G1 の下書き、C3＝G2（下書きのグループ）の公開中、C4＝G3（下書きの親）の公開中
  c1 constant uuid := '7e550000-0000-4000-8000-000000000001';
  c2 constant uuid := '7e550000-0000-4000-8000-000000000002';
  c3 constant uuid := '7e550000-0000-4000-8000-000000000003';
  c4 constant uuid := '7e550000-0000-4000-8000-000000000004';
  q_groups constant text := 'select coalesce(string_agg(name, ''/'' order by name), '''') from public.option_variant_groups where id in (''7e540000-0000-4000-8000-000000000001'', ''7e540000-0000-4000-8000-000000000002'', ''7e540000-0000-4000-8000-000000000003'')';
  q_choices constant text := 'select coalesce(string_agg(name, ''/'' order by name), '''') from public.option_variant_choices where group_id in (''7e540000-0000-4000-8000-000000000001'', ''7e540000-0000-4000-8000-000000000002'', ''7e540000-0000-4000-8000-000000000003'')';
  q_conflicts constant text := 'select coalesce(string_agg(message, ''/'' order by message), '''') from public.option_conflicts where option_id in (''7e530000-0000-4000-8000-000000000001'', ''7e530000-0000-4000-8000-000000000003'')';
  q_dependencies constant text := 'select count(*)::text from public.option_dependencies where option_id in (''7e530000-0000-4000-8000-000000000001'', ''7e530000-0000-4000-8000-000000000003'')';
  -- 公開サイト（lib/data/public-catalog.ts）と同じ形の読み取り（公開中の行を状態で絞る）
  q_catalog_groups constant text := 'select coalesce(string_agg(name, ''/'' order by name), '''') from public.option_variant_groups where status = ''published'' and option_id in (''7e530000-0000-4000-8000-000000000001'', ''7e530000-0000-4000-8000-000000000003'')';
  q_catalog_choices constant text := 'select coalesce(string_agg(name, ''/'' order by name), '''') from public.option_variant_choices where status = ''published'' and group_id in (''7e540000-0000-4000-8000-000000000001'', ''7e540000-0000-4000-8000-000000000002'', ''7e540000-0000-4000-8000-000000000003'')';
begin
  -- ---------- 検査用のデータ（トリガーと外部キー検査を止めて、必要な行だけを直接入れる） ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_cust, 'acr-cust@runtime.invalid', '{}'), (u_dealer, 'acr-dealer@runtime.invalid', '{}'), (u_admin, 'acr-admin@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_cust, 'acr-cust@runtime.invalid', 'お客様', 'customer'), (u_dealer, 'acr-dealer@runtime.invalid', '代理店', 'dealer'),
         (u_admin, 'acr-admin@runtime.invalid', '本部', 'admin');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-acr-model', '子の行の検査用モデル', 1000000, 'published');
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (c_items, 'runtime-acr-items', '子の行の検査の商品', 'multi', false, 'shell', 'published');
  insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no, simulator_visible)
  values (o_p, m_model, c_items, 'runtime-acr-p', '公開中の商品', 10000, 'published', 'PRD-975001', true),
         (o_p2, m_model, c_items, 'runtime-acr-p2', '公開中の商品 2', 10000, 'published', 'PRD-975002', true),
         (o_d, m_model, c_items, 'runtime-acr-d', '下書きの商品', 10000, 'draft', 'PRD-975003', true);
  insert into public.option_variant_groups (id, option_id, code, name, status)
  values (g1, o_p, 'g1', 'G1 公開中の親の公開中', 'published'),
         (g2, o_p, 'g2', 'G2 公開中の親の下書き', 'draft'),
         (g3, o_d, 'g3', 'G3 下書きの親の公開中', 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status)
  values (c1, g1, 'c1', 'C1 公開中のグループの公開中', 'option', 0, 'published'),
         (c2, g1, 'c2', 'C2 公開中のグループの下書き', 'option', 0, 'draft'),
         (c3, g2, 'c3', 'C3 下書きのグループの公開中', 'option', 0, 'published'),
         (c4, g3, 'c4', 'C4 下書きの親の公開中', 'option', 0, 'published');
  insert into public.option_conflicts (option_id, conflicts_with_option_id, message)
  values (o_p, o_p2, 'X1 公開中どうし'), (o_p, o_d, 'X2 下書きの商品と'), (o_d, o_p, 'X3 下書きの商品から');
  insert into public.option_dependencies (option_id, requires_option_id)
  values (o_p, o_p2), (o_p, o_d), (o_d, o_p);
  set local session_replication_role = origin;

  -- ---------- 匿名（公開の鍵） ----------
  perform pg_temp.acr_expect_eq('ACR-1 匿名：選択グループは、グループと親の商品がどちらも公開中の行だけ',
    'G1 公開中の親の公開中', pg_temp.acr_run_as('anon', null, q_groups));
  perform pg_temp.acr_expect_eq('ACR-2 匿名：選択肢は、選択肢・グループ・親の商品がすべて公開中の行だけ',
    'C1 公開中のグループの公開中', pg_temp.acr_run_as('anon', null, q_choices));
  perform pg_temp.acr_expect_eq('ACR-3 匿名：同時選択の制限は、両方の商品が公開中の行だけ',
    'X1 公開中どうし', pg_temp.acr_run_as('anon', null, q_conflicts));
  perform pg_temp.acr_expect_eq('ACR-4 匿名：依存のルールは、両方の商品が公開中の行だけ',
    '1', pg_temp.acr_run_as('anon', null, q_dependencies));
  perform pg_temp.acr_expect_eq('ACR-5 匿名：公開サイトと同じ形の読み取り（公開中のグループ）は、公開中の商品の分だけ',
    'G1 公開中の親の公開中', pg_temp.acr_run_as('anon', null, q_catalog_groups));
  perform pg_temp.acr_expect_eq('ACR-6 匿名：公開サイトと同じ形の読み取り（公開中の選択肢）は、公開中の商品の公開中のグループの分だけ',
    'C1 公開中のグループの公開中', pg_temp.acr_run_as('anon', null, q_catalog_choices));
  perform pg_temp.acr_expect_eq('ACR-7 匿名：下書きの商品そのものは今までどおり見えない',
    '0', pg_temp.acr_run_as('anon', null, 'select count(*)::text from public.options where id = ''7e530000-0000-4000-8000-000000000003'''));
  perform pg_temp.acr_expect_eq('ACR-8 匿名：価格・追加金額の列は今までどおり読めない（C1b）',
    'ERROR 42501/ERROR 42501',
    split_part(pg_temp.acr_run_as('anon', null, 'select price::text from public.options limit 1'), ':', 1) || '/' ||
    split_part(pg_temp.acr_run_as('anon', null, 'select extra_price::text from public.option_variant_choices limit 1'), ':', 1));

  -- ---------- お客様（ログインした会員） ----------
  perform pg_temp.acr_expect_eq('ACR-11 お客様：選択グループは匿名と同じ（公開中の商品の公開中だけ）',
    'G1 公開中の親の公開中', pg_temp.acr_run_as('authenticated', u_cust, q_groups));
  perform pg_temp.acr_expect_eq('ACR-12 お客様：選択肢は匿名と同じ',
    'C1 公開中のグループの公開中', pg_temp.acr_run_as('authenticated', u_cust, q_choices));
  perform pg_temp.acr_expect_eq('ACR-13 お客様：同時選択の制限・依存のルールは、両方の商品が公開中の行だけ',
    'X1 公開中どうし/1',
    pg_temp.acr_run_as('authenticated', u_cust, q_conflicts) || '/' || pg_temp.acr_run_as('authenticated', u_cust, q_dependencies));

  -- ---------- 代理店・本部（今までどおり。下書きの閲覧の範囲は先方の判断待ちのため変えない） ----------
  perform pg_temp.acr_expect_eq('ACR-21 代理店：選択グループは今までどおりすべて',
    'G1 公開中の親の公開中/G2 公開中の親の下書き/G3 下書きの親の公開中', pg_temp.acr_run_as('authenticated', u_dealer, q_groups));
  perform pg_temp.acr_expect_eq('ACR-22 代理店：選択肢は今までどおりすべて',
    'C1 公開中のグループの公開中/C2 公開中のグループの下書き/C3 下書きのグループの公開中/C4 下書きの親の公開中',
    pg_temp.acr_run_as('authenticated', u_dealer, q_choices));
  perform pg_temp.acr_expect_eq('ACR-23 代理店：同時選択の制限・依存のルールは今までどおりすべて',
    'X1 公開中どうし/X2 下書きの商品と/X3 下書きの商品から/3',
    pg_temp.acr_run_as('authenticated', u_dealer, q_conflicts) || '/' || pg_temp.acr_run_as('authenticated', u_dealer, q_dependencies));
  perform pg_temp.acr_expect_eq('ACR-24 本部：選択グループ・選択肢は今までどおりすべて',
    'G1 公開中の親の公開中/G2 公開中の親の下書き/G3 下書きの親の公開中|C1 公開中のグループの公開中/C2 公開中のグループの下書き/C3 下書きのグループの公開中/C4 下書きの親の公開中',
    pg_temp.acr_run_as('authenticated', u_admin, q_groups) || '|' || pg_temp.acr_run_as('authenticated', u_admin, q_choices));

  -- ---------- 書き込みは今までどおり止まる ----------
  perform pg_temp.acr_expect_eq('ACR-31 匿名・お客様は選択グループを書き換えられない（0 行）',
    '0/0',
    pg_temp.acr_run_as('anon', null, 'with u as (update public.option_variant_groups set name = name where id = ''7e540000-0000-4000-8000-000000000001'' returning 1) select count(*)::text from u') || '/' ||
    pg_temp.acr_run_as('authenticated', u_cust, 'with u as (update public.option_variant_groups set name = name where id = ''7e540000-0000-4000-8000-000000000001'' returning 1) select count(*)::text from u'));
end;
$acr$;

select coalesce(json_agg(json_build_object('ok', ok, 'step', step, 'expected', expected, 'actual', actual) order by seq), '[]'::json) as j
  from _acr_result;

rollback;
