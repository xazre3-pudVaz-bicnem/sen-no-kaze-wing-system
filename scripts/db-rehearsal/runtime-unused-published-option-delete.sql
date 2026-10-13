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
    (opt_unused, category_id, 'runtime-delete-unused', '未使用登録済み商品', 'published', 'PRD-999991'),
    (opt_used, category_id, 'runtime-delete-used', '使用済み登録済み商品', 'published', 'PRD-999992'),
    (opt_peer, category_id, 'runtime-delete-peer', '依存先商品', 'published', 'PRD-999993'),
    (opt_direct, category_id, 'runtime-delete-direct', '直接DELETE検査商品', 'published', 'PRD-999994'),
    (opt_draft, category_id, 'runtime-delete-draft', '下書きDELETE検査商品', 'draft', 'PRD-999995');

  insert into public.option_dependencies (option_id, requires_option_id, message)
  values (opt_used, opt_peer, '安全削除の使用済み判定用');

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
    'unused-delete 1-5 商品ルールで使用中ならRPCは削除を拒否する',
    'VALIDATION:',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$select 'ok' from (select public.delete_unused_published_option(%L::uuid)) s$q$, opt_used::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 1-6 使用中商品は残る',
    '1',
    (select count(*)::text from public.options where id = opt_used)
  );

  perform pg_temp.expect_eq(
    'unused-delete 1-7 authenticatedのpublished直接DELETEはRLSで0行',
    '0',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_direct::text)
    )
  );
  perform pg_temp.expect_eq(
    'unused-delete 1-8 published直接DELETEで商品は消えない',
    '1',
    (select count(*)::text from public.options where id = opt_direct)
  );

  perform pg_temp.expect_eq(
    'unused-delete 1-9 既存のdraft直接DELETEは維持する',
    '1',
    pg_temp.run_as(
      'authenticated',
      u_admin,
      format($q$with d as (delete from public.options where id = %L::uuid returning 1) select count(*)::text from d$q$, opt_draft::text)
    )
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
