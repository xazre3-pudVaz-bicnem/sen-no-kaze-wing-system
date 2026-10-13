-- 案件の進行（フローチャート第4版 フェーズ4〜7）：代理店の公開情報・見積依頼の希望・受付と担当・打合せの日程・現地確認・案件の資料。
--
-- 案件は見積依頼（quote_requests）の単位。案件への関わり方は case_access() で 1 か所にまとめて判定する。
--   admin        本部（すべての案件）
--   staff        担当代理店（案件の現在の見積の dealer_id。総代理店が担当代理店のときも staff）
--   manufacturer 技術検討・製造の担当（本部が案件ごとに指定する総代理店）
--   customer     お客様（見積依頼の本人）
-- 読み取りは RLS（case_access）で、書き込みは SECURITY DEFINER の RPC だけ。権限は状態の判定より前に確認する。
-- お客様に見せない情報（現地確認・社内のメモ・技術検討・担当の設定）は、お客様からは読めない表に置く。
-- 写真・書類は非公開バケット case-files（ポリシーなし＝サーバー側の service role のみ）に置き、
-- 見てよいかは case_files の行（RLS）で判定してからサーバーが取り出す。
--
-- 番号の採番（案件番号）・代理店の回答期限は先方の確認待ちのため、この migration では扱わない。
-- 既存の見積・見積依頼・電子契約の表と関数は変更しない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regclass('public.quote_requests') is null or to_regclass('public.quotes') is null then
    raise exception 'PRECONDITION: quote tables are missing; review migration order';
  end if;
  if to_regprocedure('public.notify(uuid, text, text, text, text, text)') is null
     or to_regprocedure('public.current_role_rank()') is null then
    raise exception 'PRECONDITION: notify / current_role_rank are missing; review migration order';
  end if;
  if to_regclass('public.case_workflows') is not null or to_regclass('public.dealer_profiles') is not null then
    raise exception 'PRECONDITION: case flow tables already exist; review before applying';
  end if;
end;
$preflight$;

-- ---------- 代理店の公開情報（フェーズ4） ----------

create table public.dealer_profiles (
  dealer_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> '' and length(display_name) <= 100),
  intro text check (intro is null or length(intro) <= 2000),
  service_prefectures text[] not null default '{}' check (cardinality(service_prefectures) <= 47),
  service_municipalities text[] not null default '{}' check (cardinality(service_municipalities) <= 200),
  services text[] not null default '{}' check (cardinality(services) <= 20),
  qualifications text check (qualifications is null or length(qualifications) <= 1000),
  track_record text check (track_record is null or length(track_record) <= 2000),
  completed_count integer check (completed_count is null or completed_count between 0 and 100000),
  phone text check (phone is null or length(phone) <= 30),
  website_url text check (website_url is null or (length(website_url) <= 300 and website_url ~ '^https://')),
  published boolean not null default false,
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  lock_version integer not null default 1 check (lock_version >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dealer_profiles is
  '代理店の公開情報（対応エリア・施工対応・資格・実績）。公開（published）は本部が決める。お客様の代理店検索に使う。';

create trigger trg_dealer_profiles_updated before update on public.dealer_profiles
  for each row execute function public.set_updated_at();

-- ---------- 見積依頼のときのお客様の希望（フェーズ5） ----------

create table public.quote_request_preferences (
  quote_request_id uuid primary key references public.quote_requests(id) on delete cascade,
  preferred_dealer_id uuid references public.profiles(id) on delete set null,
  meeting_method text check (meeting_method in ('onsite', 'online', 'visit', 'phone')),
  preferred_slots jsonb not null default '[]'::jsonb
    check (jsonb_typeof(preferred_slots) = 'array' and jsonb_array_length(preferred_slots) <= 3),
  note text check (note is null or length(note) <= 1000),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quote_request_preferences is
  '見積依頼のときのお客様の希望（相談したい代理店・打合せの方法・希望日）。代理店の割り当ては本部が行う。';

create trigger trg_quote_request_preferences_updated before update on public.quote_request_preferences
  for each row execute function public.set_updated_at();

-- ---------- 案件の受付・担当（フェーズ5〜6） ----------

create table public.case_workflows (
  quote_request_id uuid primary key references public.quote_requests(id) on delete cascade,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  primary_staff_id uuid references public.profiles(id) on delete set null,
  primary_assigned_at timestamptz,
  primary_assigned_by uuid references public.profiles(id) on delete set null,
  manufacturer_id uuid references public.profiles(id) on delete set null,
  manufacturer_assigned_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_workflows_ack_fields check ((acknowledged_at is null) = (acknowledged_by is null))
);

comment on table public.case_workflows is
  '案件の受付（受付日時）・主担当者・技術検討と製造の担当（総代理店）。お客様からは読めない（進み具合は専用の関数で返す）。';

create trigger trg_case_workflows_updated before update on public.case_workflows
  for each row execute function public.set_updated_at();

-- ---------- 案件への関わり方の判定 ----------

create function public.case_access(p_request_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer := coalesce(public.current_role_rank(), 0);
begin
  if v_uid is null or p_request_id is null then
    return null;
  end if;
  if v_rank >= 3 then
    return 'admin';
  end if;
  if v_rank >= 1 and exists (
    select 1
      from public.quote_requests r
      join public.quotes q on q.id = r.quote_id
     where r.id = p_request_id
       and q.dealer_id = v_uid
  ) then
    return 'staff';
  end if;
  if v_rank >= 2 and exists (
    select 1 from public.case_workflows w where w.quote_request_id = p_request_id and w.manufacturer_id = v_uid
  ) then
    return 'manufacturer';
  end if;
  if exists (select 1 from public.quote_requests r where r.id = p_request_id and r.user_id = v_uid) then
    return 'customer';
  end if;
  return null;
end;
$$;

comment on function public.case_access(uuid) is
  '案件（見積依頼）への関わり方：admin／staff（担当代理店）／manufacturer（技術検討・製造の担当）／customer（お客様）／NULL。';

-- ---------- 打合せ・現地調査などの日程（フェーズ6・予約ボード） ----------

create table public.case_appointments (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  purpose text not null check (purpose in ('meeting', 'site_survey', 'handover', 'inspection', 'other')),
  method text not null check (method in ('onsite', 'online', 'visit', 'phone')),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'done', 'canceled')),
  candidates jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) between 1 and 5),
  confirmed_starts_at timestamptz,
  confirmed_ends_at timestamptz,
  location text check (location is null or length(location) <= 200),
  note text check (note is null or length(note) <= 1000),
  customer_note text check (customer_note is null or length(customer_note) <= 1000),
  proposed_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  lock_version integer not null default 1 check (lock_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_appointments_confirmed_fields check (
    status not in ('confirmed', 'done') or confirmed_starts_at is not null
  ),
  constraint case_appointments_range check (confirmed_ends_at is null or confirmed_ends_at > confirmed_starts_at)
);

