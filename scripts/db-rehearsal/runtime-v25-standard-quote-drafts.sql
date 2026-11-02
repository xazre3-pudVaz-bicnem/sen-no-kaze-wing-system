-- v2.5 PR-D1c：Web 以外（本部だけ）の案件で、v2.5 の標準見積の版から見積下書きを作る・発行する・改訂するの実行時検査。
-- 使い捨てDB専用。最後に rollback する。
begin;

create temp table _sqd_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _sqd_result to public;

create function pg_temp.sqd_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.sqd_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _sqd_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.sqd_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _sqd_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || '%');
$fn$;

-- 下書きの明細を保存の形にする（経費の行は除く。別途見積の行は p_prices の売価・原価で manual にする。p_extra を後ろに足す）
create function pg_temp.sqd_lines(p_draft uuid, p_prices jsonb, p_extra jsonb default '[]'::jsonb) returns jsonb
language sql as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_key', i.line_key, 'section_code', c.section_code, 'name', i.name, 'description', i.description,
           'unit', i.unit, 'remark', i.remark, 'quantity', i.quantity,
           'price_mode', case when p_prices ? i.name then 'manual' else i.price_mode end,
           'cost_unit_price', coalesce((p_prices -> i.name ->> 'cost')::integer, c.cost_unit_price),
           'unit_price', coalesce((p_prices -> i.name ->> 'sale')::integer, i.unit_price)
         ) order by i.sort_order, i.line_key), '[]'::jsonb) || p_extra
    from public.quote_draft_items i
    join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
   where i.draft_id = p_draft and c.line_role = 'line';
$fn$;

-- 本部として下書きを保存する（率・経費の方法は下書きのまま）
create function pg_temp.sqd_save(p_user uuid, p_draft uuid, p_lines jsonb) returns text
language sql as $fn$
  select pg_temp.sqd_run_as('authenticated', p_user, format(
    $q$ select public.save_standard_quote_draft(%L, %s, %s, %s, %s, %L::jsonb, %L::jsonb, 0, null, null)::text $q$,
    p_draft, d.lock_version, n.sales_fee_rate, n.expense_rate, n.markup_rate, n.expense_methods, p_lines))
    from public.quote_drafts d
    join public.quote_draft_internals n on n.draft_id = d.id
   where d.id = p_draft;
$fn$;

