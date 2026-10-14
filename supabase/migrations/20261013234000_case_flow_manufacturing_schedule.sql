-- 案件の進行（フローチャート第4版 フェーズ11〜13）：製造依頼と個体・工程表・施工の記録。
--
-- フェーズ11：担当代理店（または本部）が製造仕様を確定し、技術検討・製造の担当（総代理店）へ製造依頼を送る。総代理店が受領する。
--   製造依頼は締結済みの契約（電子・書面）がある案件だけ。1 つの案件に有効な製造依頼は 1 つ。
--   送るときに、契約した見積の明細を製造仕様のスナップショットとして残す（品名・数量だけ。価格は写さない）。
--   1 棟ごとに個体（manufacturing_units）を作り、製造・検査・出荷・設置・引渡しの状態を記録する。
--   注文番号・個体番号は採番の形式が先方の確認待ちのため、欄だけ用意して発行しない（order_no / unit_no は NULL）。
-- フェーズ12：工程表（case_schedule_items）。担当代理店・本部が作り、項目ごとにお客様へ見せるかを決める（初期値は見せない）。
--   総代理店は製造・品質検査・出荷の項目を作れる（お客様へ見せるかは担当代理店・本部が決める）。
-- フェーズ13：施工の記録（case_progress_reports）と写真（case_files の progress）。お客様へ見せるかを記録ごとに決める。
--   総代理店は製造の進み具合・技術支援を記録できる。
-- 既存の見積・契約の表と関数は変更しない。get_case_progress（お客様向けの進み具合）だけ、製造・工程を足して置き換える。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.case_access(uuid)') is null or to_regprocedure('public.get_case_progress(uuid)') is null then
    raise exception 'PRECONDITION: case flow (20261013220000) must be applied first';
  end if;
  if to_regprocedure('public.record_paper_contract(uuid, text, text, date, text)') is null then
    raise exception 'PRECONDITION: paper contracts (20261013230000) must be applied first';
  end if;
  if to_regclass('public.manufacturing_orders') is not null then
    raise exception 'PRECONDITION: manufacturing tables already exist; review before applying';
  end if;
end;
$preflight$;

-- ---------- 製造依頼（フェーズ11） ----------

create table public.manufacturing_orders (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  quote_id uuid not null references public.quotes(id) on delete restrict,
  manufacturer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'received', 'in_production', 'shipped', 'completed', 'canceled')),
  unit_count integer not null check (unit_count between 1 and 50),
  requested_delivery_on date,
  spec_note text check (spec_note is null or length(spec_note) <= 4000),
  spec_snapshot jsonb check (spec_snapshot is null or jsonb_typeof(spec_snapshot) = 'object'),
  supply_note text check (supply_note is null or length(supply_note) <= 2000),
  -- 注文番号は採番の形式が先方の確認待ち（発行しない）
  order_no text unique,
  sent_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 1000),
  lock_version integer not null default 1 check (lock_version >= 1),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manufacturing_orders_sent_fields check (
    status in ('draft', 'canceled') or (sent_at is not null and manufacturer_id is not null and spec_snapshot is not null)
  ),
  constraint manufacturing_orders_received_fields check (
    status not in ('received', 'in_production', 'shipped', 'completed') or received_at is not null
  ),
  constraint manufacturing_orders_canceled_fields check ((status = 'canceled') = (canceled_at is not null))
);

comment on table public.manufacturing_orders is
  '製造依頼（フェーズ11）。締結済みの契約がある案件だけ。送るときの見積の明細を製造仕様のスナップショットとして残す（価格は写さない）。注文番号は採番の形式が先方の確認待ち。';

create unique index manufacturing_orders_one_active_per_request on public.manufacturing_orders (quote_request_id) where status <> 'canceled';
create index manufacturing_orders_manufacturer_idx on public.manufacturing_orders (manufacturer_id, status);

create trigger trg_manufacturing_orders_updated before update on public.manufacturing_orders
  for each row execute function public.set_updated_at();

