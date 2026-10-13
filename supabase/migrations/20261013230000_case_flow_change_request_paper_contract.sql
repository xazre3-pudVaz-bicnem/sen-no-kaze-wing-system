-- 案件の進行（フローチャート第4版 フェーズ9〜10）：お客様からの見積の修正依頼と、書面（紙）で締結した契約の記録。
--
-- フェーズ9：お客様は発行済みの現在の見積に「修正したい」と依頼できる（再見積への導線）。担当は対応済みにする。
--   承諾・辞退（respond_to_quote）は変えない。修正依頼は見積の状態を変えず、別の表に記録する。
-- フェーズ10：電子契約（GMOサイン、20261013150000）に加え、書面で締結した契約を本部が記録できる。
--   条件は電子契約と同じ（お客様が承諾した、案件の現在の確定見積。同時に有効な契約は 1 つ）。
--   署名済みの書面（PDF）は非公開バケット contract-documents に置き、マイページ・本部の画面から同じ経路で開ける。
-- 着手金・入金のタイミング・分割払いは先方の確認待ちのため、この migration では扱わない。
-- 既存の見積・見積依頼の表と関数は変更しない（contracts は provider と状態の制約だけを広げる）。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.case_access(uuid)') is null then
    raise exception 'PRECONDITION: case flow (20261013220000) must be applied first';
  end if;
  if to_regclass('public.contracts') is null or to_regprocedure('public.begin_electronic_contract(uuid, text, text)') is null then
    raise exception 'PRECONDITION: electronic contracts (20261013150000) must be applied first';
  end if;
  if to_regclass('public.quote_change_requests') is not null then
    raise exception 'PRECONDITION: quote_change_requests already exists; review before applying';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_provider_check' and conrelid = 'public.contracts'::regclass)
     or not exists (select 1 from pg_catalog.pg_constraint where conname = 'contracts_status_fields' and conrelid = 'public.contracts'::regclass) then
    raise exception 'PRECONDITION: contracts constraints differ from 20261013150000; review before applying';
  end if;
end;
$preflight$;

-- ---------- 見積の修正依頼（フェーズ9） ----------

create table public.quote_change_requests (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  message text not null check (btrim(message) <> '' and length(message) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution is null or length(resolution) <= 1000),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_change_requests_resolved_fields check ((status = 'resolved') = (resolved_at is not null))
);

comment on table public.quote_change_requests is
  'お客様からの見積の修正依頼（フェーズ9「修正したい（再見積へ）」）。見積の状態は変えない。担当が対応済みにする。';

create unique index quote_change_requests_one_open_per_quote on public.quote_change_requests (quote_id) where status = 'open';
create index quote_change_requests_request_idx on public.quote_change_requests (quote_request_id, created_at desc);

create trigger trg_quote_change_requests_updated before update on public.quote_change_requests
  for each row execute function public.set_updated_at();

alter table public.quote_change_requests enable row level security;
create policy quote_change_requests_read on public.quote_change_requests for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'customer'));
revoke all on public.quote_change_requests from public, anon, authenticated;
grant select on public.quote_change_requests to authenticated;

create function public.request_quote_change(p_quote_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  q public.quotes;
  req public.quote_requests;
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote_id;
  -- 権限は状態の判定より前（見えない見積は存在も分からないようにする）
  if not found or q.user_id is distinct from v_uid then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_message = '' or length(v_message) > 2000 then
    raise exception 'VALIDATION: 修正したい内容を 2000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  -- lock の順序は既存の見積処理と同じ（Quote → QuoteRequest）
  select * into q from public.quotes where id = p_quote_id for update;
  select * into req from public.quote_requests where id = q.quote_request_id for update;
  if q.status <> 'issued' then
    raise exception 'LOCKED: 回答済み・取り消し済みの見積には修正を依頼できません' using errcode = 'P0001';
  end if;
  if req.quote_id is distinct from q.id then
    raise exception 'LOCKED: この見積は最新の版ではありません。最新の見積をご確認ください' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.quote_change_requests c where c.quote_id = q.id and c.status = 'open') then
    raise exception 'LOCKED: この見積には対応中の修正依頼があります。担当からのご連絡をお待ちください' using errcode = 'P0001';
  end if;

  insert into public.quote_change_requests (quote_request_id, quote_id, message, requested_by)
  values (req.id, q.id, v_message, v_uid)
  returning id into v_id;

  perform public.notify(null, 'admin', 'quote_change_requested', 'お客様から見積の修正依頼がありました：' || q.quote_no,
    left(v_message, 200), '/admin/quotes/' || q.id::text);
  if q.dealer_id is not null then
    perform public.notify(q.dealer_id, 'dealer', 'quote_change_requested', 'お客様から見積の修正依頼がありました：' || q.quote_no,
      left(v_message, 200), '/admin/quotes/' || q.id::text);
  end if;
  return v_id;