do $test$
declare
  u_admin constant uuid := '2a300000-0000-4000-8000-000000000001';
  u_editor constant uuid := '2a300000-0000-4000-8000-000000000002';
  u_dealer constant uuid := '2a300000-0000-4000-8000-000000000003';
  u_master constant uuid := '2a300000-0000-4000-8000-000000000004';
  org_hq constant uuid := '2a300000-0000-4000-8000-000000000101';
  m_model constant uuid := '2a300000-0000-4000-8000-000000000201';
  mr_office constant uuid := '2a300000-0000-4000-8000-000000000301';
  mr_hotel constant uuid := '2a300000-0000-4000-8000-000000000302';
  cat_opt constant uuid := '2a300000-0000-4000-8000-000000000401';
  cat_sash constant uuid := '2a300000-0000-4000-8000-000000000402';
  cat_site constant uuid := '2a300000-0000-4000-8000-000000000403';
  o1 constant uuid := '2a300000-0000-4000-8000-000000000501';
  o2 constant uuid := '2a300000-0000-4000-8000-000000000502';
  o3 constant uuid := '2a300000-0000-4000-8000-000000000503';
  s1 constant uuid := '2a300000-0000-4000-8000-000000000504';
  o5 constant uuid := '2a300000-0000-4000-8000-000000000505';
  g_o2 constant uuid := '2a300000-0000-4000-8000-000000000601';
  g_color constant uuid := '2a300000-0000-4000-8000-000000000602';
  c_o2 constant uuid := '2a300000-0000-4000-8000-000000000701';
  c_white constant uuid := '2a300000-0000-4000-8000-000000000702';
  v_bmr text;
  v_bmr2 text;
  v_legacy text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_out text;
  v_draft uuid;
  v_quote uuid;
  v_rdraft uuid;
  v_payload jsonb;
  v_prices jsonb;
  v_sale text;
  v_draft_lines text;
  v_slot jsonb;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'sqd-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'sqd-editor@runtime.invalid', '{}'::jsonb),
         (u_dealer, 'sqd-dealer@runtime.invalid', '{}'::jsonb), (u_master, 'sqd-master@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'sqd-admin@runtime.invalid', '本部', 'admin'),
         (u_editor, 'sqd-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_dealer, 'sqd-dealer@runtime.invalid', '代理店', 'dealer'),
         (u_master, 'sqd-master@runtime.invalid', '総代理店', 'master_dealer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-sqd-hq', 'D1c Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-sqd-model', 'D1c 検査モデル', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false), (mr_hotel, m_model, 'hotel', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode, uses_window_type)
  values (cat_opt, 'runtime-sqd-option', 'D1c 設備', 'published', 'multi', false),
         (cat_sash, 'runtime-sqd-sash', 'D1c サッシ', 'published', 'single', true),
         (cat_site, 'runtime-sqd-site', 'D1c 施工', 'published', 'multi', false);
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values
    (o1, cat_opt, 'runtime-sqd-o1', 'D1c 設備1', 20000, false, 'published', 'PRD-947001', false),
    (o2, cat_opt, 'runtime-sqd-o2', 'D1c 設備2', 10000, false, 'published', 'PRD-947002', false),
    (o3, cat_opt, 'runtime-sqd-o3', 'D1c 設備3（別途見積）', 0, true, 'published', 'PRD-947003', false),
    (s1, cat_sash, 'runtime-sqd-s1', 'D1c サッシ1', 30000, false, 'published', 'PRD-947004', false),
    (o5, cat_site, 'runtime-sqd-o5', 'D1c 施工1', 8000, false, 'published', 'PRD-947005', true);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_o2, o2, 'size', 'サイズ', 1, false, 'published'), (g_color, s1, 'color', '色', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (c_o2, g_o2, 'large', '大', 'option', 1000, 'published', 1), (c_white, g_color, 'white', '白', 'standard', 0, 'published', 1);
  set local session_replication_role = origin;

  -- 原価（本部）：設備1 20,000、設備2 10,000＋大 1,000、サッシ1 30,000＋白 0（設備3 は別途見積、施工1 は売価を決める）
  perform pg_temp.sqd_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', o1));
  perform pg_temp.sqd_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 10000, 0, ''検査'')', o2));
  perform pg_temp.sqd_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 30000, 0, ''検査'')', s1));
  perform pg_temp.sqd_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 1000, null, ''検査'')', c_o2));
  perform pg_temp.sqd_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 0, null, ''検査'')', c_white));

  -- 本体（伸縮脚 18,200 × 12 本）と、v2.5 の標準見積。率は 1.07・1.5・経費 15%
  --   選択枠：設備1・設備2（大）・設備3（別途見積）・サッシ1（白。位置「掃出し窓」）・施工1（売価 8,000 円）
  --   明細：取付費 10,000 円・養生 0 円（オプション）、据付工事（別途見積。別途工事）
  v_bmr := pg_temp.sqd_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'D1c 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.sqd_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'D1c 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.sqd_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.sqd_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.sqd_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;
  v_slot := jsonb_build_object('baseline_key', null, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1', 'price_mode', 'auto',
                               'manual_unit_price', null, 'slot_code', null, 'slot_label', null, 'selectable_option_ids', '[]'::jsonb);
  v_payload := jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', jsonb_build_array(
      v_slot || jsonb_build_object('option_id', o1),
      v_slot || jsonb_build_object('option_id', o2, 'variant_choice_ids', jsonb_build_array(c_o2)),
      v_slot || jsonb_build_object('option_id', o3, 'price_mode', 'por'),
      v_slot || jsonb_build_object('option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white), 'slot_code', 'hakidashi', 'slot_label', '掃出し窓'),
      v_slot || jsonb_build_object('option_id', o5, 'price_mode', 'manual', 'manual_unit_price', 8000)),
    'lines', jsonb_build_array(
      jsonb_build_object('line_key', null, 'section_code', 'option', 'group_label', 'D1c 工事', 'name', '取付費',
        'quantity', '1', 'unit', '式', 'price_mode', 'manual', 'unit_price', 10000, 'remark', null, 'review_required', false),
      jsonb_build_object('line_key', null, 'section_code', 'option', 'group_label', 'D1c 工事', 'name', '養生',
        'quantity', '1', 'unit', '式', 'price_mode', 'manual', 'unit_price', 0, 'remark', null, 'review_required', false),
      jsonb_build_object('line_key', null, 'section_code', 'sitework', 'group_label', 'D1c 別途工事', 'name', '据付工事',
        'quantity', '1', 'unit', '式', 'price_mode', 'por', 'unit_price', null, 'remark', null, 'review_required', false)));
  v_out := pg_temp.sqd_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev), v_payload));
  v_out := pg_temp.sqd_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  -- 本体 29,211 × 12 ＝ 350,532、経費 52,579。オプション 32,100＋17,655＋48,150＋10,000＋0 ＝ 107,905、経費 16,185。別途工事 8,000（経費なし）
  -- 税抜 535,201・税 53,520・税込 588,721（別途見積の 2 行は合計に含めない）
  perform pg_temp.sqd_expect_eq('D1c-0 前提：v2.5 の標準見積を公開できる（税込 588,721 円・別途見積あり）', 'published/535201/53520/588721/true',
    v_out || '/' || coalesce((select r.subtotal || '/' || r.tax || '/' || r.total || '/' || r.has_por from public.standard_estimate_revisions r where r.id = v_rev), '(none)'));

  -- ---------- 案件と下書きを作る ----------
  perform pg_temp.sqd_expect_error('D1c-1 代理店・総代理店は、標準見積から案件を作れない（今と同じく本部だけ）', '42501', 'FORBIDDEN',
    pg_temp.sqd_run_as('authenticated', u_master, format($q$ select public.create_standard_quote_case('D1c 案件', '{"full_name":"検査 花子"}'::jsonb, null, %L)::text $q$, v_rev)));
  v_out := pg_temp.sqd_run_as('authenticated', u_admin,
    format($q$ select public.create_standard_quote_case('D1c 案件', '{"full_name":"検査 花子"}'::jsonb, '電話で受付', %L)::text $q$, v_rev));
  v_draft := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.sqd_expect_eq('D1c-2 本部は v2.5 の標準見積の版から案件と見積下書きを作れる（作り方・元の版を下書きに持つ）', 'standard_estimate/true',
    coalesce((select d.source_kind || '/' || (d.standard_estimate_revision_id = v_rev)::text from public.quote_drafts d where d.id = v_draft), v_out));
  perform pg_temp.sqd_expect_eq('D1c-3 同じ明細・率なので、下書きの合計は標準見積の版の合計と同じ', '535201/535201/53520/588721',
    coalesce((select d.subtotal_raw || '/' || d.subtotal || '/' || d.tax || '/' || d.total from public.quote_drafts d where d.id = v_draft), '(none)'));

  -- 明細：本体の後、区分ごとに選択枠（版の順）→ 商品に紐づかない明細 → 経費。品名は「商品名 ／ 仕様」、見出しは「カテゴリー（位置）」
  select string_agg(i.name || '|' || coalesce(i.description, '') || '|' || i.price_mode || '|' || coalesce(i.unit_price::text, 'por'), ' ; ' order by i.sort_order)
    into v_draft_lines
    from public.quote_draft_items i
   where i.draft_id = v_draft and i.kind not in ('base', 'base_expense');
  perform pg_temp.sqd_expect_eq('D1c-4 明細の品名・見出し・価格の決め方・売価単価（Web の第 1 版の見積と同じ名前）',
    'D1c 設備1|D1c 設備|auto|32100 ; D1c 設備2 ／ 大|D1c 設備|auto|17655 ; D1c 設備3（別途見積）|D1c 設備|por|por ; '
    || 'D1c サッシ1 ／ 白|D1c サッシ（掃出し窓）|auto|48150 ; 取付費|D1c 工事|manual|10000 ; 養生|D1c 工事|manual|0 ; '
    || 'オプション諸費用|交通費、労災、安全管理費等（15%）|auto|16185 ; D1c 施工1|D1c 施工|manual|8000 ; 据付工事|D1c 別途工事|por|por',
    coalesce(v_draft_lines, '(none)'));
  -- Web の第 1 版の見積（標準見積の売価の表示）と、品名ごとの金額が同じ
  select string_agg((l.value ->> 'name') || '=' || coalesce(l.value ->> 'amount', 'por'), ',' order by l.value ->> 'name')
    into v_sale
    from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') l;
  perform pg_temp.sqd_expect_eq('D1c-5 品名ごとの金額は、Web の見積に使う版の売価と同じ', v_sale,
    (select string_agg(i.name || '=' || coalesce(i.amount::text, 'por'), ',' order by i.name)
       from public.quote_draft_items i
       join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
      where i.draft_id = v_draft and i.kind <> 'base' and c.line_role = 'line'));
  -- 原価：本体 19,474 × 12 ＝ 233,688（経費 35,053）、選択枠は版で固定した原価単価（21,400・11,770・32,100）、
  -- manual は売価と同じ（取付費 10,000・養生 0・施工1 8,000）。オプション 75,270（経費 11,290）。合計 363,301
  perform pg_temp.sqd_expect_eq('D1c-6 社内の記録の原価：選択枠は版で固定した原価単価、manual の行は売価と同じ（粗利 0）。合計 363,301 円',
    '21400/11770/32100/10000/8000/363301',
    (select string_agg(c.cost_unit_price::text, '/' order by i.sort_order)
       from public.quote_draft_items i
       join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
      where i.draft_id = v_draft and i.name in ('D1c 設備1', 'D1c 設備2 ／ 大', 'D1c サッシ1 ／ 白', '取付費', 'D1c 施工1')) || '/' ||
    pg_temp.sqd_run_as('authenticated', u_admin, format($q$ select public.get_standard_quote_draft(%L) -> 'internals' ->> 'cost_total' $q$, v_draft)));

  -- ---------- 正式保存（発行） ----------
  perform pg_temp.sqd_expect_error('D1c-7 別途見積の行が残る間は正式保存できない（今と同じ）', 'P0001', 'VALIDATION',
    pg_temp.sqd_run_as('authenticated', u_admin, format('select public.finalize_quote_draft(%L, %s)::text', v_draft,
      (select lock_version from public.quote_drafts where id = v_draft))));
  -- 別途見積の 2 行に金額を入れ、新しく 0 円の行を足す
  v_prices := jsonb_build_object('D1c 設備3（別途見積）', jsonb_build_object('sale', 5000, 'cost', 4000),
                                 '据付工事', jsonb_build_object('sale', 30000, 'cost', 30000));
  v_out := pg_temp.sqd_save(u_admin, v_draft, pg_temp.sqd_lines(v_draft, v_prices, jsonb_build_array(jsonb_build_object(
    'section_code', 'option', 'name', '追加の0円', 'description', 'D1c 工事', 'unit', '式', 'quantity', 1,
    'price_mode', 'manual', 'cost_unit_price', 0, 'unit_price', 0))));
  perform pg_temp.sqd_expect_error('D1c-8 版の 0 円の明細（養生）は変えていなければ止めず、新しく足した 0 円の行だけを金額未確定として止める',
    'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（追加の0円）',
    pg_temp.sqd_run_as('authenticated', u_admin, format('select public.finalize_quote_draft(%L, %s)::text', v_draft,
      (select lock_version from public.quote_drafts where id = v_draft))));
  v_out := pg_temp.sqd_save(u_admin, v_draft, pg_temp.sqd_lines(v_draft, '{}'::jsonb) - (
    select (ordinality - 1)::integer from jsonb_array_elements(pg_temp.sqd_lines(v_draft, '{}'::jsonb)) with ordinality e(value, ordinality)
     where e.value ->> 'name' = '追加の0円'));
  -- オプション 112,905（経費 16,935）、別途工事 38,000。税抜 570,951・税 57,095・税込 628,046
  perform pg_temp.sqd_expect_eq('D1c-9 金額を入れた下書きの合計（オプション 112,905・経費 16,935・別途工事 38,000。税込 628,046 円）', '570951/57095/628046',
    coalesce((select d.subtotal || '/' || d.tax || '/' || d.total from public.quote_drafts d where d.id = v_draft), v_out));
  v_out := pg_temp.sqd_run_as('authenticated', u_admin, format('select public.finalize_quote_draft(%L, %s)::text', v_draft,
    (select lock_version from public.quote_drafts where id = v_draft)));
  v_quote := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.sqd_expect_eq('D1c-10 正式保存できる。見積は Web 以外の仕組み（版の固定の列は使わず、社内の記録に元の版・率・原価）', '628046/(none)/true/1.5000/397901',
    coalesce((select q.total || '/' || coalesce(q.pricing_model, '(none)') from public.quotes q where q.id = v_quote), v_out) || '/' ||
    coalesce((select (s.standard_estimate_revision_id = v_rev)::text || '/' || s.markup_rate || '/' || s.cost_total
                from public.quote_internal_snapshots s where s.quote_id = v_quote), '(no snapshot)'));

  -- ---------- 改訂の下書き（直前の発行版から元の版を引き継ぐ。以前は v2.5 の版のため止まっていた） ----------
  v_out := pg_temp.sqd_run_as('authenticated', u_admin, format('select public.create_quote_revision_draft(%L)::text', v_quote));
  v_rdraft := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.sqd_expect_eq('D1c-11 改訂の下書きを作れる（作り方・元の版・率・原価を発行版から引き継ぐ。最新の標準見積へは追従しない）',
    'standard_estimate/true/1.5000/397901',
    coalesce((select d.source_kind || '/' || (d.standard_estimate_revision_id = v_rev)::text from public.quote_drafts d where d.id = v_rdraft), v_out) || '/' ||
    coalesce((select n.markup_rate || '/' || n.cost_total from public.quote_draft_internals n where n.draft_id = v_rdraft), '(none)'));

  -- ---------- その他 ----------
  -- 別の仕様（ホテル）の本体から、旧来（v2.5 でない）の標準見積の下書きを作る
  v_bmr2 := pg_temp.sqd_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'D1c 本体 2', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_hotel));
  perform pg_temp.sqd_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'D1c 本体 2', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr2));
  perform pg_temp.sqd_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr2));
  v_legacy := pg_temp.sqd_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr2));
  perform pg_temp.sqd_expect_eq('D1c-12 v2.5 でない版・見つからない版からは、v2.5 の明細を作らない（今の作り方のまま）', 'legacy/[]/[]',
    coalesce((select r.pricing_model from public.standard_estimate_revisions r where r.id::text = v_legacy), v_legacy) || '/' ||
    public.standard_estimate_v25_quote_draft_lines(case when v_legacy ~ '^[0-9a-f-]{36}$' then v_legacy::uuid end)::text || '/' ||
    public.standard_estimate_v25_quote_draft_lines(gen_random_uuid())::text);
  perform pg_temp.sqd_expect_eq('D1c-13 権限：明細を作る関数は API のロールから実行できない', 'false/false/false',
    has_function_privilege('anon', 'public.standard_estimate_v25_quote_draft_lines(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.standard_estimate_v25_quote_draft_lines(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('service_role', 'public.standard_estimate_v25_quote_draft_lines(uuid)', 'EXECUTE')::text);

  -- 単位が見積の明細に入らない長さの版：行の番号ではなく明細の名前で知らせ、案件も作らない
  v_rev2 := pg_temp.sqd_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master))::uuid;
  v_out := pg_temp.sqd_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev2,
    (select lock_version from public.standard_estimate_revisions where id = v_rev2),
    jsonb_set(v_payload, '{lines}', jsonb_build_array(
      jsonb_build_object('line_key', null, 'section_code', 'option', 'group_label', 'D1c 工事', 'name', '長い単位の工事',
        'quantity', '1', 'unit', '一式（設置場所により変動します）', 'price_mode', 'manual', 'unit_price', 1000, 'remark', null, 'review_required', false)))));
  v_out := pg_temp.sqd_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev2,
    (select lock_version from public.standard_estimate_revisions where id = v_rev2)));
  perform pg_temp.sqd_expect_error('D1c-14 見積の明細に入らない単位の版からは作れない（明細の名前を示す）', 'P0001', 'VALIDATION: 標準見積の明細（「長い単位の工事」）',
    pg_temp.sqd_run_as('authenticated', u_admin,
      format($q$ select public.create_standard_quote_case('D1c 案件 2', '{"full_name":"検査 次郎"}'::jsonb, null, %L)::text $q$, v_rev2)));
  perform pg_temp.sqd_expect_eq('D1c-15 作れなかったときは、案件も下書きも残さない', '1/0',
    (select count(*)::text from public.quote_requests r where r.case_name like 'D1c 案件%') || '/' ||
    (select count(*)::text from public.quote_drafts d where d.standard_estimate_revision_id = v_rev2));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _sqd_result;

rollback;
