-- PR H：標準見積 → 見積（Quote）／見積の金額（統合版依頼書 §8・§9・§10）。
--
-- 8-1 作成：公開中の標準見積から見積下書きを作る。作り方（source kind）・元の標準見積 Revision・率・明細の写しを初回に持たせる。
--     経費は標準見積の経費の金額を写さず、経費率を写して、見積自身の区分小計から計算し直す。
--     見積側で率や明細を変えても標準見積へは戻さない。
-- 8-2 継承：第 2 版以降の下書きは直前の発行版から、明細・率・入力値・作り方・元の標準見積 Revision を引き継ぐ。
--     最新の標準見積へは自動で追従しない。
--     旧 round で発行した版から作る新しい版も trunc で計算し直す（発行済みの版はそのまま）。
-- 8-3 POR：下書きでは価格未確定（POR）を許可し、正式保存（発行）では 1 件でも残っていれば拒否する（fail closed）。
-- 8-4 内部原価：本部だけが読める専用の表に保存する（quote_draft_internals / quote_draft_item_costs / quote_internal_snapshots）。
--     quotes / quote_items には原価の列を足さない（select * や to_jsonb を使う既存の画面・PDF・API から漏れないようにする）。
--
-- あわせて次の 2 点を変える。
--   ・標準見積の閲覧（RLS）を本部だけにする。原価・率の列があるため。代理店向けは原価を除いた経路を後で設計する
--   ・手入力の見積も、新しい下書き・版の金額を trunc で計算する（依頼書 §6-2）。発行済みの見積は変えない
--
-- 既存の関数（save_quote_draft・finalize_quote_draft・finalize_quote_revision_draft・create_quote_revision_draft）は、
-- 適用済みの定義（pg_get_functiondef）を検査してから置き換える。
--   ・目印がそれぞれちょうど 1 箇所あることを確認する
--   ・想定と違う定義なら何も変更せずに停止する
--   ・owner・SECURITY DEFINER・search_path・EXECUTE は、置き換えの前後で変わらないことを検算する
-- 既存 migration は編集しない。発行済みの見積・標準見積のデータは変更しない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.save_standard_estimate_draft(uuid, numeric, numeric, numeric, integer, text, jsonb, jsonb, integer)') is null then
    raise exception 'PRECONDITION: standard estimate money contract (20261013170000) must be applied first';
  end if;
  if to_regprocedure('public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)') is null
     or to_regprocedure('public.finalize_quote_draft(uuid, integer)') is null
     or to_regprocedure('public.finalize_quote_revision_draft(uuid, integer)') is null
     or to_regprocedure('public.create_quote_revision_draft(uuid)') is null then
    raise exception 'PRECONDITION: non-web quote draft lifecycle is missing';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'quote_drafts' and column_name = 'source_kind') then
    raise exception 'PRECONDITION: quote_drafts.source_kind already exists; review before applying';
  end if;
end;
$preflight$;

-- ---------- 表 ----------

-- 見積下書きの作り方（手入力／標準見積）と、元の標準見積 Revision
alter table public.quote_drafts
  add column source_kind text not null default 'manual'
    constraint quote_drafts_source_kind_check check (source_kind in ('manual', 'standard_estimate')),
  add column standard_estimate_revision_id uuid
    references public.standard_estimate_revisions(id) on delete restrict,
  add constraint quote_drafts_standard_estimate_source check (
    (source_kind = 'manual' and standard_estimate_revision_id is null)
    or (source_kind = 'standard_estimate' and standard_estimate_revision_id is not null)
  );

comment on column public.quote_drafts.source_kind is
  '見積下書きの作り方。manual=手入力、standard_estimate=公開中の標準見積から作成（率・原価から DB が金額を計算する）。';
comment on column public.quote_drafts.standard_estimate_revision_id is
  '作成時に写した標準見積 Revision。第 2 版以降も直前の発行版から引き継ぎ、最新の標準見積へは追従しない。';

-- 明細の価格の決め方。POR（価格未確定）は単価・金額とも NULL（0 円とは別）
alter table public.quote_draft_items
  add column price_mode text not null default 'manual'
    constraint quote_draft_items_price_mode_check check (price_mode in ('manual', 'auto', 'por')),
  alter column unit_price drop not null,
  alter column amount drop not null,
  add constraint quote_draft_items_por_money check (
    (price_mode = 'por' and unit_price is null and amount is null)
    or (price_mode <> 'por' and unit_price is not null and amount is not null)
  );

comment on column public.quote_draft_items.price_mode is
  '価格の決め方。manual=売価を入力、auto=原価 × 掛率（標準見積から作成した見積）、por=価格未確定（単価・金額は NULL。発行できない）。';

-- 本部だけが使う下書きの率・内部原価（RPC からだけ読み書きする。API ロールには権限を付けない）
create table public.quote_draft_internals (
  draft_id uuid primary key references public.quote_drafts(id) on delete cascade,
  sales_fee_rate numeric(6, 4) not null,
  expense_rate numeric(6, 4) not null,
  markup_rate numeric(6, 4) not null,
  expense_methods jsonb not null,
  cost_total integer not null default 0 check (cost_total >= 0),
  updated_at timestamptz not null default now(),
  constraint quote_draft_internals_rate_ranges check (
    sales_fee_rate between 1.0000 and 1.5000
    and expense_rate between 0.0000 and 0.3000
    and markup_rate between 1.0000 and 2.5000
  ),
  constraint quote_draft_internals_expense_methods check (
    jsonb_typeof(expense_methods) = 'object'
    and expense_methods - array['base', 'interior_exterior', 'option', 'sitework'] = '{}'::jsonb
    and coalesce(expense_methods ->> 'base', '') in ('rate', 'none')
    and coalesce(expense_methods ->> 'interior_exterior', '') in ('rate', 'none')
    and coalesce(expense_methods ->> 'option', '') in ('rate', 'none')
    and coalesce(expense_methods ->> 'sitework', '') in ('rate', 'none')
  )
);

comment on table public.quote_draft_internals is
  '標準見積から作成した見積下書きの率（販売費率・経費率・掛率）・区分ごとの経費の方法・内部原価の合計。本部だけ（RPC 経由）。';

create table public.quote_draft_item_costs (
  draft_id uuid not null,
  line_key uuid not null,
  section_code text not null check (section_code in ('base', 'interior_exterior', 'option', 'sitework')),
  line_role text not null check (line_role in ('line', 'expense')),
  base_unit_cost integer check (base_unit_cost is null or base_unit_cost >= 0),
  cost_unit_price integer check (cost_unit_price is null or cost_unit_price >= 0),
  cost_amount integer check (cost_amount is null or cost_amount >= 0),
  primary key (draft_id, line_key),
  foreign key (draft_id, line_key) references public.quote_draft_items(draft_id, line_key) on delete cascade,
  constraint quote_draft_item_costs_shape check (
    (cost_unit_price is null) = (cost_amount is null)
    and (base_unit_cost is null or (section_code = 'base' and line_role = 'line'))
    and (line_role = 'line' or cost_amount is not null)
  )
);

comment on table public.quote_draft_item_costs is
  '見積下書きの明細ごとの内部原価。base_unit_cost は本体マスター由来の行の整数の基準原価単価（販売費率を掛ける前）。本部だけ（RPC 経由）。';

