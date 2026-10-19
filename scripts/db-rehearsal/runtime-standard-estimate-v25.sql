-- v2.5 PR-B1：標準見積の v2.5 の Revision の実行時検査。使い捨てDB専用。最後にrollbackする。
-- 同時実行（公開と原価の切替・保存と公開）は runtime-standard-estimate-v25.mjs が 2 本の接続で確かめる。
begin;

create temp table _sev_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _sev_result to public;

create function pg_temp.sev_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.sev_try_super(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  return coalesce(v_out, '(null)');
end;
$fn$;

create function pg_temp.sev_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _sev_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.sev_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _sev_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

create function pg_temp.sev_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _sev_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

-- 本部の editor として編集画面の確認（preview）を呼ぶ
create function pg_temp.sev_preview(p_sub uuid, p_revision_id uuid) returns jsonb
language plpgsql as $fn$
declare
  v_out jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_sub)::text, true);
  set local role authenticated;
  v_out := public.preview_standard_estimate_v25_revision(p_revision_id);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- 保存の内容（率は既存の標準見積と同じ 1.07・1.5・0.15）
create function pg_temp.sev_payload(p_slots jsonb, p_lines jsonb, p_adjustment integer default 0, p_reason text default null,
                                    p_sales_fee text default '1.07') returns text
language sql as $fn$
  select jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', p_sales_fee, 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', p_adjustment, 'adjustment_reason', p_reason,
    'slots', p_slots, 'lines', p_lines)::text;
$fn$;

