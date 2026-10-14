-- お客様のフェーズ2〜3（フローチャート第4版）：ログインなしの一時保存（URL）と、設置予定地・土地の情報。
--
-- フェーズ2「プランを保存（未ログイン＝一時保存）」「後で検討する（保存プランから後日再開）」：
--   未ログインのお客様が選んだ仕様を一時保存し、発行した URL から 30 日間、ほかの端末でも続きを開けるようにする。
--   保存するのは仕様の選択だけ（商品・バリエーション・外壁の面・仕様・設置予定の地域）。価格は保存しない（開いたときに計算し直す）。
--   URL の鍵（トークン）はサーバーが作り、DB にはハッシュだけを残す。読み書きはサーバー（service_role）の RPC だけ。
--   混み合い対策として、1 分あたりの作成数と、有効な一時保存の総数に上限を設ける。期限切れの行は作成のついでに消す。
-- フェーズ3「設置予定地域・土地確認」：保存したプランごとに、土地の有無と、
--   土地あり → 設置予定地（住所・面積・地目・前面道路・電気・水道・排水）、土地なし・未定 → 希望地域・用途・土地のご予算 を入力する。
--   読めるのはお客様本人・本部・その案件の担当代理店と製造の担当。書けるのはお客様本人と本部（担当代理店は現地確認の記録に書く）。
--   土地候補の検索・紹介と土地 DB はフローチャートで「将来機能」のため扱わない。
-- 既存の表と関数は変更しない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.case_access(uuid)') is null or to_regprocedure('public.cf_text(jsonb, text, integer, text)') is null then
    raise exception 'PRECONDITION: case flow (20261013220000) must be applied first';
  end if;
  if to_regclass('public.guest_plans') is not null or to_regclass('public.configuration_site_profiles') is not null then
    raise exception 'PRECONDITION: tables already exist; review before applying';
  end if;
end;
$preflight$;

-- ---------- 一時保存（フェーズ2） ----------

create table public.guest_plans (
  id uuid primary key default gen_random_uuid(),
  -- URL の鍵の SHA-256（16 進）。鍵そのものは保存しない
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  base_model_id uuid not null references public.base_models(id) on delete cascade,
  -- 仕様の選択だけ（価格・お客様の情報は持たない）
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 16384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  constraint guest_plans_expiry check (expires_at > created_at)
);

comment on table public.guest_plans is
  'ログインなしの一時保存（フェーズ2）。URL の鍵のハッシュと仕様の選択だけを 30 日間持つ。サーバー（service_role）の RPC だけが読み書きする。';

create index guest_plans_created_idx on public.guest_plans (created_at);
create index guest_plans_expires_idx on public.guest_plans (expires_at);

alter table public.guest_plans enable row level security;
revoke all on public.guest_plans from public, anon, authenticated, service_role;

