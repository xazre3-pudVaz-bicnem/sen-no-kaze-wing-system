-- トリガー専用の関数 26 本の EXECUTE（20261016114000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 権限が外れていること、直接呼ぶと権限で拒否すること、外した後も 31 本のトリガーが動くことを確かめる。
-- トリガーは、実行の権限を外したロール（service_role・ログインした利用者・auth の管理ロール）の書き込みで動かす。
-- 権限の検査（TFE-1〜3）は商品マスターが空でない DB でも行い、動作の検査（TFE-10〜）は空の DB でだけ行う。
begin;

create temp table _tfe_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _tfe_result to public;

-- 対象（migration と同じ一覧）
create temp table _tfe_expected (fn text not null, tbl text not null, trg text not null) on commit drop;

-- 会員登録のトリガー関数を、実行の権限の無いロールの追加で動かすための一時表（auth.users の、関数が読む列だけ）。
-- auth.users へ追加できるのは auth の管理ロールと接続ユーザーだけで、CI の接続は auth の管理ロールへ切り替えられないため
create temp table _tfe_signup (id uuid primary key, email text, raw_user_meta_data jsonb) on commit drop;
create trigger tfe_signup_profile after insert on _tfe_signup for each row execute function public.handle_new_user();
grant insert on _tfe_signup to authenticated;
insert into _tfe_expected (fn, tbl, trg) values
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

create function pg_temp.tfe_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

-- 書き込みの後に、transaction 完了時の検査（遅延の制約トリガー）をその場で動かす。成功したら遅延に戻す
create function pg_temp.tfe_run_as_at_commit(p_role text, p_sql text[], p_constraint text) returns text
language plpgsql as $fn$
declare
  v_sql text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  execute format('set local role %I', p_role);
  begin
    foreach v_sql in array p_sql loop
      execute v_sql;
    end loop;
    execute format('set constraints %s immediate', p_constraint);
    execute format('set constraints %s deferred', p_constraint);
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
end;
$fn$;

create function pg_temp.tfe_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _tfe_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.tfe_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _tfe_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

-- ---------- 権限（商品マスターが空でない DB でも行う） ----------
do $privileges$
declare
  v_left text;
  v_direct text;
