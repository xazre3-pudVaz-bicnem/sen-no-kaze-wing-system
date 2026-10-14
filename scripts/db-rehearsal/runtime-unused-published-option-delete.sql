-- 未使用の登録済み商品を安全に削除するRPCの実動作検査。
-- 使い捨てローカルDB専用。全体をtransactionで実行し最後にrollbackする。

begin;

create temp table _unused_delete_result (
  seq serial,
  step text,
  expected text,
  actual text,
  ok boolean
) on commit drop;
grant all on _unused_delete_result to public;

create function pg_temp.run_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_sub is null
      then json_build_object('role', p_role)::text
      else json_build_object('role', p_role, 'sub', p_sub)::text
    end,
    true
  );
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

create function pg_temp.run_sql(p_sql text) returns text
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

create function pg_temp.expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _unused_delete_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.expect_contains(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _unused_delete_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, position(p_expected in p_actual) > 0);
$fn$;

do $test$
declare
  u_admin constant uuid := '00000000-0000-4000-8000-00000000d101';
  u_dealer constant uuid := '00000000-0000-4000-8000-00000000d102';
  category_id constant uuid := '00000000-0000-4000-8000-00000000d110';
  opt_unused constant uuid := '00000000-0000-4000-8000-00000000d111';
  opt_used constant uuid := '00000000-0000-4000-8000-00000000d112';
  opt_peer constant uuid := '00000000-0000-4000-8000-00000000d113';
  opt_direct constant uuid := '00000000-0000-4000-8000-00000000d114';
  opt_draft constant uuid := '00000000-0000-4000-8000-00000000d115';
  opt_config constant uuid := '00000000-0000-4000-8000-00000000d116';
  opt_variant constant uuid := '00000000-0000-4000-8000-00000000d117';
  opt_snapshot constant uuid := '00000000-0000-4000-8000-00000000d118';
  opt_quote constant uuid := '00000000-0000-4000-8000-00000000d119';
  opt_standard constant uuid := '00000000-0000-4000-8000-00000000d11a';
  opt_preset constant uuid := '00000000-0000-4000-8000-00000000d11b';
  opt_service constant uuid := '00000000-0000-4000-8000-00000000d11c';
  opt_malformed constant uuid := '00000000-0000-4000-8000-00000000d11d';
  opt_postdelete constant uuid := '00000000-0000-4000-8000-00000000d11e';
  opt_face constant uuid := '00000000-0000-4000-8000-00000000d11f';
  cfg_face_id constant uuid := '00000000-0000-4000-8000-00000000d163';
  variant_group constant uuid := '00000000-0000-4000-8000-00000000d140';
  variant_choice constant uuid := '00000000-0000-4000-8000-00000000d141';
  base_model_id constant uuid := '00000000-0000-4000-8000-00000000d150';
  cfg_id constant uuid := '00000000-0000-4000-8000-00000000d160';
  cfg_item_direct constant uuid := '00000000-0000-4000-8000-00000000d161';
  cfg_item_variant constant uuid := '00000000-0000-4000-8000-00000000d162';
  snapshot_id constant uuid := '00000000-0000-4000-8000-00000000d170';
  malformed_snapshot_id constant uuid := '00000000-0000-4000-8000-00000000d171';
  quote_item_id constant uuid := '00000000-0000-4000-8000-00000000d180';
  quote_id constant uuid := '00000000-0000-4000-8000-00000000d181';
  baseline_id constant uuid := '00000000-0000-4000-8000-00000000d190';
  revision_id constant uuid := '00000000-0000-4000-8000-00000000d191';
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'unused-delete-admin@runtime.invalid', '{}'::jsonb),
    (u_dealer, 'unused-delete-dealer@runtime.invalid', '{}'::jsonb);

  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'unused-delete-admin@runtime.invalid', '削除検査管理者', 'admin'),
    (u_dealer, 'unused-delete-dealer@runtime.invalid', '削除検査代理店', 'dealer');

  insert into public.option_categories (id, code, name, status)
  values (category_id, 'runtime-unused-delete', '安全削除検査', 'published');

  insert into public.options (id, category_id, code, name, status, product_no)
  values
    (opt_unused, category_id, 'runtime-delete-unused', '未使用登録済み商品', 'published', 'PRD-999981'),
    (opt_used, category_id, 'runtime-delete-used', '商品ルール使用済み商品', 'published', 'PRD-999982'),
    (opt_peer, category_id, 'runtime-delete-peer', '参照用商品', 'published', 'PRD-999983'),
    (opt_direct, category_id, 'runtime-delete-direct', '直接DELETE検査商品', 'published', 'PRD-999984'),
    (opt_draft, category_id, 'runtime-delete-draft', '下書きDELETE検査商品', 'draft', 'PRD-999985'),
    (opt_config, category_id, 'runtime-delete-config', 'Configuration使用済み商品', 'published', 'PRD-999986'),
    (opt_variant, category_id, 'runtime-delete-variant', 'Variant使用済み商品', 'published', 'PRD-999987'),
    (opt_snapshot, category_id, 'runtime-delete-snapshot', 'Snapshot使用済み商品', 'published', 'PRD-999988'),
    (opt_quote, category_id, 'runtime-delete-quote', 'Quote使用済み商品', 'published', 'PRD-999989'),
    (opt_standard, category_id, 'runtime-delete-standard', '標準見積Revision使用済み商品', 'published', 'PRD-999990'),
    (opt_preset, category_id, 'runtime-delete-preset', 'Preset使用済み商品', 'published', 'PRD-999991'),
    (opt_service, category_id, 'runtime-delete-service', 'service_role直接DELETE検査商品', 'published', 'PRD-999992'),
    (opt_malformed, category_id, 'runtime-delete-malformed', '形式異常時停止検査商品', 'published', 'PRD-999993'),
    (opt_postdelete, category_id, 'runtime-delete-postdelete', '削除後参照復活防止商品', 'published', 'PRD-999994'),
    (opt_face, category_id, 'runtime-delete-face', '外壁4面だけで使用中の商品', 'published', 'PRD-999995');

  -- 外壁4面（configurations.exterior_faces の JSON）の側面だけで使われている商品。FK では守られない
  insert into public.configurations (id, user_id, base_model_id, name, status, exterior_faces)
  values (
    cfg_face_id,
    u_admin,
    base_model_id,
    '外壁4面検査',
    'draft',
    jsonb_build_array(jsonb_build_object('face_code', 'right', 'option_id', opt_face::text, 'variant_choice_ids', '[]'::jsonb))
  );

  insert into public.option_dependencies (option_id, requires_option_id, message)
  values (opt_used, opt_peer, '安全削除の使用済み判定用');

  insert into public.configuration_items (id, configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_item_direct, cfg_id, opt_config, 1, '{}'::uuid[]);

  insert into public.option_variant_groups (id, option_id, code, name, status)
  values (variant_group, opt_variant, 'runtime-group', '安全削除検査', 'published');
  insert into public.option_variant_choices (id, group_id, code, name, status)
  values (variant_choice, variant_group, 'runtime-choice', '安全削除検査', 'published');
  insert into public.configuration_items (id, configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_item_variant, cfg_id, opt_peer, 1, array[variant_choice]);

  insert into public.configuration_snapshots (id, configuration_id, reason, snapshot)
  values (
    snapshot_id,
    cfg_id,
    'saved',
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('option_id', opt_snapshot::text)))
  );

  insert into public.quote_items (id, quote_id, kind, name, unit_price, quantity, amount, option_id)
  values (quote_item_id, quote_id, 'option', '安全削除検査', 0, 1, 0, opt_quote);

  insert into public.standard_estimate_revision_baseline_items (
    id, revision_id, baseline_key, option_id, option_category_id, section_code,
    selection_target_code, quantity, option_code_snapshot, option_name_snapshot,
    category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order
  ) values (
    baseline_id, revision_id, gen_random_uuid(), opt_standard, category_id, 'option',
    'runtime-delete', 1, 'runtime-delete-standard', '安全削除検査',
    'runtime-unused-delete', '安全削除検査', 0, 0
  );

  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (
    base_model_id,
    'runtime-unused-delete-model',
    '安全削除検査本体',
    0,
    'published',
    jsonb_build_array(jsonb_build_object('code', 'runtime', 'name', '検査', 'option_codes', jsonb_build_array('runtime-delete-preset')))
  );

  set local session_replication_role = origin;

  perform pg_temp.expect_contains(
    'unused-delete 1-1 anonはRPCを実行できない',
    'ERROR 42501:',
    pg_temp.run_as(
      'anon',
      null,
      format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_unused::text)
    )
  );

  perform pg_temp.expect_contains(
    'unused-delete 1-2 dealerはRPCで削除できない',
    'FORBIDDEN:',
    pg_temp.run_as(
      'authenticated',
      u_dealer,
      format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_unused::text)
    )
  );

  perform pg_temp.expect_eq(
    'unused-delete 1-3 adminは未使用publishedを削除できる',
    'ok',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_unused::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 1-4 未使用publishedは実際に削除される',
    '0',
    (select count(*)::text from public.options where id = opt_unused)
  );

  perform pg_temp.expect_contains(
    'unused-delete 2-1 商品ルールで使用中なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_used::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 2-2 Configuration直参照なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_config::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 2-3 variant_choice_ids参照なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_variant::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 2-4 Configuration Snapshot参照なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_snapshot::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 2-5 Quote参照なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_quote::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 2-6 Standard Estimate Revision参照なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_standard::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 2-7 Preset code参照なら削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_preset::text))
  );

  perform pg_temp.expect_eq(
    'unused-delete 2-8 使用中商品はすべて残る',
    '6',
    (select count(*)::text from public.options where id = any(array[opt_used, opt_config, opt_variant, opt_snapshot, opt_quote, opt_standard]))
  );
  perform pg_temp.expect_eq(
    'unused-delete 2-9 Preset使用中商品も残る',
    '1',
    (select count(*)::text from public.options where id = opt_preset)
  );

  perform pg_temp.expect_eq(
    'unused-delete 3-1 authenticatedのpublished直接DELETEはRLSで0行',
    '0',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_direct::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 3-2 published直接DELETEで商品は消えない',
    '1',
    (select count(*)::text from public.options where id = opt_direct)
  );

  perform pg_temp.expect_contains(
    'unused-delete 3-3 service_roleのpublished直接DELETEはtable ACLで拒否する',
    'ERROR 42501:',
    pg_temp.run_as(
      'service_role',
      null,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_service::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 3-4 service_role直接DELETEでも商品は残る',
    '1',
    (select count(*)::text from public.options where id = opt_service)
  );

  perform pg_temp.expect_eq(
    'unused-delete 3-5 既存のdraft直接DELETEは維持する',
    '1',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_draft::text)
    )
  );

  -- published → draft に戻してから下書きとして削除しても、参照確認を迂回できない（先方確認 2026-10-14）
  perform pg_temp.expect_eq(
    'unused-delete 3-6 Preset使用中の商品もdraftへ戻すことはできる',
    '1',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with u as (update public.options set status = 'draft' where id = %L::uuid returning 1) select count(*)::text from u$q$, opt_preset::text)
    )
  );
  perform pg_temp.expect_contains(
    'unused-delete 3-7 draftへ戻したPreset使用中の商品も直接DELETEで削除できない',
    'ERROR P0001: VALIDATION:',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_preset::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 3-8 外壁4面だけで使用中の商品もdraftへ戻すことはできる',
    '1',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with u as (update public.options set status = 'draft' where id = %L::uuid returning 1) select count(*)::text from u$q$, opt_face::text)
    )
  );
  perform pg_temp.expect_contains(
    'unused-delete 3-9 draftへ戻した外壁4面使用中の商品も直接DELETEで削除できない',
    'ERROR P0001: VALIDATION:',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_face::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 3-10 どちらの商品も残り、Presetに消えたcodeは残らない',
    '2 0',
    (select count(*)::text from public.options where id = any(array[opt_preset, opt_face]))
      || ' '
      || (
        select count(*)::text
        from public.base_models bm
        cross join lateral jsonb_array_elements(bm.presets) preset(value)
        cross join lateral jsonb_array_elements_text(coalesce(preset.value -> 'option_codes', '[]'::jsonb)) preset_option(code)
        left join public.options o on o.code = preset_option.code
        where bm.slug = 'runtime-unused-delete-model' and o.id is null
      )
  );

  -- DELETE後に待機していたPreset書込みが消えたcodeを復活させないことを、保存時validationでも確認する。
  perform pg_temp.expect_eq(
    'unused-delete 4-1 参照なし商品を削除できる',
    'ok',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_postdelete::text))
  );
  perform pg_temp.expect_contains(
    'unused-delete 4-2 削除済み商品codeをPresetへ後書きできない',
    'VALIDATION:',
    pg_temp.run_sql(format(
      $q$update public.base_models set presets = %L::jsonb where id = %L::uuid returning 'ok'$q$,
      jsonb_build_array(jsonb_build_object('code', 'runtime', 'option_codes', jsonb_build_array('runtime-delete-postdelete')))::text,
      base_model_id::text
    ))
  );

  -- 想定外JSON形式を空配列扱いして削除を通さず、fail-closedする。
  set local session_replication_role = replica;
  insert into public.configuration_snapshots (id, configuration_id, reason, snapshot)
  values (malformed_snapshot_id, cfg_id, 'saved', '{"lines": {}}'::jsonb);
  set local session_replication_role = origin;

  perform pg_temp.expect_contains(
    'unused-delete 5-1 JSON形式異常があれば安全確認不能として削除を停止する',
    '形式に異常',
    pg_temp.run_as('authenticated', u_admin, format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_malformed::text))
  );
  perform pg_temp.expect_eq(
    'unused-delete 5-2 形式異常時は対象商品を残す',
    '1',
    (select count(*)::text from public.options where id = opt_malformed)
  );
end;
$test$;

select jsonb_agg(
  jsonb_build_object(
    'step', step,
    'expected', expected,
    'actual', actual,
    'ok', ok
  ) order by seq
) as j
from _unused_delete_result;

rollback;