create table public.manufacturing_units (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.manufacturing_orders(id) on delete cascade,
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  seq integer not null check (seq between 1 and 50),
  -- 個体番号は採番の形式が先方の確認待ち（発行しない）
  unit_no text unique,
  status text not null default 'planned'
    check (status in ('planned', 'in_production', 'inspected', 'shipped', 'installed', 'handed_over')),
  produced_on date,
  inspected_on date,
  shipped_on date,
  installed_on date,
  handed_over_on date,
  note text check (note is null or length(note) <= 1000),
  lock_version integer not null default 1 check (lock_version >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manufacturing_units_seq_key unique (order_id, seq)
);

comment on table public.manufacturing_units is
  '製造の個体（1 棟ごと）。製造・検査・出荷・設置・引渡しの状態。個体番号は採番の形式が先方の確認待ち。';

create trigger trg_manufacturing_units_updated before update on public.manufacturing_units
  for each row execute function public.set_updated_at();

-- ---------- 工程表（フェーズ12） ----------

create table public.case_schedule_items (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  category text not null check (category in ('manufacturing', 'inspection', 'shipping', 'delivery', 'foundation', 'installation',
                                             'electrical', 'plumbing', 'equipment', 'handover', 'other')),
  title text not null check (btrim(title) <> '' and length(title) <= 100),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'delayed')),
  customer_visible boolean not null default false,
  -- お客様に見せる項目では、お客様にも表示される
  note text check (note is null or length(note) <= 1000),
  sort_order integer not null default 0,
  lock_version integer not null default 1 check (lock_version >= 1),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_schedule_items_planned_range check (planned_end is null or planned_start is null or planned_end >= planned_start),
  constraint case_schedule_items_actual_range check (actual_end is null or actual_start is null or actual_end >= actual_start)
);

comment on table public.case_schedule_items is
  '工程表（フェーズ12）。お客様には customer_visible の項目だけを見せる（初期値は見せない）。';

create index case_schedule_items_request_idx on public.case_schedule_items (quote_request_id, sort_order, planned_start);

create trigger trg_case_schedule_items_updated before update on public.case_schedule_items
  for each row execute function public.set_updated_at();

-- ---------- 施工の記録（フェーズ13） ----------

create table public.case_progress_reports (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  schedule_item_id uuid references public.case_schedule_items(id) on delete set null,
  kind text not null check (kind in ('progress', 'completion', 'inspection', 'support')),
  title text not null check (btrim(title) <> '' and length(title) <= 100),
  body text check (body is null or length(body) <= 4000),
  reported_on date not null,
  customer_visible boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  author_name text not null check (length(author_name) <= 100),
  created_at timestamptz not null default now()
);

comment on table public.case_progress_reports is
  '施工の記録（フェーズ13：搬入・設置・基礎・給排水・電気の進み具合、検査、技術支援）。写真は case_files（progress）。お客様には customer_visible の記録だけ。';

create index case_progress_reports_request_idx on public.case_progress_reports (quote_request_id, reported_on desc);

-- ---------- RLS / ACL ----------

alter table public.manufacturing_orders enable row level security;
alter table public.manufacturing_units enable row level security;
alter table public.case_schedule_items enable row level security;
alter table public.case_progress_reports enable row level security;

