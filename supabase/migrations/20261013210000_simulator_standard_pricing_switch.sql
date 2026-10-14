-- シミュレーターの新価格（新しい標準見積）への切り替えスイッチ。
--
-- 2026-10-13 の先方回答：標準見積の登録・標準状態の商品の設定・未確定商品の確認が進み、本番の画面で最終金額を確認するまで、
-- サイトの新価格へは切り替えない（それまでは現在のサイト価格を維持する）。
--
-- 20261013200000（PR C2）は、標準状態の商品が登録された公開中の標準見積があると、自動で新しい計算を使う。
-- この migration で、本部がスイッチを入れるまでは、これまでの計算のままにする（初期値は「切り替えない」）。
--   * DB 側の計算の入口 standard_estimate_sale_view_for_configuration は、スイッチが切れている間は NULL（これまでの計算）を返す
--     （保存した仕様の金額・見積依頼の見積・見積書の行・税率・備考は、すべてこの関数を通る）
--   * シミュレーター画面の売価の取得（アプリ側）も、同じスイッチを見る
--   * スイッチを入れられるのは本部だけ（RPC。変更は監査ログに残す）
-- standard_estimate_sale_view_for_configuration は 20261013200000 の定義に、スイッチの判定を足すだけ（シグネチャ・owner・ACL は不変）。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.standard_estimate_sale_view_for_configuration(uuid)') is null
     or to_regprocedure('public.get_standard_estimate_sale_views(uuid)') is null then
    raise exception 'PRECONDITION: simulator standard estimate pricing (20261013200000) must be applied first';
  end if;
  if to_regclass('public.app_settings') is not null then
    raise exception 'PRECONDITION: app_settings already exists; review before applying';
  end if;
end;
$preflight$;

-- ---------- 設定の表 ----------

create table public.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is 'システムの設定。読み書きは専用の関数だけ（本部が RPC で変更する）。';

alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
-- ポリシーなし（= API から直接は読み書きできない。専用の関数だけが扱う）

insert into public.app_settings (key, value) values ('simulator_standard_pricing', jsonb_build_object('enabled', false));

-- ---------- スイッチの読み取り ----------

create function public.simulator_standard_pricing_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value ->> 'enabled')::boolean from public.app_settings s where s.key = 'simulator_standard_pricing'),
    false
  );
$$;

comment on function public.simulator_standard_pricing_enabled() is
  'シミュレーターで新しい標準見積の価格を使うか。false の間は、これまでの計算のまま（初期値 false）。';

-- ---------- スイッチの変更（本部だけ） ----------