comment on table public.case_appointments is
  '案件の日程（打合せ・現地調査・引渡し・点検）。担当が候補を送り、お客様が選ぶか、担当が確定する。社内のメモは置かない。';

create index case_appointments_request_idx on public.case_appointments (quote_request_id, created_at desc);
create index case_appointments_confirmed_idx on public.case_appointments (confirmed_starts_at) where status = 'confirmed';

create trigger trg_case_appointments_updated before update on public.case_appointments
  for each row execute function public.set_updated_at();

-- ---------- 現地確認（フェーズ7） ----------

create table public.site_surveys (
  quote_request_id uuid primary key references public.quote_requests(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  surveyed_on date,
  surveyor_name text check (surveyor_name is null or length(surveyor_name) <= 100),
  land jsonb not null default '{}'::jsonb check (jsonb_typeof(land) = 'object'),
  legal jsonb not null default '{}'::jsonb check (jsonb_typeof(legal) = 'object'),
  survey_notes text check (survey_notes is null or length(survey_notes) <= 4000),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  lock_version integer not null default 1 check (lock_version >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_surveys_completed_fields check (status <> 'completed' or (completed_at is not null and surveyed_on is not null))
);

comment on table public.site_surveys is
  '現地確認の記録（土地・搬入・インフラ・法規・行政の確認と測量のメモ）。お客様からは読めない。';

create trigger trg_site_surveys_updated before update on public.site_surveys
  for each row execute function public.set_updated_at();

-- ---------- 打合せ記録・本部への相談・技術検討（フェーズ7） ----------

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  kind text not null check (kind in ('meeting', 'consult', 'consult_reply', 'tech_review', 'other')),
  body text not null check (btrim(body) <> '' and length(body) <= 4000),
  verdict text check (verdict in ('feasible', 'conditional', 'infeasible')),
  estimated_cost integer check (estimated_cost is null or estimated_cost between 0 and 1000000000),
  parent_id uuid references public.case_notes(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  -- 書いた時点の名前（代理店は他の人のプロフィールを読めないため、記録に残す）
  author_name text not null check (length(author_name) <= 100),
  created_at timestamptz not null default now(),
  constraint case_notes_tech_review check ((kind = 'tech_review') = (verdict is not null)),
  constraint case_notes_cost_only_review check (kind = 'tech_review' or estimated_cost is null),
  constraint case_notes_reply_parent check ((kind = 'consult_reply') = (parent_id is not null))
);

comment on table public.case_notes is
  '案件の社内の記録（打合せ記録・本部への相談と回答・総代理店の技術検討）。追記だけで、書き換えない。お客様からは読めない。';

create index case_notes_request_idx on public.case_notes (quote_request_id, created_at);

-- ---------- 案件の写真・書類 ----------

create table public.case_files (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  context text not null check (context in ('site_survey', 'progress', 'handover', 'punch', 'after_service', 'contract', 'document')),
  context_id uuid,
  storage_path text not null unique check (storage_path ~ '^cases/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  file_name text not null check (btrim(file_name) <> '' and length(file_name) <= 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  caption text check (caption is null or length(caption) <= 200),
  customer_visible boolean not null default false,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.case_files is
  '案件の写真・書類。実体は非公開バケット case-files。お客様に見せるのは customer_visible の行だけ。';

create index case_files_request_idx on public.case_files (quote_request_id, context, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-files', 'case-files', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
-- case-files はポリシーなし（= anon / authenticated からは直接触れない。service role のみ）

-- ---------- RLS / ACL ----------

alter table public.dealer_profiles enable row level security;
alter table public.quote_request_preferences enable row level security;
alter table public.case_workflows enable row level security;
alter table public.case_appointments enable row level security;
alter table public.site_surveys enable row level security;
alter table public.case_notes enable row level security;
alter table public.case_files enable row level security;

create policy dealer_profiles_public_read on public.dealer_profiles for select to anon, authenticated
  using (published);
create policy dealer_profiles_own_read on public.dealer_profiles for select to authenticated
  using (dealer_id = auth.uid() or public.current_role_rank() >= 3);
create policy quote_request_preferences_read on public.quote_request_preferences for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'customer'));
create policy case_workflows_read on public.case_workflows for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer'));
create policy case_appointments_read on public.case_appointments for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'customer'));
create policy site_surveys_read on public.site_surveys for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer'));
create policy case_notes_read on public.case_notes for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer'));
create policy case_files_read on public.case_files for select to authenticated
  using (
    public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer')
    or (customer_visible and public.case_access(quote_request_id) = 'customer')
  );

revoke all on public.dealer_profiles from public, anon, authenticated;
revoke all on public.quote_request_preferences from public, anon, authenticated;
revoke all on public.case_workflows from public, anon, authenticated;
revoke all on public.case_appointments from public, anon, authenticated;
revoke all on public.site_surveys from public, anon, authenticated;
revoke all on public.case_notes from public, anon, authenticated;
revoke all on public.case_files from public, anon, authenticated;

grant select on public.dealer_profiles to anon, authenticated;
grant select on public.quote_request_preferences to authenticated;
grant select on public.case_workflows to authenticated;
grant select on public.case_appointments to authenticated;
grant select on public.site_surveys to authenticated;
grant select on public.case_notes to authenticated;
grant select on public.case_files to authenticated;

-- ---------- 内部の関数：入力の取り出し ----------

-- jsonb の文字列を取り出して前後の空白を除く。空なら NULL。長すぎれば VALIDATION
create function public.cf_text(p_obj jsonb, p_key text, p_max integer, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw jsonb := p_obj -> p_key;
  v_text text;
begin
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_raw) not in ('string', 'number') then
    raise exception 'VALIDATION: %の形式が正しくありません', p_label using errcode = 'P0001';
  end if;
  v_text := btrim(p_obj ->> p_key);
  if v_text = '' then
    return null;
  end if;
  if length(v_text) > p_max then
    raise exception 'VALIDATION: %は%文字以内で入力してください', p_label, p_max using errcode = 'P0001';
  end if;
  return v_text;
end;
$$;

-- jsonb の文字列の配列を取り出す（空白を除き、重複を除く）。要素が長すぎる・多すぎる場合は VALIDATION
create function public.cf_text_array(p_obj jsonb, p_key text, p_max_items integer, p_max_len integer, p_label text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw jsonb := p_obj -> p_key;
  v_out text[] := '{}';
  v_item text;
  e jsonb;
begin
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(v_raw) <> 'array' then
    raise exception 'VALIDATION: %の形式が正しくありません', p_label using errcode = 'P0001';
  end if;
  for e in select value from jsonb_array_elements(v_raw)
  loop
    if jsonb_typeof(e) <> 'string' then
      raise exception 'VALIDATION: %の形式が正しくありません', p_label using errcode = 'P0001';
    end if;
    v_item := btrim(e #>> '{}');
    if v_item = '' then
      continue;
    end if;
    if length(v_item) > p_max_len then
      raise exception 'VALIDATION: %の項目は%文字以内にしてください', p_label, p_max_len using errcode = 'P0001';
    end if;
    if not (v_item = any (v_out)) then
      v_out := v_out || v_item;
    end if;
  end loop;
  if cardinality(v_out) > p_max_items then
    raise exception 'VALIDATION: %は%件までです', p_label, p_max_items using errcode = 'P0001';
  end if;
  return v_out;
end;
$$;

-- ---------- RPC：代理店の公開情報 ----------

-- 本部はどの代理店の情報も編集できる。代理店・総代理店は自分の情報だけ。公開・非公開は本部だけが決める
create function public.save_dealer_profile(p_dealer_id uuid, p_profile jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer := coalesce(public.current_role_rank(), 0);
  v_target_role text;
  v_row public.dealer_profiles;
  v_name text;
  v_services text[];
  v_count integer;
  v_url text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not (v_rank >= 3 or (v_rank between 1 and 2 and p_dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: 代理店の情報を編集できるのは本部と、その代理店だけです' using errcode = '42501';
  end if;
  select p.role_code into v_target_role from public.profiles p where p.id = p_dealer_id;
  if v_target_role is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_target_role not in ('dealer', 'master_dealer') then
    raise exception 'VALIDATION: 代理店・総代理店のアカウントだけ公開情報を登録できます' using errcode = 'P0001';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;

  v_name := public.cf_text(p_profile, 'display_name', 100, '表示名');
  if v_name is null then
    raise exception 'VALIDATION: 表示名を入力してください' using errcode = 'P0001';
  end if;
  v_services := public.cf_text_array(p_profile, 'services', 20, 40, '施工対応');
  if exists (
    select 1 from unnest(v_services) s
     where s not in ('transport', 'foundation', 'installation', 'electrical', 'plumbing', 'exterior', 'permit', 'maintenance')
  ) then
    raise exception 'VALIDATION: 施工対応の項目が正しくありません' using errcode = 'P0001';
  end if;
  if p_profile ? 'completed_count' and jsonb_typeof(p_profile -> 'completed_count') <> 'null' then
    if jsonb_typeof(p_profile -> 'completed_count') <> 'number'
       or (p_profile ->> 'completed_count') !~ '^\d{1,6}$' then
      raise exception 'VALIDATION: 施工実績の件数は 0 以上の整数で入力してください' using errcode = 'P0001';
    end if;
    v_count := (p_profile ->> 'completed_count')::integer;
  end if;
  v_url := public.cf_text(p_profile, 'website_url', 300, 'Web サイト');
  if v_url is not null and v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'VALIDATION: Web サイトは https:// から始まる URL で入力してください' using errcode = 'P0001';
  end if;

  select * into v_row from public.dealer_profiles where dealer_id = p_dealer_id for update;
  if not found then
    if p_expected_lock_version is not null then
      raise exception 'LOCKED: 他の画面でこの代理店の情報が更新されています。再読み込みしてください' using errcode = 'P0001';
    end if;
    insert into public.dealer_profiles (
      dealer_id, display_name, intro, service_prefectures, service_municipalities, services,
      qualifications, track_record, completed_count, phone, website_url, updated_by
    ) values (
      p_dealer_id, v_name,
      public.cf_text(p_profile, 'intro', 2000, '紹介文'),
      public.cf_text_array(p_profile, 'service_prefectures', 47, 10, '対応エリア（都道府県）'),
      public.cf_text_array(p_profile, 'service_municipalities', 200, 60, '対応エリア（市区町村）'),
      v_services,
      public.cf_text(p_profile, 'qualifications', 1000, '資格'),
      public.cf_text(p_profile, 'track_record', 2000, '施工実績'),
      v_count,
      public.cf_text(p_profile, 'phone', 30, '電話番号'),
      v_url,
      v_uid
    );
    return 1;
  end if;

  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの代理店の情報が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  update public.dealer_profiles
     set display_name = v_name,
         intro = public.cf_text(p_profile, 'intro', 2000, '紹介文'),
         service_prefectures = public.cf_text_array(p_profile, 'service_prefectures', 47, 10, '対応エリア（都道府県）'),
         service_municipalities = public.cf_text_array(p_profile, 'service_municipalities', 200, 60, '対応エリア（市区町村）'),
         services = v_services,
         qualifications = public.cf_text(p_profile, 'qualifications', 1000, '資格'),
         track_record = public.cf_text(p_profile, 'track_record', 2000, '施工実績'),
         completed_count = v_count,
         phone = public.cf_text(p_profile, 'phone', 30, '電話番号'),
         website_url = v_url,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where dealer_id = p_dealer_id;
  return v_row.lock_version + 1;
end;
$$;

create function public.set_dealer_profile_published(p_dealer_id uuid, p_published boolean, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.dealer_profiles;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 代理店の情報を公開できるのは本部だけです' using errcode = '42501';
  end if;
  if p_published is null then
    raise exception 'VALIDATION: 公開・非公開の指定がありません' using errcode = 'P0001';
  end if;
  select * into v_row from public.dealer_profiles where dealer_id = p_dealer_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの代理店の情報が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  update public.dealer_profiles
     set published = p_published,
         published_at = case when p_published then now() else null end,
         published_by = case when p_published then v_uid else null end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where dealer_id = p_dealer_id;
  perform public.notify(p_dealer_id, 'dealer', 'dealer_profile_published',
    case when p_published then '代理店の紹介ページが公開されました' else '代理店の紹介ページを非公開にしました' end,
    case when p_published then 'お客様の代理店検索に表示されます。' else 'お客様の代理店検索には表示されません。' end,
    '/admin/dealers/' || p_dealer_id::text);
  return v_row.lock_version + 1;
end;
$$;

-- ---------- RPC：見積依頼のときのお客様の希望 ----------

create function public.set_quote_request_preferences(p_request_id uuid, p_preferences jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_before uuid;
  v_dealer uuid;
  v_method text;
  v_slots jsonb := '[]'::jsonb;
  e jsonb;
  v_date date;
  v_period text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('customer', 'admin') then
    raise exception 'FORBIDDEN: ご依頼の希望を変更できるのは、ご依頼のお客様と本部だけです' using errcode = '42501';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_preferences ->> 'preferred_dealer_id', '')), '') is not null then
    begin
      v_dealer := (p_preferences ->> 'preferred_dealer_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: 相談したい代理店の指定が正しくありません' using errcode = 'P0001';
    end;
    if not exists (select 1 from public.dealer_profiles d where d.dealer_id = v_dealer and d.published) then
      raise exception 'VALIDATION: 指定した代理店は選べません' using errcode = 'P0001';
    end if;
  end if;
  v_method := public.cf_text(p_preferences, 'meeting_method', 20, '打合せの方法');
  if v_method is not null and v_method not in ('onsite', 'online', 'visit', 'phone') then
    raise exception 'VALIDATION: 打合せの方法が正しくありません' using errcode = 'P0001';
  end if;
  if p_preferences ? 'preferred_slots' and jsonb_typeof(p_preferences -> 'preferred_slots') <> 'null' then
    if jsonb_typeof(p_preferences -> 'preferred_slots') <> 'array' or jsonb_array_length(p_preferences -> 'preferred_slots') > 3 then
      raise exception 'VALIDATION: 打合せの希望日は 3 つまでです' using errcode = 'P0001';
    end if;
    for e in select value from jsonb_array_elements(p_preferences -> 'preferred_slots')
    loop
      begin
        v_date := (e ->> 'date')::date;
      exception when others then
        raise exception 'VALIDATION: 打合せの希望日の形式が正しくありません' using errcode = 'P0001';
      end;
      v_period := coalesce(nullif(e ->> 'period', ''), 'any');
      if v_date is null or v_date < current_date or v_date > current_date + 365 then
        raise exception 'VALIDATION: 打合せの希望日は今日から 1 年以内の日付にしてください' using errcode = 'P0001';
      end if;
      if v_period not in ('am', 'pm', 'evening', 'any') then
        raise exception 'VALIDATION: 打合せの希望の時間帯が正しくありません' using errcode = 'P0001';
      end if;
      v_slots := v_slots || jsonb_build_array(jsonb_build_object('date', v_date::text, 'period', v_period));
    end loop;
  end if;

  select preferred_dealer_id into v_before from public.quote_request_preferences where quote_request_id = p_request_id for update;
  insert into public.quote_request_preferences (quote_request_id, preferred_dealer_id, meeting_method, preferred_slots, note, updated_by)
  values (p_request_id, v_dealer, v_method, v_slots, public.cf_text(p_preferences, 'note', 1000, '日程のご要望'), v_uid)
  on conflict (quote_request_id) do update
    set preferred_dealer_id = excluded.preferred_dealer_id,
        meeting_method = excluded.meeting_method,
        preferred_slots = excluded.preferred_slots,
        note = excluded.note,
        updated_by = excluded.updated_by;

  if v_dealer is not null and v_dealer is distinct from v_before then
    perform public.notify(null, 'admin', 'case_preferred_dealer', 'お客様が相談したい代理店を指定しました',
      '案件の「受付・担当」で、担当代理店を割り当ててください。', '/admin/quotes?request=' || p_request_id::text);
  end if;
end;
$$;

-- ---------- RPC：案件の受付・担当 ----------

create function public.acknowledge_case(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_customer uuid;
  v_quote uuid;
  v_done boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 受付できるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  select r.user_id, r.quote_id into v_customer, v_quote from public.quote_requests r where r.id = p_request_id;

  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  select w.acknowledged_at is not null into v_done from public.case_workflows w where w.quote_request_id = p_request_id for update;
  if v_done then
    return;
  end if;
  update public.case_workflows
     set acknowledged_at = now(), acknowledged_by = v_uid, updated_by = v_uid
   where quote_request_id = p_request_id;
  if v_customer is not null then
    perform public.notify(v_customer, 'customer', 'case_acknowledged', 'ご依頼を受け付けました',
      '担当より、打合せの日程などのご連絡をいたします。進み具合はマイページで確認できます。',
      '/mypage/cases/' || p_request_id::text);
  end if;
end;
$$;

create function public.assign_case_primary_staff(p_request_id uuid, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_dealer uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 主担当者を決められるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  select q.dealer_id into v_dealer
    from public.quote_requests r join public.quotes q on q.id = r.quote_id where r.id = p_request_id;
  if p_staff_id is not null then
    select p.role_code into v_role from public.profiles p where p.id = p_staff_id;
    -- 主担当者は本部の担当者か、この案件の担当代理店（担当でない人へ案件の閲覧を広げない）
    if v_role is null or not (v_role = 'admin' or p_staff_id = v_dealer) then
      raise exception 'VALIDATION: 主担当者は本部の担当者か、この案件の担当代理店から選んでください' using errcode = 'P0001';
    end if;
  end if;
  if v_access = 'staff' and p_staff_id is distinct from v_uid then
    raise exception 'FORBIDDEN: 担当代理店は自分を主担当者にすることだけできます' using errcode = '42501';
  end if;

  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  perform 1 from public.case_workflows w where w.quote_request_id = p_request_id for update;
  update public.case_workflows
     set primary_staff_id = p_staff_id,
         primary_assigned_at = case when p_staff_id is null then null else now() end,
         primary_assigned_by = case when p_staff_id is null then null else v_uid end,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  if p_staff_id is not null and p_staff_id <> v_uid then
    perform public.notify(p_staff_id, case when v_role = 'admin' then 'admin' else 'dealer' end, 'case_primary_assigned',
      '案件の主担当者になりました', 'お客様への連絡と日程の調整をお願いします。', '/admin/quotes?request=' || p_request_id::text);
  end if;
end;
$$;

create function public.set_case_manufacturer(p_request_id uuid, p_manufacturer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 技術検討・製造の担当を決められるのは本部だけです' using errcode = '42501';
  end if;
  if not exists (select 1 from public.quote_requests r where r.id = p_request_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_manufacturer_id is not null then
    select p.role_code into v_role from public.profiles p where p.id = p_manufacturer_id;
    if v_role is null or v_role <> 'master_dealer' then
      raise exception 'VALIDATION: 技術検討・製造の担当は総代理店から選んでください' using errcode = 'P0001';
    end if;
  end if;
  insert into public.case_workflows (quote_request_id, updated_by) values (p_request_id, v_uid)
  on conflict (quote_request_id) do nothing;
  perform 1 from public.case_workflows w where w.quote_request_id = p_request_id for update;
  update public.case_workflows
     set manufacturer_id = p_manufacturer_id,
         manufacturer_assigned_at = case when p_manufacturer_id is null then null else now() end,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  if p_manufacturer_id is not null then
    perform public.notify(p_manufacturer_id, 'dealer', 'case_manufacturer_assigned',
      '技術検討・製造の担当に指定されました', '案件の仕様と現地確認の内容を確認し、技術検討を記録してください。',
      '/admin/manufacturing?request=' || p_request_id::text);
  end if;
end;
$$;

-- ---------- RPC：日程（予約ボード） ----------

create function public.propose_case_appointment(p_request_id uuid, p_appointment jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_purpose text;
  v_method text;
  v_candidates jsonb := '[]'::jsonb;
  v_confirm boolean;
  v_starts timestamptz;
  v_ends timestamptz;
  v_customer uuid;
  v_id uuid;
  e jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 日程を送れるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_appointment is null or jsonb_typeof(p_appointment) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_purpose := coalesce(public.cf_text(p_appointment, 'purpose', 20, '日程の種類'), 'meeting');
  v_method := coalesce(public.cf_text(p_appointment, 'method', 20, '打合せの方法'), 'onsite');
  if v_purpose not in ('meeting', 'site_survey', 'handover', 'inspection', 'other') then
    raise exception 'VALIDATION: 日程の種類が正しくありません' using errcode = 'P0001';
  end if;
  if v_method not in ('onsite', 'online', 'visit', 'phone') then
    raise exception 'VALIDATION: 打合せの方法が正しくありません' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_appointment -> 'candidates') is distinct from 'array'
     or jsonb_array_length(p_appointment -> 'candidates') not between 1 and 5 then
    raise exception 'VALIDATION: 候補の日時は 1〜5 つ入力してください' using errcode = 'P0001';
  end if;
  for e in select value from jsonb_array_elements(p_appointment -> 'candidates')
  loop
    begin
      v_starts := (e ->> 'starts_at')::timestamptz;
      v_ends := nullif(e ->> 'ends_at', '')::timestamptz;
    exception when others then
      raise exception 'VALIDATION: 候補の日時の形式が正しくありません' using errcode = 'P0001';
    end;
    if v_starts is null or v_starts < now() - interval '1 day' or v_starts > now() + interval '2 years' then
      raise exception 'VALIDATION: 候補の日時は今日以降の日時にしてください' using errcode = 'P0001';
    end if;
    if v_ends is not null and v_ends <= v_starts then
      raise exception 'VALIDATION: 終了の時刻は開始より後にしてください' using errcode = 'P0001';
    end if;
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object('starts_at', v_starts, 'ends_at', v_ends));
  end loop;
  v_confirm := coalesce((p_appointment -> 'confirm') = 'true'::jsonb, false);
  if v_confirm and jsonb_array_length(v_candidates) <> 1 then
    raise exception 'VALIDATION: 日時を確定するときは、候補を 1 つにしてください' using errcode = 'P0001';
  end if;

  insert into public.case_appointments (
    quote_request_id, purpose, method, status, candidates, confirmed_starts_at, confirmed_ends_at,
    location, note, proposed_by, confirmed_by
  ) values (
    p_request_id, v_purpose, v_method,
    case when v_confirm then 'confirmed' else 'proposed' end,
    v_candidates,
    case when v_confirm then (v_candidates -> 0 ->> 'starts_at')::timestamptz end,
    case when v_confirm then nullif(v_candidates -> 0 ->> 'ends_at', '')::timestamptz end,
    public.cf_text(p_appointment, 'location', 200, '場所'),
    public.cf_text(p_appointment, 'note', 1000, 'お客様へのご案内'),
    v_uid,
    case when v_confirm then v_uid end
  )
  returning id into v_id;

  select r.user_id into v_customer from public.quote_requests r where r.id = p_request_id;
  if v_customer is not null then
    perform public.notify(v_customer, 'customer', 'case_appointment_' || case when v_confirm then 'confirmed' else 'proposed' end,
      case when v_confirm then '打合せなどの日時が決まりました' else '打合せなどの候補日をお送りしました' end,
      case when v_confirm then 'マイページで日時と場所をご確認ください。' else 'マイページで、ご都合の良い日時を選んでください。' end,
      '/mypage/cases/' || p_request_id::text);
  end if;
  return v_id;
end;
$$;

create function public.confirm_case_appointment(p_appointment_id uuid, p_candidate_index integer, p_expected_lock_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  a public.case_appointments;
  v_customer uuid;
  v_dealer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into a from public.case_appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(a.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff', 'customer') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status <> 'proposed' then
    raise exception 'LOCKED: この日程はすでに決まっているか、取り消されています' using errcode = 'P0001';
  end if;
  if a.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 日程が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if p_candidate_index is null or p_candidate_index < 0 or p_candidate_index >= jsonb_array_length(a.candidates) then
    raise exception 'VALIDATION: 候補の日時を選んでください' using errcode = 'P0001';
  end if;
  update public.case_appointments
     set status = 'confirmed',
         confirmed_starts_at = (a.candidates -> p_candidate_index ->> 'starts_at')::timestamptz,
         confirmed_ends_at = nullif(a.candidates -> p_candidate_index ->> 'ends_at', '')::timestamptz,
         confirmed_by = v_uid,
         lock_version = lock_version + 1
   where id = a.id;

  select r.user_id, q.dealer_id into v_customer, v_dealer
    from public.quote_requests r left join public.quotes q on q.id = r.quote_id
   where r.id = a.quote_request_id;
  if v_access = 'customer' then
    perform public.notify(null, 'admin', 'case_appointment_confirmed', 'お客様が日程を選びました',
      '案件の「現地確認」タブで日時を確認してください。', '/admin/quotes?request=' || a.quote_request_id::text);
    if v_dealer is not null then
      perform public.notify(v_dealer, 'dealer', 'case_appointment_confirmed', 'お客様が日程を選びました',
        '案件の「現地確認」タブで日時を確認してください。', '/admin/quotes?request=' || a.quote_request_id::text);
    end if;
  elsif v_customer is not null then
    perform public.notify(v_customer, 'customer', 'case_appointment_confirmed', '打合せなどの日時が決まりました',
      'マイページで日時と場所をご確認ください。', '/mypage/cases/' || a.quote_request_id::text);
  end if;
end;
$$;

create function public.request_case_appointment_change(p_appointment_id uuid, p_customer_note text, p_expected_lock_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a public.case_appointments;
  v_note text := btrim(coalesce(p_customer_note, ''));
  v_dealer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into a from public.case_appointments where id = p_appointment_id for update;
  if not found or public.case_access(a.quote_request_id) is distinct from 'customer' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status <> 'proposed' then
    raise exception 'LOCKED: この日程はすでに決まっているか、取り消されています' using errcode = 'P0001';
  end if;
  if a.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 日程が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if v_note = '' or length(v_note) > 1000 then
    raise exception 'VALIDATION: ご都合の良い日時やご要望を 1000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  update public.case_appointments set customer_note = v_note, lock_version = lock_version + 1 where id = a.id;
  select q.dealer_id into v_dealer
    from public.quote_requests r left join public.quotes q on q.id = r.quote_id where r.id = a.quote_request_id;
  perform public.notify(null, 'admin', 'case_appointment_change_requested', 'お客様から日程の変更のご要望がありました',
    '候補の日時が合わないとのご連絡です。案件の「現地確認」タブで確認し、新しい候補を送ってください。',
    '/admin/quotes?request=' || a.quote_request_id::text);
  if v_dealer is not null then
    perform public.notify(v_dealer, 'dealer', 'case_appointment_change_requested', 'お客様から日程の変更のご要望がありました',
      '候補の日時が合わないとのご連絡です。新しい候補を送ってください。', '/admin/quotes?request=' || a.quote_request_id::text);
  end if;
end;
$$;

create function public.set_case_appointment_status(p_appointment_id uuid, p_status text, p_expected_lock_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  a public.case_appointments;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into a from public.case_appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(a.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 日程を変更できるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if a.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 日程が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if not ((a.status = 'proposed' and p_status = 'canceled') or (a.status = 'confirmed' and p_status in ('done', 'canceled'))) then
    raise exception 'LOCKED: この日程はその状態に変更できません' using errcode = 'P0001';
  end if;
  update public.case_appointments set status = p_status, lock_version = lock_version + 1 where id = a.id;
  if p_status = 'canceled' then
    select r.user_id into v_customer from public.quote_requests r where r.id = a.quote_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'case_appointment_canceled', '日程を取り消しました',
        '担当より改めてご連絡いたします。', '/mypage/cases/' || a.quote_request_id::text);
    end if;
  end if;
end;
$$;

-- ---------- RPC：現地確認 ----------

create function public.save_site_survey(p_request_id uuid, p_survey jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.site_surveys;
  v_land jsonb := '{}'::jsonb;
  v_legal jsonb := '{}'::jsonb;
  v_date date;
  k text;
  v text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 現地確認を記録できるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_survey is null or jsonb_typeof(p_survey) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_survey ->> 'surveyed_on', '')), '') is not null then
    begin
      v_date := (p_survey ->> 'surveyed_on')::date;
    exception when others then
      raise exception 'VALIDATION: 確認日の形式が正しくありません' using errcode = 'P0001';
    end;
  end if;
  -- 土地・法規は決まった項目だけを、短い文字列で保存する
  foreach k in array array['area_sqm', 'land_category', 'road_access', 'road_width', 'electricity', 'water', 'sewage', 'gas',
                           'delivery_route', 'crane', 'ground', 'slope']
  loop
    v := public.cf_text(coalesce(p_survey -> 'land', '{}'::jsonb), k, 200, '土地・搬入の項目');
    if v is not null then
      v_land := v_land || jsonb_build_object(k, v);
    end if;
  end loop;
  foreach k in array array['city_planning_area', 'zoning', 'fire_zone', 'building_coverage', 'floor_area_ratio',
                           'building_confirmation', 'height_district', 'other_regulations', 'admin_consultation']
  loop
    v := public.cf_text(coalesce(p_survey -> 'legal', '{}'::jsonb), k, 200, '法規・行政の項目');
    if v is not null then
      v_legal := v_legal || jsonb_build_object(k, v);
    end if;
  end loop;

  select * into v_row from public.site_surveys where quote_request_id = p_request_id for update;
  if not found then
    if p_expected_lock_version is not null then
      raise exception 'LOCKED: 他の画面で現地確認が更新されています。再読み込みしてください' using errcode = 'P0001';
    end if;
    insert into public.site_surveys (quote_request_id, surveyed_on, surveyor_name, land, legal, survey_notes, updated_by)
    values (p_request_id, v_date, public.cf_text(p_survey, 'surveyor_name', 100, '確認した人'), v_land, v_legal,
            public.cf_text(p_survey, 'survey_notes', 4000, '測量・確認のメモ'), v_uid);
    return 1;
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で現地確認が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if v_row.status = 'completed' then
    raise exception 'LOCKED: 完了した現地確認は変更できません。変更するときは「記録中に戻す」を押してください' using errcode = 'P0001';
  end if;
  update public.site_surveys
     set surveyed_on = v_date,
         surveyor_name = public.cf_text(p_survey, 'surveyor_name', 100, '確認した人'),
         land = v_land,
         legal = v_legal,
         survey_notes = public.cf_text(p_survey, 'survey_notes', 4000, '測量・確認のメモ'),
         lock_version = lock_version + 1,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  return v_row.lock_version + 1;
end;
$$;

create function public.set_site_survey_status(p_request_id uuid, p_status text, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.site_surveys;
  v_dealer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 現地確認を完了できるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'draft') then
    raise exception 'VALIDATION: 状態の指定が正しくありません' using errcode = 'P0001';
  end if;
  select * into v_row from public.site_surveys where quote_request_id = p_request_id for update;
  if not found then
    raise exception 'VALIDATION: 先に現地確認の内容を保存してください' using errcode = 'P0001';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で現地確認が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if v_row.status = p_status then
    return v_row.lock_version;
  end if;
  if p_status = 'completed' and v_row.surveyed_on is null then
    raise exception 'VALIDATION: 確認日を入力してから完了にしてください' using errcode = 'P0001';
  end if;
  update public.site_surveys
     set status = p_status,
         completed_at = case when p_status = 'completed' then now() else null end,
         completed_by = case when p_status = 'completed' then v_uid else null end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  if p_status = 'completed' then
    perform public.notify(null, 'admin', 'site_survey_completed', '現地確認が完了しました',
      '案件の「現地確認」タブで内容を確認してください。', '/admin/quotes?request=' || p_request_id::text);
  end if;
  return v_row.lock_version + 1;
end;
$$;

-- ---------- RPC：打合せ記録・本部への相談・技術検討 ----------

create function public.add_case_note(p_request_id uuid, p_note jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_kind text;
  v_body text;
  v_verdict text;
  v_cost integer;
  v_parent uuid;
  v_parent_row public.case_notes;
  v_dealer uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access = 'customer' then
    raise exception 'FORBIDDEN: 社内の記録を書けるのは本部・担当代理店・技術検討の担当だけです' using errcode = '42501';
  end if;
  if p_note is null or jsonb_typeof(p_note) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_kind := public.cf_text(p_note, 'kind', 20, '記録の種類');
  v_body := public.cf_text(p_note, 'body', 4000, '内容');
  if v_body is null then
    raise exception 'VALIDATION: 内容を入力してください' using errcode = 'P0001';
  end if;
  if v_kind = 'tech_review' then
    if v_access not in ('admin', 'manufacturer') then
      raise exception 'FORBIDDEN: 技術検討を記録できるのは本部と技術検討の担当（総代理店）だけです' using errcode = '42501';
    end if;
    v_verdict := public.cf_text(p_note, 'verdict', 20, '製造可否');
    if v_verdict is null or v_verdict not in ('feasible', 'conditional', 'infeasible') then
      raise exception 'VALIDATION: 製造可否を選んでください' using errcode = 'P0001';
    end if;
    if p_note ? 'estimated_cost' and jsonb_typeof(p_note -> 'estimated_cost') <> 'null' then
      if jsonb_typeof(p_note -> 'estimated_cost') <> 'number' or (p_note ->> 'estimated_cost') !~ '^\d{1,10}$' then
        raise exception 'VALIDATION: 概算コストは 0 以上の整数（円）で入力してください' using errcode = 'P0001';
      end if;
      v_cost := (p_note ->> 'estimated_cost')::integer;
    end if;
  elsif v_kind = 'consult_reply' then
    if v_access <> 'admin' then
      raise exception 'FORBIDDEN: 相談への回答は本部だけが書けます' using errcode = '42501';
    end if;
    begin
      v_parent := (p_note ->> 'parent_id')::uuid;
    exception when others then
      raise exception 'VALIDATION: 回答する相談を選んでください' using errcode = 'P0001';
    end;
    select * into v_parent_row from public.case_notes where id = v_parent;
    if not found or v_parent_row.quote_request_id <> p_request_id or v_parent_row.kind <> 'consult' then
      raise exception 'VALIDATION: 回答する相談を選んでください' using errcode = 'P0001';
    end if;
  elsif v_kind in ('meeting', 'consult', 'other') then
    if v_access not in ('admin', 'staff') then
      raise exception 'FORBIDDEN: 打合せ記録・相談を書けるのは本部と担当代理店だけです' using errcode = '42501';
    end if;
  else
    raise exception 'VALIDATION: 記録の種類が正しくありません' using errcode = 'P0001';
  end if;

  insert into public.case_notes (quote_request_id, kind, body, verdict, estimated_cost, parent_id, created_by, author_name)
  values (p_request_id, v_kind, v_body, v_verdict, v_cost, v_parent, v_uid,
          left(coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = v_uid),
                        case v_access when 'admin' then '本部' when 'manufacturer' then '総代理店' else '担当代理店' end), 100))
  returning id into v_id;

  select q.dealer_id into v_dealer
    from public.quote_requests r left join public.quotes q on q.id = r.quote_id where r.id = p_request_id;
  if v_kind = 'consult' then
    perform public.notify(null, 'admin', 'case_consult', '代理店から本部への相談があります',
      left(v_body, 200), '/admin/quotes?request=' || p_request_id::text);
  elsif v_kind = 'consult_reply' then
    perform public.notify(v_parent_row.created_by,
      case when (select p.role_code from public.profiles p where p.id = v_parent_row.created_by) = 'admin' then 'admin' else 'dealer' end,
      'case_consult_reply', '本部から相談への回答があります',
      left(v_body, 200), '/admin/quotes?request=' || p_request_id::text);
  elsif v_kind = 'tech_review' then
    perform public.notify(null, 'admin', 'case_tech_review', '技術検討が記録されました',
      left(v_body, 200), '/admin/quotes?request=' || p_request_id::text);
    if v_dealer is not null then
      perform public.notify(v_dealer, 'dealer', 'case_tech_review', '技術検討が記録されました',
        left(v_body, 200), '/admin/quotes?request=' || p_request_id::text);
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------- RPC：案件の写真・書類 ----------

-- 登録してよいかを確かめて行を作り、保存先を返す。実体の保存・取り出しはサーバー（service role）が行う
create function public.register_case_file(p_request_id uuid, p_file jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_context text;
  v_context_id uuid;
  v_type text;
  v_size integer;
  v_ext text;
  v_visible boolean;
  v_name text;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_file is null or jsonb_typeof(p_file) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_context := public.cf_text(p_file, 'context', 20, '資料の種類');
  if v_context is null or v_context not in ('site_survey', 'progress', 'handover', 'punch', 'after_service', 'contract', 'document') then
    raise exception 'VALIDATION: 資料の種類が正しくありません' using errcode = 'P0001';
  end if;
  -- 誰がどの資料を登録できるか（権限は状態の判定より前）
  if not (
    (v_context in ('site_survey', 'handover') and v_access in ('admin', 'staff'))
    or (v_context = 'progress' and v_access in ('admin', 'staff', 'manufacturer'))
    -- 案件資料：お客様も設置予定地の写真・図面を送れる（見積依頼の添付資料）
    or (v_context in ('document', 'punch', 'after_service') and v_access in ('admin', 'staff', 'customer'))
    or (v_context = 'contract' and v_access = 'admin')
  ) then
    raise exception 'FORBIDDEN: この資料を登録する権限がありません' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_file ->> 'context_id', '')), '') is not null then
    begin
      v_context_id := (p_file ->> 'context_id')::uuid;
    exception when others then
      raise exception 'VALIDATION: 資料の紐付け先が正しくありません' using errcode = 'P0001';
    end;
  end if;
  v_type := public.cf_text(p_file, 'content_type', 40, 'ファイルの種類');
  v_ext := case v_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' end;
  if v_ext is null then
    raise exception 'VALIDATION: 登録できるのは JPEG・PNG・WebP の画像と PDF だけです' using errcode = 'P0001';
  end if;
  if coalesce(p_file ->> 'size_bytes', '') !~ '^\d{1,9}$' then
    raise exception 'VALIDATION: ファイルの大きさが正しくありません' using errcode = 'P0001';
  end if;
  v_size := (p_file ->> 'size_bytes')::integer;
  if v_size < 1 or v_size > 20971520 then
    raise exception 'VALIDATION: ファイルは 20MB 以下にしてください' using errcode = 'P0001';
  end if;
  v_name := public.cf_text(p_file, 'file_name', 200, 'ファイル名');
  if v_name is null then
    raise exception 'VALIDATION: ファイル名がありません' using errcode = 'P0001';
  end if;
  -- お客様が登録した資料はお客様にも見える。担当の資料は、お客様に見せるかを選ぶ（初期値は見せない）
  v_visible := case when v_access = 'customer' then true else coalesce((p_file -> 'customer_visible') = 'true'::jsonb, false) end;
  v_path := 'cases/' || p_request_id::text || '/' || v_id::text || '.' || v_ext;

  insert into public.case_files (id, quote_request_id, context, context_id, storage_path, file_name, content_type, size_bytes, caption, customer_visible, uploaded_by)
  values (v_id, p_request_id, v_context, v_context_id, v_path, v_name, v_type, v_size,
          public.cf_text(p_file, 'caption', 200, '説明'), v_visible, v_uid);
  return jsonb_build_object('id', v_id, 'storage_path', v_path);
end;
$$;

-- 登録した本人か本部だけが削除できる。削除した行の保存先を返す（実体はサーバーが消す）
create function public.delete_case_file(p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  f public.case_files;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into f from public.case_files where id = p_file_id for update;
  -- 見えない資料（関係の無い案件、お客様に表示していない資料）は、存在も分からないようにする
  if not found
     or public.case_access(f.quote_request_id) is null
     or (public.case_access(f.quote_request_id) = 'customer' and not f.customer_visible) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (f.uploaded_by = v_uid or coalesce(public.current_role_rank(), 0) >= 3) then
    raise exception 'FORBIDDEN: 削除できるのは登録した人と本部だけです' using errcode = '42501';
  end if;
  delete from public.case_files where id = f.id;
  return f.storage_path;
end;
$$;

-- ---------- RPC：お客様向けの進み具合（社内の情報は返さない） ----------

create function public.get_case_progress(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access text := public.case_access(p_request_id);
  w public.case_workflows;
  s public.site_surveys;
  v_primary_name text;
begin
  if v_access is null then
    return null;
  end if;
  select * into w from public.case_workflows where quote_request_id = p_request_id;
  select * into s from public.site_surveys where quote_request_id = p_request_id;
  if w.primary_staff_id is not null then
    select p.full_name into v_primary_name from public.profiles p where p.id = w.primary_staff_id;
  end if;
  return jsonb_build_object(
    'acknowledged_at', w.acknowledged_at,
    'primary_staff_name', v_primary_name,
    'site_survey_status', coalesce(s.status, 'none'),
    'site_survey_completed_at', s.completed_at
  );
end;
$$;

-- ---------- owner / EXECUTE ----------

do $acl$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.case_access(uuid)'::regprocedure,
    'public.cf_text(jsonb, text, integer, text)'::regprocedure,
    'public.cf_text_array(jsonb, text, integer, integer, text)'::regprocedure,
    'public.save_dealer_profile(uuid, jsonb, integer)'::regprocedure,
    'public.set_dealer_profile_published(uuid, boolean, integer)'::regprocedure,
    'public.set_quote_request_preferences(uuid, jsonb)'::regprocedure,
    'public.acknowledge_case(uuid)'::regprocedure,
    'public.assign_case_primary_staff(uuid, uuid)'::regprocedure,
    'public.set_case_manufacturer(uuid, uuid)'::regprocedure,
    'public.propose_case_appointment(uuid, jsonb)'::regprocedure,
    'public.confirm_case_appointment(uuid, integer, integer)'::regprocedure,
    'public.request_case_appointment_change(uuid, text, integer)'::regprocedure,
    'public.set_case_appointment_status(uuid, text, integer)'::regprocedure,
    'public.save_site_survey(uuid, jsonb, integer)'::regprocedure,
    'public.set_site_survey_status(uuid, text, integer)'::regprocedure,
    'public.add_case_note(uuid, jsonb)'::regprocedure,
    'public.register_case_file(uuid, jsonb)'::regprocedure,
    'public.delete_case_file(uuid)'::regprocedure,
    'public.get_case_progress(uuid)'::regprocedure
  ]
  loop
    execute format('alter function %s owner to postgres', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;

  -- RLS の判定と、画面からの操作（すべて関数の中で権限を確認する）は authenticated だけ。入力の取り出しは内部だけ
  foreach v_fn in array array[
    'public.case_access(uuid)'::regprocedure,
    'public.save_dealer_profile(uuid, jsonb, integer)'::regprocedure,
    'public.set_dealer_profile_published(uuid, boolean, integer)'::regprocedure,
    'public.set_quote_request_preferences(uuid, jsonb)'::regprocedure,
    'public.acknowledge_case(uuid)'::regprocedure,
    'public.assign_case_primary_staff(uuid, uuid)'::regprocedure,
    'public.set_case_manufacturer(uuid, uuid)'::regprocedure,
    'public.propose_case_appointment(uuid, jsonb)'::regprocedure,
    'public.confirm_case_appointment(uuid, integer, integer)'::regprocedure,
    'public.request_case_appointment_change(uuid, text, integer)'::regprocedure,
    'public.set_case_appointment_status(uuid, text, integer)'::regprocedure,
    'public.save_site_survey(uuid, jsonb, integer)'::regprocedure,
    'public.set_site_survey_status(uuid, text, integer)'::regprocedure,
    'public.add_case_note(uuid, jsonb)'::regprocedure,
    'public.register_case_file(uuid, jsonb)'::regprocedure,
    'public.delete_case_file(uuid)'::regprocedure,
    'public.get_case_progress(uuid)'::regprocedure
  ]
  loop
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$acl$;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_table text;
  v_fn record;
begin
  foreach v_table in array array['dealer_profiles', 'quote_request_preferences', 'case_workflows', 'case_appointments',
                                 'site_surveys', 'case_notes', 'case_files']
  loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'POSTCONDITION: RLS must be enabled on %', v_table;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
       or has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       or has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('anon', 'public.' || v_table, 'DELETE') then
      raise exception 'POSTCONDITION: % must be read-only through the API (writes go through RPCs)', v_table;
    end if;
    if v_table <> 'dealer_profiles' and has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'POSTCONDITION: % must not be readable by anon', v_table;
    end if;
  end loop;
  if exists (select 1 from storage.buckets where id = 'case-files' and public) then
    raise exception 'POSTCONDITION: case-files bucket must be private';
  end if;

  for v_fn in
    select p.oid::regprocedure as fn, p.proname, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('case_access', 'cf_text', 'cf_text_array', 'save_dealer_profile', 'set_dealer_profile_published',
                         'set_quote_request_preferences', 'acknowledge_case', 'assign_case_primary_staff', 'set_case_manufacturer',
                         'propose_case_appointment', 'confirm_case_appointment', 'request_case_appointment_change',
                         'set_case_appointment_status', 'save_site_survey', 'set_site_survey_status', 'add_case_note',
                         'register_case_file', 'delete_case_file', 'get_case_progress')
  loop
    if has_function_privilege('anon', v_fn.fn, 'EXECUTE') or has_function_privilege('service_role', v_fn.fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon / service_role', v_fn.fn;
    end if;
    if v_fn.owner <> 'postgres' or not (v_fn.proconfig @> array['search_path=""']) then
      raise exception 'POSTCONDITION: % must be owned by postgres with an empty search_path', v_fn.fn;
    end if;
    if v_fn.proname not like 'cf\_%' and not v_fn.prosecdef then
      raise exception 'POSTCONDITION: % must be SECURITY DEFINER', v_fn.fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.cf_text(jsonb, text, integer, text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cf_text_array(jsonb, text, integer, integer, text)'::regprocedure, 'EXECUTE') then
    raise exception 'POSTCONDITION: input helpers must stay internal';
  end if;
end;
$postcondition$;

commit;