do $test$
declare
  u_admin constant uuid := '25000000-0000-4000-8000-000000000031';
  u_editor constant uuid := '25000000-0000-4000-8000-000000000032';
  u_master constant uuid := '25000000-0000-4000-8000-000000000033';
  u_customer constant uuid := '25000000-0000-4000-8000-000000000034';
  org_hq constant uuid := '25000000-0000-4000-8000-000000000131';
  org_master constant uuid := '25000000-0000-4000-8000-000000000132';
  m_model constant uuid := '25000000-0000-4000-8000-000000000631';
  mr_a constant uuid := '25000000-0000-4000-8000-000000000641';
  mr_b constant uuid := '25000000-0000-4000-8000-000000000642';
  cat_id constant uuid := '25000000-0000-4000-8000-000000000231';
  p1 constant uuid := '25000000-0000-4000-8000-000000000331';
  p2 constant uuid := '25000000-0000-4000-8000-000000000332';
  p3 constant uuid := '25000000-0000-4000-8000-000000000333';
  p4 constant uuid := '25000000-0000-4000-8000-000000000334';
  p5 constant uuid := '25000000-0000-4000-8000-000000000335';
  g1 constant uuid := '25000000-0000-4000-8000-000000000431';
  c1 constant uuid := '25000000-0000-4000-8000-000000000531';
  c2 constant uuid := '25000000-0000-4000-8000-000000000532';
  v_bmr_a text;
  v_bmr_b text;
  v_se_a1 text;
  v_se_b1 text;
  v_master_a uuid;
  v_master_b uuid;
  v_a2 uuid;
  v_a3 uuid;
  v_b2 uuid;
  v_out text;
  v_p1_v1 uuid;
  v_calc uuid;
  v_tax uuid;
  v_slots jsonb;
  v_lines jsonb;
  v_lock integer;
  v_qd uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'sev-admin@runtime.invalid', '{}'::jsonb),
    (u_editor, 'sev-editor@runtime.invalid', '{}'::jsonb),
    (u_master, 'sev-master@runtime.invalid', '{}'::jsonb),
    (u_customer, 'sev-customer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'sev-admin@runtime.invalid', 'global admin', 'admin'),
    (u_editor, 'sev-editor@runtime.invalid', 'HQ editor', 'customer'),
    (u_master, 'sev-master@runtime.invalid', 'master dealer', 'master_dealer'),
    (u_customer, 'sev-customer@runtime.invalid', 'customer', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values
    (org_hq, 'runtime-sev-hq', 'SE v2.5 Runtime HQ', 'headquarters', 'active'),
    (org_master, 'runtime-sev-master', 'SE v2.5 Runtime Master', 'master_dealer', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values
    (org_hq, u_editor, 'editor', 'active'),
    (org_master, u_master, 'owner', 'active');

  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-sev-model', 'v2.5 標準見積検査モデル', 1000000, 'published');
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_a, m_model, 'office', '2100x4550', false), (mr_b, m_model, 'hotel', '3640x4550', true);

  -- 本体分類表に対応の無いカテゴリーは、どの仕様でもお客様が選べる（区分は「オプション」）
  insert into public.option_categories (id, code, name, status)
  values (cat_id, 'runtime-sev-category', 'v2.5標準見積検査', 'published');
  insert into public.options (id, category_id, code, name, price, status, product_no)
  values
    (p1, cat_id, 'runtime-sev-p1', '検査商品1（選択肢あり）', 120000, 'published', 'PRD-925031'),
    (p2, cat_id, 'runtime-sev-p2', '検査商品2', 30000, 'published', 'PRD-925032'),
    (p3, cat_id, 'runtime-sev-p3', '検査商品3（原価未設定）', 50000, 'published', 'PRD-925033'),
    (p4, cat_id, 'runtime-sev-p4', '検査商品4', 10000, 'published', 'PRD-925034');
  -- 施工の商品は別途工事の区分（estimate_section_for_option）
  insert into public.options (id, category_id, code, name, price, status, product_no, is_installation)
  values (p5, cat_id, 'runtime-sev-p5', '検査施工5（別途工事）', 20000, 'published', 'PRD-925035', true);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g1, p1, 'size', 'サイズ', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status)
  values (c1, g1, 'standard', '標準', 'standard', 0, 'published'),
         (c2, g1, 'large', '大', 'option', 5000, 'published');

  set local session_replication_role = origin;

  -- 商品の標準原価と選択肢の調整額（v2.5 PR-A1 の RPC）
  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 100000, 0, ''初回設定'')', p1));
  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''初回設定'')', p2));
  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 8000, 0, ''初回設定'')', p4));
  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 15000, 0, ''初回設定'')', p5));
  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 0, null, ''標準は差なし'')', c1));
  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 5000, null, ''大サイズの原価差'')', c2));
  select v.id into v_p1_v1 from public.option_standard_cost_versions v where v.option_id = p1 and v.superseded_at is null;
  select r.id into v_calc from public.pricing_calculation_rule_versions r where r.superseded_at is null;
  select t.id into v_tax from public.tax_rule_versions t where t.superseded_at is null;

  -- 本体 A・B（基準原価 18,200 円 × 12 本）を公開する
  v_bmr_a := pg_temp.sev_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'v2.5検査 本体A', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_a));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'v2.5検査 本体A', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr_a));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr_a));
  v_bmr_b := pg_temp.sev_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'v2.5検査 本体B', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_b));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'v2.5検査 本体B', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr_b));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr_b));

  -- v2.5 以前の標準見積 A・B（オプションの auto 明細 1 行・別途工事の POR 1 行、標準状態の商品 2 つ）を公開する
  v_se_a1 := pg_temp.sev_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr_a));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.save_standard_estimate_draft(%L, 1.07, 0.15, 1.5, 0, null,
    '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb,
    '[{"section_code":"option","name":"洗面器","quantity":1,"price_mode":"auto","cost_unit_price":46150},{"section_code":"sitework","name":"外構工事","quantity":1,"price_mode":"por"}]'::jsonb,
    1)).id::text $q$, v_se_a1));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.set_standard_estimate_baseline(%L,
    jsonb_build_array(jsonb_build_object('option_id', %L::text, 'variant_choice_ids', jsonb_build_array(%L::text), 'quantity', 1),
                      jsonb_build_object('option_id', %L::text, 'quantity', 2)), 2)).id::text $q$, v_se_a1, p1, c1, p2));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.publish_standard_estimate_revision(%L, 3)).id::text $q$, v_se_a1));
  select r.standard_estimate_master_id into v_master_a from public.standard_estimate_revisions r where r.id::text = v_se_a1;

  v_se_b1 := pg_temp.sev_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr_b));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.save_standard_estimate_draft(%L, 1.07, 0.15, 1.5, 0, null,
    '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb,
    '[{"section_code":"option","name":"洗面器","quantity":1,"price_mode":"auto","cost_unit_price":46150},{"section_code":"sitework","name":"設置工事","quantity":1,"price_mode":"auto","cost_unit_price":30000}]'::jsonb,
    1)).id::text $q$, v_se_b1));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.set_standard_estimate_baseline(%L,
    jsonb_build_array(jsonb_build_object('option_id', %L::text, 'quantity', 1)), 2)).id::text $q$, v_se_b1, p2));
  perform pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.publish_standard_estimate_revision(%L, 3)).id::text $q$, v_se_b1));
  select r.standard_estimate_master_id into v_master_b from public.standard_estimate_revisions r where r.id::text = v_se_b1;

  perform pg_temp.sev_expect_eq('前提：v2.5 以前の標準見積 A・B を公開できた', 'published/published/legacy',
    (select string_agg(r.status, '/' order by r.version) from public.standard_estimate_revisions r where r.id::text in (v_se_a1, v_se_b1)) || '/' ||
    (select r.pricing_model from public.standard_estimate_revisions r where r.id::text = v_se_a1));

  -- A は v2.5 以前の下書き（次の Revision）を作っておく（v2.5 への切り替えの対象）
  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_next_standard_estimate_revision(%L)::text', v_master_a));
  v_a2 := v_out::uuid;

  -- ---------- 公開の境界 ----------

  perform pg_temp.sev_expect_denied('anonは v2.5 の下書きを作れない', '42501',
    pg_temp.sev_run_as('anon', null, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master_a)));
  perform pg_temp.sev_expect_denied('service_roleは v2.5 の下書きを作れない', '42501',
    pg_temp.sev_run_as('service_role', null, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master_a)));
  perform pg_temp.sev_expect_error('お客様は v2.5 の下書きを作れない', '42501', 'FORBIDDEN',
    pg_temp.sev_run_as('authenticated', u_customer, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master_a)));
  perform pg_temp.sev_expect_error('総代理店は本部の標準見積の v2.5 の下書きを作れない', '42501', 'FORBIDDEN',
    pg_temp.sev_run_as('authenticated', u_master, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master_a)));
  perform pg_temp.sev_expect_denied('内部の再計算はログインした利用者から実行できない', '42501',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.standard_estimate_v25_recalculate(%L)::text', v_a2)));
  perform pg_temp.sev_expect_denied('内部の計算の入力はログインした利用者から実行できない', '42501',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.standard_estimate_v25_calc_input(%L)::text', v_a2)));

  -- ---------- v2.5 以前の下書きを v2.5 に切り替える ----------

  perform pg_temp.sev_expect_error('読んだ下書きの版が違えば切り替えない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 99)::text', v_master_a)));
  perform pg_temp.sev_expect_error('下書きの版を指定しない切り替えはしない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master_a)));
  perform pg_temp.sev_expect_eq('下書きの版が一致すれば、同じ下書きを v2.5 に切り替える', v_a2::text,
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master_a)));
  perform pg_temp.sev_expect_eq('切り替えた下書きは v2.5・現在の計算ルールと税ルールを固定・版が進む', 'v2.5/2/2/true/true',
    (select r.pricing_model || '/' || r.version || '/' || r.lock_version || '/' ||
            (r.calc_rule_version_id = v_calc)::text || '/' || (r.tax_rule_version_id = v_tax)::text
       from public.standard_estimate_revisions r where r.id = v_a2));
  perform pg_temp.sev_expect_eq('v2.5 以前の明細は今の売価の manual（POR は por）として「要見直し」で写り、旧明細は残らない', '0/2/manual:69225:69225:true,por:::true',
    (select count(*)::text from public.standard_estimate_revision_lines l where l.revision_id = v_a2) || '/' ||
    (select count(*)::text from public.standard_estimate_revision_v25_lines l where l.revision_id = v_a2) || '/' ||
    (select string_agg(l.price_mode || ':' || coalesce(l.unit_price::text, '') || ':' || coalesce(l.amount::text, '') || ':' || l.review_required::text, ',' order by l.price_mode)
       from public.standard_estimate_revision_v25_lines l where l.revision_id = v_a2));
  perform pg_temp.sev_expect_eq('標準状態の商品は auto の選択枠になり、いま現在の原価 Version を固定する', 'auto:true:true,auto:true:',
    (select string_agg(b.price_mode || ':' || (b.standard_cost_version_id = (select v.id from public.option_standard_cost_versions v where v.option_id = b.option_id and v.superseded_at is null))::text
                       || ':' || coalesce((select bool_and(bv.variant_cost_version_id is not null)::text from public.standard_estimate_revision_baseline_variants bv where bv.baseline_item_id = b.id), ''),
                       ',' order by b.sort_order)
       from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2));
  -- 本体：trunc(18,200×1.07)=19,474 → trunc(×1.5)=29,211 → ×12=350,532、経費 trunc(×0.15)=52,579
  -- 商品1：trunc(100,000×1.07)=107,000 → 160,500、商品2：trunc(20,000×1.07)=21,400 → 32,100 ×2=64,200、manual 69,225
  -- オプション 293,925・経費 44,088。別途工事は POR（v2.5 では経費の対象。金額は未確定）
  perform pg_temp.sev_expect_eq('金額は v2.5 の正式計算（本体・オプション・別途工事の POR）', '350532:52579/293925:44088/0:0:true/741124/74112/815236/true/true',
    (select string_agg(s.line_subtotal || ':' || s.expense_amount || case when s.section_code = 'sitework' then ':' || s.has_por::text else '' end, '/' order by
       case s.section_code when 'base' then 0 when 'option' then 1 else 2 end)
       from public.standard_estimate_revision_sections s where s.revision_id = v_a2 and s.section_code in ('base', 'option', 'sitework')) || '/' ||
    (select r.subtotal_raw || '/' || r.tax || '/' || r.total || '/' || r.has_por || '/' || r.v25_pricing_complete from public.standard_estimate_revisions r where r.id = v_a2));
  perform pg_temp.sev_expect_eq('選択枠の金額は正式計算の結果と同じ', '107000:160500:160500/21400:32100:64200',
    (select string_agg(b.cost_unit_price || ':' || b.sale_unit_price || ':' || b.amount, '/' order by b.sort_order)
       from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2));
  perform pg_temp.sev_expect_eq('計算結果の por の区分・合計は未確定（null）、確定した区分は保存した金額と同じ', 'true/null/null/293925/44088',
    (select (r.v25_calc_result -> 'calc' ->> 'has_por') || '/' || coalesce(r.v25_calc_result -> 'calc' ->> 'total', 'null') || '/' ||
            coalesce((select x.value ->> 'subtotal' from jsonb_array_elements(r.v25_calc_result -> 'calc' -> 'sections') x where x.value ->> 'code' = 'sitework'), 'null') || '/' ||
            (select x.value ->> 'subtotal' from jsonb_array_elements(r.v25_calc_result -> 'calc' -> 'sections') x where x.value ->> 'code' = 'option') || '/' ||
            (select x.value ->> 'expense' from jsonb_array_elements(r.v25_calc_result -> 'calc' -> 'sections') x where x.value ->> 'code' = 'option')
       from public.standard_estimate_revisions r where r.id = v_a2));
  perform pg_temp.sev_expect_eq('切り替えても公開中の v2.5 以前の Revision は変わらない', 'published/legacy/1',
    (select r.status || '/' || r.pricing_model || '/' || (select count(*)::text from public.standard_estimate_revision_lines l where l.revision_id = r.id and l.price_mode = 'auto')
       from public.standard_estimate_revisions r where r.id::text = v_se_a1));
  perform pg_temp.sev_expect_eq('v2.5 の下書きがあれば、作り直さずに同じ下書きを返す', v_a2::text || '/2',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master_a)) || '/' ||
    (select r.lock_version::text from public.standard_estimate_revisions r where r.id = v_a2));

  -- ---------- 旧来の処理からは v2.5 の標準見積を変えられない ----------

  perform pg_temp.sev_expect_error('旧来の保存では v2.5 の下書きを変えられない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.save_standard_estimate_draft(%L, 1.07, 0.15, 1.5, 0, null, '{}'::jsonb, '[]'::jsonb, 2)).id::text $q$, v_a2)));
  perform pg_temp.sev_expect_error('旧来の標準状態の変更では v2.5 の下書きを変えられない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.set_standard_estimate_baseline(%L, '[]'::jsonb, 2)).id::text $q$, v_a2)));
  perform pg_temp.sev_expect_error('旧来の公開では v2.5 の下書きを公開できない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_revision(%L, 2)).id::text', v_a2)));
  perform pg_temp.sev_expect_denied('v2.5 の明細の表へ直接書き込めない', '42501',
    pg_temp.sev_run_as('authenticated', u_editor, format($q$ insert into public.standard_estimate_revision_v25_lines (revision_id, section_code, name, quantity, price_mode, unit_price, amount, sort_order)
      values (%L, 'option', '直接', 1, 'manual', 1, 1, 9) returning id::text $q$, v_a2)));
  perform pg_temp.sev_expect_error('DB の管理者でも、v2.5 の RPC を通さずに v2.5 の Revision は変えられない', 'P0001', 'LOCKED',
    pg_temp.sev_try_super(format('update public.standard_estimate_revisions set markup_rate = 2 where id = %L returning id::text', v_a2)));
  perform pg_temp.sev_expect_eq('旧来の処理が止まった後も v2.5 の下書きは変わらない', '2/2/2/741124',
    (select r.lock_version::text from public.standard_estimate_revisions r where r.id = v_a2) || '/' ||
    (select count(*)::text from public.standard_estimate_revision_v25_lines l where l.revision_id = v_a2) || '/' ||
    (select count(*)::text from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2) || '/' ||
    (select r.subtotal_raw::text from public.standard_estimate_revisions r where r.id = v_a2));

  -- ---------- 保存：原価 Version は黙って更新しない ----------

  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 110000, 1, ''原価改定'')', p1));
  v_lines := jsonb_build_array(
    jsonb_build_object('section_code', 'option', 'name', '洗面器', 'quantity', 1, 'price_mode', 'manual', 'unit_price', 69225, 'review_required', true),
    jsonb_build_object('section_code', 'sitework', 'name', '外構工事', 'quantity', 1, 'price_mode', 'por', 'review_required', true));
  v_slots := jsonb_build_array(
    jsonb_build_object('option_id', p1, 'variant_choice_ids', jsonb_build_array(c1), 'quantity', 2),
    jsonb_build_object('option_id', p2, 'quantity', 2));
  perform pg_temp.sev_expect_eq('同じ商品・同じ選択肢の保存（数量だけ変更）は成功する', '3',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload(v_slots, v_lines))));
  perform pg_temp.sev_expect_eq('原価が改定されても、同じ商品・同じ選択肢の選択枠は固定した原価 Version のまま（金額も改定前）', 'true/321000/stale',
    (select (b.standard_cost_version_id = v_p1_v1)::text || '/' || b.amount from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2 and b.option_id = p1) || '/' ||
    (select x.value ->> 'cost_status' from jsonb_array_elements(pg_temp.sev_preview(u_editor, v_a2) -> 'slots') x where (x.value ->> 'option_id')::uuid = p1));
  perform pg_temp.sev_expect_eq('編集画面の確認でも、古い原価があれば公開できないと分かる', 'false',
    pg_temp.sev_run_as('authenticated', u_editor, format($q$ select (public.preview_standard_estimate_v25_revision(%L) ->> 'publishable') $q$, v_a2)));
  perform pg_temp.sev_expect_error('固定した原価が現在の Version と違えば公開しない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 3)).id::text', v_a2)));

  v_slots := jsonb_build_array(
    jsonb_build_object('option_id', p1, 'variant_choice_ids', jsonb_build_array(c2), 'quantity', 2),
    jsonb_build_object('option_id', p2, 'quantity', 2));
  perform pg_temp.sev_expect_eq('選択肢を変えた保存は成功する', '4',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 3, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload(v_slots, v_lines))));
  -- 商品1（大）：110,000＋5,000＝115,000 → trunc(×1.07)=123,050 → trunc(×1.5)=184,575 ×2＝369,150
  perform pg_temp.sev_expect_eq('選択肢を変えた選択枠は、いま現在の原価 Version（商品と選択肢）を固定し直す', 'false/115000/123050/184575/369150/current',
    (select (b.standard_cost_version_id = v_p1_v1)::text || '/' || b.selection_cost || '/' || b.cost_unit_price || '/' || b.sale_unit_price || '/' || b.amount
       from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2 and b.option_id = p1) || '/' ||
    (select x.value ->> 'cost_status' from jsonb_array_elements(pg_temp.sev_preview(u_editor, v_a2) -> 'slots') x where (x.value ->> 'option_id')::uuid = p1));

  v_slots := v_slots || jsonb_build_array(jsonb_build_object('option_id', p3, 'quantity', 1));
  perform pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 4, %L::jsonb)).lock_version::text', v_a2,
    pg_temp.sev_payload(v_slots, v_lines)));
  perform pg_temp.sev_expect_eq('原価が未設定の商品は 0 円にせず、計算から外して未設定として挙げる', 'false/runtime-sev-p3:missing_standard_cost/null',
    (select r.v25_pricing_complete::text from public.standard_estimate_revisions r where r.id = v_a2) || '/' ||
    (select string_agg(o.code || ':' || (x.value ->> 'reason'), ',')
       from public.standard_estimate_revisions r
       cross join lateral jsonb_array_elements(r.v25_calc_result -> 'incomplete') x
       join public.options o on o.id = (x.value ->> 'option_id')::uuid
      where r.id = v_a2) || '/' ||
    coalesce((select b.amount::text from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2 and b.option_id = p3), 'null'));
  perform pg_temp.sev_expect_error('原価が未設定の商品があれば公開しない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 5)).id::text', v_a2)));

  -- 原価の無い商品は manual（売価を入力）にでき、por（別途見積）の選択枠も持てる。工事費は manual・別途見積の明細
  v_slots := jsonb_build_array(
    jsonb_build_object('option_id', p1, 'variant_choice_ids', jsonb_build_array(c2), 'quantity', 2),
    jsonb_build_object('option_id', p2, 'quantity', 2),
    jsonb_build_object('option_id', p3, 'quantity', 1, 'price_mode', 'manual', 'manual_unit_price', 30000),
    jsonb_build_object('option_id', p4, 'quantity', 1, 'price_mode', 'por'));
  v_lines := jsonb_build_array(
    jsonb_build_object('section_code', 'sitework', 'name', '設置工事', 'quantity', 1, 'unit', '式', 'price_mode', 'manual', 'unit_price', 50000),
    jsonb_build_object('section_code', 'sitework', 'name', '外構工事', 'quantity', 1, 'unit', '式', 'price_mode', 'por'));
  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 5, %L::jsonb)).lock_version::text', v_a2,
    pg_temp.sev_payload(v_slots, v_lines)));
  perform pg_temp.sev_expect_eq('manual・por の選択枠と、manual・別途見積の明細を保存できる', '6/true/manual:30000:30000,por::',
    v_out || '/' ||
    (select r.v25_pricing_complete::text from public.standard_estimate_revisions r where r.id = v_a2) || '/' ||
    (select string_agg(b.price_mode || ':' || coalesce(b.manual_unit_price::text, '') || ':' || coalesce(b.amount::text, ''), ',' order by b.sort_order)
       from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2 and b.option_id in (p3, p4)));

  -- ---------- 入力の検査（保存しない） ----------

  perform pg_temp.sev_expect_error('manual の選択枠に売価が無ければ保存しない', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload(jsonb_build_array(jsonb_build_object('option_id', p3, 'quantity', 1, 'price_mode', 'manual')), '[]'::jsonb))));
  perform pg_temp.sev_expect_error('範囲外の販売費率は保存しない', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload('[]'::jsonb, '[]'::jsonb, 0, null, '1.6'))));
  perform pg_temp.sev_expect_error('同じ商品の重複は保存しない', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload(jsonb_build_array(jsonb_build_object('option_id', p2, 'quantity', 1), jsonb_build_object('option_id', p2, 'quantity', 2)), '[]'::jsonb))));
  perform pg_temp.sev_expect_error('ほかの商品の選択肢は保存しない', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload(jsonb_build_array(jsonb_build_object('option_id', p2, 'variant_choice_ids', jsonb_build_array(c1), 'quantity', 1)), '[]'::jsonb))));
  perform pg_temp.sev_expect_error('商品に紐づかない明細を auto にはできない（商品台帳の商品は商品として追加する）', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload('[]'::jsonb, jsonb_build_array(jsonb_build_object('section_code', 'option', 'name', '部材', 'quantity', 1, 'price_mode', 'auto', 'unit_price', 1))))));
  perform pg_temp.sev_expect_error('調整額に理由が無ければ保存しない', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload('[]'::jsonb, '[]'::jsonb, -1000, null))));
  perform pg_temp.sev_expect_error('古い版のままの保存は拒否する', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_a2,
      pg_temp.sev_payload(v_slots, v_lines))));
  perform pg_temp.sev_expect_eq('拒否した保存では下書きは変わらない', '6/4/2',
    (select r.lock_version::text from public.standard_estimate_revisions r where r.id = v_a2) || '/' ||
    (select count(*)::text from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2) || '/' ||
    (select count(*)::text from public.standard_estimate_revision_v25_lines l where l.revision_id = v_a2));

  -- ---------- 最新原価を取り込む ----------

  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 25000, 1, ''原価改定'')', p2));
  perform pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_a2,
    pg_temp.sev_payload(v_slots, v_lines, -1000, '端数調整')));
  perform pg_temp.sev_expect_eq('保存し直しても、商品2は改定前の原価のまま（古い原価として示す）', 'stale/false',
    (select x.value ->> 'cost_status' from jsonb_array_elements(pg_temp.sev_preview(u_editor, v_a2) -> 'slots') x where (x.value ->> 'option_id')::uuid = p2) || '/' ||
    (pg_temp.sev_preview(u_editor, v_a2) ->> 'publishable'));
  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select (public.refresh_standard_estimate_v25_costs(%L, 7)).lock_version::text', v_a2));
  perform pg_temp.sev_expect_eq('最新原価を取り込むと、auto の選択枠が現在の原価 Version になり、公開できる', '8/current/true/40125',
    v_out || '/' ||
    (select x.value ->> 'cost_status' from jsonb_array_elements(pg_temp.sev_preview(u_editor, v_a2) -> 'slots') x where (x.value ->> 'option_id')::uuid = p2) || '/' ||
    (pg_temp.sev_preview(u_editor, v_a2) ->> 'publishable') || '/' ||
    (select b.sale_unit_price::text from public.standard_estimate_revision_baseline_items b where b.revision_id = v_a2 and b.option_id = p2));

  -- ---------- 公開 ----------

  perform pg_temp.sev_expect_error('古い版のままの公開は拒否する', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 7)).id::text', v_a2)));

  -- 「要見直し」が 1 行でも残っていれば公開しない（画面だけでなく DB で止める）
  perform pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 8, %L::jsonb)).lock_version::text', v_a2,
    pg_temp.sev_payload(v_slots, jsonb_build_array(
      jsonb_build_object('section_code', 'sitework', 'name', '設置工事', 'quantity', 1, 'unit', '式', 'price_mode', 'manual', 'unit_price', 50000, 'review_required', true),
      jsonb_build_object('section_code', 'sitework', 'name', '外構工事', 'quantity', 1, 'unit', '式', 'price_mode', 'por')), -1000, '端数調整')));
  perform pg_temp.sev_expect_eq('要見直しの明細が残っていれば、編集画面の確認でも公開できないと分かる', '1/false',
    (pg_temp.sev_preview(u_editor, v_a2) ->> 'review_required_lines') || '/' || (pg_temp.sev_preview(u_editor, v_a2) ->> 'publishable'));
  perform pg_temp.sev_expect_error('要見直しの明細が残っていれば公開しない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 9)).id::text', v_a2)));
  perform pg_temp.sev_expect_eq('要見直しで止めた公開では、下書きのまま変わらない', 'draft/9',
    (select r.status || '/' || r.lock_version from public.standard_estimate_revisions r where r.id = v_a2));
  perform pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 9, %L::jsonb)).lock_version::text', v_a2,
    pg_temp.sev_payload(v_slots, v_lines, -1000, '端数調整')));
  perform pg_temp.sev_expect_eq('見直し済みにすると、公開できる状態になる', '0/true',
    (pg_temp.sev_preview(u_editor, v_a2) ->> 'review_required_lines') || '/' || (pg_temp.sev_preview(u_editor, v_a2) ->> 'publishable'));
  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 10)).status', v_a2));
  perform pg_temp.sev_expect_eq('公開でき、現在の版になり、前の版（v2.5 以前）は置き換わる', 'published/true/superseded/true/true',
    v_out || '/' ||
    (select (m.current_published_revision_id = v_a2)::text from public.standard_estimate_masters m where m.id = v_master_a) || '/' ||
    (select r.status from public.standard_estimate_revisions r where r.id::text = v_se_a1) || '/' ||
    (select (r.v25_pricing_complete and r.v25_calc_result is not null)::text from public.standard_estimate_revisions r where r.id = v_a2) || '/' ||
    (select (r.published_at is not null)::text from public.standard_estimate_revisions r where r.id = v_a2));
  perform pg_temp.sev_expect_eq('公開した金額は、固定した原価からの正式計算と同じ', 'true',
    (select ((public.pricing_calculate(r.calc_rule_version_id, r.tax_rule_version_id, public.standard_estimate_v25_calc_input(r.id) -> 'input')) = (r.v25_calc_result -> 'calc'))::text
       from public.standard_estimate_revisions r where r.id = v_a2));
  perform pg_temp.sev_expect_error('公開した計算結果は DB の管理者でも変えられない', 'P0001', 'LOCKED',
    pg_temp.sev_try_super(format($q$ update public.standard_estimate_revisions set v25_calc_result = '{}'::jsonb where id = %L returning id::text $q$, v_a2)));
  perform pg_temp.sev_expect_error('公開した Revision の明細は変えられない', 'P0001', 'LOCKED',
    pg_temp.sev_try_super(format($q$ update public.standard_estimate_revision_v25_lines set name = '変更' where revision_id = %L returning id::text $q$, v_a2)));
  perform pg_temp.sev_expect_eq('シミュレーターの売価の取得は、v2.5 の Revision をまだ扱わない（v2.5 以前の B だけ返す）', '1/' || v_se_b1,
    (select jsonb_array_length(public.get_standard_estimate_sale_views(m_model))::text) || '/' ||
    (select public.get_standard_estimate_sale_views(m_model) -> 0 ->> 'revision_id'));
  perform pg_temp.sev_expect_error('v2.5 で公開した標準見積では、旧来の次の Revision を作れない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_next_standard_estimate_revision(%L)::text', v_master_a)));
  perform pg_temp.sev_expect_error('v2.5 で公開した標準見積では、旧来の下書きを作れない', 'P0001', 'LOCKED',
    pg_temp.sev_run_as('authenticated', u_editor, format('select public.create_standard_estimate_draft(%L)::text', v_bmr_a)));

  -- 標準見積から作る見積（PR H）は v2.5 の Revision をまだ扱わない
  set local session_replication_role = replica;
  insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind)
  values (v_qd, gen_random_uuid(), m_model, 'office', 'formal');
  set local session_replication_role = origin;
  perform pg_temp.sev_expect_error('v2.5 の標準見積から見積の下書きは作れない', 'P0001', 'LOCKED',
    pg_temp.sev_try_super(format($q$ update public.quote_drafts set source_kind = 'standard_estimate', standard_estimate_revision_id = %L where id = %L returning id::text $q$, v_a2, v_qd)));

  -- ---------- 次の v2.5 の下書き：固定した原価 Version をそのまま引き継ぐ ----------

  perform pg_temp.sev_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 120000, 2, ''原価改定'')', p1));
  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master_a));
  v_a3 := v_out::uuid;
  perform pg_temp.sev_expect_eq('公開中の v2.5 から次の下書き（版 3）を作り、固定した原価をそのまま引き継ぐ（黙って更新しない）', 'draft/3/v2.5/true/stale/2',
    (select r.status || '/' || r.version || '/' || r.pricing_model from public.standard_estimate_revisions r where r.id = v_a3) || '/' ||
    (select ((select b3.standard_cost_version_id from public.standard_estimate_revision_baseline_items b3 where b3.revision_id = v_a3 and b3.option_id = p1)
           = (select b2.standard_cost_version_id from public.standard_estimate_revision_baseline_items b2 where b2.revision_id = v_a2 and b2.option_id = p1))::text) || '/' ||
    (select x.value ->> 'cost_status' from jsonb_array_elements(pg_temp.sev_preview(u_editor, v_a3) -> 'slots') x where (x.value ->> 'option_id')::uuid = p1) || '/' ||
    (select count(*)::text from public.standard_estimate_revision_v25_lines l where l.revision_id = v_a3));
  perform pg_temp.sev_expect_eq('次の下書きを作っても、公開中の v2.5 の Revision は変わらない', 'published/11',
    (select r.status || '/' || r.lock_version from public.standard_estimate_revisions r where r.id = v_a2));

  -- #500：公開中の標準見積の標準状態にある商品は、取扱終了にできない（従来どおり）
  perform pg_temp.sev_expect_error('公開中の v2.5 の標準見積の選択枠にある商品は、取扱終了にできない', 'P0001', 'LOCKED',
    pg_temp.sev_try_super(format('update public.options set archived_at = now() where id = %L returning id::text', p1)));

  -- ---------- 公開中の v2.5 以前の Revision から、新しい v2.5 の下書きを作る（B） ----------

  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master_b));
  v_b2 := v_out::uuid;
  perform pg_temp.sev_expect_eq('公開中の v2.5 以前の Revision を土台に新しい v2.5 の下書き（版 2）を作り、別途工事の明細は別途見積（要見直し）で写る',
    'draft/2/v2.5/1/manual:69225:true,por::true/auto:true',
    (select r.status || '/' || r.version || '/' || r.pricing_model || '/' || r.lock_version from public.standard_estimate_revisions r where r.id = v_b2) || '/' ||
    (select string_agg(l.price_mode || ':' || coalesce(l.unit_price::text, '') || ':' || l.review_required::text, ',' order by l.sort_order)
       from public.standard_estimate_revision_v25_lines l where l.revision_id = v_b2) || '/' ||
    (select string_agg(b.price_mode || ':' || (b.standard_cost_version_id = (select v.id from public.option_standard_cost_versions v where v.option_id = b.option_id and v.superseded_at is null))::text, ',')
       from public.standard_estimate_revision_baseline_items b where b.revision_id = v_b2));
  perform pg_temp.sev_expect_eq('土台にした v2.5 以前の Revision は公開中のまま変わらない', 'published/legacy/' || v_se_b1,
    (select r.status || '/' || r.pricing_model from public.standard_estimate_revisions r where r.id::text = v_se_b1) || '/' ||
    (select m.current_published_revision_id::text from public.standard_estimate_masters m where m.id = v_master_b));
  perform pg_temp.sev_expect_error('別途工事の商品は自動計算（販売費・掛率）にできない', 'P0001', 'VALIDATION',
    pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 1, %L::jsonb)).lock_version::text', v_b2,
      pg_temp.sev_payload(jsonb_build_array(jsonb_build_object('option_id', p2, 'quantity', 1), jsonb_build_object('option_id', p5, 'quantity', 1)), '[]'::jsonb, 0, null, '1'))));
  v_out := pg_temp.sev_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 1, %L::jsonb)).lock_version::text', v_b2,
    pg_temp.sev_payload(
      jsonb_build_array(jsonb_build_object('option_id', p2, 'quantity', 1),
                        jsonb_build_object('option_id', p5, 'quantity', 1, 'price_mode', 'manual', 'manual_unit_price', 100000)),
      jsonb_build_array(jsonb_build_object('section_code', 'option', 'name', '洗面器', 'quantity', 1, 'price_mode', 'manual', 'unit_price', 69225)),
      0, null, '1')));
  -- 販売費率 1.0・掛率 1.5・経費率 0.15。別途工事は決めた税別売価 100,000 円のまま（経費なし）、オプションは経費を掛ける
  perform pg_temp.sev_expect_eq('別途工事は決めた税別売価のまま経費を掛けず、ほかの区分は従来どおり経費を掛ける', '2/100000/0/none/false/rate',
    v_out || '/' ||
    (select s.line_subtotal || '/' || s.expense_amount || '/' || s.expense_method || '/' || s.has_por
       from public.standard_estimate_revision_sections s where s.revision_id = v_b2 and s.section_code = 'sitework') || '/' ||
    (select s.expense_method from public.standard_estimate_revision_sections s where s.revision_id = v_b2 and s.section_code = 'option'));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _sev_result;

rollback;