begin
  select coalesce(string_agg(x.fn, ', ' order by x.fn), '')
    into v_left
    from (select distinct fn from _tfe_expected) x
   where exists (select 1 from pg_catalog.pg_proc p
                  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                  where p.oid = x.fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
      or has_function_privilege('anon', x.fn, 'execute')
      or has_function_privilege('authenticated', x.fn, 'execute')
      or has_function_privilege('service_role', x.fn, 'execute');
  perform pg_temp.tfe_expect_eq('TFE-1 トリガー専用の関数 26 本は、PUBLIC・anon・authenticated・service_role から直接実行できない（残っている関数の一覧が空）',
    '26/', (select count(distinct fn) from _tfe_expected)::text || '/' || v_left);

  -- 直接呼ぶと、3 つのロールのどれでも権限で拒否する（トリガーとして呼ばれる前に止まる）
  select coalesce(string_agg(r.fn || '(' || r.role || ')', ', ' order by r.fn, r.role), '')
    into v_direct
    from (select x.fn, rl.role,
                 pg_temp.tfe_run_as(rl.role, null, format('select %s::text', x.fn)) as out
            from (select distinct fn from _tfe_expected) x
           cross join unnest(array['anon', 'authenticated', 'service_role']) as rl(role)) r
   where r.out not like 'ERROR 42501: permission denied for function %';
  perform pg_temp.tfe_expect_eq('TFE-2 26 本を anon・authenticated・service_role が直接呼ぶと、どれも権限で拒否する（42501。拒否しなかった組み合わせが空）',
    '', v_direct);

  perform pg_temp.tfe_expect_eq('TFE-3 31 本のトリガーは残っていて、すべて有効（関数・テーブル・名前は migration の一覧のとおり。後の migration でこの 26 本を使って足したトリガーにも無効なものが無い）', '31/31/0',
    (select count(*) from _tfe_expected)::text || '/' ||
    (select count(*) from _tfe_expected e
       join pg_catalog.pg_trigger t on t.tgrelid = e.tbl::regclass and t.tgname = e.trg
      where t.tgfoid = e.fn::regprocedure and t.tgenabled = 'O')::text || '/' ||
    (select count(*) from pg_catalog.pg_trigger t
      where not t.tgisinternal and t.tgenabled <> 'O'
        and t.tgfoid in (select distinct e.fn::regprocedure from _tfe_expected e))::text);
end;
$privileges$;

-- ---------- 外した後もトリガーが動く（商品マスターが空の DB でだけ行う） ----------
do $behavior$
declare
  u_admin constant uuid := '7c000000-0000-4000-8000-000000000001';
  u_cust constant uuid := '7c000000-0000-4000-8000-000000000002';
  u_dealer constant uuid := '7c000000-0000-4000-8000-000000000003';
  u_new constant uuid := '7c000000-0000-4000-8000-000000000004';
  u_new2 constant uuid := '7c000000-0000-4000-8000-000000000005';
  m_model constant uuid := '7c100000-0000-4000-8000-000000000001';
  m_other constant uuid := '7c100000-0000-4000-8000-000000000002';
  c_items constant uuid := '7c200000-0000-4000-8000-000000000001';
  c_other constant uuid := '7c200000-0000-4000-8000-000000000002';
  o_item constant uuid := '7c300000-0000-4000-8000-000000000001';
  o_other constant uuid := '7c300000-0000-4000-8000-000000000002';
  vg_item constant uuid := '7c310000-0000-4000-8000-000000000001';
  vg_other constant uuid := '7c310000-0000-4000-8000-000000000002';
  vc_item constant uuid := '7c320000-0000-4000-8000-000000000001';
  vc_other constant uuid := '7c320000-0000-4000-8000-000000000002';
  org_hq constant uuid := '7c400000-0000-4000-8000-000000000001';
  org_dealer constant uuid := '7c400000-0000-4000-8000-000000000002';
  org_md constant uuid := '7c400000-0000-4000-8000-000000000003';
  bm constant uuid := '7c410000-0000-4000-8000-000000000001';
  bm_other constant uuid := '7c410000-0000-4000-8000-000000000002';
  bm_legacy constant uuid := '7c410000-0000-4000-8000-000000000003';
  bm_alt constant uuid := '7c410000-0000-4000-8000-000000000004';
  bm_md constant uuid := '7c410000-0000-4000-8000-000000000005';
  mr_se constant uuid := '7c470000-0000-4000-8000-000000000001';
  mr_se_alt constant uuid := '7c470000-0000-4000-8000-000000000002';
  mr_md constant uuid := '7c470000-0000-4000-8000-000000000003';
  bmr_pub constant uuid := '7c420000-0000-4000-8000-000000000001';
  bmr_draft constant uuid := '7c420000-0000-4000-8000-000000000002';
  bmr_other constant uuid := '7c420000-0000-4000-8000-000000000003';
  bmr_legacy constant uuid := '7c420000-0000-4000-8000-000000000004';
  lb constant uuid := '7c430000-0000-4000-8000-000000000001';
  sem constant uuid := '7c440000-0000-4000-8000-000000000001';
  rev_pub constant uuid := '7c450000-0000-4000-8000-000000000001';
  rev_draft constant uuid := '7c450000-0000-4000-8000-000000000002';
  bi_pub constant uuid := '7c460000-0000-4000-8000-000000000001';
  bi_draft constant uuid := '7c460000-0000-4000-8000-000000000002';
  cfg constant uuid := '7c500000-0000-4000-8000-000000000001';
  qr constant uuid := '7c600000-0000-4000-8000-000000000001';
  qr2 constant uuid := '7c600000-0000-4000-8000-000000000002';
  qr3 constant uuid := '7c600000-0000-4000-8000-000000000003';
  q_parent constant uuid := '7c610000-0000-4000-8000-000000000001';
  q_new constant uuid := '7c610000-0000-4000-8000-000000000002';
  v_role text;
  v_out text;
  v_out2 text;
  v_before integer;
  v_mid integer;
  v_role_before integer;
  v_variant_sql constant text :=
    'insert into public.standard_estimate_revision_baseline_variants (baseline_item_id, variant_group_id, variant_choice_id, '
    || 'variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot, extra_price_snapshot) '
    || 'values (%L, %L, %L, ''color'', ''色'', %L, %L, 0) returning ''ok''';
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.tfe_expect_eq('TFE-0 商品マスターが空の DB で行う検査のため、トリガーの動作の確認は省略', 'skipped', 'skipped');
    return;
  end if;

  -- ---------- 検査用のデータ（トリガーと外部キー検査を止めて、必要な行だけを直接入れる） ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'tfe-admin@runtime.invalid', '{}'), (u_cust, 'tfe-cust@runtime.invalid', '{}'), (u_dealer, 'tfe-dealer@runtime.invalid', '{}'),
         -- TFE-10b の会員（プロフィールは auth.users を参照するため先に入れる。ここではトリガーが動かないのでプロフィールは作られない）
         (u_new2, 'tfe-new2@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'tfe-admin@runtime.invalid', '本部', 'admin'), (u_cust, 'tfe-cust@runtime.invalid', 'お客様', 'customer'),
         (u_dealer, 'tfe-dealer@runtime.invalid', '代理店', 'dealer');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-tfe-model', 'トリガーの検査用モデル', 1000000, 'published'),
         (m_other, 'runtime-tfe-other', 'トリガーの検査用の別モデル', 1000000, 'published');
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (c_items, 'runtime-tfe-items', 'トリガーの検査の商品', 'multi', false, 'shell', 'published'),
         (c_other, 'runtime-tfe-other', 'トリガーの検査の別カテゴリー', 'multi', false, 'shell', 'published');
  insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no, simulator_visible)
  values (o_item, m_model, c_items, 'runtime-tfe-item', 'トリガーの検査の商品', 1000, 'published', 'PRD-973001', true),
         (o_other, m_model, c_other, 'runtime-tfe-other', 'トリガーの検査の別の商品', 1000, 'published', 'PRD-973002', true);
  insert into public.option_variant_groups (id, option_id, code, name, status)
  values (vg_item, o_item, 'color', '色', 'published'), (vg_other, o_other, 'color', '色', 'published');
  insert into public.option_variant_choices (id, group_id, code, name, status)
  values (vc_item, vg_item, 'white', '白', 'published'), (vc_other, vg_other, 'black', '黒', 'published');
  insert into public.organizations (id, code, name, organization_type)
  values (org_hq, 'RT-TFE-HQ', 'トリガーの検査の本部', 'headquarters'), (org_dealer, 'RT-TFE-DEALER', 'トリガーの検査の代理店', 'dealer'),
         (org_md, 'RT-TFE-MD', 'トリガーの検査の総代理店', 'master_dealer');
  insert into public.matrix_specs (code, label) values ('tfe-se', 'トリガーの検査の用途'), ('tfe-md', 'トリガーの検査の総代理店の用途');
  insert into public.matrix_sizes (code, width_mm, depth_mm, label) values ('9101x2201', 9101, 2201, '検査A'), ('9102x2202', 9102, 2202, '検査B');
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_se, m_model, 'tfe-se', '9101x2201', false), (mr_se_alt, m_model, 'tfe-se', '9102x2202', false),
         (mr_md, m_model, 'tfe-md', '9101x2201', false);
  insert into public.base_masters (id, base_model_id, owner_organization_id, name, current_published_revision_id, fire_spec_code, matrix_row_id)
  values (bm, m_model, org_hq, 'トリガーの検査の本体', bmr_pub, 'non_fire', mr_se),
         (bm_other, m_other, org_hq, 'トリガーの検査の別の本体', bmr_other, 'non_fire', null),
         (bm_legacy, m_model, org_hq, 'トリガーの検査の旧本体移行', null, 'non_fire', null),
         (bm_alt, m_model, org_hq, 'トリガーの検査の付け替え先の本体', null, 'non_fire', mr_se_alt),
         (bm_md, m_model, org_md, 'トリガーの検査の総代理店の本体', null, 'non_fire', mr_md);
  insert into public.base_master_revisions (id, base_master_id, version, status, published_at, expense_method, expense_rate)
  values (bmr_pub, bm, 1, 'published', now(), 'none', null), (bmr_draft, bm, 2, 'draft', null, 'none', null),
         (bmr_other, bm_other, 1, 'published', now(), 'none', null), (bmr_legacy, bm_legacy, 1, 'draft', null, 'none', null);
  insert into public.legacy_base_migration_batches (id, status, source_snapshot_hash) values (lb, 'migrated', repeat('0', 64));
  insert into public.legacy_base_migration_draft_outputs (
    migration_batch_id, base_model_id, proposed_group_key, representative_legacy_spec_code, base_master_id, revision_id,
    initial_fire_spec_code, fire_spec_review_required, source_classified_base_line_total, legacy_base_section_line_total,
    legacy_base_expense, legacy_base_total, target_expense_method, target_expense_amount, target_line_subtotal, target_total)
  values (lb, m_model, 'tfe', 'tfe-legacy', bm_legacy, bmr_legacy, 'non_fire', true, 0, 0, 0, 0, 'none', 0, 0, 0);
  insert into public.standard_estimate_masters (id, owner_organization_id, base_model_id, base_master_id, spec_code, name, current_published_revision_id)
  values (sem, org_hq, m_model, bm, 'tfe-se', 'トリガーの検査の標準見積', rev_pub);
  insert into public.standard_estimate_revisions (id, standard_estimate_master_id, version, base_master_revision_id, status, published_at, tax_rate)
  values (rev_pub, sem, 1, bmr_pub, 'published', now(), 0.10), (rev_draft, sem, 2, bmr_pub, 'draft', null, 0.10);
  insert into public.standard_estimate_revision_baseline_items (
    id, revision_id, option_id, option_category_id, section_code, selection_target_code, quantity,
    option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order)
  values (bi_pub, rev_pub, o_item, c_items, 'option', 'runtime-tfe-items', 1, 'runtime-tfe-item', 'トリガーの検査の商品', 'runtime-tfe-items', 'トリガーの検査の商品', 1000, 1),
         (bi_draft, rev_draft, o_item, c_items, 'option', 'runtime-tfe-items', 1, 'runtime-tfe-item', 'トリガーの検査の商品', 'runtime-tfe-items', 'トリガーの検査の商品', 1000, 1);
  insert into public.estimate_templates (base_model_id, spec_code, name, source_file_name, source_sheet_name, source_sha256)
  values (m_model, 'tfe-locked', '検査用 Excel 標準', 'runtime.xlsx', 'runtime', repeat('0', 64));
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (cfg, u_cust, m_model, 'トリガーの検査の構成', 'draft', 'tfe-se', 'shell');
  insert into public.quote_requests (id, status, contact)
  values (qr, 'reviewing', '{}'::jsonb), (qr2, 'reviewing', '{}'::jsonb), (qr3, 'reviewing', '{}'::jsonb);
  insert into public.quotes (id, quote_no, quote_request_id, user_id, status, valid_until, customer_name, base_model_name,
                             base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total, base_model_id)
  values (q_parent, 'RT-TFE-0001', qr, u_cust, 'issued', now() + interval '30 days', 'お客様', 'トリガーの検査用モデル',
          1000000, 0, 0, 1000000, 0.10, 100000, 1100000, m_model);
  set local session_replication_role = origin;

  -- ---------- 会員・プロフィール ----------
  -- 会員登録は Supabase Auth（auth の管理ロール）が auth.users へ追加する。切り替えられない接続（CI）では接続ユーザーで追加する
  v_role := case when pg_has_role(current_user, 'supabase_auth_admin', 'member') then 'supabase_auth_admin' else current_user end;
  v_out := pg_temp.tfe_run_as(v_role, null, format(
    $q$insert into auth.users (id, email, raw_user_meta_data) values (%L, 'tfe-new@runtime.invalid', '{"full_name": "新しい会員"}'::jsonb) returning 'ok'$q$, u_new));
  perform pg_temp.tfe_expect_eq('TFE-10 会員登録（auth.users への追加）でプロフィールを作り、お客様番号を付ける（handle_new_user・assign_customer_no。auth の管理ロールにも実行の権限は無い）',
    'false/ok/新しい会員/true',
    has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'execute')::text || '/' || v_out || '/' ||
    coalesce((select full_name || '/' || (customer_no ~ '^C[0-9]{6}$')::text from public.profiles where id = u_new), 'プロフィールなし'));
  -- どの環境でも、実行の権限の無いロール（ログインした利用者）の追加で同じ関数が動き、お客様番号も付く
  v_out := pg_temp.tfe_run_as('authenticated', null, format(
    $q$insert into pg_temp._tfe_signup (id, email, raw_user_meta_data) values (%L, 'tfe-new2@runtime.invalid', '{"full_name": "別の新しい会員"}'::jsonb) returning 'ok'$q$, u_new2));
  perform pg_temp.tfe_expect_eq('TFE-10b 実行の権限の無いログインした利用者の追加でも、同じトリガー関数がプロフィールを作り、お客様番号を付ける（handle_new_user・assign_customer_no）',
    'false/ok/別の新しい会員/true',
    has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')::text || '/' || v_out || '/' ||
    coalesce((select full_name || '/' || (customer_no ~ '^C[0-9]{6}$')::text from public.profiles where id = u_new2), 'プロフィールなし'));

  v_before := (select count(*) from public.audit_logs where entity = 'profile' and entity_id = u_cust);
  v_out := pg_temp.tfe_run_as('authenticated', u_cust, format($q$update public.profiles set full_name = 'お客様（変更）' where id = %L returning 'ok'$q$, u_cust));
  v_mid := (select count(*) from public.audit_logs where entity = 'profile' and entity_id = u_cust);
  v_role_before := (select count(*) from public.audit_logs where entity = 'profile' and entity_id = u_cust and action = 'role');
  v_out2 := pg_temp.tfe_run_as('authenticated', u_admin, format($q$update public.profiles set role_code = 'dealer' where id = %L returning 'ok'$q$, u_cust));
  perform pg_temp.tfe_expect_eq('TFE-11 お客様が自分の名前を変えても変更履歴は書かず、本部の管理者が権限を変えると変更履歴を書く（trg_audit_role）',
    'ok/0/ok/1', v_out || '/' || (v_mid - v_before)::text || '/' || v_out2 || '/' ||
    ((select count(*) from public.audit_logs where entity = 'profile' and entity_id = u_cust and action = 'role') - v_role_before)::text);

  -- ---------- 本体価格・問い合わせ・見積の通知 ----------
  v_before := (select count(*) from public.audit_logs where entity = 'base_model' and entity_id = m_model and action = 'price');
  v_out := pg_temp.tfe_run_as('service_role', null, format('update public.base_models set base_price = base_price + 1000 where id = %L returning ''ok''', m_model));
  perform pg_temp.tfe_expect_eq('TFE-12 本体価格を変えると変更履歴を書く（trg_audit_model）', 'ok/1',
    v_out || '/' || ((select count(*) from public.audit_logs where entity = 'base_model' and entity_id = m_model and action = 'price') - v_before)::text);

  v_out := pg_temp.tfe_run_as('service_role', null,
    $q$insert into public.contact_messages (full_name, email, topic, message) values ('トリガー検査', 'tfe-contact@runtime.invalid', 'other', '通知の確認') returning 'ok'$q$);
  perform pg_temp.tfe_expect_eq('TFE-13 問い合わせを受け付けると本部へ通知を作る（trg_contact_notify）', 'ok/1',
    v_out || '/' || (select count(*) from public.notifications where kind = 'contact_received' and body like 'トリガー検査 様%')::text);

  -- 見積の追加は、見積の関数（所有者の postgres で動く）だけができる。担当の代理店の変更は service_role で行う
  v_out := pg_temp.tfe_run_as('postgres', null, format(
    $q$insert into public.quotes (id, quote_no, quote_request_id, user_id, status, valid_until, customer_name, base_model_name,
                                  base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total, base_model_id)
       values (%L, 'RT-TFE-0002', %L, %L, 'issued', now() + interval '30 days', 'お客様', 'トリガーの検査用モデル',
               1000000, 0, 0, 1000000, 0.10, 100000, 1100000, %L) returning 'ok'$q$, q_new, qr3, u_cust, m_model));
  v_out2 := pg_temp.tfe_run_as('service_role', null, format('update public.quotes set dealer_id = %L where id = %L returning ''ok''', u_dealer, q_new));
  perform pg_temp.tfe_expect_eq('TFE-14 見積を作ると本部へ、担当の代理店を決めると代理店へ通知を作る（trg_quote_notify の追加・更新。追加は見積の関数と同じ postgres で行う）', 'ok/1/ok/1',
    v_out || '/' || (select count(*) from public.notifications where kind = 'quote_requested' and title = '新しい見積依頼：RT-TFE-0002')::text || '/' ||
    v_out2 || '/' || (select count(*) from public.notifications where kind = 'quote_assigned' and recipient_id = u_dealer and title like '%RT-TFE-0002')::text);

  -- ---------- 本体の内訳・外壁 ----------
  perform pg_temp.tfe_expect_error('TFE-15 Excel 取込済みの標準見積の本体内訳は変えられない（prevent_locked_base_breakdown_edit）', 'P0001', 'LOCKED: Excel取込済みの標準見積です',
    pg_temp.tfe_run_as('service_role', null, format($q$insert into public.base_breakdown_items (base_model_id, spec_code, section, name) values (%L, 'tfe-locked', 'base', '検査の内訳') returning 'ok'$q$, m_model)));
  perform pg_temp.tfe_expect_eq('TFE-16 Excel 取込のない仕様の本体内訳は追加できる（同じトリガーが通す）', 'ok',
    pg_temp.tfe_run_as('service_role', null, format($q$insert into public.base_breakdown_items (base_model_id, spec_code, section, name) values (%L, 'tfe-free', 'base', '検査の内訳') returning 'ok'$q$, m_model)));
  perform pg_temp.tfe_expect_error('TFE-17 外壁の指定は 4 面すべてが必要（validate_configuration_exterior_faces）', 'P0001', 'VALIDATION: 外壁は4面すべてを指定してください',
    pg_temp.tfe_run_as('service_role', null, format($q$update public.configurations set exterior_faces = '[{"face_code": "front"}]'::jsonb where id = %L returning 'ok'$q$, cfg)));

  -- ---------- 本体 Master・Revision ----------
  perform pg_temp.tfe_expect_error('TFE-18 本体を所有できるのは本部か総代理店だけ（enforce_base_master_owner_type。公開履歴のない本体の所有組織を代理店へ変えて確かめる）', 'P0001', 'VALIDATION: 本体を所有できるのは本部または総代理店です',
    pg_temp.tfe_run_as('service_role', null, format('update public.base_masters set owner_organization_id = %L where id = %L returning ''ok''', org_dealer, bm_legacy)));
  perform pg_temp.tfe_expect_error('TFE-19 本体の現在公開版は、同じ本体の公開済み Revision だけを指せる（validate_base_master_revision_refs）', 'P0001', 'VALIDATION: 現在公開版は同じ本体のpublished Revisionを指定してください',
    pg_temp.tfe_run_as('service_role', null, format('update public.base_masters set current_published_revision_id = %L where id = %L returning ''ok''', bmr_draft, bm)));
  perform pg_temp.tfe_expect_eq('TFE-20 本体の下書き Revision には明細を追加でき、公開済み Revision には追加できない（prevent_non_draft_base_master_line_write）',
    'ok/true',
    pg_temp.tfe_run_as('service_role', null, format($q$insert into public.base_master_revision_lines (revision_id, section, name) values (%L, 'base', '検査の明細') returning 'ok'$q$, bmr_draft)) || '/' ||
    (pg_temp.tfe_run_as('service_role', null, format($q$insert into public.base_master_revision_lines (revision_id, section, name) values (%L, 'base', '検査の明細') returning 'ok'$q$, bmr_pub))
       like 'ERROR P0001: LOCKED: 公開済み本体Revisionの明細は変更できません%')::text);
  perform pg_temp.tfe_expect_error('TFE-21 公開済みの本体 Revision は削除できない（prevent_published_base_master_revision_mutation）', 'P0001', 'LOCKED: 公開済み本体Revisionは削除できません',
    pg_temp.tfe_run_as('service_role', null, format('delete from public.base_master_revisions where id = %L returning ''ok''', bmr_pub)));
  perform pg_temp.tfe_expect_error('TFE-22 防火確認と最終検算の済んでいない旧本体移行の下書きは、直接公開できない（prevent_unreviewed_legacy_base_migration_publish）', 'P0001', 'LOCKED: 旧本体移行Draftは防火確認と最終検算完了後に専用Publishしてください',
    pg_temp.tfe_run_as('service_role', null, format('update public.base_master_revisions set status = ''published'', published_at = now() where id = %L returning ''ok''', bmr_legacy)));
  perform pg_temp.tfe_expect_error('TFE-23 本体の現在公開版が公開済みでなくなる変更は、transaction の完了時に止める（validate_base_master_current_pointer_at_commit）', 'P0001', 'VALIDATION: 現在公開版ポインタはtransaction完了時にpublished Revisionを指している必要があります',
    pg_temp.tfe_run_as_at_commit('service_role', array[format('update public.base_master_revisions set status = ''superseded'' where id = %L', bmr_pub)],
      'public.base_master_current_pointer_consistency'));

  -- ---------- 標準見積 Master・Revision ----------
  perform pg_temp.tfe_expect_error('TFE-24 標準見積を所有できるのは本部だけ（validate_standard_estimate_master_refs）', 'P0001', 'VALIDATION: 標準見積を所有できるのは本部だけです',
    pg_temp.tfe_run_as('service_role', null, format($q$insert into public.standard_estimate_masters (owner_organization_id, base_model_id, base_master_id, spec_code, name) values (%L, %L, %L, 'tfe-md', '総代理店の標準見積') returning 'ok'$q$, org_md, m_model, bm_md)));
  perform pg_temp.tfe_expect_error('TFE-25 Revision を作った標準見積は、基準の本体などを変えられない（prevent_standard_estimate_master_identity_change_after_revision。同じ用途の別の本体へ付け替えて確かめる）', 'P0001', 'LOCKED: Revision作成済みの標準見積は所有組織・商品モデル・本体Master・用途区分を変更できません',
    pg_temp.tfe_run_as('service_role', null, format('update public.standard_estimate_masters set base_master_id = %L where id = %L returning ''ok''', bm_alt, sem)));
  perform pg_temp.tfe_expect_error('TFE-26 標準見積の現在公開版は、同じ標準見積の公開済み Revision だけを指せる（validate_standard_estimate_current_pointer）', 'P0001', 'VALIDATION: 現在公開版は同じStandard Estimate Masterのpublished Revisionを指定してください',
    pg_temp.tfe_run_as('service_role', null, format('update public.standard_estimate_masters set current_published_revision_id = %L where id = %L returning ''ok''', rev_draft, sem)));
  perform pg_temp.tfe_expect_error('TFE-27 標準見積の Revision は、公開済みの本体 Revision だけを参照できる（validate_standard_estimate_base_revision_ref）', 'P0001', 'VALIDATION: 標準見積はpublishedまたはsupersededの本体Revisionだけを参照できます',
    pg_temp.tfe_run_as('service_role', null, format('insert into public.standard_estimate_revisions (standard_estimate_master_id, version, base_master_revision_id, tax_rate) values (%L, 3, %L, 0.10) returning ''ok''', sem, bmr_draft)));
  perform pg_temp.tfe_expect_error('TFE-28 公開済みの標準見積 Revision は削除できない（prevent_published_standard_estimate_revision_mutation）', 'P0001', 'LOCKED: 公開済みStandard Estimate Revisionは削除できません',
    pg_temp.tfe_run_as('service_role', null, format('delete from public.standard_estimate_revisions where id = %L returning ''ok''', rev_pub)));
  perform pg_temp.tfe_expect_eq('TFE-29 公開済みの標準見積 Revision の分類・明細・選択枠は変えられない（prevent_non_draft_standard_estimate_child_write の 3 本）', 'true/true/true',
    (pg_temp.tfe_run_as('service_role', null, format($q$insert into public.standard_estimate_revision_sections (revision_id, section_code) values (%L, 'sitework') returning 'ok'$q$, rev_pub))
       like 'ERROR P0001: LOCKED: 公開済みStandard Estimate Revisionの子要素は変更できません%')::text || '/' ||
    (pg_temp.tfe_run_as('service_role', null, format($q$insert into public.standard_estimate_revision_lines (revision_id, section_code, name, sort_order, unit_price, amount, cost_unit_price, cost_amount) values (%L, 'sitework', '検査の明細', 90, 0, 0, 0, 0) returning 'ok'$q$, rev_pub))
       like 'ERROR P0001: LOCKED: 公開済みStandard Estimate Revisionの子要素は変更できません%')::text || '/' ||
    (pg_temp.tfe_run_as('service_role', null, format('update public.standard_estimate_revision_baseline_items set sort_order = 2 where id = %L returning ''ok''', bi_pub))
       like 'ERROR P0001: LOCKED: 公開済みStandard Estimate Revisionの子要素は変更できません%')::text);
  perform pg_temp.tfe_expect_error('TFE-30 選択枠の商品とカテゴリーは一致させる（validate_standard_estimate_baseline_item_refs）', 'P0001', 'VALIDATION: baseline商品のcategoryが一致しません',
    pg_temp.tfe_run_as('service_role', null, format(
      $q$insert into public.standard_estimate_revision_baseline_items (revision_id, option_id, option_category_id, section_code, selection_target_code, quantity,
           option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order)
         values (%L, %L, %L, 'option', 'runtime-tfe-other', 1, 'runtime-tfe-item', 'トリガーの検査の商品', 'runtime-tfe-other', '別カテゴリー', 1000, 2) returning 'ok'$q$,
      rev_draft, o_item, c_other)));
  perform pg_temp.tfe_expect_error('TFE-31 公開済みの標準見積 Revision の選択枠のバリエーションは変えられない（prevent_non_draft_standard_estimate_variant_write）', 'P0001', 'LOCKED: 公開済みStandard Estimate Revisionのbaseline variantは変更できません',
    pg_temp.tfe_run_as('service_role', null, format(v_variant_sql, bi_pub, vg_item, vc_item, 'white', '白')));
  perform pg_temp.tfe_expect_error('TFE-32 選択枠のバリエーションは、その商品のものだけ（validate_standard_estimate_baseline_variant_refs）', 'P0001', 'VALIDATION: variant groupがbaseline商品に属していません',
    pg_temp.tfe_run_as('service_role', null, format(v_variant_sql, bi_draft, vg_other, vc_other, 'black', '黒')));
  perform pg_temp.tfe_expect_eq('TFE-33 標準見積の現在公開版の整合は、transaction の完了時に Revision 側・Master 側の両方で止める（validate_standard_estimate_current_pointer_at_commit の 2 本）', 'true/true',
    (pg_temp.tfe_run_as_at_commit('service_role', array[format('update public.standard_estimate_revisions set status = ''superseded'' where id = %L', rev_pub)],
       'public.standard_estimate_current_pointer_consistency')
       like 'ERROR P0001: VALIDATION: Published RevisionがないStandard Estimateは現在公開版ポインタを持てません%')::text || '/' ||
    (pg_temp.tfe_run_as_at_commit('service_role', array[format('update public.standard_estimate_masters set current_published_revision_id = null where id = %L', sem)],
       'public.standard_estimate_master_current_pointer_consistency')
       like 'ERROR P0001: VALIDATION: Published RevisionがあるStandard Estimateはtransaction完了時にそのRevisionを現在公開版として指す必要があります%')::text);
  perform pg_temp.tfe_expect_eq('TFE-34 下書きの標準見積 Revision は、分類・明細・選択枠のバリエーションを追加して公開できる（同じトリガーが通す。完了時の整合も通る）', 'ok/ok/ok/ok',
    pg_temp.tfe_run_as('service_role', null, format($q$insert into public.standard_estimate_revision_sections (revision_id, section_code) values (%L, 'sitework') returning 'ok'$q$, rev_draft)) || '/' ||
    pg_temp.tfe_run_as('service_role', null, format($q$insert into public.standard_estimate_revision_lines (revision_id, section_code, name, sort_order, unit_price, amount, cost_unit_price, cost_amount) values (%L, 'sitework', '検査の明細', 90, 0, 0, 0, 0) returning 'ok'$q$, rev_draft)) || '/' ||
    pg_temp.tfe_run_as('service_role', null, format(v_variant_sql, bi_draft, vg_item, vc_item, 'white', '白')) || '/' ||
    pg_temp.tfe_run_as_at_commit('service_role', array[
        format('update public.standard_estimate_revisions set status = ''superseded'' where id = %L', rev_pub),
        format('update public.standard_estimate_revisions set status = ''published'', published_at = now() where id = %L', rev_draft),
        format('update public.standard_estimate_masters set current_published_revision_id = %L where id = %L', rev_draft, sem)],
      'public.standard_estimate_current_pointer_consistency, public.standard_estimate_master_current_pointer_consistency'));

  -- ---------- 見積の下書き ----------
  perform pg_temp.tfe_expect_eq('TFE-35 見積・見積の下書きの本体 Revision は、同じ商品モデルの公開済み版だけ（validate_quote_base_revision_ref の 2 本）', 'true/true',
    (pg_temp.tfe_run_as('service_role', null, format(
       $q$insert into public.quote_drafts (quote_request_id, base_model_id, base_master_revision_id, spec_code, quote_kind, tax_rate) values (%L, %L, %L, 'tfe-se', 'formal', 0.10) returning 'ok'$q$,
       qr2, m_model, bmr_other))
       like 'ERROR P0001: VALIDATION: 本体Revisionは同じ商品モデルのpublished/superseded版を指定してください%')::text || '/' ||
    (pg_temp.tfe_run_as('service_role', null, format('update public.quotes set base_master_revision_id = %L where id = %L returning ''ok''', bmr_other, q_parent))
       like 'ERROR P0001: VALIDATION: 本体Revisionは同じ商品モデルのpublished/superseded版を指定してください%')::text);
  perform pg_temp.tfe_expect_error('TFE-36 見積の下書きの親見積は、同じ案件の見積だけ（validate_quote_draft_parent_ref）', 'P0001', 'VALIDATION: Draftの親見積は同じ案件系列のQuoteを指定してください',
    pg_temp.tfe_run_as('service_role', null, format(
      $q$insert into public.quote_drafts (quote_request_id, parent_quote_id, base_model_id, spec_code, quote_kind, tax_rate) values (%L, %L, %L, 'tfe-se', 'formal', 0.10) returning 'ok'$q$,
      qr2, q_parent, m_model)));
  perform pg_temp.tfe_expect_eq('TFE-37 同じ案件の親見積と、同じ商品モデルの公開済み本体 Revision なら、見積の下書きを作れる（同じ 2 つのトリガーが通す）', 'ok',
    pg_temp.tfe_run_as('service_role', null, format(
      $q$insert into public.quote_drafts (quote_request_id, parent_quote_id, base_model_id, base_master_revision_id, spec_code, quote_kind, tax_rate) values (%L, %L, %L, %L, 'tfe-se', 'formal', 0.10) returning 'ok'$q$,
      qr, q_parent, m_model, bmr_pub)));
end;
$behavior$;

select coalesce(json_agg(json_build_object('ok', ok, 'step', step, 'expected', expected, 'actual', actual) order by seq), '[]'::json) as j
  from _tfe_result;

rollback;