create function public.set_simulator_standard_pricing(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_before boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- 権限は状態の判定より前に確認する（本部だけ）
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: シミュレーターの価格を切り替えられるのは本部だけです' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'VALIDATION: 切り替えの指定がありません' using errcode = 'P0001';
  end if;

  select coalesce((s.value ->> 'enabled')::boolean, false) into v_before
    from public.app_settings s where s.key = 'simulator_standard_pricing' for update;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values ('simulator_standard_pricing', jsonb_build_object('enabled', p_enabled), v_uid, now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  if v_before is distinct from p_enabled then
    perform public.write_audit(
      'status', 'app_settings', null,
      case when p_enabled then 'シミュレーターの価格を新しい標準見積に切り替えました'
           else 'シミュレーターの価格をこれまでの計算に戻しました' end,
      jsonb_build_object('simulator_standard_pricing', coalesce(v_before, false)),
      jsonb_build_object('simulator_standard_pricing', p_enabled)
    );
  end if;
  return p_enabled;
end;
$$;

-- ---------- DB 側の計算の入口にスイッチを入れる ----------

-- 保存済みの仕様に使う標準見積（売価だけの形）を 1 件に決める。決まらなければ NULL（これまでの計算）
create or replace function public.standard_estimate_sale_view_for_configuration(p_configuration_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $view_for_configuration$
declare
  cfg public.configurations;
  v_slug text;
  v_spec text;
  v_fire boolean;
  v_views jsonb;
  v_count integer;
  v_pick jsonb;
begin
  /* サイトの新価格へ切り替えるまでは、これまでの計算のまま（2026-10-13 先方回答） */
  if not public.simulator_standard_pricing_enabled() then
    return null;
  end if;

  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then
    return null;
  end if;
  select m.slug into v_slug from public.base_models m where m.id = cfg.base_model_id;
  /* 互換：BOX の hotel-single は BOX ホテル仕様の標準見積で計算する */
  v_spec := case when v_slug = 'box' and cfg.spec_code = 'hotel-single' then 'hotel' else cfg.spec_code end;
  if v_spec is null then
    return null;
  end if;
  v_fire := exists (
    select 1
      from public.configuration_items ci
      join public.options o on o.id = ci.option_id
     where ci.configuration_id = cfg.id
       and o.code = 'fire-proof'
  );
  v_views := public.get_standard_estimate_sale_views(cfg.base_model_id);

  if v_fire then
    select count(*), (array_agg(e.value))[1]
      into v_count, v_pick
      from jsonb_array_elements(v_views) as e(value)
     where e.value ->> 'spec_code' = v_spec
       and e.value ->> 'fire_spec_code' = 'fire'
       and jsonb_array_length(e.value -> 'baseline') > 0;
    if v_count = 1 then
      return v_pick;
    end if;
  end if;

  select count(*), (array_agg(e.value))[1]
    into v_count, v_pick
    from jsonb_array_elements(v_views) as e(value)
   where e.value ->> 'spec_code' = v_spec
     and e.value ->> 'fire_spec_code' = 'non_fire'
     and jsonb_array_length(e.value -> 'baseline') > 0;
  return case when v_count = 1 then v_pick else null end;
end;
$view_for_configuration$;

-- ---------- owner / EXECUTE ----------

alter function public.simulator_standard_pricing_enabled() owner to postgres;
alter function public.set_simulator_standard_pricing(boolean) owner to postgres;
alter function public.standard_estimate_sale_view_for_configuration(uuid) owner to postgres;

revoke all on function public.simulator_standard_pricing_enabled() from public, anon, authenticated, service_role;
revoke all on function public.set_simulator_standard_pricing(boolean) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_sale_view_for_configuration(uuid) from public, anon, authenticated, service_role;

-- スイッチの状態は、シミュレーターのページ（サーバー側・service role）と管理画面（本部）が読む
grant execute on function public.simulator_standard_pricing_enabled() to authenticated, service_role;
grant execute on function public.set_simulator_standard_pricing(boolean) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.app_settings'::regclass) then
    raise exception 'POSTCONDITION: RLS must be enabled on app_settings';
  end if;
  if has_table_privilege('anon', 'public.app_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.app_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.app_settings', 'DELETE') then
    raise exception 'POSTCONDITION: app_settings must not be readable or writable through the API';
  end if;
  if public.simulator_standard_pricing_enabled() then
    raise exception 'POSTCONDITION: simulator standard pricing must start disabled';
  end if;

  v_fn := 'public.simulator_standard_pricing_enabled()'::regprocedure;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'POSTCONDITION: simulator_standard_pricing_enabled must be executable by authenticated and service_role only';
  end if;

  v_fn := 'public.set_simulator_standard_pricing(boolean)'::regprocedure;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'POSTCONDITION: set_simulator_standard_pricing must be executable by authenticated only';
  end if;

  v_fn := 'public.standard_estimate_sale_view_for_configuration(uuid)'::regprocedure;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'POSTCONDITION: standard_estimate_sale_view_for_configuration must stay internal';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = v_fn and p.prosecdef and p.proconfig @> array['search_path=""']
       and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'POSTCONDITION: standard_estimate_sale_view_for_configuration must stay SECURITY DEFINER with empty search_path, owned by postgres';
  end if;
end;
$postcondition$;

commit;