-- 発行済み見積の内部原価・率（標準見積から作成した見積だけ）。発行時に 1 回だけ書き、変更しない
create table public.quote_internal_snapshots (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  source_kind text not null check (source_kind = 'standard_estimate'),
  standard_estimate_revision_id uuid not null references public.standard_estimate_revisions(id) on delete restrict,
  sales_fee_rate numeric(6, 4) not null,
  expense_rate numeric(6, 4) not null,
  markup_rate numeric(6, 4) not null,
  expense_methods jsonb not null check (jsonb_typeof(expense_methods) = 'object'),
  subtotal integer not null,
  cost_total integer not null check (cost_total >= 0),
  gross_profit integer not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint quote_internal_snapshots_rate_ranges check (
    sales_fee_rate between 1.0000 and 1.5000
    and expense_rate between 0.0000 and 0.3000
    and markup_rate between 1.0000 and 2.5000
  ),
  constraint quote_internal_snapshots_profit check (gross_profit = subtotal - cost_total)
);

comment on table public.quote_internal_snapshots is
  '発行済み見積（標準見積から作成）の内部原価・使用した率・粗利の snapshot。再現性のために保存し、変更しない。本部だけが読める。';

create function public.prevent_quote_internal_snapshot_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $snapshot_immutable$
begin
  raise exception 'QUOTE_IMMUTABLE: 発行済み見積の内部原価・率は変更できません' using errcode = 'P0001';
end;
$snapshot_immutable$;

create trigger quote_internal_snapshots_immutable
before update on public.quote_internal_snapshots
for each row execute function public.prevent_quote_internal_snapshot_update();

alter table public.quote_draft_internals enable row level security;
alter table public.quote_draft_item_costs enable row level security;
alter table public.quote_internal_snapshots enable row level security;

revoke all privileges on table public.quote_draft_internals,
                                public.quote_draft_item_costs,
                                public.quote_internal_snapshots
from public, anon, authenticated;

grant all privileges on table public.quote_draft_internals,
                               public.quote_draft_item_costs,
                               public.quote_internal_snapshots
to service_role;

create policy quote_internal_snapshots_hq_read
on public.quote_internal_snapshots
for select
to authenticated
using (public.current_role_rank() >= 3);

grant select on public.quote_internal_snapshots to authenticated;

-- ---------- 標準見積の閲覧を本部だけにする ----------
-- 公開済みの標準見積には原価・率の列がある。代理店所属の利用者（is_active_standard_estimate_staff）が
-- 読める経路を閉じ、本部（admin・本部組織の所属）だけにする。

