-- 電子契約（GMOサイン）：承諾済みの確定見積から、契約書をお客様へ送信して署名を記録する。
--
-- 範囲は本部とエンドユーザーだけ（代理店・総代理店は後の工程）。
--   * 契約書の本文は GMOサイン上の契約書テンプレート（本部が管理）を使い、コードに条文を持たない
--   * Quote / QuoteRequest / Snapshot は変更しない。契約の状態は contracts だけが持つ
--   * 契約金額は、送信時点の承諾済み見積の税込合計をスナップショットとして保存する（見積の金額は書き換えない）
--
-- 状態：sending（送信処理中）→ sent（お客様の署名待ち）→ signed（締結済み）
--       sending → failed（送信に失敗。やり直せる）／ sending・sent → canceled（取り消し）
-- 1 つの案件で同時に有効な契約（sending・sent・signed）は 1 つだけ。
--
-- 書き込みは RPC だけ。本部の操作（開始・送信済み・失敗・取り消し）は authenticated（本部だけ）、
-- 署名完了の記録は GMOサインの通知を受けたサーバーが署名済み文書を取得・保存した後に service_role で行う。
-- 署名済み文書は非公開バケット contract-documents（ポリシーなし＝サーバー側の service role のみ）に置く。

begin;

-- ---------- table ----------

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete restrict,
  quote_id uuid not null references public.quotes(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'gmosign' check (provider in ('gmosign')),
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'signed', 'canceled', 'failed')),
  signer_name text not null check (btrim(signer_name) <> '' and length(signer_name) <= 100),
  signer_email text not null
    check (length(signer_email) <= 254 and signer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contract_total integer not null check (contract_total >= 0),
  envelope_xid text,
  provider_document_id text,
  signed_file_path text,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 1000),
  sent_at timestamptz,
  signed_at timestamptz,
  canceled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_envelope_xid_key unique (envelope_xid),
  constraint contracts_status_fields check (
    (status <> 'sent' or (envelope_xid is not null and sent_at is not null))
    and (status <> 'signed' or (envelope_xid is not null and signed_at is not null and signed_file_path is not null))
    and (status <> 'canceled' or canceled_at is not null)
  )
);

comment on table public.contracts is
  '電子契約（GMOサイン）。承諾済み確定見積から送信した契約書と署名状態。Quote / Snapshot は変更しない。';
comment on column public.contracts.contract_total is '送信時点の承諾済み見積の税込合計（スナップショット）。';

create unique index contracts_one_active_per_request
  on public.contracts (quote_request_id)
  where status in ('sending', 'sent', 'signed');
create index contracts_quote_idx on public.contracts (quote_id);
create index contracts_user_idx on public.contracts (user_id);

create trigger trg_contracts_updated before update on public.contracts
  for each row execute function public.set_updated_at();

-- ---------- RLS / ACL ----------

alter table public.contracts enable row level security;

create policy contracts_read on public.contracts for select to authenticated
  using (user_id = auth.uid() or public.current_role_rank() >= 3);

revoke all on public.contracts from public, anon, authenticated;
grant select on public.contracts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-documents', 'contract-documents', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
-- contract-documents はポリシーなし（= anon / authenticated からは直接触れない。service role のみ）

-- ---------- RPC：本部が送信を開始する ----------

create function public.begin_electronic_contract(
  p_quote_id uuid,
  p_signer_name text,
  p_signer_email text
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
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- 権限は状態の判定より前に確認する（本部だけ）
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 電子契約を送信できるのは本部だけです' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 100 then
    raise exception 'VALIDATION: 署名者の氏名を入力してください' using errcode = 'P0001';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION: 署名者のメールアドレスの形式が正しくありません' using errcode = 'P0001';
  end if;

  -- lock の順序は既存の見積処理と同じ（Quote → QuoteRequest）
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into req from public.quote_requests where id = q.quote_request_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if q.user_id is null then
    raise exception 'LOCKED: お客様アカウントのある案件だけ電子契約を送信できます' using errcode = 'P0001';
  end if;
  if q.status <> 'accepted' then
    raise exception 'LOCKED: お客様が承諾した見積だけ契約書を送信できます' using errcode = 'P0001';
  end if;
  if req.quote_id is distinct from q.id then
    raise exception 'LOCKED: この見積は案件の現在の版ではありません' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.contracts c
     where c.quote_request_id = req.id and c.status in ('sending', 'sent', 'signed')
  ) then
    raise exception 'LOCKED: この案件には送信中または締結済みの契約があります' using errcode = 'P0001';
  end if;

  insert into public.contracts (quote_request_id, quote_id, user_id, signer_name, signer_email, contract_total, created_by, updated_by)
  values (req.id, q.id, q.user_id, v_name, v_email, q.total, v_uid, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- RPC：本部が送信結果を記録する ----------

create function public.record_electronic_contract_sent(
  p_contract_id uuid,
  p_envelope_xid text,
  p_document_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.contracts;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_envelope_xid, '')), '') is null then
    raise exception 'VALIDATION: 送信の識別子がありません' using errcode = 'P0001';
  end if;

  select * into c from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if c.status <> 'sending' then
    raise exception 'LOCKED: 送信処理中の契約ではありません' using errcode = 'P0001';
  end if;

  update public.contracts
     set status = 'sent',
         envelope_xid = btrim(p_envelope_xid),
         provider_document_id = nullif(btrim(coalesce(p_document_id, '')), ''),
         sent_at = now(),
         failure_reason = null,
         updated_by = v_uid
   where id = c.id;

  perform public.notify(c.user_id, 'customer', 'contract_sent', '契約書をお送りしました',
    'GMOサインからのメールのご案内に沿って、契約書の内容をご確認のうえ署名してください。',
    '/mypage/quotes/' || c.quote_id::text);
