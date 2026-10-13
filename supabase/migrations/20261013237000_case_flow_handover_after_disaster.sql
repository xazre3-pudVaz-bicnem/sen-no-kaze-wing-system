-- 案件の進行（フローチャート第4版 フェーズ14〜15）：完了確認・是正・工事完了承諾書・引渡し、アフター受付、災害時提供の意思・全国ストック台帳。
--
-- フェーズ14：担当代理店（または本部）が完成確認を始め、お客様がマイページで「問題なし」か「気になる点がある」を回答する。
--   指摘は是正事項（case_punch_items）として担当が是正し、お客様（または担当）が是正を確認する。
--   署名済みの工事完了承諾書（書面の写し・case_files の handover）を記録してから、引渡し完了にする。
--   マイページを使わないお客様もいるため、承諾書の記録をお客様の確認（書面）として扱う。
--   引渡し完了で、設置済みの個体を引渡し済みにする。承諾書の電子署名（GMOサイン）はテンプレートが先方の準備待ちのため、書面の写しで記録する。
-- フェーズ15：引渡しの後、お客様・担当代理店・本部がアフター（定期点検・問い合わせ・修理）を登録する。製造起因のものは総代理店へ回す（修補・部材供給）。
--   災害時提供の意思（承諾／条件付き承諾／不承諾。後から変えられ、履歴を残す）。承諾書の文面は先方が決めるため、本部が文面を登録するまでお客様には表示しない。
--   全国ストック台帳（本部だけ）：引渡し済みの個体の登録状態・稼働状況・即時提供・輸送・72 時間／7 日の供給可否を本部が判定する。
--   台帳に登録できるのは、お客様の最新の意思が承諾か条件付き承諾の個体だけ。不承諾にしたら登録を止める。
--   災害時パートナーの管理・供給指揮システムとの連携は仕様が未定のため扱わない。
-- 既存の表は変更しない。置き換える関数は 2 つ：delete_case_file（承諾書として記録した写しを消せないようにする）と、
-- get_case_progress（契約が締結済みか・引渡しの状態を足す。契約の表は本部とお客様しか読めないため、担当代理店の画面の判定に使う）。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.case_access(uuid)') is null or to_regprocedure('public.delete_case_file(uuid)') is null then
    raise exception 'PRECONDITION: case flow (20261013220000) must be applied first';
  end if;
  if to_regclass('public.manufacturing_units') is null or to_regprocedure('public.cf_date(jsonb, text, text)') is null then
    raise exception 'PRECONDITION: manufacturing (20261013234000) must be applied first';
  end if;
  if to_regclass('public.case_handovers') is not null then
    raise exception 'PRECONDITION: handover tables already exist; review before applying';
  end if;
end;
$preflight$;

-- ---------- 完了確認・引渡し（フェーズ14） ----------

create table public.case_handovers (
  quote_request_id uuid primary key references public.quote_requests(id) on delete cascade,
  status text not null default 'inspecting' check (status in ('inspecting', 'correcting', 'ready', 'handed_over')),
  inspection_on date not null,
  -- お客様にも表示される
  inspection_summary text check (inspection_summary is null or length(inspection_summary) <= 2000),
  customer_confirmation text not null default 'pending' check (customer_confirmation in ('pending', 'ok', 'issues')),
  -- mypage：お客様がマイページで回答／certificate：署名済みの承諾書を担当が記録
  customer_confirmed_via text check (customer_confirmed_via in ('mypage', 'certificate')),
  customer_confirmed_at timestamptz,
  certificate_file_id uuid references public.case_files(id),
  certificate_signed_on date,
  handed_over_on date,
  handed_over_by uuid references public.profiles(id) on delete set null,
  lock_version integer not null default 1 check (lock_version >= 1),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_handovers_confirmation_fields check (
    (customer_confirmation = 'pending') = (customer_confirmed_via is null)
    and (customer_confirmed_via is null) = (customer_confirmed_at is null)
    and (customer_confirmation <> 'issues' or customer_confirmed_via = 'mypage')
  ),
  constraint case_handovers_certificate_fields check (
    (certificate_file_id is null) = (certificate_signed_on is null)
    and (certificate_file_id is null or status in ('ready', 'handed_over'))
  ),
  constraint case_handovers_ready_fields check (status not in ('ready', 'handed_over') or customer_confirmation = 'ok'),
  constraint case_handovers_handed_over_fields check (
    (status = 'handed_over') = (handed_over_on is not null) and (status <> 'handed_over' or certificate_file_id is not null)
  )
);

comment on table public.case_handovers is
  '完了確認・引渡し（フェーズ14）。お客様の確認（マイページの回答か、署名済みの承諾書）と工事完了承諾書の写しの記録の後に、引渡し完了にする。';

create trigger trg_case_handovers_updated before update on public.case_handovers
  for each row execute function public.set_updated_at();

create table public.case_punch_items (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  description text not null check (btrim(description) <> '' and length(description) <= 1000),
  raised_by_customer boolean not null default false,
  status text not null default 'open' check (status in ('open', 'fixed', 'verified')),
  fixed_on date,
  verified_at timestamptz,
  lock_version integer not null default 1 check (lock_version >= 1),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_punch_items_fields check ((status = 'open') = (fixed_on is null) and (status = 'verified') = (verified_at is not null))
);