-- jsonb の配列が、UUID の文字列だけ（max 件まで）か
create function public.cf_uuid_array_valid(p_value jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
      or jsonb_typeof(p_value) = 'null'
      or (jsonb_typeof(p_value) = 'array'
          and jsonb_array_length(p_value) <= p_max
          and not exists (
            select 1 from jsonb_array_elements(p_value) e
             where jsonb_typeof(e) <> 'string'
                or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          ));
$$;

create function public.create_guest_plan(p_token_hash text, p_base_model_id uuid, p_plan jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_face jsonb;
  v_expires timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: 一時保存の鍵が正しくありません' using errcode = 'P0001';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or octet_length(p_plan::text) > 16384 then
    raise exception 'VALIDATION: 一時保存の内容が正しくありません' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_plan) k
     where k not in ('name', 'option_ids', 'variant_choice_ids', 'exterior_faces', 'finish_level', 'spec_code',
                     'site_prefecture', 'site_municipality', 'site_location_undecided')
  ) then
    raise exception 'VALIDATION: 一時保存の内容が正しくありません' using errcode = 'P0001';
  end if;
  if not public.cf_uuid_array_valid(p_plan -> 'option_ids', 300) or not public.cf_uuid_array_valid(p_plan -> 'variant_choice_ids', 300) then
    raise exception 'VALIDATION: 選んだ商品の形式が正しくありません' using errcode = 'P0001';
  end if;
  if p_plan ? 'exterior_faces' and jsonb_typeof(p_plan -> 'exterior_faces') <> 'null' then
    if jsonb_typeof(p_plan -> 'exterior_faces') <> 'array' or jsonb_array_length(p_plan -> 'exterior_faces') > 4 then
      raise exception 'VALIDATION: 外壁の選択の形式が正しくありません' using errcode = 'P0001';
    end if;
    for v_face in select value from jsonb_array_elements(p_plan -> 'exterior_faces')
    loop
      if jsonb_typeof(v_face) <> 'object'
         or coalesce(v_face ->> 'face_code', '') not in ('front', 'right', 'back', 'left')
         or not public.cf_uuid_array_valid(jsonb_build_array(v_face -> 'option_id'), 1)
         or not public.cf_uuid_array_valid(v_face -> 'variant_choice_ids', 20) then
        raise exception 'VALIDATION: 外壁の選択の形式が正しくありません' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  if coalesce(p_plan ->> 'finish_level', 'full') not in ('shell', 'equipment', 'full')
     or coalesce(p_plan ->> 'spec_code', 'x') !~ '^[a-z0-9_-]{1,40}$'
     or length(coalesce(p_plan ->> 'name', '')) > 60
     or length(coalesce(p_plan ->> 'site_prefecture', '')) > 10
     or length(coalesce(p_plan ->> 'site_municipality', '')) > 60
     or coalesce(jsonb_typeof(p_plan -> 'site_location_undecided'), 'boolean') not in ('boolean', 'null') then
    raise exception 'VALIDATION: 一時保存の内容が正しくありません' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.base_models m where m.id = p_base_model_id and m.status = 'published') then
    raise exception 'VALIDATION: 商品が見つかりません' using errcode = 'P0001';
  end if;

  -- 期限切れの行を、作成のついでに少しずつ消す
  delete from public.guest_plans g
   where g.id in (select x.id from public.guest_plans x where x.expires_at < now() order by x.expires_at limit 200);
  -- 混み合い対策（1 分あたりの作成数・有効な一時保存の総数）
  if (select count(*) from public.guest_plans g where g.created_at > now() - interval '1 minute') >= 60
     or (select count(*) from public.guest_plans g where g.expires_at > now()) >= 100000 then
    raise exception 'LOCKED: 一時保存が混み合っています。少し時間をおいてからお試しください' using errcode = 'P0001';
  end if;

  insert into public.guest_plans (token_hash, base_model_id, plan)
  values (p_token_hash, p_base_model_id, p_plan)
  returning expires_at into v_expires;
  return v_expires;
end;
$$;