create or replace function public.can_view_standard_estimate_master(p_standard_estimate_master_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
         or exists (
           select 1
             from public.standard_estimate_masters m
             join public.organizations owner_org on owner_org.id = m.owner_organization_id
            where m.id = p_standard_estimate_master_id
              and owner_org.status = 'active'
              and owner_org.organization_type = 'headquarters'
              and public.current_organization_member_rank(owner_org.id) >= 1
         );
$$;

create or replace function public.can_view_standard_estimate_revision(p_standard_estimate_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
         or exists (
           select 1
             from public.standard_estimate_revisions r
             join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
             join public.organizations owner_org on owner_org.id = m.owner_organization_id
            where r.id = p_standard_estimate_revision_id
              and owner_org.status = 'active'
              and owner_org.organization_type = 'headquarters'
              and public.current_organization_member_rank(owner_org.id) >= 1
         );
$$;

-- ---------- 計算（内部。API からは実行させない） ----------
-- 標準見積の下書きの明細・率から、明細・経費の行・合計・内部原価を作り直す。
-- 式は標準見積（20261013170000）と同じで、すべての計算境界で trunc。
--   本体マスター由来の行：原価単価 = trunc(基準原価単価 × 販売費率)。基準原価単価はサーバーの値だけを使う
--   auto：売価単価 = trunc(原価単価 × 掛率)、manual：売価単価を入力、por：単価・金額とも NULL（合計に含めない）
--   明細額 = trunc(数量 × 単価)、経費 = trunc(区分の明細小計 × 経費率)（売価・原価それぞれ）、税 = trunc(小計 × 税率)
-- 経費の行は画面から受け取らず、保存のたびに区分ごとに作り直す（金額は写さない）。

create function public.apply_standard_quote_draft(
  p_draft_id uuid,
  p_sales_fee_rate numeric,
  p_expense_rate numeric,
  p_markup_rate numeric,
  p_expense_methods jsonb,
  p_lines jsonb,
  p_adjustment integer,
  p_adjustment_reason text,
  p_notes text,
  p_trust_base_unit_cost boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $apply_standard_quote$
declare
  v_uid uuid := auth.uid();
  d public.quote_drafts;
  v_sections constant text[] := array['base', 'interior_exterior', 'option', 'sitework'];
  v_methods jsonb := '{}'::jsonb;
  v_section text;
  v_method text;
  v_pos integer;
  v_existing jsonb;
  v_current_keys uuid[];
  v_parent_keys uuid[] := '{}'::uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_counts integer[] := array[0, 0, 0, 0];
  v_sale_sums numeric[] := array[0, 0, 0, 0];
  v_cost_sums numeric[] := array[0, 0, 0, 0];
  line jsonb;
  v_index integer := 0;
  v_key uuid;
  v_known jsonb;
  v_name text;
  v_mode text;
  v_qty numeric;
  v_base_cost integer;
  v_cost integer;
  v_sale integer;
  v_cost_amount numeric;
  v_sale_amount numeric;
  v_sale_exp numeric;
  v_cost_exp numeric;
  v_rate_label text;
  v_adjustment integer := coalesce(p_adjustment, 0);
  v_reason text := nullif(btrim(coalesce(p_adjustment_reason, '')), '');
  v_subtotal_raw numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_cost_total numeric;
  v_new_lock_version integer;
begin
  select * into d from public.quote_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.source_kind <> 'standard_estimate' then
    raise exception 'LOCKED: 標準見積から作成した見積下書きではありません' using errcode = 'P0001';
  end if;

  -- 率は標準見積と同じ範囲（本部管理の共通ルール）
  if p_sales_fee_rate is null or p_sales_fee_rate < 1 or p_sales_fee_rate > 1.5 or p_sales_fee_rate <> round(p_sales_fee_rate, 4) then
    raise exception 'VALIDATION: 販売費率は 100〜150%% の範囲で入力してください' using errcode = 'P0001';
  end if;
  if p_expense_rate is null or p_expense_rate < 0 or p_expense_rate > 0.3 or p_expense_rate <> round(p_expense_rate, 4) then
    raise exception 'VALIDATION: 経費率は 0〜30%% の範囲で入力してください' using errcode = 'P0001';
  end if;
  if p_markup_rate is null or p_markup_rate < 1 or p_markup_rate > 2.5 or p_markup_rate <> round(p_markup_rate, 4) then
    raise exception 'VALIDATION: 掛率は 100〜250%% の範囲で入力してください' using errcode = 'P0001';
  end if;
  if p_expense_methods is null or jsonb_typeof(p_expense_methods) <> 'object' then
    raise exception 'VALIDATION: 区分の経費の計算方法を指定してください' using errcode = 'P0001';
  end if;
  foreach v_section in array v_sections loop
    v_method := coalesce(p_expense_methods ->> v_section, case when v_section = 'sitework' then 'none' else 'rate' end);
    if v_method not in ('rate', 'none') then
      raise exception 'VALIDATION: 経費の計算方法は「率」か「なし」を選んでください（固定額は使えません）' using errcode = 'P0001';
    end if;
    v_methods := v_methods || jsonb_build_object(v_section, v_method);
  end loop;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'VALIDATION: 明細データが不正です' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 300 then
    raise exception 'VALIDATION: 明細は300行以内にしてください' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'VALIDATION: 調整理由は500文字以内で入力してください' using errcode = 'P0001';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'VALIDATION: メモは1000文字以内で入力してください' using errcode = 'P0001';
  end if;

  -- 保存前の明細と内部原価（本体マスター由来の基準原価単価・経費の行の明細 ID はここから引き継ぐ）
  select coalesce(jsonb_object_agg(c.line_key::text, jsonb_build_object(
           'section_code', c.section_code, 'line_role', c.line_role, 'base_unit_cost', c.base_unit_cost)), '{}'::jsonb)
    into v_existing
    from public.quote_draft_item_costs c
   where c.draft_id = d.id;
  select coalesce(array_agg(i.line_key), '{}'::uuid[])
    into v_current_keys
    from public.quote_draft_items i
   where i.draft_id = d.id;
  if d.parent_quote_id is not null then
    select coalesce(array_agg(qi.line_key) filter (where qi.line_key is not null), '{}'::uuid[])
      into v_parent_keys
      from public.quote_items qi
     where qi.quote_id = d.parent_quote_id;
  end if;

  delete from public.quote_draft_items where draft_id = d.id;

  for line in select value from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    if jsonb_typeof(line) <> 'object' then
      raise exception 'VALIDATION: %行目の形式が不正です', v_index using errcode = 'P0001';
    end if;
    v_section := line ->> 'section_code';
    if v_section is null or not (v_section = any(v_sections)) then
      raise exception 'VALIDATION: %行目の区分が不正です', v_index using errcode = 'P0001';
    end if;
    v_name := nullif(btrim(coalesce(line ->> 'name', '')), '');
    if v_name is null or length(v_name) > 120 then
      raise exception 'VALIDATION: %行目の品名は1〜120文字で入力してください', v_index using errcode = 'P0001';
    end if;
    if length(coalesce(line ->> 'description', '')) > 200
       or length(coalesce(line ->> 'remark', '')) > 200
       or length(coalesce(line ->> 'unit', '')) > 12 then
      raise exception 'VALIDATION: %行目の説明・単位・備考が長すぎます', v_index using errcode = 'P0001';
    end if;
    v_mode := coalesce(line ->> 'price_mode', 'auto');
    if v_mode not in ('auto', 'manual', 'por') then
      raise exception 'VALIDATION: %行目の価格の決め方が不正です', v_index using errcode = 'P0001';
    end if;
    begin
      v_key := nullif(line ->> 'line_key', '')::uuid;
      v_qty := coalesce((line ->> 'quantity')::numeric, 1);
      v_cost := (line ->> 'cost_unit_price')::integer;
      v_sale := (line ->> 'unit_price')::integer;
      v_base_cost := case when p_trust_base_unit_cost then (line ->> 'base_unit_cost')::integer end;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'VALIDATION: %行目の数量・単価・明細 ID の形式が不正です', v_index using errcode = 'P0001';
    end;
    if v_qty::text in ('NaN', 'Infinity', '-Infinity') or v_qty < 0.01 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception 'VALIDATION: %行目の数量は0.01以上99999以下・小数4桁以内で入力してください', v_index using errcode = 'P0001';
    end if;

    if v_key is null then
      v_key := gen_random_uuid();
    else
      if v_key = any(v_seen) then
        raise exception 'VALIDATION: 同じ明細 ID の行が重複しています' using errcode = 'P0001';
      end if;
      v_known := v_existing -> v_key::text;
      if v_known is not null and v_known ->> 'line_role' = 'expense' then
        raise exception 'VALIDATION: %行目：経費の行は保存のたびに自動で作り直すため、明細として保存できません', v_index using errcode = 'P0001';
      end if;
      if v_known is not null and (v_known ->> 'base_unit_cost') is not null then
        -- 本体マスター由来の行：基準原価単価はサーバーに保存した値だけを使う（画面から送られた原価は使わない）
        v_base_cost := (v_known ->> 'base_unit_cost')::integer;
      end if;
      if not (v_key = any(v_current_keys))
         and not (v_key = any(v_parent_keys))
         and (
           exists (select 1 from public.quote_items qi where qi.line_key = v_key)
           or exists (select 1 from public.quote_draft_items di where di.line_key = v_key and di.draft_id <> d.id)
         ) then
        raise exception 'VALIDATION: 他の見積系列の明細 ID は使用できません' using errcode = 'P0001';
      end if;
    end if;
    v_seen := array_append(v_seen, v_key);

    if v_base_cost is not null and (v_base_cost < 0 or v_base_cost > 100000000) then
      raise exception 'VALIDATION: %行目の本体の基準原価単価が不正です', v_index using errcode = 'P0001';
    end if;
    if v_base_cost is not null and v_section <> 'base' then
      raise exception 'VALIDATION: %行目：本体マスターの行は本体の区分から移動できません', v_index using errcode = 'P0001';
    end if;

    if v_mode = 'por' then
      v_cost := null;
      v_sale := null;
      v_cost_amount := null;
      v_sale_amount := null;
    else
      if v_base_cost is not null then
        v_cost := trunc(v_base_cost * p_sales_fee_rate)::integer;
      elsif v_cost is null or v_cost < 0 or v_cost > 100000000 then
        raise exception 'VALIDATION: %行目の原価単価（0〜100,000,000円の整数）を入力してください', v_index using errcode = 'P0001';
      end if;
      if v_mode = 'auto' then
        v_sale := trunc(v_cost * p_markup_rate)::integer;
      elsif v_sale is null or v_sale < 0 or v_sale > 100000000 then
        raise exception 'VALIDATION: %行目の売価単価（0〜100,000,000円の整数）を入力してください', v_index using errcode = 'P0001';
      end if;
      v_cost_amount := trunc(v_qty * v_cost);
      v_sale_amount := trunc(v_qty * v_sale);
      if v_cost_amount > 2147483647 or v_sale_amount > 2147483647 then
        raise exception 'VALIDATION: %行目の金額が保存可能範囲を超えています', v_index using errcode = 'P0001';
      end if;
    end if;

    v_pos := array_position(v_sections, v_section);
    v_counts[v_pos] := v_counts[v_pos] + 1;
    insert into public.quote_draft_items (
      draft_id, line_key, kind, option_id, name, description, unit, remark,
      unit_price, quantity, amount, image_url, sort_order, price_mode
    )
    values (
      d.id, v_key,
      case v_section when 'base' then 'base' when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'installation' end,
      null, v_name,
      nullif(btrim(coalesce(line ->> 'description', '')), ''),
      nullif(btrim(coalesce(line ->> 'unit', '')), ''),
      nullif(btrim(coalesce(line ->> 'remark', '')), ''),
      v_sale, v_qty, v_sale_amount::integer, null, v_pos * 1000 + v_counts[v_pos], v_mode
    );
    insert into public.quote_draft_item_costs (draft_id, line_key, section_code, line_role, base_unit_cost, cost_unit_price, cost_amount)
    values (d.id, v_key, v_section, 'line', v_base_cost, v_cost, v_cost_amount::integer);

    if v_mode <> 'por' then
      v_sale_sums[v_pos] := v_sale_sums[v_pos] + v_sale_amount;
      v_cost_sums[v_pos] := v_cost_sums[v_pos] + v_cost_amount;
    end if;
  end loop;

  -- 経費の行：区分の明細小計（POR を除く）× 経費率。売価・原価それぞれ trunc
  v_rate_label := trim(trailing '.' from to_char(p_expense_rate * 100, 'FM990.99'));
  foreach v_section in array v_sections loop
    v_pos := array_position(v_sections, v_section);
    if v_methods ->> v_section = 'rate' then
      v_sale_exp := trunc(v_sale_sums[v_pos] * p_expense_rate);
      v_cost_exp := trunc(v_cost_sums[v_pos] * p_expense_rate);
    else
      v_sale_exp := 0;
      v_cost_exp := 0;
    end if;
    if v_sale_exp <> 0 or v_cost_exp <> 0 then
      select e.key::uuid into v_key
        from jsonb_each(v_existing) as e(key, value)
       where e.value ->> 'line_role' = 'expense'
         and e.value ->> 'section_code' = v_section
       limit 1;
      if v_key is null or v_key = any(v_seen) then
        v_key := gen_random_uuid();
      end if;
      v_seen := array_append(v_seen, v_key);
      insert into public.quote_draft_items (
        draft_id, line_key, kind, option_id, name, description, unit, remark,
        unit_price, quantity, amount, image_url, sort_order, price_mode
      )
      values (
        d.id, v_key,
        case v_section when 'base' then 'base_expense' when 'interior_exterior' then 'interior_exterior_expense'
                       when 'option' then 'option_expense' else 'installation' end,
        null,
        case v_section when 'base' then '本体諸費用' when 'interior_exterior' then '内外装工事経費'
                       when 'option' then 'オプション諸費用' else '別途工事経費' end,
        '交通費、労災、安全管理費等（' || v_rate_label || '%）',
        '式', null, v_sale_exp::integer, 1, v_sale_exp::integer, null, v_pos * 1000 + 999, 'auto'
      );
      insert into public.quote_draft_item_costs (draft_id, line_key, section_code, line_role, base_unit_cost, cost_unit_price, cost_amount)
      values (d.id, v_key, v_section, 'expense', null, v_cost_exp::integer, v_cost_exp::integer);
      v_sale_sums[v_pos] := v_sale_sums[v_pos] + v_sale_exp;
      v_cost_sums[v_pos] := v_cost_sums[v_pos] + v_cost_exp;
    end if;
  end loop;

  -- 合計：調整額は整数円をそのまま加減算し、税だけ trunc（小計は 0 以上なので floor と同じ）
  v_subtotal_raw := v_sale_sums[1] + v_sale_sums[2] + v_sale_sums[3] + v_sale_sums[4];
  v_cost_total := v_cost_sums[1] + v_cost_sums[2] + v_cost_sums[3] + v_cost_sums[4];
  v_subtotal := v_subtotal_raw + v_adjustment;
  if v_subtotal_raw > 2147483647 or v_subtotal > 2147483647 or v_cost_total > 2147483647 then
    raise exception 'VALIDATION: 見積金額が保存可能範囲を超えています' using errcode = 'P0001';
  end if;
  if v_subtotal < 0 then
    raise exception 'VALIDATION: 調整後の小計が0円未満です' using errcode = 'P0001';
  end if;
  v_tax := floor(v_subtotal * d.tax_rate);
  v_total := v_subtotal + v_tax;
  if v_total > 2147483647 then
    raise exception 'VALIDATION: 税額または税込金額が保存可能範囲を超えています' using errcode = 'P0001';
  end if;

  update public.quote_drafts
     set adjustment = v_adjustment,
         adjustment_reason = v_reason,
         subtotal_raw = v_subtotal_raw::integer,
         subtotal = v_subtotal::integer,
         tax = v_tax::integer,
         total = v_total::integer,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = d.id
  returning lock_version into v_new_lock_version;

  insert into public.quote_draft_internals (draft_id, sales_fee_rate, expense_rate, markup_rate, expense_methods, cost_total, updated_at)
  values (d.id, p_sales_fee_rate, p_expense_rate, p_markup_rate, v_methods, v_cost_total::integer, now())
  on conflict (draft_id) do update
    set sales_fee_rate = excluded.sales_fee_rate,
        expense_rate = excluded.expense_rate,
        markup_rate = excluded.markup_rate,
        expense_methods = excluded.expense_methods,
        cost_total = excluded.cost_total,
        updated_at = now();

  return v_new_lock_version;
end;
$apply_standard_quote$;

-- 公開中の標準見積の率・区分の経費の方法・明細（本体は固定した本体 Revision の明細）を、見積下書きへ写す
create function public.materialize_standard_quote_draft(p_draft_id uuid, p_standard_estimate_revision_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $materialize_standard_quote$
declare
  d public.quote_drafts;
  rev public.standard_estimate_revisions;
  m public.standard_estimate_masters;
  v_methods jsonb;
  v_lines jsonb;
begin
  select * into d from public.quote_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into rev from public.standard_estimate_revisions where id = p_standard_estimate_revision_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if rev.status <> 'published' then
    raise exception 'LOCKED: 公開中の標準見積だけから見積を作成できます' using errcode = 'P0001';
  end if;
  select * into m from public.standard_estimate_masters where id = rev.standard_estimate_master_id;
  if not found or m.status <> 'active' or m.current_published_revision_id is distinct from rev.id then
    raise exception 'LOCKED: 標準見積の公開版が変わりました。再読み込みしてください' using errcode = 'P0001';
  end if;
  if d.source_kind <> 'standard_estimate'
     or d.standard_estimate_revision_id is distinct from rev.id
     or d.base_model_id is distinct from m.base_model_id
     or d.spec_code is distinct from m.spec_code
     or d.base_master_revision_id is distinct from rev.base_master_revision_id then
    raise exception 'VALIDATION: 見積下書きと標準見積の商品モデル・用途・本体 Revision が一致しません' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.standard_estimate_revision_sections s
              where s.revision_id = rev.id and s.expense_method not in ('rate', 'none')) then
    raise exception 'LOCKED: 固定額の経費を含む標準見積からは見積を作れません。標準見積の経費の計算方法（率／なし）を見直してください' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(s.section_code, s.expense_method), '{}'::jsonb)
    into v_methods
    from public.standard_estimate_revision_sections s
   where s.revision_id = rev.id;

  select coalesce(jsonb_agg(x.line order by x.section_rank, x.sort_order, x.id), '[]'::jsonb)
    into v_lines
    from (
      select 1 as section_rank, l.sort_order, l.id::text as id,
             jsonb_build_object(
               'section_code', 'base', 'name', l.name, 'description', l.section, 'unit', l.unit, 'remark', l.remark,
               'quantity', l.quantity, 'price_mode', 'auto', 'base_unit_cost', l.unit_price
             ) as line
        from public.base_master_revision_lines l
       where l.revision_id = rev.base_master_revision_id
      union all
      select case l.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end, l.sort_order, l.id::text,
             jsonb_build_object(
               'section_code', l.section_code, 'name', l.name, 'description', l.group_label, 'unit', l.unit, 'remark', l.remark,
               'quantity', l.quantity, 'price_mode', l.price_mode, 'cost_unit_price', l.cost_unit_price, 'unit_price', l.unit_price
             )
        from public.standard_estimate_revision_lines l
       where l.revision_id = rev.id
    ) x;

  -- 調整額・理由も入力値として写す（同じ明細・率なら、見積の合計は標準見積の合計と一致する）
  return public.apply_standard_quote_draft(
    d.id, rev.sales_fee_rate, rev.expense_rate, rev.markup_rate, v_methods, v_lines,
    rev.standard_adjustment_amount, rev.standard_adjustment_reason, d.notes, true
  );
end;
$materialize_standard_quote$;

-- 発行時：標準見積から作成した見積の内部原価・率・粗利を snapshot に残す（手入力の見積では何もしない）
create function public.write_quote_internal_snapshot(p_draft_id uuid, p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $write_snapshot$
declare
  d public.quote_drafts;
  n public.quote_draft_internals;
  q public.quotes;
  v_lines jsonb;
  v_cost_total numeric;
begin
  select * into d from public.quote_drafts where id = p_draft_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.source_kind <> 'standard_estimate' then
    return;
  end if;
  select * into n from public.quote_draft_internals where draft_id = d.id;
  if not found then
    raise exception 'VALIDATION: 標準見積の率・内部原価がありません。保存し直してください' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.quote_draft_items i
      left join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
     where i.draft_id = d.id
       and (c.line_key is null or c.cost_amount is null or i.price_mode = 'por')
  ) then
    raise exception 'VALIDATION: 内部原価のない明細があります。保存し直してください' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.quote_draft_items i
      join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
     where i.draft_id = d.id
       and c.line_role = 'line'
       and (
         (c.base_unit_cost is not null and c.cost_unit_price <> trunc(c.base_unit_cost * n.sales_fee_rate))
         or (i.price_mode = 'auto' and i.unit_price <> trunc(c.cost_unit_price * n.markup_rate))
         or c.cost_amount <> trunc(i.quantity * c.cost_unit_price)
       )
  ) then
    raise exception 'VALIDATION: 率と金額が一致しない明細があります。保存し直してください' using errcode = 'P0001';
  end if;

  select coalesce(sum(c.cost_amount), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'line_key', c.line_key, 'section_code', c.section_code, 'line_role', c.line_role, 'price_mode', i.price_mode,
           'base_unit_cost', c.base_unit_cost, 'cost_unit_price', c.cost_unit_price, 'cost_amount', c.cost_amount
         ) order by i.sort_order, i.line_key), '[]'::jsonb)
    into v_cost_total, v_lines
    from public.quote_draft_items i
    join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
   where i.draft_id = d.id;
  if v_cost_total <> n.cost_total then
    raise exception 'VALIDATION: 内部原価の合計が一致しません。保存し直してください' using errcode = 'P0001';
  end if;

  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.quote_internal_snapshots (
    quote_id, source_kind, standard_estimate_revision_id, sales_fee_rate, expense_rate, markup_rate,
    expense_methods, subtotal, cost_total, gross_profit, lines, created_by
  )
  values (
    q.id, 'standard_estimate', d.standard_estimate_revision_id, n.sales_fee_rate, n.expense_rate, n.markup_rate,
    n.expense_methods, q.subtotal, v_cost_total::integer, q.subtotal - v_cost_total::integer, v_lines, auth.uid()
  );