comment on table public.case_punch_items is '完成確認の指摘事項（是正事項）。担当が是正し、お客様（または担当）が是正を確認する。写真は case_files（punch）。';

create index case_punch_items_request_idx on public.case_punch_items (quote_request_id, created_at);

create trigger trg_case_punch_items_updated before update on public.case_punch_items
  for each row execute function public.set_updated_at();

-- ---------- アフター（フェーズ15） ----------

create table public.after_service_requests (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  kind text not null check (kind in ('inspection', 'inquiry', 'repair')),
  title text not null check (btrim(title) <> '' and length(title) <= 100),
  body text check (body is null or length(body) <= 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'escalated', 'resolved')),
  -- お客様への回答（お客様にも表示される）
  response text check (response is null or length(response) <= 2000),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_by_customer boolean not null default false,
  escalated_at timestamptz,
  resolved_at timestamptz,
  lock_version integer not null default 1 check (lock_version >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint after_service_requests_fields check (
    (status <> 'escalated' or escalated_at is not null) and (status = 'resolved') = (resolved_at is not null)
  )
);

comment on table public.after_service_requests is
  'アフター（定期点検・問い合わせ・修理）。製造起因のものは総代理店へ回す（escalated_at。回した後は総代理店も読める）。回答はお客様にも表示される。写真は case_files（after_service）。';

create index after_service_requests_request_idx on public.after_service_requests (quote_request_id, created_at desc);
create index after_service_requests_open_idx on public.after_service_requests (status) where status <> 'resolved';

create trigger trg_after_service_requests_updated before update on public.after_service_requests
  for each row execute function public.set_updated_at();

-- ---------- 災害時提供の意思（フェーズ15） ----------

create table public.disaster_consent_texts (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  title text not null check (btrim(title) <> '' and length(title) <= 100),
  body text not null check (btrim(body) <> '' and length(body) <= 20000),
  published_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict
);

comment on table public.disaster_consent_texts is
  '災害時提供の承諾書の文面（先方が決めた文面を本部が登録する）。文面が無い間は、お客様に意思の設定を表示しない。版は書き換えず、新しい版を足す。';

create table public.disaster_consents (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  text_id uuid not null references public.disaster_consent_texts(id) on delete restrict,
  decision text not null check (decision in ('accepted', 'conditional', 'declined')),
  conditions text check (conditions is null or (btrim(conditions) <> '' and length(conditions) <= 2000)),
  -- 最新の行が今の意思。同じトランザクションの中でも順番が分かるように、実際の時刻を使う
  created_at timestamptz not null default clock_timestamp(),
  constraint disaster_consents_conditions check ((decision = 'conditional') = (conditions is not null))
);

comment on table public.disaster_consents is
  '災害時提供についてのお客様の意思（承諾／条件付き承諾／不承諾）。変えるときは新しい行を足す（履歴として残し、最新の行が今の意思）。';

create index disaster_consents_request_idx on public.disaster_consents (quote_request_id, created_at desc);

-- ---------- 全国ストック台帳（フェーズ15・本部だけ） ----------

create table public.stock_ledger_entries (
  unit_id uuid primary key references public.manufacturing_units(id) on delete cascade,
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  registration_status text not null check (registration_status in ('registered', 'suspended')),
  operating_status text check (operating_status is null or length(operating_status) <= 200),
  last_inspection_on date,
  immediate_available boolean not null default false,
  transportable boolean not null default false,
  supply_72h boolean not null default false,
  supply_7d boolean not null default false,
  location_prefecture text check (location_prefecture is null or length(location_prefecture) <= 10),
  location_municipality text check (location_municipality is null or length(location_municipality) <= 60),
  note text check (note is null or length(note) <= 1000),
  judged_by uuid references public.profiles(id) on delete set null,
  judged_at timestamptz not null default now(),
  lock_version integer not null default 1 check (lock_version >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.stock_ledger_entries is
  '全国ストック台帳（本部だけ）。引渡し済みの個体の登録状態・稼働状況・即時提供・輸送・72 時間／7 日の供給可否。登録はお客様の意思が承諾・条件付き承諾のときだけ。';

create trigger trg_stock_ledger_entries_updated before update on public.stock_ledger_entries
  for each row execute function public.set_updated_at();

-- ---------- RLS / ACL ----------

alter table public.case_handovers enable row level security;
alter table public.case_punch_items enable row level security;
alter table public.after_service_requests enable row level security;
alter table public.disaster_consent_texts enable row level security;
alter table public.disaster_consents enable row level security;
alter table public.stock_ledger_entries enable row level security;

create policy case_handovers_read on public.case_handovers for select to authenticated
  using (public.case_access(quote_request_id) is not null);
create policy case_punch_items_read on public.case_punch_items for select to authenticated
  using (public.case_access(quote_request_id) is not null);
-- 総代理店は、回されたアフター（製造起因）だけ
create policy after_service_requests_read on public.after_service_requests for select to authenticated
  using (
    public.case_access(quote_request_id) in ('admin', 'staff', 'customer')
    or (escalated_at is not null and public.case_access(quote_request_id) = 'manufacturer')
  );
create policy disaster_consent_texts_read on public.disaster_consent_texts for select to authenticated
  using (true);
create policy disaster_consents_read on public.disaster_consents for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'customer'));
create policy stock_ledger_entries_read on public.stock_ledger_entries for select to authenticated
  using (coalesce(public.current_role_rank(), 0) >= 3);