-- 一時保存を開く（期限内のものだけ）。鍵のハッシュで探す
create function public.get_guest_plan(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('base_model_id', g.base_model_id, 'plan', g.plan, 'expires_at', g.expires_at)
    from public.guest_plans g
   where g.token_hash = p_token_hash
     and g.expires_at > now();
$$;

-- ---------- 設置予定地・土地（フェーズ3） ----------

create table public.configuration_site_profiles (
  configuration_id uuid primary key references public.configurations(id) on delete cascade,
  -- owned：土地あり／none：土地なし（これから探す）／undecided：未定
  land_status text not null check (land_status in ('owned', 'none', 'undecided')),
  -- 土地あり
  site_address text check (site_address is null or length(site_address) <= 200),
  area_sqm numeric(12, 2) check (area_sqm is null or (area_sqm > 0 and area_sqm <= 1000000)),
  land_category text check (land_category is null or land_category in ('residential', 'farmland', 'forest', 'miscellaneous', 'other', 'unknown')),
  road_access text check (road_access is null or road_access in ('wide', 'narrow', 'none', 'unknown')),
  electricity text check (electricity is null or electricity in ('available', 'unavailable', 'unknown')),
  water text check (water is null or water in ('available', 'unavailable', 'unknown')),
  drainage text check (drainage is null or drainage in ('available', 'unavailable', 'unknown')),
  -- 土地なし・未定
  desired_area text check (desired_area is null or length(desired_area) <= 200),
  intended_use text check (intended_use is null or intended_use in ('residence', 'villa', 'office', 'lodging', 'store', 'warehouse', 'other')),
  land_budget text check (land_budget is null or land_budget in ('under_3m', '3m_5m', '5m_10m', '10m_20m', 'over_20m', 'undecided')),
  note text check (note is null or length(note) <= 1000),
  lock_version integer not null default 1 check (lock_version >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 土地の有無に合わない項目は持たない
  constraint configuration_site_profiles_branch check (
    (land_status = 'owned' and desired_area is null and intended_use is null and land_budget is null)
    or (land_status <> 'owned' and site_address is null and area_sqm is null and land_category is null and road_access is null
        and electricity is null and water is null and drainage is null)
  )
);

comment on table public.configuration_site_profiles is
  '保存したプランごとの設置予定地・土地の情報（フェーズ3）。お客様の申告。読めるのは本人・本部・案件の担当代理店と製造の担当、書けるのは本人と本部。';

create trigger trg_configuration_site_profiles_updated before update on public.configuration_site_profiles
  for each row execute function public.set_updated_at();

-- プランの土地の情報への関わり方：owner（お客様本人）／admin（本部）／staff（そのプランの案件の担当代理店・製造の担当）
create function public.configuration_site_profile_access(p_configuration_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when auth.uid() is null then null
           when exists (select 1 from public.configurations c where c.id = p_configuration_id and c.user_id = auth.uid()) then 'owner'
           when coalesce(public.current_role_rank(), 0) >= 3 then 'admin'
           when exists (
             select 1 from public.quote_requests r
              where r.configuration_id = p_configuration_id
                and public.case_access(r.id) in ('staff', 'manufacturer')
           ) then 'staff'
           else null
         end;
$$;

alter table public.configuration_site_profiles enable row level security;
create policy configuration_site_profiles_read on public.configuration_site_profiles for select to authenticated
  using (public.configuration_site_profile_access(configuration_id) is not null);
revoke all on public.configuration_site_profiles from public, anon, authenticated;
grant select on public.configuration_site_profiles to authenticated;

create function public.save_configuration_site_profile(p_configuration_id uuid, p_profile jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.configuration_site_profiles;
  v_status text;
  v_owned boolean;
  v_area_text text;
  v_area numeric;
  v_category text;
  v_road text;
  v_electricity text;
  v_water text;
  v_drainage text;
  v_use text;
  v_budget text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.configuration_site_profile_access(p_configuration_id);
  if v_access is null or v_access not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: 土地の情報を変更できるのは、お客様ご本人と本部だけです' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_status := public.cf_text(p_profile, 'land_status', 20, '土地の有無');
  if v_status is null or v_status not in ('owned', 'none', 'undecided') then
    raise exception 'VALIDATION: 土地の有無を選んでください' using errcode = 'P0001';
  end if;
  v_owned := v_status = 'owned';

  if v_owned then
    -- 数字かどうかを先に確かめてから数値にする（条件の評価順は決まっていないため、1 つの式にまとめない）
    v_area_text := public.cf_text(p_profile, 'area_sqm', 20, '敷地面積');
    if v_area_text is not null then
      if v_area_text !~ '^\d{1,7}(\.\d{1,2})?$' then
        raise exception 'VALIDATION: 敷地面積は数字（㎡・小数は 2 桁まで）で入力してください' using errcode = 'P0001';
      end if;
      v_area := v_area_text::numeric;
      if v_area <= 0 or v_area > 1000000 then
        raise exception 'VALIDATION: 敷地面積を正しく入力してください' using errcode = 'P0001';
      end if;
    end if;
    v_category := public.cf_text(p_profile, 'land_category', 20, '地目');
    v_road := public.cf_text(p_profile, 'road_access', 20, '前面道路');
    v_electricity := public.cf_text(p_profile, 'electricity', 20, '電気');
    v_water := public.cf_text(p_profile, 'water', 20, '上水道');
    v_drainage := public.cf_text(p_profile, 'drainage', 20, '排水');
    if (v_category is not null and v_category not in ('residential', 'farmland', 'forest', 'miscellaneous', 'other', 'unknown'))
       or (v_road is not null and v_road not in ('wide', 'narrow', 'none', 'unknown'))
       or (v_electricity is not null and v_electricity not in ('available', 'unavailable', 'unknown'))
       or (v_water is not null and v_water not in ('available', 'unavailable', 'unknown'))
       or (v_drainage is not null and v_drainage not in ('available', 'unavailable', 'unknown')) then
      raise exception 'VALIDATION: 選んだ項目が正しくありません' using errcode = 'P0001';
    end if;
  else
    v_use := public.cf_text(p_profile, 'intended_use', 20, '希望用途');
    v_budget := public.cf_text(p_profile, 'land_budget', 20, '土地のご予算');
    if (v_use is not null and v_use not in ('residence', 'villa', 'office', 'lodging', 'store', 'warehouse', 'other'))
       or (v_budget is not null and v_budget not in ('under_3m', '3m_5m', '5m_10m', '10m_20m', 'over_20m', 'undecided')) then
      raise exception 'VALIDATION: 選んだ項目が正しくありません' using errcode = 'P0001';
    end if;
  end if;

  -- 初めての保存が同時に来たときも順番に処理する（プランの行で待ち合わせる）
  perform 1 from public.configurations c where c.id = p_configuration_id for no key update;
  select * into v_row from public.configuration_site_profiles where configuration_id = p_configuration_id for update;
  if not found then
    if p_expected_lock_version is not null then
      raise exception 'LOCKED: 他の画面で土地の情報が更新されています。再読み込みしてください' using errcode = 'P0001';
    end if;
  elsif v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で土地の情報が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;

  insert into public.configuration_site_profiles as p (
    configuration_id, land_status, site_address, area_sqm, land_category, road_access, electricity, water, drainage,
    desired_area, intended_use, land_budget, note, updated_by
  ) values (
    p_configuration_id, v_status,
    case when v_owned then public.cf_text(p_profile, 'site_address', 200, '設置予定地') end,
    v_area, v_category, v_road, v_electricity, v_water, v_drainage,
    case when not v_owned then public.cf_text(p_profile, 'desired_area', 200, '希望地域') end,
    v_use, v_budget,
    public.cf_text(p_profile, 'note', 1000, '土地についてのメモ'),
    v_uid
  )
  on conflict (configuration_id) do update
    set land_status = excluded.land_status,
        site_address = excluded.site_address,
        area_sqm = excluded.area_sqm,
        land_category = excluded.land_category,
        road_access = excluded.road_access,
        electricity = excluded.electricity,
        water = excluded.water,
        drainage = excluded.drainage,
        desired_area = excluded.desired_area,
        intended_use = excluded.intended_use,
        land_budget = excluded.land_budget,
        note = excluded.note,
        updated_by = excluded.updated_by,
        lock_version = p.lock_version + 1;
  return coalesce(v_row.lock_version, 0) + 1;
end;
$$;

-- ---------- owner / EXECUTE ----------

do $acl$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.cf_uuid_array_valid(jsonb, integer)'::regprocedure,
    'public.create_guest_plan(text, uuid, jsonb)'::regprocedure,
    'public.get_guest_plan(text)'::regprocedure,
    'public.configuration_site_profile_access(uuid)'::regprocedure,
    'public.save_configuration_site_profile(uuid, jsonb, integer)'::regprocedure
  ]
  loop
    execute format('alter function %s owner to postgres', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  -- 一時保存はサーバー（service_role）だけ。土地の情報はログインした利用者（判定は関数の中）
  grant execute on function public.create_guest_plan(text, uuid, jsonb) to service_role;
  grant execute on function public.get_guest_plan(text) to service_role;
  grant execute on function public.configuration_site_profile_access(uuid) to authenticated;
  grant execute on function public.save_configuration_site_profile(uuid, jsonb, integer) to authenticated;
end;
$acl$;

-- ---------- postconditions ----------

do $postcondition$
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.guest_plans'::regclass)
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.configuration_site_profiles'::regclass) then
    raise exception 'POSTCONDITION: RLS must be enabled';
  end if;
  if has_table_privilege('anon', 'public.guest_plans', 'SELECT') or has_table_privilege('authenticated', 'public.guest_plans', 'SELECT')
     or has_table_privilege('anon', 'public.guest_plans', 'INSERT') or has_table_privilege('authenticated', 'public.guest_plans', 'INSERT') then
    raise exception 'POSTCONDITION: guest_plans must be closed to anon / authenticated';
  end if;
  if has_table_privilege('anon', 'public.configuration_site_profiles', 'SELECT')
     or has_table_privilege('authenticated', 'public.configuration_site_profiles', 'INSERT')
     or has_table_privilege('authenticated', 'public.configuration_site_profiles', 'UPDATE')
     or has_table_privilege('authenticated', 'public.configuration_site_profiles', 'DELETE') then
    raise exception 'POSTCONDITION: configuration_site_profiles must be read-only for authenticated and closed for anon';
  end if;
  if has_function_privilege('anon', 'public.create_guest_plan(text, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_guest_plan(text, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_guest_plan(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_guest_plan(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.create_guest_plan(text, uuid, jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_guest_plan(text)', 'EXECUTE') then
    raise exception 'POSTCONDITION: guest plan RPCs must be executable by service_role only';
  end if;
  if has_function_privilege('anon', 'public.save_configuration_site_profile(uuid, jsonb, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.configuration_site_profile_access(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cf_uuid_array_valid(jsonb, integer)', 'EXECUTE') then
    raise exception 'POSTCONDITION: site profile functions must not be executable by anon, helpers must stay internal';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_guest_plan', 'get_guest_plan', 'configuration_site_profile_access', 'save_configuration_site_profile')
       and (not p.prosecdef or pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' or not (p.proconfig @> array['search_path=""']))
  ) then
    raise exception 'POSTCONDITION: RPCs must be SECURITY DEFINER with an empty search_path, owned by postgres';
  end if;
end;
$postcondition$;

commit;