end;
$write_snapshot$;

-- 次の版の下書きを作った直後：金額を trunc で計算し直し、標準見積から作成した見積なら率・内部原価を直前の発行版から引き継ぐ
create function public.prepare_quote_revision_draft(p_parent_quote_id uuid, p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $prepare_revision_draft$
declare
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  s public.quote_internal_snapshots;
  v_subtotal_raw numeric;
begin
  select * into d from public.quote_drafts where id = p_draft_id and parent_quote_id = p_parent_quote_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 新しい版の金額は trunc（発行済みの版は変えない。旧 round の金額を新しい版へ持ち込まない）
  update public.quote_draft_items
     set amount = trunc(unit_price::numeric * quantity)::integer
   where draft_id = d.id
     and amount is distinct from trunc(unit_price::numeric * quantity)::integer;
  select coalesce(sum(amount), 0) into v_subtotal_raw from public.quote_draft_items where draft_id = d.id;
  if v_subtotal_raw <> d.subtotal_raw then
    if v_subtotal_raw + d.adjustment < 0 then
      raise exception 'VALIDATION: 切り捨てで計算し直すと、調整後の小計が0円未満になります。調整額を見直してください' using errcode = 'P0001';
    end if;
    update public.quote_drafts
       set subtotal_raw = v_subtotal_raw::integer,
           subtotal = (v_subtotal_raw + adjustment)::integer,
           tax = floor((v_subtotal_raw + adjustment) * tax_rate)::integer,
           total = (v_subtotal_raw + adjustment + floor((v_subtotal_raw + adjustment) * tax_rate))::integer
     where id = d.id;
  end if;

  select * into s from public.quote_internal_snapshots where quote_id = p_parent_quote_id;
  if not found then
    return;
  end if;
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 標準見積から作成した見積の改訂は、現在は本部管理者だけが行えます' using errcode = '42501';
  end if;

  -- 率・入力値・作り方・元の標準見積 Revision は直前の発行版から（最新の標準見積へは追従しない）
  update public.quote_drafts
     set source_kind = 'standard_estimate',
         standard_estimate_revision_id = s.standard_estimate_revision_id
   where id = d.id;

  insert into public.quote_draft_internals (draft_id, sales_fee_rate, expense_rate, markup_rate, expense_methods, cost_total)
  values (d.id, s.sales_fee_rate, s.expense_rate, s.markup_rate, s.expense_methods, s.cost_total);

  insert into public.quote_draft_item_costs (draft_id, line_key, section_code, line_role, base_unit_cost, cost_unit_price, cost_amount)
  select d.id, (x.value ->> 'line_key')::uuid, x.value ->> 'section_code', x.value ->> 'line_role',
         (x.value ->> 'base_unit_cost')::integer, (x.value ->> 'cost_unit_price')::integer, (x.value ->> 'cost_amount')::integer
    from jsonb_array_elements(s.lines) as x(value)
   where exists (select 1 from public.quote_draft_items i
                  where i.draft_id = d.id and i.line_key = (x.value ->> 'line_key')::uuid);

  update public.quote_draft_items i
     set price_mode = x.value ->> 'price_mode'
    from jsonb_array_elements(s.lines) as x(value)
   where i.draft_id = d.id
     and i.line_key = (x.value ->> 'line_key')::uuid;

  if exists (
    select 1 from public.quote_draft_items i
     where i.draft_id = d.id
       and not exists (select 1 from public.quote_draft_item_costs c where c.draft_id = d.id and c.line_key = i.line_key)
  ) or (select coalesce(sum(c.cost_amount), 0) from public.quote_draft_item_costs c where c.draft_id = d.id) <> s.cost_total then
    raise exception 'VALIDATION: 直前の版の内部原価が明細と一致しません' using errcode = 'P0001';
  end if;
end;
$prepare_revision_draft$;

-- ---------- RPC ----------

-- 公開中の標準見積から、案件（quote_request）と見積下書きを作る（本部だけ）
create function public.create_standard_quote_case(
  p_case_name text,
  p_contact jsonb,
  p_message text,
  p_standard_estimate_revision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $create_standard_quote_case$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_case_name text := nullif(btrim(coalesce(p_case_name, '')), '');
  v_full_name text;
  v_company_name text;
  v_site_address text;
  v_message text;
  rev public.standard_estimate_revisions;
  m public.standard_estimate_masters;
  v_request_id uuid;
  v_draft_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 標準見積からの見積作成は現在本部管理者のみ利用できます' using errcode = '42501';
  end if;

  if p_contact is null or jsonb_typeof(p_contact) <> 'object' then
    raise exception 'VALIDATION: お客様情報が不正です' using errcode = 'P0001';
  end if;
  v_full_name := nullif(btrim(coalesce(p_contact ->> 'full_name', '')), '');
  v_company_name := nullif(btrim(coalesce(p_contact ->> 'company_name', '')), '');
  v_site_address := nullif(btrim(coalesce(p_contact ->> 'site_address', '')), '');
  v_message := nullif(btrim(coalesce(p_message, '')), '');
  if v_full_name is null or length(v_full_name) > 60 then
    raise exception 'VALIDATION: お客様名は1〜60文字で入力してください' using errcode = 'P0001';
  end if;
  if v_company_name is not null and length(v_company_name) > 100 then
    raise exception 'VALIDATION: 会社名は100文字以内で入力してください' using errcode = 'P0001';
  end if;
  if v_site_address is not null and length(v_site_address) > 200 then
    raise exception 'VALIDATION: 設置予定地は200文字以内で入力してください' using errcode = 'P0001';
  end if;
  if v_message is not null and length(v_message) > 1000 then
    raise exception 'VALIDATION: メモは1000文字以内で入力してください' using errcode = 'P0001';
  end if;
  if v_case_name is not null and length(v_case_name) > 120 then
    raise exception 'VALIDATION: 案件名は120文字以内で入力してください' using errcode = 'P0001';
  end if;

  select * into rev from public.standard_estimate_revisions where id = p_standard_estimate_revision_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if rev.status <> 'published' then
    raise exception 'LOCKED: 公開中の標準見積だけから見積を作成できます' using errcode = 'P0001';
  end if;
  select * into m from public.standard_estimate_masters where id = rev.standard_estimate_master_id;
  if not exists (select 1 from public.base_models b where b.id = m.base_model_id and b.status = 'published') then
    raise exception 'VALIDATION: 公開中の商品モデルの標準見積を選んでください' using errcode = 'P0001';
  end if;

  insert into public.quote_requests (configuration_id, user_id, quote_id, status, message, contact, created_by, case_name)
  values (
    null, null, null, 'reviewing', v_message,
    jsonb_build_object(
      'full_name', v_full_name,
      'company_name', v_company_name,
      'email', '',
      'phone', '',
      'address', '',
      'site_address', v_site_address
    ),
    v_uid, v_case_name
  )
  returning id into v_request_id;

  insert into public.quote_drafts (
    quote_request_id, parent_quote_id, base_model_id, base_master_revision_id, spec_code, quote_kind, finish_level,
    tax_rate, adjustment, subtotal_raw, subtotal, tax, total, lock_version, dealer_note, notes,
    created_by, updated_by, source_kind, standard_estimate_revision_id
  )
  values (
    v_request_id, null, m.base_model_id, rev.base_master_revision_id, m.spec_code, 'formal', 'full',
    rev.tax_rate, 0, 0, 0, 0, 0, 0, null, v_message,
    v_uid, v_uid, 'standard_estimate', rev.id
  )
  returning id into v_draft_id;

  perform public.materialize_standard_quote_draft(v_draft_id, rev.id);
  return v_draft_id;
end;
$create_standard_quote_case$;

-- 標準見積から作成した見積下書きを保存する（本部だけ）。率・明細から DB が全額を計算し直し、新しい lock_version を返す
create function public.save_standard_quote_draft(
  p_draft_id uuid,
  p_expected_lock_version integer,
  p_sales_fee_rate numeric,
  p_expense_rate numeric,
  p_markup_rate numeric,
  p_expense_methods jsonb,
  p_lines jsonb,
  p_adjustment integer,
  p_adjustment_reason text,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $save_standard_quote$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  parent public.quotes;
  r public.quote_requests;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 標準見積から作成した見積は、現在は本部管理者だけが編集できます' using errcode = '42501';
  end if;

  -- lock の順序は既存の保存・発行と同じ（Draft → 親 Quote → QuoteRequest）
  select * into d from public.quote_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.parent_quote_id is not null then
    select * into parent
      from public.quotes
     where id = d.parent_quote_id
       and quote_request_id = d.quote_request_id
     for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if d.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if d.source_kind <> 'standard_estimate' then
    raise exception 'LOCKED: 手入力の見積は通常の見積編集画面で保存してください' using errcode = 'P0001';
  end if;
  if d.parent_quote_id is not null then
    if parent.status <> 'issued' then
      raise exception 'LOCKED: 親Revisionはすでに発行中ではありません' using errcode = 'P0001';
    end if;
    select * into r from public.quote_requests where id = d.quote_request_id for update;
    if not found or r.quote_id is distinct from parent.id then
      raise exception 'LOCKED: 最新Revisionから改訂してください' using errcode = 'P0001';
    end if;
  end if;

  return public.apply_standard_quote_draft(
    d.id, p_sales_fee_rate, p_expense_rate, p_markup_rate, p_expense_methods, p_lines,
    p_adjustment, p_adjustment_reason, p_notes, false
  );
end;
$save_standard_quote$;

-- 標準見積から作成した見積下書きを、率・内部原価も含めて返す（本部だけ）
create function public.get_standard_quote_draft(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_standard_quote$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  r public.quote_requests;
  n public.quote_draft_internals;
  rev public.standard_estimate_revisions;
  m public.standard_estimate_masters;
  parent public.quotes;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 標準見積から作成した見積の内部原価は本部管理者だけが参照できます' using errcode = '42501';
  end if;

  select * into d from public.quote_drafts where id = p_draft_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.source_kind <> 'standard_estimate' then
    raise exception 'LOCKED: 標準見積から作成した見積下書きではありません' using errcode = 'P0001';
  end if;
  select * into r from public.quote_requests where id = d.quote_request_id;
  select * into n from public.quote_draft_internals where draft_id = d.id;
  select * into rev from public.standard_estimate_revisions where id = d.standard_estimate_revision_id;
  select * into m from public.standard_estimate_masters where id = rev.standard_estimate_master_id;
  if d.parent_quote_id is not null then
    select * into parent from public.quotes where id = d.parent_quote_id;
  end if;

  return jsonb_build_object(
    'draft', to_jsonb(d),
    'request', jsonb_build_object(
      'id', r.id,
      'case_name', r.case_name,
      'status', r.status,
      'message', r.message,
      'contact', r.contact
    ),
    'internals', to_jsonb(n),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object(
               'section_code', c.section_code,
               'line_role', c.line_role,
               'base_unit_cost', c.base_unit_cost,
               'cost_unit_price', c.cost_unit_price,
               'cost_amount', c.cost_amount
             ) order by i.sort_order, i.line_key)
        from public.quote_draft_items i
        left join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
       where i.draft_id = d.id
    ), '[]'::jsonb),
    'standard_estimate', jsonb_build_object(
      'revision_id', rev.id,
      'version', rev.version,
      'status', rev.status,
      'total', rev.total,
      'master_id', m.id,
      'name', m.name,
      'current_published_revision_id', m.current_published_revision_id
    ),
    'parent', case when parent.id is null then null else jsonb_build_object(
      'id', parent.id,
      'quote_no', parent.quote_no,
      'revision', parent.revision,
      'total', parent.total
    ) end
  );
end;
$get_standard_quote$;

-- ---------- 既存の見積処理への差し込み（適用済みの定義を検査してから置き換える） ----------

-- save_quote_draft（手入力の保存）
--   1. 楽観ロックの確認の直後：標準見積から作成した下書きは受け付けない
--   2. 明細額：trunc で計算する（直前の版の旧 round の金額を引き継がない）
--   3. 代理店が変えられない本体の行も、金額は 2. の trunc の値にする（単価・数量は直前の版と同じことを確認済み）
do $patch_save_quote_draft$
declare
  v_signature constant text := 'public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)';
  v_from text[];
  v_to text[];
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
  v_index integer;
begin
  v_from := array[
    E'  if d.lock_version is distinct from p_expected_lock_version then\n'
    || E'    raise exception ''LOCKED: 他の画面でDraftが更新されています。再読み込みしてください''\n'
    || E'      using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'    if v_has_parent_item\n'
    || E'       and v_parent_item.unit_price = v_unit_price\n'
    || E'       and v_parent_item.quantity = v_qty then\n'
    || E'      v_amount := v_parent_item.amount;\n'
    || E'    else\n'
    || E'      v_amount_numeric := round(v_unit_price_raw * v_qty);\n'
    || E'      if v_amount_numeric < -2147483648 or v_amount_numeric > 2147483647 then\n'
    || E'        raise exception ''VALIDATION: 明細金額が保存可能範囲を超えています''\n'
    || E'          using errcode = ''P0001'';\n'
    || E'      end if;\n'
    || E'      v_amount := v_amount_numeric::integer;\n'
    || E'    end if;\n',
    E'      case when v_lock_parent_base then v_parent_item.amount else v_amount end,\n'
  ];
  v_to := array[
    v_from[1]
    || E'\n'
    || E'  /* 標準見積から作成した見積は、率・原価から金額を計算する専用の保存処理（save_standard_quote_draft）だけで保存する。 */\n'
    || E'  if d.source_kind = ''standard_estimate'' then\n'
    || E'    raise exception ''LOCKED: 標準見積から作成した見積は、標準見積の見積編集画面で保存してください''\n'
    || E'      using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'    /* 新しい Draft・Revision の金額は trunc（0 方向切り捨て）で計算し直す。旧 round の発行済み金額は持ち込まない（依頼書 §6-2・§8-2）。 */\n'
    || E'    v_amount_numeric := trunc(v_unit_price_raw * v_qty);\n'
    || E'    if v_amount_numeric < -2147483648 or v_amount_numeric > 2147483647 then\n'
    || E'      raise exception ''VALIDATION: 明細金額が保存可能範囲を超えています''\n'
    || E'        using errcode = ''P0001'';\n'
    || E'    end if;\n'
    || E'    v_amount := v_amount_numeric::integer;\n',
    E'      v_amount,\n'
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'QUOTE_STANDARD_ESTIMATE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'QUOTE_STANDARD_ESTIMATE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_save_quote_draft$;

-- finalize_quote_draft（初回 Revision 1 の発行）
--   1. 楽観ロックの確認の直後：標準見積から作成した見積の発行は本部だけ。POR が残っていれば発行しない
--   2・3. 明細額の検算と発行明細の金額：trunc
--   4. 下書きを消す直前：標準見積から作成した見積の内部原価・率を snapshot に残す
do $patch_finalize_quote_draft$
declare
  v_signature constant text := 'public.finalize_quote_draft(uuid, integer)';
  v_from text[];
  v_to text[];
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
  v_index integer;
begin
  v_from := array[
    E'  if d.lock_version is distinct from p_expected_lock_version then\n'
    || E'    raise exception ''LOCKED: 他の画面でDraftが更新されています。再読み込みしてください'' using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'    v_expected_amount := round(i.unit_price::numeric * i.quantity);\n',
    E'    round(item.unit_price::numeric * item.quantity)::integer,\n',
    E'  delete from public.quote_drafts\n'
    || E'   where id = d.id;\n'
  ];
  v_to := array[
    v_from[1]
    || E'  /* 標準見積から作成した見積の発行は本部だけ。価格未確定（POR）の明細が 1 件でも残っていれば発行しない（fail closed）。 */\n'
    || E'  if d.source_kind = ''standard_estimate'' and v_rank < 3 then\n'
    || E'    raise exception ''FORBIDDEN: 標準見積から作成した見積は、現在は本部管理者だけが発行できます'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || E'  if exists (\n'
    || E'    select 1 from public.quote_draft_items por\n'
    || E'     where por.draft_id = d.id\n'
    || E'       and (por.price_mode = ''por'' or por.unit_price is null or por.amount is null)\n'
    || E'  ) then\n'
    || E'    raise exception ''VALIDATION: 価格未確定（POR）の明細が残っています。自動計算か売価の入力で価格を確定してから正式保存してください'' using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'    v_expected_amount := trunc(i.unit_price::numeric * i.quantity);\n',
    E'    trunc(item.unit_price::numeric * item.quantity)::integer,\n',
    E'  /* 標準見積から作成した見積は、内部原価・率・粗利を本部だけが読める snapshot に残す（手入力の見積では何もしない）。 */\n'
    || E'  perform public.write_quote_internal_snapshot(d.id, v_quote_id);\n'
    || E'\n'
    || v_from[4]
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'QUOTE_STANDARD_ESTIMATE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'QUOTE_STANDARD_ESTIMATE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_finalize_quote_draft$;

-- finalize_quote_revision_draft（第 2 版以降の発行）
--   1. 楽観ロックの確認の直後：標準見積から作成した見積の発行は本部だけ。POR が残っていれば発行しない
--   2. 明細額の検算：trunc（直前の版の旧 round の金額は引き継がない）
--   3. 代理店の本体の行の比較から金額を外す（金額は単価・数量から trunc で決まり、2. で検算する）
--   4. 下書きを消す直前：標準見積から作成した見積の内部原価・率を snapshot に残す
do $patch_finalize_quote_revision_draft$
declare
  v_signature constant text := 'public.finalize_quote_revision_draft(uuid, integer)';
  v_from text[];
  v_to text[];
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
  v_index integer;
begin
  v_from := array[
    E'  if d.lock_version is distinct from p_expected_lock_version then\n'
    || E'    raise exception ''LOCKED: 他の画面でDraftが更新されています。再読み込みしてください''\n'
    || E'      using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'    if v_has_parent_item\n'
    || E'       and v_parent_item.unit_price = i.unit_price\n'
    || E'       and v_parent_item.quantity = i.quantity then\n'
    || E'      v_expected_amount := v_parent_item.amount;\n'
    || E'    else\n'
    || E'      v_expected_amount := round(i.unit_price::numeric * i.quantity);\n'
    || E'    end if;\n',
    E'           or v_parent_item.amount is distinct from i.amount\n',
    E'  delete from public.quote_drafts\n'
    || E'   where id = d.id;\n'
  ];
  v_to := array[
    v_from[1]
    || E'  /* 標準見積から作成した見積の発行は本部だけ。価格未確定（POR）の明細が 1 件でも残っていれば発行しない（fail closed）。 */\n'
    || E'  if d.source_kind = ''standard_estimate'' and v_rank < 3 then\n'
    || E'    raise exception ''FORBIDDEN: 標準見積から作成した見積は、現在は本部管理者だけが発行できます'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || E'  if exists (\n'
    || E'    select 1 from public.quote_draft_items por\n'
    || E'     where por.draft_id = d.id\n'
    || E'       and (por.price_mode = ''por'' or por.unit_price is null or por.amount is null)\n'
    || E'  ) then\n'
    || E'    raise exception ''VALIDATION: 価格未確定（POR）の明細が残っています。自動計算か売価の入力で価格を確定してから正式保存してください''\n'
    || E'      using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'    /* 新しい Revision の金額は trunc で検算する（直前の版の旧 round の金額は引き継がない。依頼書 §8-2）。 */\n'
    || E'    v_expected_amount := trunc(i.unit_price::numeric * i.quantity);\n',
    E'           /* 金額は単価・数量から trunc で決まり、下で検算するため比較しない（直前の版の旧 round の金額との差で止めない） */\n',
    E'  /* 標準見積から作成した見積は、内部原価・率・粗利を本部だけが読める snapshot に残す（手入力の見積では何もしない）。 */\n'
    || E'  perform public.write_quote_internal_snapshot(d.id, v_quote_id);\n'
    || E'\n'
    || v_from[4]
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'QUOTE_STANDARD_ESTIMATE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'QUOTE_STANDARD_ESTIMATE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_finalize_quote_revision_draft$;

-- create_quote_revision_draft（次の版の下書きを作る）
--   新しい下書きを返す直前：金額を trunc で計算し直し、標準見積から作成した見積なら率・内部原価を直前の発行版から引き継ぐ
do $patch_create_quote_revision_draft$
declare
  v_signature constant text := 'public.create_quote_revision_draft(uuid)';
  v_from text[];
  v_to text[];
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
  v_index integer;
begin
  v_from := array[
    E'  return v_draft_id;\n'
  ];
  v_to := array[
    E'  /* 新しい版の金額を trunc で計算し直し、標準見積から作成した見積なら率・内部原価を直前の発行版から引き継ぐ（最新の標準見積へは追従しない）。 */\n'
    || E'  perform public.prepare_quote_revision_draft(p_quote_id, v_draft_id);\n'
    || E'\n'
    || v_from[1]
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'QUOTE_STANDARD_ESTIMATE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'QUOTE_STANDARD_ESTIMATE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'QUOTE_STANDARD_ESTIMATE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_create_quote_revision_draft$;

-- ---------- owner / EXECUTE ----------

alter function public.prevent_quote_internal_snapshot_update() owner to postgres;
alter function public.can_view_standard_estimate_master(uuid) owner to postgres;
alter function public.can_view_standard_estimate_revision(uuid) owner to postgres;
alter function public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean) owner to postgres;
alter function public.materialize_standard_quote_draft(uuid, uuid) owner to postgres;
alter function public.write_quote_internal_snapshot(uuid, uuid) owner to postgres;
alter function public.prepare_quote_revision_draft(uuid, uuid) owner to postgres;
alter function public.create_standard_quote_case(text, jsonb, text, uuid) owner to postgres;
alter function public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text) owner to postgres;
alter function public.get_standard_quote_draft(uuid) owner to postgres;

revoke all on function public.prevent_quote_internal_snapshot_update() from public, anon, authenticated, service_role;
revoke all on function public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.materialize_standard_quote_draft(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.write_quote_internal_snapshot(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.prepare_quote_revision_draft(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_standard_quote_case(text, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_standard_quote_draft(uuid) from public, anon, authenticated, service_role;

grant execute on function public.create_standard_quote_case(text, jsonb, text, uuid) to authenticated;
grant execute on function public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text) to authenticated;
grant execute on function public.get_standard_quote_draft(uuid) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
  v_table regclass;
begin
  foreach v_fn in array array[
    'public.create_standard_quote_case(text, jsonb, text, uuid)'::regprocedure,
    'public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text)'::regprocedure,
    'public.get_standard_quote_draft(uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure,
    'public.materialize_standard_quote_draft(uuid, uuid)'::regprocedure,
    'public.write_quote_internal_snapshot(uuid, uuid)'::regprocedure,
    'public.prepare_quote_revision_draft(uuid, uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by API roles', v_fn;
    end if;
  end loop;

  foreach v_table in array array[
    'public.quote_draft_internals'::regclass,
    'public.quote_draft_item_costs'::regclass,
    'public.quote_internal_snapshots'::regclass
  ]
  loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = v_table) then
      raise exception 'POSTCONDITION: row level security must be enabled on %', v_table;
    end if;
    if has_table_privilege('anon', v_table, 'SELECT')
       or has_table_privilege('anon', v_table, 'INSERT')
       or has_table_privilege('authenticated', v_table, 'INSERT')
       or has_table_privilege('authenticated', v_table, 'UPDATE')
       or has_table_privilege('authenticated', v_table, 'DELETE') then
      raise exception 'POSTCONDITION: API roles must not write or anonymously read %', v_table;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.quote_draft_internals', 'SELECT')
     or has_table_privilege('authenticated', 'public.quote_draft_item_costs', 'SELECT') then
    raise exception 'POSTCONDITION: draft internals must be readable only through RPC';
  end if;

  if pg_catalog.pg_get_functiondef('public.can_view_standard_estimate_revision(uuid)'::regprocedure) ilike '%is_active_standard_estimate_staff%'
     or pg_catalog.pg_get_functiondef('public.can_view_standard_estimate_master(uuid)'::regprocedure) ilike '%is_active_standard_estimate_staff%' then
    raise exception 'POSTCONDITION: standard estimates must be visible to headquarters only';
  end if;

  if pg_catalog.pg_get_functiondef('public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)'::regprocedure) ilike '%round(v_unit_price_raw%'
     or pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure) ilike '%round(i.unit_price%'
     or pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure) ilike '%round(item.unit_price%'
     or pg_catalog.pg_get_functiondef('public.finalize_quote_revision_draft(uuid, integer)'::regprocedure) ilike '%round(i.unit_price%' then
    raise exception 'POSTCONDITION: new quote drafts and revisions must use trunc, not round';
  end if;
end;
$postcondition$;

commit;