end;
$$;

create function public.record_electronic_contract_failed(
  p_contract_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.contracts;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into c from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if c.status <> 'sending' then
    raise exception 'LOCKED: 送信処理中の契約ではありません' using errcode = 'P0001';
  end if;

  update public.contracts
     set status = 'failed',
         failure_reason = left(coalesce(nullif(btrim(p_reason), ''), '送信に失敗しました'), 1000),
         updated_by = v_uid
   where id = c.id;
end;
$$;

create function public.cancel_electronic_contract(
  p_contract_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c public.contracts;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into c from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if c.status not in ('sending', 'sent') then
    raise exception 'LOCKED: 締結済み・取り消し済みの契約は取り消せません' using errcode = 'P0001';
  end if;

  update public.contracts
     set status = 'canceled',
         canceled_at = now(),
         failure_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 1000),
         updated_by = v_uid
   where id = c.id;
end;
$$;

-- ---------- RPC：署名完了の記録（GMOサインの通知を受けたサーバーだけ） ----------

create function public.record_electronic_contract_signed(
  p_envelope_xid text,
  p_document_id text,
  p_file_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contracts;
begin
  if nullif(btrim(coalesce(p_file_path, '')), '') is null then
    raise exception 'VALIDATION: 署名済み文書の保存先がありません' using errcode = 'P0001';
  end if;

  select * into c from public.contracts where envelope_xid = btrim(p_envelope_xid) for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 通知の重複は無視する（同じ封筒の再通知でも結果は変わらない）
  if c.status = 'signed' then
    return c.id;
  end if;
  if c.status <> 'sent' then
    raise exception 'LOCKED: 署名待ちの契約ではありません' using errcode = 'P0001';
  end if;

  update public.contracts
     set status = 'signed',
         signed_at = now(),
         signed_file_path = btrim(p_file_path),
         provider_document_id = coalesce(nullif(btrim(coalesce(p_document_id, '')), ''), provider_document_id)
   where id = c.id;

  perform public.notify(c.user_id, 'customer', 'contract_signed', '契約書の署名が完了しました',
    '締結済みの契約書はマイページの見積詳細からご確認いただけます。', '/mypage/quotes/' || c.quote_id::text);
  perform public.notify(null, 'admin', 'contract_signed', '契約書の署名が完了しました',
    'お客様の署名が完了しました。案件の契約書類タブで確認できます。', '/admin/quotes/' || c.quote_id::text || '?tab=documents');
  return c.id;
end;
$$;

-- ---------- owner / EXECUTE ----------

alter function public.begin_electronic_contract(uuid, text, text) owner to postgres;
alter function public.record_electronic_contract_sent(uuid, text, text) owner to postgres;
alter function public.record_electronic_contract_failed(uuid, text) owner to postgres;
alter function public.cancel_electronic_contract(uuid, text) owner to postgres;
alter function public.record_electronic_contract_signed(text, text, text) owner to postgres;

revoke all on function public.begin_electronic_contract(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_electronic_contract_sent(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_electronic_contract_failed(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.cancel_electronic_contract(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_electronic_contract_signed(text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.begin_electronic_contract(uuid, text, text) to authenticated;
grant execute on function public.record_electronic_contract_sent(uuid, text, text) to authenticated;
grant execute on function public.record_electronic_contract_failed(uuid, text) to authenticated;
grant execute on function public.cancel_electronic_contract(uuid, text) to authenticated;
grant execute on function public.record_electronic_contract_signed(text, text, text) to service_role;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.contracts'::regclass) then
    raise exception 'POSTCONDITION: RLS must be enabled on contracts';
  end if;
  if has_table_privilege('anon', 'public.contracts', 'SELECT')
     or has_table_privilege('authenticated', 'public.contracts', 'INSERT')
     or has_table_privilege('authenticated', 'public.contracts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.contracts', 'DELETE') then
    raise exception 'POSTCONDITION: contracts must be read-only for authenticated and closed for anon';
  end if;
  if exists (select 1 from storage.buckets where id = 'contract-documents' and public) then
    raise exception 'POSTCONDITION: contract-documents bucket must be private';
  end if;

  foreach v_fn in array array[
    'public.begin_electronic_contract(uuid, text, text)'::regprocedure,
    'public.record_electronic_contract_sent(uuid, text, text)'::regprocedure,
    'public.record_electronic_contract_failed(uuid, text)'::regprocedure,
    'public.cancel_electronic_contract(uuid, text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn;
    end if;
  end loop;

  v_fn := 'public.record_electronic_contract_signed(text, text, text)'::regprocedure;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'POSTCONDITION: record_electronic_contract_signed must be executable by service_role only';
  end if;
end;
$postcondition$;

commit;
