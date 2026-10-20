-- 販売停止・廃番（20261020110000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 商品マスターが空の DB で実行する（検査用のモデル・カテゴリー・商品だけを使うため）。
begin;

create temp table _pss_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _pss_result to public;

create function pg_temp.pss_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.pss_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _pss_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.pss_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _pss_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

create function pg_temp.pss_try(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  execute p_sql into v_out;
  return coalesce(v_out, 'ok');
exception when others then
  return format('ERROR %s: %s', sqlstate, sqlerrm);
end;
$fn$;

do $test$
declare
  u_admin constant uuid := '7b000000-0000-4000-8000-000000000001';
  u_editor constant uuid := '7b000000-0000-4000-8000-000000000002';
  u_dealer constant uuid := '7b000000-0000-4000-8000-000000000003';
  u_cust constant uuid := '7b000000-0000-4000-8000-000000000004';
  m_model constant uuid := '7b100000-0000-4000-8000-000000000001';
  c_items constant uuid := '7b200000-0000-4000-8000-000000000001';
  o_preset constant uuid := '7b300000-0000-4000-8000-000000000001';
  o_se constant uuid := '7b300000-0000-4000-8000-000000000002';
  o_tmpl constant uuid := '7b300000-0000-4000-8000-000000000003';
  o_free constant uuid := '7b300000-0000-4000-8000-000000000004';
  o_default constant uuid := '7b300000-0000-4000-8000-000000000005';
  o_dep_target constant uuid := '7b300000-0000-4000-8000-000000000006';
  o_dep_source constant uuid := '7b300000-0000-4000-8000-000000000007';
  o_disc constant uuid := '7b300000-0000-4000-8000-000000000008';
  org constant uuid := '7b400000-0000-4000-8000-000000000001';
  bm constant uuid := '7b410000-0000-4000-8000-000000000001';
  bmr constant uuid := '7b420000-0000-4000-8000-000000000001';
  sem constant uuid := '7b430000-0000-4000-8000-000000000001';
  rev_pub constant uuid := '7b440000-0000-4000-8000-000000000001';
  cfg_preset constant uuid := '7b500000-0000-4000-8000-000000000001';
  cfg_free constant uuid := '7b500000-0000-4000-8000-000000000002';
  qr_draft constant uuid := '7b600000-0000-4000-8000-000000000001';
  qd_before constant uuid := '7b610000-0000-4000-8000-000000000001';
  v_out text;
  v_updated text;
  v_updated2 text;
  v_audit_before integer;
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.pss_expect_eq('PSS-0 商品マスターが空の DB で実行する検査のため省略', 'skipped', 'skipped');
    return;
  end if;

  -- ---------- 検査用のデータ（トリガーと外部キー検査を止めて、必要な行だけを直接入れる） ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'pss-admin@runtime.invalid', '{}'), (u_editor, 'pss-editor@runtime.invalid', '{}'),
         (u_dealer, 'pss-dealer@runtime.invalid', '{}'), (u_cust, 'pss-cust@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'pss-admin@runtime.invalid', '本部', 'admin'), (u_editor, 'pss-editor@runtime.invalid', '総代理店', 'master_dealer'),
         (u_dealer, 'pss-dealer@runtime.invalid', '代理店', 'dealer'), (u_cust, 'pss-cust@runtime.invalid', 'お客様', 'customer');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-pss-model', '販売停止の検査用モデル', 1000000, 'published',
          '[{"code": "pss-spec", "name": "検査仕様", "option_codes": ["runtime-pss-preset"]}]'::jsonb);
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (c_items, 'runtime-pss-items', '販売停止の検査の商品', 'multi', false, 'shell', 'published');
  insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no, simulator_visible, archived_at, is_default, sort_order)
  values
    (o_preset, m_model, c_items, 'runtime-pss-preset', '本体の仕様の商品', 1000, 'published', 'PRD-972001', true, null, false, 1),
    (o_se, m_model, c_items, 'runtime-pss-se', '公開中の標準見積の商品', 1000, 'published', 'PRD-972002', true, null, false, 2),
    (o_tmpl, m_model, c_items, 'runtime-pss-tmpl', 'Excel 標準の基準商品', 1000, 'published', 'PRD-972003', true, null, false, 3),
    (o_free, m_model, c_items, 'runtime-pss-free', '参照のない商品', 1000, 'published', 'PRD-972004', true, null, false, 4),
    (o_default, m_model, c_items, 'runtime-pss-default', '初期選択の商品', 1000, 'published', 'PRD-972005', true, null, true, 5),
    (o_dep_target, m_model, c_items, 'runtime-pss-dep-target', '前提商品', 1000, 'published', 'PRD-972006', true, null, false, 6),
    (o_dep_source, m_model, c_items, 'runtime-pss-dep-source', '前提が必要な商品', 1000, 'published', 'PRD-972007', true, null, false, 7),
    (o_disc, m_model, c_items, 'runtime-pss-disc', '廃番にする商品', 1000, 'published', 'PRD-972008', true, null, false, 8);
  insert into public.option_dependencies (option_id, requires_option_id) values (o_dep_source, o_dep_target);
  insert into public.estimate_templates (base_model_id, spec_code, name, source_file_name, source_sheet_name, source_sha256, baseline_option_ids)
  values (m_model, 'pss-tmpl', '検査用 Excel 標準', 'runtime.xlsx', 'runtime', repeat('0', 64), array[o_tmpl]);
  insert into public.organizations (id, code, name, organization_type) values (org, 'RT-PSS-ORG', '販売停止の検査の本部', 'headquarters');
  insert into public.base_masters (id, base_model_id, owner_organization_id, name) values (bm, m_model, org, '販売停止の検査の本体');
  insert into public.base_master_revisions (id, base_master_id, version, expense_method, expense_rate) values (bmr, bm, 1, 'none', null);
  insert into public.standard_estimate_masters (id, owner_organization_id, base_model_id, base_master_id, spec_code, name, current_published_revision_id)
  values (sem, org, m_model, bm, 'pss-se', '販売停止の検査の標準見積', rev_pub);
  insert into public.standard_estimate_revisions (id, standard_estimate_master_id, version, base_master_revision_id, status, published_at, tax_rate)
  values (rev_pub, sem, 1, bmr, 'published', now(), 0.10);
  insert into public.standard_estimate_revision_baseline_items (
    revision_id, option_id, option_category_id, section_code, selection_target_code, quantity,
    option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order)
  values (rev_pub, o_se, c_items, 'option', 'runtime-pss-items', 1, 'runtime-pss-se', '公開中の標準見積の商品', 'runtime-pss-items', '販売停止の検査の商品', 1000, 1);
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (cfg_preset, u_cust, m_model, '本体の仕様の構成', 'draft', 'pss-spec', 'shell'),
         (cfg_free, u_cust, m_model, '参照のない仕様の構成', 'draft', 'pss-free', 'shell');
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_preset, o_free, 1, '{}'), (cfg_free, o_free, 1, '{}');
  -- 販売停止の前に作った、標準見積からの見積の下書き
  insert into public.quote_requests (id, status, contact) values (qr_draft, 'reviewing', '{}'::jsonb);
  insert into public.quote_drafts (id, quote_request_id, base_model_id, base_master_revision_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level, standard_estimate_revision_id)
  values (qd_before, qr_draft, m_model, bmr, 'pss-se', 'formal', 0.10, 0, 'standard_estimate', 'full', rev_pub);
  set local session_replication_role = origin;

  -- ---------- 販売停止（参照の緩和） ----------
  v_audit_before := (select count(*) from public.audit_logs where entity = 'option' and entity_id in (o_preset, o_disc));
  perform pg_temp.pss_expect_eq('PSS-1 本体の仕様・公開中の標準見積・Excel 標準の基準商品で使っていても、商品台帳の編集者は販売停止にできる', 'ok/ok/ok',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_preset)) || '/' ||
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_se)) || '/' ||
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_tmpl)));
  perform pg_temp.pss_expect_error('PSS-2 初期選択の商品は販売停止にしない（先に設定を外す）', 'P0001', 'LOCKED: 必須・初期選択の商品は販売停止にできません',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_default)));
  perform pg_temp.pss_expect_error('PSS-3 前提商品は販売停止にしない（先に前提の設定を見直す）', 'P0001', 'LOCKED: 「前提が必要な商品」の前提商品として使われているため、販売停止にできません',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_dep_target)));

  -- ---------- ①：受付停止 ----------
  perform pg_temp.pss_expect_eq('PSS-4 標準構成に販売停止の商品がある仕様は受け付けない（本体の仕様・公開中の標準見積・Excel 標準）', 'false:本体の仕様の商品/false:公開中の標準見積の商品/false:Excel 標準の基準商品/true:',
    (select (j ->> 'accepting') || ':' || coalesce((select string_agg(x, '、') from jsonb_array_elements_text(j -> 'stopped_names') x), '')
       from public.get_spec_acceptance_state(m_model, 'pss-spec') j) || '/' ||
    (select (j ->> 'accepting') || ':' || coalesce((select string_agg(x, '、') from jsonb_array_elements_text(j -> 'stopped_names') x), '')
       from public.get_spec_acceptance_state(m_model, 'pss-se') j) || '/' ||
    (select (j ->> 'accepting') || ':' || coalesce((select string_agg(x, '、') from jsonb_array_elements_text(j -> 'stopped_names') x), '')
       from public.get_spec_acceptance_state(m_model, 'pss-tmpl') j) || '/' ||
    (select (j ->> 'accepting') || ':' || coalesce((select string_agg(x, '、') from jsonb_array_elements_text(j -> 'stopped_names') x), '')
       from public.get_spec_acceptance_state(m_model, 'pss-free') j));
  perform pg_temp.pss_expect_eq('PSS-5 受付の判定はログインした利用者だけが使える（anon・service_role は不可）', 'false/false/true',
    has_function_privilege('anon', 'public.get_spec_acceptance_state(uuid, text)', 'execute')::text || '/' ||
    has_function_privilege('service_role', 'public.get_spec_acceptance_state(uuid, text)', 'execute')::text || '/' ||
    has_function_privilege('authenticated', 'public.get_spec_acceptance_state(uuid, text)', 'execute')::text);
  perform pg_temp.pss_expect_error('PSS-6 標準構成に販売停止の商品がある仕様は、販売停止の商品を選んでいない構成でも見積依頼を受け付けない', 'P0001', 'RETIRED: この仕様の標準の商品構成に、販売停止の商品（本体の仕様の商品）が含まれるため',
    pg_temp.pss_try(format('insert into public.quote_requests (configuration_id, user_id, status, contact) values (%L, %L, ''new'', ''{}''::jsonb) returning ''ok''', cfg_preset, u_cust)));
  perform pg_temp.pss_expect_eq('PSS-7 標準構成に販売停止の商品が無い仕様は、従来どおり見積依頼を受け付ける', 'ok',
    pg_temp.pss_try(format('insert into public.quote_requests (configuration_id, user_id, status, contact) values (%L, %L, ''new'', ''{}''::jsonb) returning ''ok''', cfg_free, u_cust)));
  perform pg_temp.pss_expect_error('PSS-8 標準状態に販売停止の商品がある標準見積からは、新しい見積の下書きを作らない', 'P0001', 'RETIRED: 標準見積の標準状態に、販売停止の商品（公開中の標準見積の商品）が含まれる',
    pg_temp.pss_try(format('insert into public.quote_drafts (quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, source_kind, finish_level, standard_estimate_revision_id) values (%L, %L, ''pss-se'', ''formal'', 0.10, ''standard_estimate'', ''full'', %L) returning ''ok''', qr_draft, m_model, rev_pub)));
  perform pg_temp.pss_expect_error('PSS-9 販売停止の前に作った下書きも、正式発行の前の確認で止める', 'P0001', 'RETIRED: 標準見積の標準状態に、販売停止の商品（公開中の標準見積の商品）が含まれるため、この見積は正式に発行できません',
    pg_temp.pss_try(format('select public.assert_standard_estimate_source_sellable(%L)::text || ''ok''', qd_before)));
  perform pg_temp.pss_expect_eq('PSS-10 正式保存の 2 つの関数は、標準見積から作った見積の確認の直後にこの確認を呼ぶ', 'true/true',
    (select (strpos(d, '標準見積から作成した見積は、現在は本部管理者だけが発行できます') between 1 and strpos(d, 'perform public.assert_standard_estimate_source_sellable(d.id);'))::text
       from pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure) d) || '/' ||
    (select (strpos(d, '標準見積から作成した見積は、現在は本部管理者だけが発行できます') between 1 and strpos(d, 'perform public.assert_standard_estimate_source_sellable(d.id);'))::text
       from pg_catalog.pg_get_functiondef('public.finalize_quote_revision_draft(uuid, integer)'::regprocedure) d));

  -- ---------- 販売の再開 ----------
  -- 再開と確認は別の文にする（同じ文の副問い合わせは、再開の前の状態を見るため）
  v_out := pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = null where id = %L returning ''ok''', o_preset));
  perform pg_temp.pss_expect_eq('PSS-11 販売停止の商品は再開できる（再開すると、その仕様はまた受け付ける）', 'ok/true',
    v_out || '/' || (select j ->> 'accepting' from public.get_spec_acceptance_state(m_model, 'pss-spec') j));

  -- ---------- 廃番・取り消し ----------
  select updated_at::text into v_updated from public.options where id = o_disc;
  perform pg_temp.pss_expect_error('PSS-12 販売中の商品は廃番にできない（先に販売停止）', 'P0001', 'VALIDATION: 廃番にできるのは販売停止の商品だけです',
    pg_temp.pss_run_as('authenticated', u_editor, format('select public.set_option_discontinued(%L, %L::timestamptz, true, ''生産終了'')::text', o_disc, v_updated)));
  perform pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_disc));
  select updated_at::text into v_updated from public.options where id = o_disc;
  perform pg_temp.pss_expect_error('PSS-13 廃番には理由が必要', 'P0001', 'VALIDATION: 理由を 500 文字以内で入力してください',
    pg_temp.pss_run_as('authenticated', u_editor, format('select public.set_option_discontinued(%L, %L::timestamptz, true, ''  '')::text', o_disc, v_updated)));
  perform pg_temp.pss_expect_error('PSS-14 代理店（商品台帳を編集できない）は廃番にできない', '42501', 'FORBIDDEN',
    pg_temp.pss_run_as('authenticated', u_dealer, format('select public.set_option_discontinued(%L, %L::timestamptz, true, ''生産終了'')::text', o_disc, v_updated)));
  perform pg_temp.pss_expect_error('PSS-15 画面が読んだ版でなければ廃番にしない', 'P0001', 'LOCKED',
    pg_temp.pss_run_as('authenticated', u_editor, format('select public.set_option_discontinued(%L, %L::timestamptz, true, ''生産終了'')::text', o_disc, '2000-01-01T00:00:00Z')));
  perform pg_temp.pss_expect_error('PSS-16 RPC を通さない廃番（理由なしの直接の更新）は止める', 'P0001', 'VALIDATION: 廃番にする理由を入力してください',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set discontinued_at = now() where id = %L returning ''ok''', o_disc)));
  v_out := pg_temp.pss_run_as('authenticated', u_editor, format('select public.set_option_discontinued(%L, %L::timestamptz, true, ''メーカーの生産終了'')::text', o_disc, v_updated));
  perform pg_temp.pss_expect_eq('PSS-17 販売停止の商品は、理由つきで廃番にできる', 'true/true',
    (v_out !~ '^ERROR')::text || '/' || (select (discontinued_at is not null)::text from public.options where id = o_disc));
  perform pg_temp.pss_expect_error('PSS-18 廃番の商品は販売を再開できない', 'P0001', 'LOCKED: 廃番の商品は販売を再開できません',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = null where id = %L returning ''ok''', o_disc)));
  perform pg_temp.pss_expect_error('PSS-19 廃番の商品はシミュレーター表示も変えられない', 'P0001', 'VALIDATION: シミュレーター表示は、販売中の登録済み商品だけで設定できます',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set simulator_visible = false where id = %L returning ''ok''', o_disc)));
  select updated_at::text into v_updated2 from public.options where id = o_disc;
  perform pg_temp.pss_expect_error('PSS-20 廃番の取り消しは本部の管理者だけ（総代理店は不可）', '42501', 'FORBIDDEN',
    pg_temp.pss_run_as('authenticated', u_editor, format('select public.set_option_discontinued(%L, %L::timestamptz, false, ''誤操作'')::text', o_disc, v_updated2)));
  perform pg_temp.pss_expect_error('PSS-21 RPC を通さない取り消し（直接の更新）は、本部の管理者でも理由なしでは止める', 'P0001', 'VALIDATION: 廃番を取り消す理由を入力してください',
    pg_temp.pss_run_as('authenticated', u_admin, format('update public.options set discontinued_at = null where id = %L returning ''ok''', o_disc)));
  v_out := pg_temp.pss_run_as('authenticated', u_admin, format('select public.set_option_discontinued(%L, %L::timestamptz, false, ''誤って廃番にした'')::text', o_disc, v_updated2));
  perform pg_temp.pss_expect_eq('PSS-22 本部の管理者が理由つきで取り消すと、販売停止に戻る（販売は再開しない）', 'true/null/retired',
    (v_out !~ '^ERROR')::text || '/' || (select coalesce(discontinued_at::text, 'null') from public.options where id = o_disc) || '/' ||
    (select public.product_lifecycle_state(status, archived_at) from public.options where id = o_disc));
  perform pg_temp.pss_expect_eq('PSS-23 取り消した後は、販売を再開できる', 'ok',
    pg_temp.pss_run_as('authenticated', u_editor, format('update public.options set archived_at = null where id = %L returning ''ok''', o_disc)));

  -- ---------- 変更履歴 ----------
  perform pg_temp.pss_expect_eq('PSS-24 販売停止・再開・廃番・取り消しを変更履歴に残し、廃番・取り消しは理由も残す', '6/true/true',
    ((select count(*) from public.audit_logs where entity = 'option' and entity_id in (o_preset, o_disc) and action = 'lifecycle') - 0)::text || '/' ||
    exists (select 1 from public.audit_logs where entity_id = o_disc and summary like '廃番にした：廃番にする商品（理由：メーカーの生産終了）%')::text || '/' ||
    exists (select 1 from public.audit_logs where entity_id = o_disc and summary like '廃番を取り消した（販売停止に戻した）：廃番にする商品（理由：誤って廃番にした）%')::text);

  -- ---------- 権限・文言 ----------
  perform pg_temp.pss_expect_eq('PSS-25 廃番の RPC はログインした利用者だけ。内部の部品は利用者から実行できない', 'false/false/true/false',
    (has_function_privilege('anon', 'public.set_option_discontinued(uuid, timestamptz, boolean, text)', 'execute')
       or has_function_privilege('service_role', 'public.set_option_discontinued(uuid, timestamptz, boolean, text)', 'execute'))::text || '/' ||
    has_function_privilege('anon', 'public.spec_stopped_baseline_names(uuid, text)', 'execute')::text || '/' ||
    has_function_privilege('authenticated', 'public.set_option_discontinued(uuid, timestamptz, boolean, text)', 'execute')::text || '/' ||
    (select bool_or(has_function_privilege(r, f, 'execute'))::text
       from unnest(array['anon', 'authenticated', 'service_role']) as r,
            unnest(array['public.spec_stopped_baseline_names(uuid, text)', 'public.standard_estimate_stopped_baseline_names(uuid)',
                         'public.assert_standard_estimate_source_sellable(uuid)']) as f));
  perform pg_temp.pss_expect_eq('PSS-26 #500 の止めの文言は「販売停止中」に変わり、「取扱終了」は残らない（判定は変えない）', '0/9',
    (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('options_lifecycle_guard', 'configuration_items_lifecycle_guard', 'configurations_exterior_lifecycle_guard',
        'estimate_templates_lifecycle_guard', 'quote_draft_items_lifecycle_guard', 'quote_items_lifecycle_guard', 'quote_requests_lifecycle_guard',
        'standard_estimate_baseline_lifecycle_guard', 'standard_estimate_baseline_variant_lifecycle_guard', 'standard_estimate_publish_lifecycle_guard')
        and p.prosrc like '%取扱終了%')::text || '/' ||
    (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('configuration_items_lifecycle_guard', 'configurations_exterior_lifecycle_guard',
        'estimate_templates_lifecycle_guard', 'quote_draft_items_lifecycle_guard', 'quote_items_lifecycle_guard', 'quote_requests_lifecycle_guard',
        'standard_estimate_baseline_lifecycle_guard', 'standard_estimate_baseline_variant_lifecycle_guard', 'standard_estimate_publish_lifecycle_guard')
        and p.prosrc like '%販売停止中%')::text);
end;
$test$;

select coalesce(json_agg(json_build_object('ok', ok, 'step', step, 'expected', expected, 'actual', actual) order by seq), '[]'::json) as j
  from _pss_result;

rollback;