end;
$$;

create function public.resolve_quote_change_request(p_change_request_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.quote_change_requests;
  v_access text;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into c from public.quote_change_requests where id = p_change_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(c.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 修正依頼を対応済みにできるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if c.status <> 'open' then
    raise exception 'LOCKED: この修正依頼はすでに対応済みです' using errcode = 'P0001';
  end if;
  if length(coalesce(p_resolution, '')) > 1000 then
    raise exception 'VALIDATION: 対応内容は 1000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  update public.quote_change_requests
     set status = 'resolved', resolution = nullif(btrim(coalesce(p_resolution, '')), ''), resolved_by = v_uid, resolved_at = now()
   where id = c.id;
  select r.user_id into v_customer from public.quote_requests r where r.id = c.quote_request_id;
  if v_customer is not null then
    perform public.notify(v_customer, 'customer', 'quote_change_resolved', '見積の修正依頼に対応しました',
      coalesce(left(nullif(btrim(coalesce(p_resolution, '')), ''), 200), '担当からのご案内をご確認ください。'),
      '/mypage/cases/' || c.quote_request_id::text);
  end if;
end;
$$;

-- ---------- 書面で締結した契約（フェーズ10） ----------

alter table public.contracts drop constraint contracts_provider_check;
alter table public.contracts add constraint contracts_provider_check check (provider in ('gmosign', 'paper'));

alter table public.contracts drop constraint contracts_status_fields;
alter table public.contracts add constraint contracts_status_fields check (
  (status <> 'sent' or (envelope_xid is not null and sent_at is not null))
  and (status <> 'signed' or (signed_at is not null and signed_file_path is not null and (provider = 'paper' or envelope_xid is not null)))
  and (status <> 'canceled' or canceled_at is not null)
  -- 書面の契約は、締結済みとして記録する（誤って記録したときは本部が無効にする）。送信の流れは電子契約だけ
  and (provider <> 'paper' or (status in ('signed', 'canceled') and envelope_xid is null))
);

comment on column public.contracts.provider is 'gmosign：GMOサインの電子契約／paper：書面で締結した契約（本部が署名済みの PDF を記録）。';

create function public.record_paper_contract(
  p_quote_id uuid,
  p_signer_name text,
  p_signer_email text,
  p_signed_on date,
  p_file_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  q public.quotes;
  req public.quote_requests;
  v_id uuid;
  v_name text := btrim(coalesce(p_signer_name, ''));
  v_email text := lower(btrim(coalesce(p_signer_email, '')));
  v_path text := btrim(coalesce(p_file_path, ''));
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- 権限は状態の判定より前に確認する（本部だけ）
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 書面の契約を記録できるのは本部だけです' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 100 then
    raise exception 'VALIDATION: 署名者の氏名を入力してください' using errcode = 'P0001';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION: 署名者のメールアドレスの形式が正しくありません' using errcode = 'P0001';
  end if;
  if p_signed_on is null or p_signed_on > current_date or p_signed_on < current_date - 3650 then
    raise exception 'VALIDATION: 締結日を正しく入力してください' using errcode = 'P0001';
  end if;
  if v_path !~ '^contracts/paper/[0-9a-f-]{36}\.pdf$' then
    raise exception 'VALIDATION: 契約書の保存先が正しくありません' using errcode = 'P0001';
  end if;

  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into req from public.quote_requests where id = q.quote_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if q.user_id is null then
    raise exception 'LOCKED: お客様アカウントのある案件だけ契約を記録できます' using errcode = 'P0001';
  end if;
  if q.status <> 'accepted' then
    raise exception 'LOCKED: お客様が承諾した見積だけ契約を記録できます' using errcode = 'P0001';
  end if;
  if req.quote_id is distinct from q.id then
    raise exception 'LOCKED: この見積は案件の現在の版ではありません' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contracts c where c.quote_request_id = req.id and c.status in ('sending', 'sent', 'signed')) then
    raise exception 'LOCKED: この案件には送信中または締結済みの契約があります' using errcode = 'P0001';
  end if;

  insert into public.contracts (
    quote_request_id, quote_id, user_id, provider, status, signer_name, signer_email, contract_total,
    signed_file_path, signed_at, created_by, updated_by
  ) values (
    req.id, q.id, q.user_id, 'paper', 'signed', v_name, v_email, q.total,
    v_path, (p_signed_on::timestamp at time zone 'Asia/Tokyo'), v_uid, v_uid
  )
  returning id into v_id;

  perform public.notify(q.user_id, 'customer', 'contract_signed', 'ご契約の記録が完了しました',
    '書面でご締結いただいた契約書は、マイページの見積詳細からご確認いただけます。', '/mypage/quotes/' || q.id::text);
  return v_id;
end;
$$;

-- 誤って記録した書面の契約を、本部が理由を残して無効にする（記録は消さず、取り消しとして残す）
create function public.void_paper_contract(p_contract_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.contracts;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 書面の契約を無効にできるのは本部だけです' using errcode = '42501';
  end if;
  if v_reason = '' or length(v_reason) > 1000 then
    raise exception 'VALIDATION: 無効にする理由を 1000 文字以内で入力してください' using errcode = 'P0001';
  end if;
  select * into c from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if c.provider <> 'paper' or c.status <> 'signed' then
    raise exception 'LOCKED: 無効にできるのは、記録済みの書面の契約だけです' using errcode = 'P0001';
  end if;
  update public.contracts
     set status = 'canceled', canceled_at = now(), failure_reason = left(v_reason, 1000), updated_by = v_uid
   where id = c.id;
end;
$$;

-- ---------- owner / EXECUTE ----------

alter function public.void_paper_contract(uuid, text) owner to postgres;
revoke all on function public.void_paper_contract(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.void_paper_contract(uuid, text) to authenticated;

alter function public.request_quote_change(uuid, text) owner to postgres;
alter function public.resolve_quote_change_request(uuid, text) owner to postgres;
alter function public.record_paper_contract(uuid, text, text, date, text) owner to postgres;

revoke all on function public.request_quote_change(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_quote_change_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_paper_contract(uuid, text, text, date, text) from public, anon, authenticated, service_role;

grant execute on function public.request_quote_change(uuid, text) to authenticated;
grant execute on function public.resolve_quote_change_request(uuid, text) to authenticated;
grant execute on function public.record_paper_contract(uuid, text, text, date, text) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.quote_change_requests'::regclass) then
    raise exception 'POSTCONDITION: RLS must be enabled on quote_change_requests';
  end if;
  if has_table_privilege('anon', 'public.quote_change_requests', 'SELECT')
     or has_table_privilege('authenticated', 'public.quote_change_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.quote_change_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.quote_change_requests', 'DELETE')
     or has_table_privilege('authenticated', 'public.contracts', 'INSERT')
     or has_table_privilege('authenticated', 'public.contracts', 'UPDATE') then
    raise exception 'POSTCONDITION: change requests and contracts must be written through RPCs only';
  end if;
  foreach v_fn in array array[
    'public.request_quote_change(uuid, text)'::regprocedure,
    'public.resolve_quote_change_request(uuid, text)'::regprocedure,
    'public.record_paper_contract(uuid, text, text, date, text)'::regprocedure,
    'public.void_paper_contract(uuid, text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc p
       where p.oid = v_fn and p.prosecdef and p.proconfig @> array['search_path=""'] and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    ) then
      raise exception 'POSTCONDITION: % must be SECURITY DEFINER with an empty search_path, owned by postgres', v_fn;
    end if;
  end loop;
end;
$postcondition$;

commit;
