-- DB Rehearsal専用：未使用の下書きVariantを削除する実RPC検査。最後に全体ROLLBACK。
begin;
create temp table _draft_variant_delete_checks (test text, expected text, actual text, ok boolean) on commit drop;
grant all on _draft_variant_delete_checks to public;

create function pg_temp.run_as_variant(p_role text, p_sub uuid, p_query text)
returns text language plpgsql as $fn$
declare v_out text;
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case when p_sub is null then pg_catalog.json_build_object('role', p_role)::text
         else pg_catalog.json_build_object('role', p_role, 'sub', p_sub)::text end,
    true
  );
  execute pg_catalog.format('set local role %I', p_role);
  begin
    execute p_query into v_out;
  exception when others then
    v_out := pg_catalog.format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  reset role;
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  return pg_catalog.coalesce(v_out, '(null)');
end;
$fn$;

create function pg_temp.expect_variant(p_test text, p_expected text, p_actual text)
returns void language sql as $fn$
  insert into _draft_variant_delete_checks (test, expected, actual, ok)
  values (p_test, p_expected, p_actual, position(p_expected in p_actual) > 0);
$fn$;

do $test$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-00000000e501';
  dealer_id constant uuid := '00000000-0000-4000-8000-00000000e502';
  category_id constant uuid := '00000000-0000-4000-8000-00000000e510';
  draft_id constant uuid := '00000000-0000-4000-8000-00000000e520';
  used_id constant uuid := '00000000-0000-4000-8000-00000000e521';
  published_id constant uuid := '00000000-0000-4000-8000-00000000e522';
  group_color constant uuid := '00000000-0000-4000-8000-00000000e530';
  group_child constant uuid := '00000000-0000-4000-8000-00000000e531';
  group_unused constant uuid := '00000000-0000-4000-8000-00000000e532';
  group_used constant uuid := '00000000-0000-4000-8000-00000000e533';
  group_published constant uuid := '00000000-0000-4000-8000-00000000e534';
  choice_red constant uuid := '00000000-0000-4000-8000-00000000e540';
  choice_blue constant uuid := '00000000-0000-4000-8000-00000000e541';
  choice_unused constant uuid := '00000000-0000-4000-8000-00000000e542';
  choice_used constant uuid := '00000000-0000-4000-8000-00000000e543';
  choice_published constant uuid := '00000000-0000-4000-8000-00000000e544';
  sample text;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data) values
    (admin_id, 'variant-delete-admin@runtime.invalid', '{}'::jsonb),
    (dealer_id, 'variant-delete-dealer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code) values
    (admin_id, 'variant-delete-admin@runtime.invalid', '選択肢削除検査管理者', 'admin'),
    (dealer_id, 'variant-delete-dealer@runtime.invalid', '選択肢削除検査代理店', 'dealer');
  insert into public.option_categories (id, code, name, status)
    values (category_id, 'runtime-variant-delete', '選択肢削除検査', 'published');
  insert into public.options (id, category_id, code, name, status, product_no) values
    (draft_id, category_id, 'runtime-variant-draft', '未使用Draft', 'draft', 'PRD-999971'),
    (used_id, category_id, 'runtime-variant-used', '業務使用中Draft', 'draft', 'PRD-999972'),
    (published_id, category_id, 'runtime-variant-published', '登録済み商品', 'published', 'PRD-999973');
  insert into public.option_variant_groups (id, option_id, code, name, status, depends_on_group_code, depends_on_choice_codes) values
    (group_color, draft_id, 'color', '色', 'published', null, '{}'::text[]),
    (group_child, draft_id, 'child', '赤の条件付き項目', 'published', 'color', array['red']::text[]),
    (group_unused, draft_id, 'unused', '未使用の選択項目', 'published', null, '{}'::text[]),
    (group_used, used_id, 'used', '使用中商品の選択項目', 'published', null, '{}'::text[]),
    (group_published, published_id, 'published', '登録済み商品の選択項目', 'published', null, '{}'::text[]);
  insert into public.option_variant_choices (id, group_id, code, name, status) values
    (choice_red, group_color, 'red', '赤', 'published'),
    (choice_blue, group_color, 'blue', '青', 'published'),
    (choice_unused, group_unused, 'unused', '消す選択肢', 'published'),
    (choice_used, group_used, 'used', '使用中', 'published'),
    (choice_published, group_published, 'published', '公開済み', 'published');
  -- FKの参照だけに頼らない検査。既存 Configuration の使用中 option_id を仕込む。
  insert into public.configuration_items (id, configuration_id, option_id, quantity, variant_choice_ids)
  values ('00000000-0000-4000-8000-00000000e550',
          '00000000-0000-4000-8000-00000000e551', used_id, 1, array[choice_used]);
  set local session_replication_role = origin;

  perform pg_temp.expect_variant(
    'variant-delete 1 anon RPC拒否', 'ERROR 42501:',
    pg_temp.run_as_variant('anon', null, format(
      $q$select 'ok' from (select public.delete_unused_variant_choice(%L::uuid, %L::uuid)) a$q$,
      draft_id::text, choice_blue::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 2 dealer RPC拒否', 'FORBIDDEN:',
    pg_temp.run_as_variant('authenticated', dealer_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_choice(%L::uuid, %L::uuid)) a$q$,
      draft_id::text, choice_blue::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 3 authenticated直接DELETE拒否', 'ERROR 42501:',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$delete from public.option_variant_choices where id = %L::uuid returning 'deleted'$q$,
      choice_blue::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 4 service_role直接DELETE拒否', 'ERROR 42501:',
    pg_temp.run_as_variant('service_role', null, format(
      $q$delete from public.option_variant_groups where id = %L::uuid returning 'deleted'$q$,
      group_unused::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 5 使用中商品はChoice削除不可', '使用されているため削除できません',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_choice(%L::uuid, %L::uuid)) a$q$,
      used_id::text, choice_used::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 6 公開済み商品はChoice削除不可', '下書き商品だけ削除できます',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_choice(%L::uuid, %L::uuid)) a$q$,
      published_id::text, choice_published::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 7 条件参照中Choiceは削除不可', '表示条件に使われているため削除できません',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_choice(%L::uuid, %L::uuid)) a$q$,
      draft_id::text, choice_red::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 8 条件参照されるGroupは削除不可', '表示条件に使われているため削除できません',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_group(%L::uuid, %L::uuid)) a$q$,
      draft_id::text, group_color::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 9 未使用Choice削除成功', 'ok',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_choice(%L::uuid, %L::uuid)) a$q$,
      draft_id::text, choice_blue::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 10 Choice削除反映', '0',
    (select count(*)::text from public.option_variant_choices where id = choice_blue));
  perform pg_temp.expect_variant(
    'variant-delete 11 未使用Group配下もまとめて削除', 'ok',
    pg_temp.run_as_variant('authenticated', admin_id, format(
      $q$select 'ok' from (select public.delete_unused_variant_group(%L::uuid, %L::uuid)) a$q$,
      draft_id::text, group_unused::text
    )));
  perform pg_temp.expect_variant(
    'variant-delete 12 Group消去', '0',
    (select count(*)::text from public.option_variant_groups where id = group_unused));
  perform pg_temp.expect_variant(
    'variant-delete 13 配下Choice消去', '0',
    (select count(*)::text from public.option_variant_choices where id = choice_unused));
  perform pg_temp.expect_variant(
    'variant-delete 14 保護対象の赤は残る', '1',
    (select count(*)::text from public.option_variant_choices where id = choice_red));
end;
$test$;

select coalesce(json_agg(
  json_build_object('test', test, 'expected', expected, 'actual', actual, 'ok', ok)
), '[]'::json) as j from _draft_variant_delete_checks;
rollback;