create policy manufacturing_orders_read on public.manufacturing_orders for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer'));
create policy manufacturing_units_read on public.manufacturing_units for select to authenticated
  using (public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer'));
create policy case_schedule_items_read on public.case_schedule_items for select to authenticated
  using (
    public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer')
    or (customer_visible and public.case_access(quote_request_id) = 'customer')
  );
create policy case_progress_reports_read on public.case_progress_reports for select to authenticated
  using (
    public.case_access(quote_request_id) in ('admin', 'staff', 'manufacturer')
    or (customer_visible and public.case_access(quote_request_id) = 'customer')
  );

revoke all on public.manufacturing_orders from public, anon, authenticated;
revoke all on public.manufacturing_units from public, anon, authenticated;
revoke all on public.case_schedule_items from public, anon, authenticated;
revoke all on public.case_progress_reports from public, anon, authenticated;
grant select on public.manufacturing_orders to authenticated;
grant select on public.manufacturing_units to authenticated;
grant select on public.case_schedule_items to authenticated;
grant select on public.case_progress_reports to authenticated;

-- ---------- 内部の関数 ----------

-- jsonb の日付（YYYY-MM-DD）を取り出す。空なら NULL。形式が違えば VALIDATION
create function public.cf_date(p_obj jsonb, p_key text, p_label text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'VALIDATION: %の形式が正しくありません', p_label using errcode = 'P0001';
  end if;
  begin
    return v_text::date;
  exception when others then
    raise exception 'VALIDATION: %の形式が正しくありません', p_label using errcode = 'P0001';
  end;
end;
$$;

-- 案件の担当代理店（現在の見積の担当）
create function public.case_dealer_id(p_request_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select q.dealer_id from public.quote_requests r join public.quotes q on q.id = r.quote_id where r.id = p_request_id;
$$;

-- ---------- RPC：製造依頼 ----------

create function public.create_manufacturing_order(p_request_id uuid, p_order jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_contract public.contracts;
  v_count integer;
  v_delivery date;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 製造依頼を作れるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  -- 数字かどうかを先に確かめてから整数にする（条件の評価順は決まっていないため、1 つの式にまとめない）
  if coalesce(p_order ->> 'unit_count', '') !~ '^\d{1,2}$' then
    raise exception 'VALIDATION: 棟数は 1〜50 で入力してください' using errcode = 'P0001';
  end if;
  v_count := (p_order ->> 'unit_count')::integer;
  if v_count not between 1 and 50 then
    raise exception 'VALIDATION: 棟数は 1〜50 で入力してください' using errcode = 'P0001';
  end if;
  v_delivery := public.cf_date(p_order, 'requested_delivery_on', '希望納期');
  if v_delivery is not null and (v_delivery < current_date or v_delivery > current_date + 1095) then
    raise exception 'VALIDATION: 希望納期は今日から 3 年以内の日付にしてください' using errcode = 'P0001';
  end if;

  perform 1 from public.quote_requests r where r.id = p_request_id for update;
  select * into v_contract from public.contracts c
   where c.quote_request_id = p_request_id and c.status = 'signed'
   order by c.signed_at desc limit 1;
  if not found then
    raise exception 'LOCKED: 契約が締結されてから製造依頼を作れます' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.manufacturing_orders o where o.quote_request_id = p_request_id and o.status <> 'canceled') then
    raise exception 'LOCKED: この案件には製造依頼があります' using errcode = 'P0001';
  end if;

  insert into public.manufacturing_orders (quote_request_id, contract_id, quote_id, unit_count, requested_delivery_on, spec_note, created_by, updated_by)
  values (p_request_id, v_contract.id, v_contract.quote_id, v_count, v_delivery,
          public.cf_text(p_order, 'spec_note', 4000, '製造仕様のメモ'), v_uid, v_uid)
  returning id into v_id;
  insert into public.manufacturing_units (order_id, quote_request_id, seq, updated_by)
  select v_id, p_request_id, s, v_uid from generate_series(1, v_count) as s;
  return v_id;
end;
$$;

create function public.update_manufacturing_order(p_order_id uuid, p_order jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  o public.manufacturing_orders;
  v_access text;
  v_count integer;
  v_delivery date;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into o from public.manufacturing_orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(o.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 製造依頼を変更できるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  if o.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で製造依頼が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if o.status = 'canceled' then
    raise exception 'LOCKED: 取り消した製造依頼は変更できません' using errcode = 'P0001';
  end if;

  if o.status = 'draft' then
    if coalesce(p_order ->> 'unit_count', '') !~ '^\d{1,2}$' then
      raise exception 'VALIDATION: 棟数は 1〜50 で入力してください' using errcode = 'P0001';
    end if;
    v_count := (p_order ->> 'unit_count')::integer;
    if v_count not between 1 and 50 then
      raise exception 'VALIDATION: 棟数は 1〜50 で入力してください' using errcode = 'P0001';
    end if;
    v_delivery := public.cf_date(p_order, 'requested_delivery_on', '希望納期');
    if v_delivery is not null and (v_delivery < current_date or v_delivery > current_date + 1095) then
      raise exception 'VALIDATION: 希望納期は今日から 3 年以内の日付にしてください' using errcode = 'P0001';
    end if;
    update public.manufacturing_orders
       set unit_count = v_count,
           requested_delivery_on = v_delivery,
           spec_note = public.cf_text(p_order, 'spec_note', 4000, '製造仕様のメモ'),
           supply_note = case when v_access = 'admin' then public.cf_text(p_order, 'supply_note', 2000, '基幹資材の供給手配') else supply_note end,
           lock_version = lock_version + 1,
           updated_by = v_uid
     where id = o.id;
    -- 送る前は個体に進み具合が無いため、棟数に合わせて作り直す
    if v_count <> o.unit_count then
      delete from public.manufacturing_units where order_id = o.id;
      insert into public.manufacturing_units (order_id, quote_request_id, seq, updated_by)
      select o.id, o.quote_request_id, s, v_uid from generate_series(1, v_count) as s;
    end if;
  else
    -- 送った後は、本部の基幹資材の供給手配のメモだけ変えられる
    if v_access <> 'admin' then
      raise exception 'LOCKED: 送った製造依頼は変更できません（本部の供給手配のメモだけ変更できます）' using errcode = 'P0001';
    end if;
    update public.manufacturing_orders
       set supply_note = public.cf_text(p_order, 'supply_note', 2000, '基幹資材の供給手配'),
           lock_version = lock_version + 1,
           updated_by = v_uid
     where id = o.id;
  end if;
  return o.lock_version + 1;
end;
$$;

create function public.send_manufacturing_order(p_order_id uuid, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  o public.manufacturing_orders;
  v_access text;
  v_manufacturer uuid;
  q public.quotes;
  v_snapshot jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into o from public.manufacturing_orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(o.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: 製造依頼を送れるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if o.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で製造依頼が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if o.status <> 'draft' then
    raise exception 'LOCKED: この製造依頼はすでに送っています' using errcode = 'P0001';
  end if;
  select w.manufacturer_id into v_manufacturer from public.case_workflows w where w.quote_request_id = o.quote_request_id;
  if v_manufacturer is null then
    raise exception 'LOCKED: 先に本部が技術検討・製造の担当（総代理店）を決めてください' using errcode = 'P0001';
  end if;

  -- 契約した見積の明細を、製造仕様のスナップショットとして残す（品名・数量だけ。価格は写さない）
  select * into q from public.quotes where id = o.quote_id;
  v_snapshot := jsonb_build_object(
    'quote_no', q.quote_no,
    'revision', q.revision,
    'base_model_name', q.base_model_name,
    'spec_code', to_jsonb(q) ->> 'spec_code',
    'finish_level', to_jsonb(q) ->> 'finish_level',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', qi.kind,
               'name', qi.name,
               'quantity', qi.quantity,
               'unit', to_jsonb(qi) ->> 'unit'
             ) order by qi.sort_order)
        from public.quote_items qi where qi.quote_id = q.id
    ), '[]'::jsonb)
  );

  update public.manufacturing_orders
     set status = 'sent', manufacturer_id = v_manufacturer, spec_snapshot = v_snapshot, sent_at = now(),
         lock_version = lock_version + 1, updated_by = v_uid
   where id = o.id;
  perform public.notify(v_manufacturer, 'dealer', 'manufacturing_order_sent', '製造依頼が届きました',
    '製造仕様・棟数・希望納期を確認し、受領してください。', '/admin/manufacturing');
  perform public.notify(null, 'admin', 'manufacturing_order_sent', '製造依頼を総代理店へ送りました',
    '案件の「製造・施工」タブで状況を確認できます。', '/admin/manufacturing');
  return o.lock_version + 1;
end;
$$;

create function public.set_manufacturing_order_status(p_order_id uuid, p_status text, p_expected_lock_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  o public.manufacturing_orders;
  v_access text;
  v_dealer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into o from public.manufacturing_orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(o.quote_request_id);
  -- 誰がどの状態にできるか（権限は状態の判定より前）
  if v_access is null
     or (p_status in ('received', 'in_production', 'shipped') and v_access not in ('admin', 'manufacturer'))
     or (p_status = 'completed' and v_access not in ('admin', 'staff'))
     or (p_status = 'canceled' and v_access <> 'admin')
     or p_status not in ('received', 'in_production', 'shipped', 'completed', 'canceled') then
    raise exception 'FORBIDDEN: この製造依頼をその状態にする権限がありません' using errcode = '42501';
  end if;
  if o.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で製造依頼が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if not (
    (o.status = 'sent' and p_status = 'received')
    or (o.status = 'received' and p_status = 'in_production')
    or (o.status = 'in_production' and p_status = 'shipped')
    or (o.status = 'shipped' and p_status = 'completed')
    or (o.status not in ('completed', 'canceled') and p_status = 'canceled')
  ) then
    raise exception 'LOCKED: この製造依頼はその状態に変更できません' using errcode = 'P0001';
  end if;
  if p_status = 'canceled' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'VALIDATION: 取り消す理由を入力してください' using errcode = 'P0001';
  end if;

  update public.manufacturing_orders
     set status = p_status,
         received_at = case when p_status = 'received' then now() else received_at end,
         completed_at = case when p_status = 'completed' then now() else completed_at end,
         canceled_at = case when p_status = 'canceled' then now() else canceled_at end,
         cancel_reason = case when p_status = 'canceled' then left(btrim(p_reason), 1000) else cancel_reason end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = o.id;

  v_dealer := public.case_dealer_id(o.quote_request_id);
  if p_status in ('received', 'shipped') then
    perform public.notify(null, 'admin', 'manufacturing_order_' || p_status,
      case p_status when 'received' then '総代理店が製造依頼を受領しました' else '製造した個体を出荷しました' end,
      '案件の「製造・施工」タブで状況を確認できます。', '/admin/manufacturing');
    if v_dealer is not null then
      perform public.notify(v_dealer, 'dealer', 'manufacturing_order_' || p_status,
        case p_status when 'received' then '総代理店が製造依頼を受領しました' else '製造した個体を出荷しました' end,
        '案件の「製造・施工」タブで状況を確認できます。', '/admin/manufacturing');
    end if;
  end if;
  return o.lock_version + 1;
end;
$$;

-- 個体の状態。製造・検査・出荷は総代理店（と本部）、設置・引渡しは担当代理店（と本部）が記録する。状態は前へだけ進める（本部は戻せる）
create function public.update_manufacturing_unit(p_unit_id uuid, p_unit jsonb, p_expected_lock_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  u public.manufacturing_units;
  o public.manufacturing_orders;
  v_access text;
  v_status text;
  v_rank_old integer;
  v_rank_new integer;
  v_order constant text[] := array['planned', 'in_production', 'inspected', 'shipped', 'installed', 'handed_over'];
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into u from public.manufacturing_units where id = p_unit_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(u.quote_request_id);
  if v_access is null or v_access = 'customer' then
    raise exception 'FORBIDDEN: 個体の状態を記録できるのは本部・担当代理店・製造の担当だけです' using errcode = '42501';
  end if;
  if p_unit is null or jsonb_typeof(p_unit) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_status := coalesce(public.cf_text(p_unit, 'status', 20, '個体の状態'), u.status);
  v_rank_new := array_position(v_order, v_status);
  v_rank_old := array_position(v_order, u.status);
  if v_rank_new is null then
    raise exception 'VALIDATION: 個体の状態が正しくありません' using errcode = 'P0001';
  end if;
  if (v_status in ('in_production', 'inspected', 'shipped') and v_status <> u.status and v_access not in ('admin', 'manufacturer'))
     or (v_status in ('installed', 'handed_over') and v_status <> u.status and v_access not in ('admin', 'staff')) then
    raise exception 'FORBIDDEN: この状態を記録する権限がありません' using errcode = '42501';
  end if;
  if u.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面で個体の状態が更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  select * into o from public.manufacturing_orders where id = u.order_id;
  if o.status in ('draft', 'canceled') then
    raise exception 'LOCKED: 送っていない（または取り消した）製造依頼の個体は記録できません' using errcode = 'P0001';
  end if;
  if v_rank_new < v_rank_old and v_access <> 'admin' then
    raise exception 'LOCKED: 個体の状態は前へだけ進められます（戻すときは本部へご連絡ください）' using errcode = 'P0001';
  end if;

  update public.manufacturing_units
     set status = v_status,
         produced_on = coalesce(public.cf_date(p_unit, 'produced_on', '製造日'), produced_on),
         inspected_on = coalesce(public.cf_date(p_unit, 'inspected_on', '検査日'), inspected_on),
         shipped_on = coalesce(public.cf_date(p_unit, 'shipped_on', '出荷日'), shipped_on),
         installed_on = coalesce(public.cf_date(p_unit, 'installed_on', '設置日'), installed_on),
         handed_over_on = coalesce(public.cf_date(p_unit, 'handed_over_on', '引渡し日'), handed_over_on),
         note = case when p_unit ? 'note' then public.cf_text(p_unit, 'note', 1000, '個体のメモ') else note end,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = u.id;
  return u.lock_version + 1;
end;
$$;

-- ---------- RPC：工程表 ----------

create function public.save_case_schedule_item(p_request_id uuid, p_item_id uuid, p_item jsonb, p_expected_lock_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_row public.case_schedule_items;
  v_category text;
  v_title text;
  v_status text;
  v_visible boolean;
  v_ps date; v_pe date; v_as date; v_ae date;
  v_id uuid;
  v_version integer;
  v_customer uuid;
  v_became_visible boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access = 'customer' then
    raise exception 'FORBIDDEN: 工程表を編集できるのは本部・担当代理店・製造の担当だけです' using errcode = '42501';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_category := public.cf_text(p_item, 'category', 20, '工程の種類');
  if v_category is null or v_category not in ('manufacturing', 'inspection', 'shipping', 'delivery', 'foundation', 'installation',
                                              'electrical', 'plumbing', 'equipment', 'handover', 'other') then
    raise exception 'VALIDATION: 工程の種類が正しくありません' using errcode = 'P0001';
  end if;
  -- 総代理店は製造・品質検査・出荷の工程だけ
  if v_access = 'manufacturer' and v_category not in ('manufacturing', 'inspection', 'shipping') then
    raise exception 'FORBIDDEN: 製造の担当が編集できるのは、製造・品質検査・出荷の工程だけです' using errcode = '42501';
  end if;
  v_title := public.cf_text(p_item, 'title', 100, '工程名');
  if v_title is null then
    raise exception 'VALIDATION: 工程名を入力してください' using errcode = 'P0001';
  end if;
  v_status := coalesce(public.cf_text(p_item, 'status', 20, '工程の状態'), 'planned');
  if v_status not in ('planned', 'in_progress', 'done', 'delayed') then
    raise exception 'VALIDATION: 工程の状態が正しくありません' using errcode = 'P0001';
  end if;
  v_ps := public.cf_date(p_item, 'planned_start', '予定の開始日');
  v_pe := public.cf_date(p_item, 'planned_end', '予定の終了日');
  v_as := public.cf_date(p_item, 'actual_start', '実績の開始日');
  v_ae := public.cf_date(p_item, 'actual_end', '実績の終了日');
  if (v_pe is not null and v_ps is not null and v_pe < v_ps) or (v_ae is not null and v_as is not null and v_ae < v_as) then
    raise exception 'VALIDATION: 終了日は開始日以降にしてください' using errcode = 'P0001';
  end if;
  -- お客様へ見せるかは、担当代理店・本部が決める
  v_visible := coalesce((p_item -> 'customer_visible') = 'true'::jsonb, false);

  if p_item_id is null then
    insert into public.case_schedule_items (
      quote_request_id, category, title, planned_start, planned_end, actual_start, actual_end, status,
      customer_visible, note, sort_order, created_by, updated_by
    ) values (
      p_request_id, v_category, v_title, v_ps, v_pe, v_as, v_ae, v_status,
      case when v_access in ('admin', 'staff') then v_visible else false end,
      public.cf_text(p_item, 'note', 1000, 'メモ'),
      coalesce((select max(i.sort_order) + 1 from public.case_schedule_items i where i.quote_request_id = p_request_id), 0),
      v_uid, v_uid
    )
    returning id, lock_version, customer_visible into v_id, v_version, v_became_visible;
  else
    select * into v_row from public.case_schedule_items where id = p_item_id for update;
    if not found or v_row.quote_request_id <> p_request_id then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_access = 'manufacturer' and v_row.category not in ('manufacturing', 'inspection', 'shipping') then
      raise exception 'FORBIDDEN: 製造の担当が編集できるのは、製造・品質検査・出荷の工程だけです' using errcode = '42501';
    end if;
    if v_row.lock_version is distinct from p_expected_lock_version then
      raise exception 'LOCKED: 他の画面で工程表が更新されています。再読み込みしてください' using errcode = 'P0001';
    end if;
    update public.case_schedule_items
       set category = v_category, title = v_title, planned_start = v_ps, planned_end = v_pe, actual_start = v_as, actual_end = v_ae,
           status = v_status,
           customer_visible = case when v_access in ('admin', 'staff') then v_visible else customer_visible end,
           note = public.cf_text(p_item, 'note', 1000, 'メモ'),
           lock_version = lock_version + 1,
           updated_by = v_uid
     where id = v_row.id
    returning id, lock_version into v_id, v_version;
    v_became_visible := v_access in ('admin', 'staff') and v_visible and not v_row.customer_visible;
  end if;

  if v_became_visible then
    select r.user_id into v_customer from public.quote_requests r where r.id = p_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'case_schedule_updated', '工程表を更新しました',
        'マイページの「ご依頼の進み具合」で、製造・施工の予定をご確認いただけます。', '/mypage/cases/' || p_request_id::text);
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'lock_version', v_version);
end;
$$;

create function public.delete_case_schedule_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.case_schedule_items;
  v_access text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_row from public.case_schedule_items where id = p_item_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(v_row.quote_request_id);
  if v_access is null or v_access = 'customer' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_access = 'manufacturer' and v_row.category not in ('manufacturing', 'inspection', 'shipping') then
    raise exception 'FORBIDDEN: 製造の担当が削除できるのは、製造・品質検査・出荷の工程だけです' using errcode = '42501';
  end if;
  delete from public.case_schedule_items where id = v_row.id;
end;
$$;

-- ---------- RPC：施工の記録 ----------

create function public.add_case_progress_report(p_request_id uuid, p_report jsonb)
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
  v_on date;
  v_visible boolean;
  v_item uuid;
  v_id uuid;
  v_customer uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access = 'customer' then
    raise exception 'FORBIDDEN: 施工の記録を書けるのは本部・担当代理店・製造の担当だけです' using errcode = '42501';
  end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'VALIDATION: 入力内容を確認してください' using errcode = 'P0001';
  end if;
  v_kind := public.cf_text(p_report, 'kind', 20, '記録の種類');
  if v_kind is null or v_kind not in ('progress', 'completion', 'inspection', 'support') then
    raise exception 'VALIDATION: 記録の種類が正しくありません' using errcode = 'P0001';
  end if;
  if v_access = 'manufacturer' and v_kind not in ('progress', 'support') then
    raise exception 'FORBIDDEN: 製造の担当が書けるのは、進み具合と技術支援の記録だけです' using errcode = '42501';
  end if;
  v_title := public.cf_text(p_report, 'title', 100, '見出し');
  if v_title is null then
    raise exception 'VALIDATION: 見出しを入力してください' using errcode = 'P0001';
  end if;
  v_on := coalesce(public.cf_date(p_report, 'reported_on', '記録日'), current_date);
  if v_on > current_date then
    raise exception 'VALIDATION: 記録日は今日以前の日付にしてください' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_report ->> 'schedule_item_id', '')), '') is not null then
    begin
      v_item := (p_report ->> 'schedule_item_id')::uuid;
    exception when others then
      raise exception 'VALIDATION: 工程の指定が正しくありません' using errcode = 'P0001';
    end;
    if not exists (select 1 from public.case_schedule_items i where i.id = v_item and i.quote_request_id = p_request_id) then
      raise exception 'VALIDATION: 工程の指定が正しくありません' using errcode = 'P0001';
    end if;
  end if;
  v_visible := v_access in ('admin', 'staff') and coalesce((p_report -> 'customer_visible') = 'true'::jsonb, false);

  insert into public.case_progress_reports (quote_request_id, schedule_item_id, kind, title, body, reported_on, customer_visible, created_by, author_name)
  values (p_request_id, v_item, v_kind, v_title, public.cf_text(p_report, 'body', 4000, '内容'), v_on, v_visible, v_uid,
          left(coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = v_uid),
                        case v_access when 'admin' then '本部' when 'manufacturer' then '総代理店' else '担当代理店' end), 100))
  returning id into v_id;

  if v_visible then
    select r.user_id into v_customer from public.quote_requests r where r.id = p_request_id;
    if v_customer is not null then
      perform public.notify(v_customer, 'customer', 'case_progress_reported', '施工の様子を更新しました',
        v_title, '/mypage/cases/' || p_request_id::text);
    end if;
  end if;
  return v_id;