revoke all on public.case_handovers from public, anon, authenticated;
revoke all on public.case_punch_items from public, anon, authenticated;
revoke all on public.after_service_requests from public, anon, authenticated;
revoke all on public.disaster_consent_texts from public, anon, authenticated;
revoke all on public.disaster_consents from public, anon, authenticated;
revoke all on public.stock_ledger_entries from public, anon, authenticated;
grant select on public.case_handovers to authenticated;
grant select on public.case_punch_items to authenticated;
grant select on public.after_service_requests to authenticated;
grant select on public.disaster_consent_texts to authenticated;
grant select on public.disaster_consents to authenticated;
grant select on public.stock_ledger_entries to authenticated;

-- ---------- RPC：完了確認・是正・引渡し ----------

-- 完成確認を始める（確認し直すときは、お客様の回答と承諾書の記録を待ちに戻す。是正中の指摘はそのまま残る）
create function public.start_handover_inspection(p_request_id uuid, p_inspection jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.case_handovers;
  v_on date;
  v_summary text;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 完成確認を始められるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_inspection is null or jsonb_typeof(p_inspection) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_on := public.cf_date(p_inspection, 'inspection_on', '完成確認の日');
  if v_on is null or v_on > current_date + 365 or v_on < current_date - 3650 then
    raise exception 'VALIDATION: 完成確認の日を正しく入力してください' using errcode = 'P0001';
  end if;
  v_summary := public.cf_text(p_inspection, 'inspection_summary', 2000, '完成確認の内容');

  perform 1 from public.quote_requests r where r.id = p_request_id for update;
  if not exists (select 1 from public.contracts c where c.quote_request_id = p_request_id and c.status = 'signed') then
    raise exception 'LOCKED: 契約が締結されてから完成確認を始められます' using errcode = 'P0001';
  end if;

  select * into v_row from public.case_handovers where quote_request_id = p_request_id for update;
  if not found then
    if p_expected_lock_version is not null then
      raise exception 'LOCKED: 他の画面で完了確認が更新されています。再読み込みしてください' using errcode = 'P0001';
    end if;
    insert into public.case_handovers (quote_request_id, inspection_on, inspection_summary, created_by, updated_by)
    values (p_request_id, v_on, v_summary, v_uid, v_uid);
  else
    if v_row.lock_version is distinct from p_expected_lock_version then
      raise exception 'LOCKED: 他の画面で完了確認が更新されています。再読み込みしてください' using errcode = 'P0001';
    end if;
    if v_row.status = 'handed_over' then
      raise exception 'LOCKED: 引渡し済みの案件です' using errcode = 'P0001';
    end if;
    update public.case_handovers
       set inspection_on = v_on,
           inspection_summary = v_summary,
           status = case when exists (select 1 from public.case_punch_items p where p.quote_request_id = p_request_id and p.status <> 'verified')
                         then 'correcting' else 'inspecting' end,
           customer_confirmation = 'pending',
           customer_confirmed_via = null,
           customer_confirmed_at = null,
           certificate_file_id = null,
           certificate_signed_on = null,
           lock_version = lock_version + 1,
           updated_by = v_uid
     where quote_request_id = p_request_id;
  end if;

  select r.user_id into v_customer from public.quote_requests r where r.id = p_request_id;
  if v_customer is not null then
    perform public.notify(v_customer, 'customer', 'handover_inspection', '完成内容のご確認をお願いします',
      'マイページの「ご依頼の進み具合」で完成内容をご確認のうえ、「問題なし」か「気になる点がある」をお知らせください。',
      '/mypage/cases/' || p_request_id::text);
  end if;
  return coalesce(v_row.lock_version, 0) + 1;
end;
$$;

-- お客様の回答（マイページ）。ok：問題なし／issues：気になる点（是正事項になる）
create function public.confirm_handover(p_request_id uuid, p_result text, p_issues jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.case_handovers;
  v_issue jsonb;
  v_text text;
  v_count integer := 0;
  v_title text;
  v_dealer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if public.case_access(p_request_id) is distinct from 'customer' then
    raise exception 'FORBIDDEN: 完成内容の確認はお客様が行います' using errcode = '42501';
  end if;
  if p_result is null or p_result not in ('ok', 'issues') then
    raise exception 'VALIDATION: 回答の内容が正しくありません' using errcode = 'P0001';
  end if;
  select * into v_row from public.case_handovers where quote_request_id = p_request_id for update;
  if not found or v_row.status = 'handed_over' or (p_result = 'ok' and v_row.status = 'ready') then
    raise exception 'LOCKED: 今は完成内容の回答を受け付けていません' using errcode = 'P0001';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 完了確認が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;

  if p_result = 'ok' then
    if exists (select 1 from public.case_punch_items p where p.quote_request_id = p_request_id and p.status <> 'verified') then
      raise exception 'LOCKED: 是正の確認が済んでいない点があります。先に是正の内容をご確認ください' using errcode = 'P0001';
    end if;
    update public.case_handovers
       set customer_confirmation = 'ok', customer_confirmed_via = 'mypage', customer_confirmed_at = now(), status = 'ready',
           lock_version = lock_version + 1, updated_by = v_uid
     where quote_request_id = p_request_id;
    v_title := 'お客様が完成内容を確認しました（問題なし）';
  else
    if p_issues is null or jsonb_typeof(p_issues) <> 'array' or jsonb_array_length(p_issues) not between 1 and 20 then
      raise exception 'VALIDATION: 気になる点を 1〜20 件入力してください' using errcode = 'P0001';
    end if;
    for v_issue in select value from jsonb_array_elements(p_issues)
    loop
      if jsonb_typeof(v_issue) <> 'string' then
        raise exception 'VALIDATION: 気になる点の形式が正しくありません' using errcode = 'P0001';
      end if;
      v_text := btrim(v_issue #>> '{}');
      if v_text = '' or length(v_text) > 1000 then
        raise exception 'VALIDATION: 気になる点は 1 件 1000 文字以内で入力してください' using errcode = 'P0001';
      end if;
      insert into public.case_punch_items (quote_request_id, description, raised_by_customer, created_by, updated_by)
      values (p_request_id, v_text, true, v_uid, v_uid);
      v_count := v_count + 1;
    end loop;
    -- 承諾書の記録の後に指摘があったら、是正の後に記録し直す
    update public.case_handovers
       set customer_confirmation = 'issues', customer_confirmed_via = 'mypage', customer_confirmed_at = now(), status = 'correcting',
           certificate_file_id = null, certificate_signed_on = null,
           lock_version = lock_version + 1, updated_by = v_uid
     where quote_request_id = p_request_id;
    v_title := 'お客様から完成内容への指摘がありました（' || v_count || ' 件）';
  end if;

  v_dealer := public.case_dealer_id(p_request_id);
  perform public.notify(null, 'admin', 'handover_confirmed', v_title,
    '案件の「引渡し・アフター」タブで確認してください。', '/admin/quotes?request=' || p_request_id::text);
  if v_dealer is not null then
    perform public.notify(v_dealer, 'dealer', 'handover_confirmed', v_title,
      '案件の「引渡し・アフター」タブで確認してください。', '/admin/quotes?request=' || p_request_id::text);
  end if;
  return v_row.lock_version + 1;
end;
$$;

create function public.add_punch_item(p_request_id uuid, p_description text, p_expected_lock_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.case_handovers;
  v_text text := btrim(coalesce(p_description, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 是正事項を追加できるのは本部と担当代理店だけです（お客様は完成内容の確認から指摘できます）' using errcode = '42501';
  end if;
  if v_text = '' or length(v_text) > 1000 then
    raise exception 'VALIDATION: 是正事項を 1000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  select * into v_row from public.case_handovers where quote_request_id = p_request_id for update;
  if not found or v_row.status = 'handed_over' then
    raise exception 'LOCKED: 完成確認を始めてから（引渡しの前に）是正事項を追加できます' using errcode = 'P0001';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で完了確認が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  insert into public.case_punch_items (quote_request_id, description, created_by, updated_by)
  values (p_request_id, v_text, v_uid, v_uid)
  returning id into v_id;
  -- 確認済み（問題なし）の後に見つかったら、お客様の確認と承諾書の記録を待ちに戻す
  update public.case_handovers
     set status = 'correcting',
         customer_confirmation = case when customer_confirmation = 'ok' then 'pending' else customer_confirmation end,
         customer_confirmed_via = case when customer_confirmation = 'ok' then null else customer_confirmed_via end,
         customer_confirmed_at = case when customer_confirmation = 'ok' then null else customer_confirmed_at end,
         certificate_file_id = null,
         certificate_signed_on = null,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  return v_id;
end;
$$;

-- 是正事項の状態。fixed：担当が是正した／verified：お客様（または担当）が是正を確認した
create function public.set_punch_item_status(p_item_id uuid, p_status text, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.case_punch_items;
  v_access text;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_item from public.case_punch_items where id = p_item_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(v_item.quote_request_id);
  if v_access is null
     or p_status is null
     or p_status not in ('fixed', 'verified')
     or (p_status = 'fixed' and v_access not in ('admin', 'staff'))
     or (p_status = 'verified' and v_access not in ('admin', 'staff', 'customer')) then
    raise exception 'FORBIDDEN: この是正事項をその状態にする権限がありません' using errcode = '42501';
  end if;
  if v_item.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 是正事項が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if not ((v_item.status = 'open' and p_status = 'fixed') or (v_item.status = 'fixed' and p_status = 'verified')) then
    raise exception 'LOCKED: この是正事項はその状態に変更できません' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.case_handovers h where h.quote_request_id = v_item.quote_request_id and h.status = 'handed_over') then
    raise exception 'LOCKED: 引渡し済みの案件です' using errcode = 'P0001';
  end if;
  update public.case_punch_items
     set status = p_status,
         fixed_on = case when p_status = 'fixed' then current_date else fixed_on end,
         verified_at = case when p_status = 'verified' then now() else verified_at end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = v_item.id;
  if p_status = 'fixed' then
    select r.user_id into v_customer from public.quote_requests r where r.id = v_item.quote_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'punch_item_fixed', 'ご指摘の点の是正が終わりました',
        'マイページの「ご依頼の進み具合」で、是正の内容をご確認ください。', '/mypage/cases/' || v_item.quote_request_id::text);
    end if;
  end if;
  return v_item.lock_version + 1;
end;
$$;

-- 署名済みの工事完了承諾書（写し）を記録する。記録は、お客様の確認（書面）として扱う
create function public.record_completion_certificate(p_request_id uuid, p_file_id uuid, p_signed_on date, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.case_handovers;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 工事完了承諾書を記録できるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  select * into v_row from public.case_handovers where quote_request_id = p_request_id for update;
  if not found or v_row.status = 'handed_over' then
    raise exception 'LOCKED: 完成確認を始めてから（引渡しの前に）記録できます' using errcode = 'P0001';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で完了確認が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.case_punch_items p where p.quote_request_id = p_request_id and p.status <> 'verified') then
    raise exception 'LOCKED: 是正の確認が済んでいない是正事項があります' using errcode = 'P0001';
  end if;
  if p_signed_on is null or p_signed_on > current_date or p_signed_on < v_row.inspection_on - 365 then
    raise exception 'VALIDATION: 承諾書の署名日を正しく入力してください（今日以前）' using errcode = 'P0001';
  end if;
  if p_file_id is null
     or not exists (select 1 from public.case_files f where f.id = p_file_id and f.quote_request_id = p_request_id and f.context = 'handover') then
    raise exception 'VALIDATION: この案件の「完了確認・引渡し」に登録した、署名済みの承諾書の写しを選んでください' using errcode = 'P0001';
  end if;
  update public.case_handovers
     set certificate_file_id = p_file_id,
         certificate_signed_on = p_signed_on,
         status = 'ready',
         customer_confirmed_via = case when customer_confirmation = 'ok' then customer_confirmed_via else 'certificate' end,
         customer_confirmed_at = case when customer_confirmation = 'ok' then customer_confirmed_at else now() end,
         customer_confirmation = 'ok',
         lock_version = lock_version + 1,
         updated_by = v_uid
   where quote_request_id = p_request_id;
  return v_row.lock_version + 1;
end;
$$;

create function public.complete_handover(p_request_id uuid, p_handed_over_on date, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.case_handovers;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 引渡し完了にできるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  select * into v_row from public.case_handovers where quote_request_id = p_request_id for update;
  if not found or v_row.status <> 'ready' or v_row.certificate_file_id is null then
    raise exception 'LOCKED: お客様の確認と工事完了承諾書の記録が済んでから、引渡し完了にできます' using errcode = 'P0001';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で完了確認が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if p_handed_over_on is null or p_handed_over_on > current_date or p_handed_over_on < v_row.inspection_on then
    raise exception 'VALIDATION: 引渡し日は完成確認の日から今日までの日付にしてください' using errcode = 'P0001';
  end if;
  update public.case_handovers
     set status = 'handed_over', handed_over_on = p_handed_over_on, handed_over_by = v_uid, lock_version = lock_version + 1, updated_by = v_uid
   where quote_request_id = p_request_id;
  -- 設置済みの個体を引渡し済みにする
  update public.manufacturing_units mu
     set status = 'handed_over', handed_over_on = p_handed_over_on, lock_version = mu.lock_version + 1, updated_by = v_uid
    from public.manufacturing_orders mo
   where mo.id = mu.order_id and mo.quote_request_id = p_request_id and mo.status <> 'canceled' and mu.status = 'installed';

  select r.user_id into v_customer from public.quote_requests r where r.id = p_request_id;
  if v_customer is not null then
    perform public.notify(v_customer, 'customer', 'handover_completed', 'お引渡しが完了しました',
      'これからは、マイページから定期点検・修理などのご依頼ができます。', '/mypage/cases/' || p_request_id::text);
  end if;
  perform public.notify(null, 'admin', 'handover_completed', '引渡しが完了しました',
    '工事完了承諾書の写しは、案件の「引渡し・アフター」タブで確認できます。', '/admin/quotes?request=' || p_request_id::text);
  return v_row.lock_version + 1;
end;
$$;

-- ---------- RPC：アフター ----------

create function public.create_after_service_request(p_request_id uuid, p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_kind text;
  v_title text;
  v_id uuid;
  v_dealer uuid;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff', 'customer') then
    raise exception 'FORBIDDEN: アフターを登録できるのは、お客様・担当代理店・本部だけです' using errcode = '42501';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_kind := public.cf_text(p_request, 'kind', 20, 'ご依頼の種類');
  if v_kind is null or v_kind not in ('inspection', 'inquiry', 'repair') then
    raise exception 'VALIDATION: ご依頼の種類を選んでください' using errcode = 'P0001';
  end if;
  v_title := public.cf_text(p_request, 'title', 100, '件名');
  if v_title is null then
    raise exception 'VALIDATION: 件名を入力してください' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.case_handovers h where h.quote_request_id = p_request_id and h.status = 'handed_over') then
    raise exception 'LOCKED: お引渡しの後にご依頼いただけます' using errcode = 'P0001';
  end if;
  insert into public.after_service_requests (quote_request_id, kind, title, body, requested_by, requested_by_customer, updated_by)
  values (p_request_id, v_kind, v_title, public.cf_text(p_request, 'body', 4000, '内容'), v_uid, v_access = 'customer', v_uid)
  returning id into v_id;

  if v_access = 'customer' then
    v_dealer := public.case_dealer_id(p_request_id);
    perform public.notify(null, 'admin', 'after_service_requested', 'お客様からアフターのご依頼がありました：' || v_title,
      'アフターの一覧で内容を確認し、対応してください。', '/admin/after-service');
    if v_dealer is not null then
      perform public.notify(v_dealer, 'dealer', 'after_service_requested', 'お客様からアフターのご依頼がありました：' || v_title,
        'アフターの一覧で内容を確認し、対応してください。', '/admin/after-service');
    end if;
  else
    select r.user_id into v_customer from public.quote_requests r where r.id = p_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'after_service_registered', 'アフターの予定を登録しました：' || v_title,
        'マイページの「ご依頼の進み具合」でご確認いただけます。', '/mypage/cases/' || p_request_id::text);
    end if;
  end if;
  return v_id;
end;
$$;

-- 状態と回答。担当代理店・本部はすべて、総代理店は回されたものの回答と完了だけ
create function public.update_after_service_request(p_id uuid, p_update jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.after_service_requests;
  v_access text;
  v_status text;
  v_manufacturer uuid;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_row from public.after_service_requests where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(v_row.quote_request_id);
  -- 回されていないものは、総代理店には存在も分からないようにする
  if v_access = 'manufacturer' and v_row.escalated_at is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_access is null or v_access = 'customer' then
    raise exception 'FORBIDDEN: このアフターを更新する権限がありません' using errcode = '42501';
  end if;
  if p_update is null or jsonb_typeof(p_update) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_status := coalesce(public.cf_text(p_update, 'status', 20, '状態'), v_row.status);
  if v_status not in ('open', 'in_progress', 'escalated', 'resolved') then
    raise exception 'VALIDATION: 状態が正しくありません' using errcode = 'P0001';
  end if;
  if v_access = 'manufacturer' and v_status not in ('escalated', 'resolved') then
    raise exception 'FORBIDDEN: 製造の担当は、回されたアフターの回答と完了だけ記録できます' using errcode = '42501';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でアフターが更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if v_row.status = 'resolved' and v_status <> 'resolved' then
    raise exception 'LOCKED: 完了したアフターは戻せません。新しいご依頼として登録してください' using errcode = 'P0001';
  end if;
  if v_status = 'escalated' and v_row.status <> 'escalated' then
    select w.manufacturer_id into v_manufacturer from public.case_workflows w where w.quote_request_id = v_row.quote_request_id;
    if v_manufacturer is null then
      raise exception 'LOCKED: 製造の担当（総代理店）が決まっていない案件です。先に本部が製造の担当を決めてください' using errcode = 'P0001';
    end if;
  end if;

  update public.after_service_requests
     set status = v_status,
         response = case when p_update ? 'response' then public.cf_text(p_update, 'response', 2000, 'お客様への回答') else response end,
         escalated_at = case when v_status = 'escalated' and escalated_at is null then now() else escalated_at end,
         resolved_at = case when v_status = 'resolved' then coalesce(resolved_at, now()) else null end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = v_row.id;

  if v_manufacturer is not null then
    perform public.notify(v_manufacturer, 'dealer', 'after_service_escalated', '製造起因のアフターが回ってきました：' || v_row.title,
      '修補・部材供給の対応をお願いします。', '/admin/after-service');
  end if;
  if v_status = 'resolved' and v_row.status <> 'resolved' then
    select r.user_id into v_customer from public.quote_requests r where r.id = v_row.quote_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'after_service_resolved', 'アフターのご依頼に対応しました：' || v_row.title,
        'マイページの「ご依頼の進み具合」で回答をご確認ください。', '/mypage/cases/' || v_row.quote_request_id::text);
    end if;
  end if;
  return v_row.lock_version + 1;
end;
$$;

-- ---------- RPC：災害時提供の意思 ----------

-- 承諾書の文面を登録する（本部だけ。版を足す）
create function public.publish_disaster_consent_text(p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_version integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 承諾書の文面を登録できるのは本部だけです' using errcode = '42501';
  end if;
  if v_title = '' or length(v_title) > 100 then
    raise exception 'VALIDATION: 見出しを 100 文字以内で入力してください' using errcode = 'P0001';
  end if;
  if v_body = '' or length(v_body) > 20000 then
    raise exception 'VALIDATION: 文面を 20000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  lock table public.disaster_consent_texts in exclusive mode;
  select coalesce(max(t.version), 0) + 1 into v_version from public.disaster_consent_texts t;
  insert into public.disaster_consent_texts (version, title, body, created_by)
  values (v_version, v_title, v_body, v_uid)
  returning id into v_id;
  perform public.write_audit('publish', 'disaster_consent_texts', v_id,
    '災害時提供の承諾書の文面を登録しました（第' || v_version || '版）', null, jsonb_build_object('version', v_version, 'title', v_title));
  return v_version;
end;
$$;

-- お客様の意思（引渡しの後・文面の登録の後）。不承諾にしたら、全国ストック台帳の登録を止める
create function public.set_disaster_consent(p_request_id uuid, p_decision text, p_conditions text, p_text_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_text public.disaster_consent_texts;
  v_conditions text := nullif(btrim(coalesce(p_conditions, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if public.case_access(p_request_id) is distinct from 'customer' then
    raise exception 'FORBIDDEN: 災害時提供の意思はお客様が決めます' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'conditional', 'declined') then
    raise exception 'VALIDATION: 承諾・条件付き承諾・不承諾のいずれかを選んでください' using errcode = 'P0001';
  end if;
  if p_decision = 'conditional' and v_conditions is null then
    raise exception 'VALIDATION: 条件を入力してください' using errcode = 'P0001';
  end if;
  if length(coalesce(v_conditions, '')) > 2000 then
    raise exception 'VALIDATION: 条件は 2000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  select * into v_text from public.disaster_consent_texts t order by t.version desc limit 1;
  if not found then
    raise exception 'LOCKED: 承諾書の文面の準備ができてから設定できます' using errcode = 'P0001';
  end if;
  -- 読んだ文面と最新の文面が違う（読んでいる間に新しい版が登録された）なら、読み直してもらう
  if v_text.version is distinct from p_text_version then
    raise exception 'LOCKED: 承諾書の文面が新しくなりました。再読み込みして最新の文面をご確認ください' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.case_handovers h where h.quote_request_id = p_request_id and h.status = 'handed_over') then
    raise exception 'LOCKED: お引渡しの後に設定できます' using errcode = 'P0001';
  end if;
  insert into public.disaster_consents (quote_request_id, user_id, text_id, decision, conditions)
  values (p_request_id, v_uid, v_text.id, p_decision, case when p_decision = 'conditional' then v_conditions end)
  returning id into v_id;
  if p_decision = 'declined' then
    update public.stock_ledger_entries
       set registration_status = 'suspended', lock_version = lock_version + 1
     where quote_request_id = p_request_id and registration_status = 'registered';
  end if;
  perform public.notify(null, 'admin', 'disaster_consent_set',
    'お客様が災害時提供の意思を設定しました（' || case p_decision when 'accepted' then '承諾' when 'conditional' then '条件付き承諾' else '不承諾' end || '）',
    '全国ストック台帳で、登録と提供の可否を確認してください。', '/admin/stock-ledger');
  return v_id;
end;
$$;

-- ---------- RPC：全国ストック台帳（本部だけ） ----------

create function public.save_stock_ledger_entry(p_unit_id uuid, p_entry jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_unit public.manufacturing_units;
  v_row public.stock_ledger_entries;
  v_status text;
  v_decision text;
  v_inspected date;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 全国ストック台帳を編集できるのは本部だけです' using errcode = '42501';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_status := coalesce(public.cf_text(p_entry, 'registration_status', 20, '登録状態'), 'registered');
  if v_status not in ('registered', 'suspended') then
    raise exception 'VALIDATION: 登録状態が正しくありません' using errcode = 'P0001';
  end if;
  v_inspected := public.cf_date(p_entry, 'last_inspection_on', '最終点検日');
  if v_inspected is not null and v_inspected > current_date then
    raise exception 'VALIDATION: 最終点検日は今日以前の日付にしてください' using errcode = 'P0001';
  end if;
  select * into v_unit from public.manufacturing_units where id = p_unit_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_unit.status <> 'handed_over' then
    raise exception 'LOCKED: 引渡し済みの個体だけ台帳に載せられます' using errcode = 'P0001';
  end if;
  select c.decision into v_decision from public.disaster_consents c
   where c.quote_request_id = v_unit.quote_request_id order by c.created_at desc, c.id desc limit 1;
  if v_status = 'registered' and coalesce(v_decision, '') not in ('accepted', 'conditional') then
    raise exception 'LOCKED: お客様が災害時提供を承諾（または条件付きで承諾）していない個体は登録できません' using errcode = 'P0001';
  end if;

  select * into v_row from public.stock_ledger_entries where unit_id = p_unit_id for update;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で台帳が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  insert into public.stock_ledger_entries as e (
    unit_id, quote_request_id, registration_status, operating_status, last_inspection_on,
    immediate_available, transportable, supply_72h, supply_7d, location_prefecture, location_municipality, note, judged_by, judged_at
  ) values (
    v_unit.id, v_unit.quote_request_id, v_status, public.cf_text(p_entry, 'operating_status', 200, '稼働状況'), v_inspected,
    coalesce((p_entry -> 'immediate_available') = 'true'::jsonb, false),
    coalesce((p_entry -> 'transportable') = 'true'::jsonb, false),
    coalesce((p_entry -> 'supply_72h') = 'true'::jsonb, false),
    coalesce((p_entry -> 'supply_7d') = 'true'::jsonb, false),
    public.cf_text(p_entry, 'location_prefecture', 10, '所在地（都道府県）'),
    public.cf_text(p_entry, 'location_municipality', 60, '所在地（市区町村）'),
    public.cf_text(p_entry, 'note', 1000, 'メモ'),
    v_uid, now()
  )
  on conflict (unit_id) do update
    set registration_status = excluded.registration_status,
        operating_status = excluded.operating_status,
        last_inspection_on = excluded.last_inspection_on,
        immediate_available = excluded.immediate_available,
        transportable = excluded.transportable,
        supply_72h = excluded.supply_72h,
        supply_7d = excluded.supply_7d,
        location_prefecture = excluded.location_prefecture,
        location_municipality = excluded.location_municipality,
        note = excluded.note,
        judged_by = excluded.judged_by,
        judged_at = excluded.judged_at,
        lock_version = e.lock_version + 1;
  return coalesce(v_row.lock_version, 0) + 1;
end;
$$;

-- ---------- 資料の削除：承諾書として記録した写しは消せない ----------

create or replace function public.delete_case_file(p_file_id uuid)
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
  if exists (select 1 from public.case_handovers h where h.certificate_file_id = f.id) then
    raise exception 'LOCKED: 工事完了承諾書として記録した写しは削除できません' using errcode = 'P0001';
  end if;
  delete from public.case_files where id = f.id;
  return f.storage_path;
end;
$$;

-- ---------- お客様向けの進み具合（契約の締結と引渡しの状態を足す。社内の情報は返さない） ----------

create or replace function public.get_case_progress(p_request_id uuid)
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
  o public.manufacturing_orders;
  h public.case_handovers;
  v_primary_name text;
begin
  if v_access is null then
    return null;
  end if;
  select * into w from public.case_workflows where quote_request_id = p_request_id;
  select * into s from public.site_surveys where quote_request_id = p_request_id;
  select * into o from public.manufacturing_orders where quote_request_id = p_request_id and status <> 'canceled';
  select * into h from public.case_handovers where quote_request_id = p_request_id;
  if w.primary_staff_id is not null then
    select p.full_name into v_primary_name from public.profiles p where p.id = w.primary_staff_id;
  end if;
  return jsonb_build_object(
    'acknowledged_at', w.acknowledged_at,
    'primary_staff_name', v_primary_name,
    'site_survey_status', coalesce(s.status, 'none'),
    'site_survey_completed_at', s.completed_at,
    -- 製造：状態と棟数・出荷済み・設置済みの数だけ（仕様のスナップショット・供給手配のメモは返さない）
    'manufacturing_status', coalesce(case when o.status = 'draft' then null else o.status end, 'none'),
    'unit_count', o.unit_count,
    'units_shipped', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('shipped', 'installed', 'handed_over')),
    'units_installed', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('installed', 'handed_over')),
    -- 契約は締結済みかどうかだけ（契約の中身は本部とお客様だけが読める）。担当代理店・製造の担当の画面の判定に使う
    'contract_signed', exists (select 1 from public.contracts c where c.quote_request_id = p_request_id and c.status = 'signed'),
    'handover_status', coalesce(h.status, 'none')
  );
end;
$$;

-- ---------- owner / EXECUTE ----------

do $acl$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.start_handover_inspection(uuid, jsonb, integer)'::regprocedure,
    'public.confirm_handover(uuid, text, jsonb, integer)'::regprocedure,
    'public.add_punch_item(uuid, text, integer)'::regprocedure,
    'public.set_punch_item_status(uuid, text, integer)'::regprocedure,
    'public.record_completion_certificate(uuid, uuid, date, integer)'::regprocedure,
    'public.complete_handover(uuid, date, integer)'::regprocedure,
    'public.create_after_service_request(uuid, jsonb)'::regprocedure,
    'public.update_after_service_request(uuid, jsonb, integer)'::regprocedure,
    'public.publish_disaster_consent_text(text, text)'::regprocedure,
    'public.set_disaster_consent(uuid, text, text, integer)'::regprocedure,
    'public.save_stock_ledger_entry(uuid, jsonb, integer)'::regprocedure,
    'public.delete_case_file(uuid)'::regprocedure,
    'public.get_case_progress(uuid)'::regprocedure
  ]
  loop
    execute format('alter function %s owner to postgres', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$acl$;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_table text;
  v_fn record;
  v_count integer := 0;
begin
  foreach v_table in array array['case_handovers', 'case_punch_items', 'after_service_requests', 'disaster_consent_texts',
                                 'disaster_consents', 'stock_ledger_entries']
  loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'POSTCONDITION: RLS must be enabled on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') then
      raise exception 'POSTCONDITION: % must be read-only for authenticated and closed for anon', v_table;
    end if;
  end loop;
  for v_fn in
    select p.oid::regprocedure as fn, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('start_handover_inspection', 'confirm_handover', 'add_punch_item', 'set_punch_item_status',
                         'record_completion_certificate', 'complete_handover', 'create_after_service_request',
                         'update_after_service_request', 'publish_disaster_consent_text', 'set_disaster_consent',
                         'save_stock_ledger_entry', 'delete_case_file', 'get_case_progress')
  loop
    v_count := v_count + 1;
    if has_function_privilege('anon', v_fn.fn, 'EXECUTE') or has_function_privilege('service_role', v_fn.fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn.fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn.fn;
    end if;
    if not v_fn.prosecdef or v_fn.owner <> 'postgres' or not (v_fn.proconfig @> array['search_path=""']) then
      raise exception 'POSTCONDITION: % must be SECURITY DEFINER with an empty search_path, owned by postgres', v_fn.fn;
    end if;
  end loop;
  if v_count <> 13 then
    raise exception 'POSTCONDITION: expected 13 functions, found %', v_count;
  end if;
end;
$postcondition$;

commit;