end;
$$;

create function public.set_case_progress_report_visibility(p_report_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.case_progress_reports;
  v_access text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_row from public.case_progress_reports where id = p_report_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_access := public.case_access(v_row.quote_request_id);
  if v_access is null or v_access not in ('admin', 'staff') then
    raise exception 'FORBIDDEN: お客様へ見せるかを決められるのは本部と担当代理店だけです' using errcode = '42501';
  end if;
  if p_visible is null then
    raise exception 'VALIDATION: 表示の指定がありません' using errcode = 'P0001';
  end if;
  update public.case_progress_reports set customer_visible = p_visible where id = v_row.id;
end;
$$;

-- ---------- お客様向けの進み具合（製造・工程を足す。社内の情報は返さない） ----------

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
  v_primary_name text;
begin
  if v_access is null then
    return null;
  end if;
  select * into w from public.case_workflows where quote_request_id = p_request_id;
  select * into s from public.site_surveys where quote_request_id = p_request_id;
  select * into o from public.manufacturing_orders where quote_request_id = p_request_id and status <> 'canceled';
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
    'units_installed', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('installed', 'handed_over'))
  );
end;
$$;

-- ---------- owner / EXECUTE ----------

do $acl$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.cf_date(jsonb, text, text)'::regprocedure,
    'public.case_dealer_id(uuid)'::regprocedure,
    'public.create_manufacturing_order(uuid, jsonb)'::regprocedure,
    'public.update_manufacturing_order(uuid, jsonb, integer)'::regprocedure,
    'public.send_manufacturing_order(uuid, integer)'::regprocedure,
    'public.set_manufacturing_order_status(uuid, text, integer, text)'::regprocedure,
    'public.update_manufacturing_unit(uuid, jsonb, integer)'::regprocedure,
    'public.save_case_schedule_item(uuid, uuid, jsonb, integer)'::regprocedure,
    'public.delete_case_schedule_item(uuid)'::regprocedure,
    'public.add_case_progress_report(uuid, jsonb)'::regprocedure,
    'public.set_case_progress_report_visibility(uuid, boolean)'::regprocedure,
    'public.get_case_progress(uuid)'::regprocedure
  ]
  loop
    execute format('alter function %s owner to postgres', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'public.create_manufacturing_order(uuid, jsonb)'::regprocedure,
    'public.update_manufacturing_order(uuid, jsonb, integer)'::regprocedure,
    'public.send_manufacturing_order(uuid, integer)'::regprocedure,
    'public.set_manufacturing_order_status(uuid, text, integer, text)'::regprocedure,
    'public.update_manufacturing_unit(uuid, jsonb, integer)'::regprocedure,
    'public.save_case_schedule_item(uuid, uuid, jsonb, integer)'::regprocedure,
    'public.delete_case_schedule_item(uuid)'::regprocedure,
    'public.add_case_progress_report(uuid, jsonb)'::regprocedure,
    'public.set_case_progress_report_visibility(uuid, boolean)'::regprocedure,
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
  foreach v_table in array array['manufacturing_orders', 'manufacturing_units', 'case_schedule_items', 'case_progress_reports']
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
    select p.oid::regprocedure as fn, p.proname, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('cf_date', 'case_dealer_id', 'create_manufacturing_order', 'update_manufacturing_order', 'send_manufacturing_order',
                         'set_manufacturing_order_status', 'update_manufacturing_unit', 'save_case_schedule_item', 'delete_case_schedule_item',
                         'add_case_progress_report', 'set_case_progress_report_visibility', 'get_case_progress')
  loop
    if has_function_privilege('anon', v_fn.fn, 'EXECUTE') or has_function_privilege('service_role', v_fn.fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon / service_role', v_fn.fn;
    end if;
    if v_fn.owner <> 'postgres' or not (v_fn.proconfig @> array['search_path=""']) then
      raise exception 'POSTCONDITION: % must be owned by postgres with an empty search_path', v_fn.fn;
    end if;
    if v_fn.proname <> 'cf_date' and not v_fn.prosecdef then
      raise exception 'POSTCONDITION: % must be SECURITY DEFINER', v_fn.fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.cf_date(jsonb, text, text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.case_dealer_id(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'POSTCONDITION: internal helpers must stay internal';
  end if;
end;
$postcondition$;

commit;
