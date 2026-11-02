-- v2.5 PR-S1：窓タイプと、標準見積の位置・用途ごとの選択枠・枠ごとの選べる商品（DB と計算）
--
-- 2026-10-30（2 回）・11-01 の先方の決定：
-- * サッシなど、同じカテゴリーに複数の独立した選択枠を持てるようにする。位置・用途の枠は商品登録ではなく、標準見積の版で決める
--   （商品マスター＝何の商品か、標準見積＝どこに何を使うか）。同じ商品を複数の位置で使える（例：開き窓①② とも 02609）
-- * 枠には、将来の平面図の位置と紐づける安定した識別子（slot_code）を持たせ、新しい版へ引き継ぐ。平面図の画面は今回作らない
-- * 枠ごとの選べる商品は、枠の側で指定する。指定あり → 標準の商品と指定した商品から選べる。指定なし → 標準の商品だけ
--   （色・ガラスなど、商品の選択肢は変えられる）。商品台帳には持たせない
-- * 公開済みの版の枠・標準の商品・選べる商品は、その版の内容として固定する。変えるときは新しい下書きで公開する
-- * 窓タイプはサッシの商品だけ、商品登録で 1 商品 1 つ（FIX窓・引違い窓・縦すべり出し窓・横すべり出し窓など）。「掃出し窓」は入れない
-- * 内部建具の「建具タイプ」などの商品の項目は足さない。ほかのカテゴリー固有の属性も作り込まない
--
-- 決まり
-- * 位置の枠（slot_code・slot_label）は数量 1。外壁（4 面の専用の仕組み）と防火仕様には作らない。
--   1 つのカテゴリーで、カテゴリー単位の枠と位置の枠を混ぜない
-- * お客様の保存したプランは、位置の枠ごとに明細（configuration_items）の行を持つ（slot_code）。
--   版の位置の枠と 1 対 1 で、その枠で選べる商品だけ。明細の表の既存のトリガー（選択肢・仕様のカテゴリー・販売停止）が枠の行にも効く
-- * 金額：位置の枠の行は、その枠の標準と同じ「商品＋選択肢」なら公開した版のその枠の売価、それ以外は v2.5 の式（C1 と同じ）
-- * 見積依頼：版の位置の枠と保存したプランの選択が合わなければ止める（保存し直してから）。位置ごとの選んだ商品は 0 円の写しの行で残す
--
-- データの変更は、窓タイプの初期 4 件と、サッシのカテゴリー（code = 'sash'）の「窓タイプを使う」の印だけ。
-- 既存の版・保存したプラン・見積は変えない。スイッチも入れない。既存 migration は編集しない。

begin;

set local lock_timeout = '5s';

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.standard_estimate_v25_slot_rule_issues(uuid)') is null
     or to_regprocedure('public.standard_estimate_v25_configuration_money(uuid, uuid)') is null
     or to_regprocedure('public.write_standard_estimate_quote_items(uuid, uuid)') is null then
    raise exception 'PRECONDITION: simulator v2.5 pricing (20261029100000) must be applied first';
  end if;
  if to_regprocedure('public.legacy_price_write_allowed()') is null then
    raise exception 'PRECONDITION: legacy price column guard (20261030100000) must be applied first';
  end if;
  if to_regclass('public.window_types') is not null
     or to_regclass('public.standard_estimate_revision_slot_options') is not null then
    raise exception 'PRECONDITION: position slots already exist';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.standard_estimate_revision_baseline_items'::regclass
       and conname = 'standard_estimate_revision_ba_revision_id_selection_target__key'
       and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (revision_id, selection_target_code, option_id)'
  ) then
    raise exception 'PRECONDITION: unique (revision_id, selection_target_code, option_id) on baseline items was not found';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.configuration_items'::regclass
       and conname = 'configuration_items_configuration_id_option_id_key'
       and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (configuration_id, option_id)'
  ) then
    raise exception 'PRECONDITION: unique (configuration_id, option_id) on configuration items was not found';
  end if;
end;
$preflight$;

-- ---------- 窓タイプ（サッシの商品の属性。マスターは表で持つ） ----------

create table public.window_types (
  code text primary key check (code ~ '^[a-z][a-z0-9-]{0,39}$'),
  label text not null check (label = pg_catalog.btrim(label) and label <> '' and pg_catalog.char_length(label) <= 40),
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index window_types_label_key on public.window_types (label);

comment on table public.window_types is
  '窓タイプ（サッシの商品の開閉形式。FIX窓・引違い窓・縦すべり出し窓・横すべり出し窓など）。商品ごとに 1 つ（options.window_type_code）。「掃出し窓」などの用途・形状は入れない。2026-10-30 先方回答。';

alter table public.window_types enable row level security;

create policy window_types_read on public.window_types
  for select to anon, authenticated using (true);
create policy window_types_admin_insert on public.window_types
  for insert to authenticated with check (public.is_admin());
create policy window_types_admin_update on public.window_types
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on table public.window_types from anon, authenticated;
grant select on table public.window_types to anon, authenticated;
grant insert, update on table public.window_types to authenticated;

create trigger window_types_set_updated_at
before update on public.window_types
for each row execute function public.set_updated_at();

insert into public.window_types (code, label, sort_order) values
  ('fix', 'FIX窓', 10),
  ('sliding', '引違い窓', 20),
  ('casement', '縦すべり出し窓', 30),
  ('awning', '横すべり出し窓', 40);

-- サッシのカテゴリーの印（窓タイプを使うカテゴリー。コードにカテゴリーのコードを書かず、この印で決める）
alter table public.option_categories
  add column uses_window_type boolean not null default false;

comment on column public.option_categories.uses_window_type is
  '商品に窓タイプ（window_types）を設定するカテゴリー（サッシ）。2026-10-30 先方回答。';

update public.option_categories set uses_window_type = true where code = 'sash';

-- 商品の窓タイプ（サッシの商品だけ・1 商品 1 つ・任意）
alter table public.options
  add column window_type_code text references public.window_types (code) on update cascade on delete restrict;

comment on column public.options.window_type_code is
  'サッシの商品の窓タイプ（window_types。1 商品 1 つ・任意）。窓タイプを使うカテゴリーの商品だけ。2026-10-30 先方回答。';

create index options_window_type_code_idx on public.options (window_type_code) where window_type_code is not null;

-- C1b：options は列ごとに読める列を決めている。アプリが読む新しい列は anon・authenticated へ列で許可する（legacy-price-columns.json と同じ）
grant select (window_type_code) on public.options to anon, authenticated;

create function public.options_window_type_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.window_type_code is null then
    return new;
  end if;
  if not exists (select 1 from public.option_categories c where c.id = new.category_id and c.uses_window_type) then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 窓タイプは、窓タイプを使うカテゴリー（サッシ）の商品だけに設定できます';
  end if;
  if (tg_op = 'INSERT' or new.window_type_code is distinct from old.window_type_code)
     and not exists (select 1 from public.window_types w where w.code = new.window_type_code and w.status = 'active') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 使用中の窓タイプを選んでください';
  end if;
  return new;
end;
$$;

create trigger options_window_type_guard
before insert or update of window_type_code, category_id on public.options
for each row execute function public.options_window_type_guard();

create function public.option_categories_window_type_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.uses_window_type and not new.uses_window_type
     and exists (select 1 from public.options o where o.category_id = new.id and o.window_type_code is not null) then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 窓タイプが設定された商品があるため、このカテゴリーの窓タイプの設定は外せません（先に商品の窓タイプを外してください）';
  end if;
  return new;
end;
$$;

create trigger option_categories_window_type_guard
before update of uses_window_type on public.option_categories
for each row execute function public.option_categories_window_type_guard();

-- ---------- 標準見積の版の選択枠：位置・用途 ----------

alter table public.standard_estimate_revision_baseline_items
  add column slot_code text,
  add column slot_label text,
  add constraint standard_estimate_baseline_items_slot_pair check ((slot_code is null) = (slot_label is null)),
  add constraint standard_estimate_baseline_items_slot_code_format check (slot_code is null or slot_code ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  add constraint standard_estimate_baseline_items_slot_label_format
    check (slot_label is null or (slot_label = pg_catalog.btrim(slot_label) and slot_label <> '' and pg_catalog.char_length(slot_label) <= 40)),
  add constraint standard_estimate_baseline_items_slot_quantity check (slot_code is null or quantity = 1);

comment on column public.standard_estimate_revision_baseline_items.slot_code is
  '位置・用途の選択枠の識別子（英小文字・数字・ハイフン。版の中で一意。新しい版へ引き継ぎ、将来の平面図の位置と紐づける）。null はカテゴリー単位の選択枠。2026-10-30 先方回答。';
comment on column public.standard_estimate_revision_baseline_items.slot_label is
  '位置・用途の名前（掃出し窓・洗面窓・開き窓① など。同じカテゴリーの中で一意）。slot_code と両方あるか両方無いか。';

-- 位置の枠は版の中で一意（null＝カテゴリー単位の枠は何件でもよい）。選べる商品の表から参照する
alter table public.standard_estimate_revision_baseline_items
  add constraint standard_estimate_baseline_items_slot_code_key unique (revision_id, slot_code),
  add constraint standard_estimate_baseline_items_slot_label_key unique (revision_id, option_category_id, slot_label);

-- 同じ商品を複数の位置で使えるよう、一意の条件に位置を足す（カテゴリー単位の枠は、これまでどおり商品ごとに 1 つ）
alter table public.standard_estimate_revision_baseline_items
  drop constraint standard_estimate_revision_ba_revision_id_selection_target__key;
alter table public.standard_estimate_revision_baseline_items
  add constraint standard_estimate_baseline_items_target_option_slot_key
    unique nulls not distinct (revision_id, selection_target_code, option_id, slot_code);

-- ---------- 枠ごとの選べる商品 ----------

create table public.standard_estimate_revision_slot_options (
  revision_id uuid not null,
  slot_code text not null,
  option_id uuid not null references public.options (id) on delete restrict,
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (revision_id, slot_code, option_id),
  constraint standard_estimate_slot_options_slot_fkey foreign key (revision_id, slot_code)
    references public.standard_estimate_revision_baseline_items (revision_id, slot_code) on delete cascade
);

create index standard_estimate_slot_options_option_idx on public.standard_estimate_revision_slot_options (option_id);

comment on table public.standard_estimate_revision_slot_options is
  '位置・用途の選択枠ごとに、お客様が標準の商品の代わりに選べる商品（標準の商品は常に選べる。指定が無ければ標準の商品だけ）。'
  '同じカテゴリー・公開中・販売停止でない商品だけ（公開とスイッチで確かめる）。公開済みの版は変えない。2026-10-30 先方回答。';

alter table public.standard_estimate_revision_slot_options enable row level security;

create policy standard_estimate_revision_slot_options_read on public.standard_estimate_revision_slot_options
  for select to authenticated using (public.can_view_standard_estimate_revision(revision_id));

revoke all on table public.standard_estimate_revision_slot_options from anon, authenticated;
grant select on table public.standard_estimate_revision_slot_options to authenticated;

-- v2.5 の RPC からだけ変える・下書きだけ変えられる（版の子の表と同じ守り）
create trigger standard_estimate_revision_slot_options_v25_guard
before insert or update or delete on public.standard_estimate_revision_slot_options
for each row execute function public.standard_estimate_v25_child_guard();

create trigger standard_estimate_revision_slot_options_draft_only
before insert or update or delete on public.standard_estimate_revision_slot_options
for each row execute function public.prevent_non_draft_standard_estimate_child_write();

-- ---------- お客様の保存したプラン：位置の枠ごとの明細 ----------

alter table public.configuration_items
  add column slot_code text,
  add constraint configuration_items_slot_code_format check (slot_code is null or slot_code ~ '^[a-z0-9][a-z0-9-]{0,39}$');

comment on column public.configuration_items.slot_code is
  '標準見積の版の位置・用途の選択枠（standard_estimate_revision_baseline_items.slot_code）ごとの選択。null はカテゴリー単位の選択（これまでどおり）。v2.5 PR-S1。';

-- 同じ商品を複数の位置で選べるよう、一意の条件を「カテゴリー単位は商品ごと・位置は枠ごと」に分ける
alter table public.configuration_items drop constraint configuration_items_configuration_id_option_id_key;
create unique index configuration_items_option_key on public.configuration_items (configuration_id, option_id) where slot_code is null;
create unique index configuration_items_slot_key on public.configuration_items (configuration_id, slot_code) where slot_code is not null;


-- ---------- 版を写す：位置・用途の選択枠と選べる商品も写す ----------

create or replace function public.standard_estimate_v25_copy_slots(p_from_revision_id uuid, p_to_revision_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_from_model text;
  v_auto_sections text[];
  v_mode text;
  b public.standard_estimate_revision_baseline_items%rowtype;
  v_new_id uuid;
begin
  select r.pricing_model into v_from_model from public.standard_estimate_revisions r where r.id = p_from_revision_id;
  select rule.auto_price_sections into v_auto_sections
    from public.standard_estimate_revisions r
    join public.pricing_calculation_rule_versions rule on rule.id = r.calc_rule_version_id
   where r.id = p_to_revision_id;
  for b in
    select * from public.standard_estimate_revision_baseline_items bi
     where bi.revision_id = p_from_revision_id
     order by bi.sort_order, bi.id
  loop
    v_mode := case
      when v_from_model = 'v2.5' then b.price_mode
      when b.section_code = any(coalesce(v_auto_sections, '{}'::text[])) then 'auto'
      else 'por'
    end;
    insert into public.standard_estimate_revision_baseline_items (
      revision_id, baseline_key, option_id, option_category_id, section_code, selection_target_code, quantity,
      option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot,
      unit_price_snapshot, price_on_request_snapshot, sort_order,
      price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label
    )
    values (
      p_to_revision_id, b.baseline_key, b.option_id, b.option_category_id, b.section_code, b.selection_target_code, b.quantity,
      b.option_code_snapshot, b.option_name_snapshot, b.category_code_snapshot, b.category_name_snapshot,
      b.unit_price_snapshot, b.price_on_request_snapshot, b.sort_order,
      v_mode,
      case
        when v_mode <> 'auto' then null
        when v_from_model = 'v2.5' then b.standard_cost_version_id
        else (select v.id from public.option_standard_cost_versions v where v.option_id = b.option_id and v.superseded_at is null)
      end,
      case when v_mode = 'manual' then b.manual_unit_price end,
      b.slot_code, b.slot_label
    )
    returning id into v_new_id;

    insert into public.standard_estimate_revision_baseline_variants (
      baseline_item_id, variant_group_id, variant_choice_id,
      variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot,
      extra_price_snapshot, price_on_request_snapshot, sort_order,
      variant_cost_version_id, cost_adjustment_snapshot
    )
    select v_new_id, bv.variant_group_id, bv.variant_choice_id,
           bv.variant_group_code_snapshot, bv.variant_group_name_snapshot, bv.variant_choice_code_snapshot, bv.variant_choice_name_snapshot,
           bv.extra_price_snapshot, bv.price_on_request_snapshot, bv.sort_order,
           case
             when v_mode <> 'auto' then null
             when v_from_model = 'v2.5' then bv.variant_cost_version_id
             else cur.id
           end,
           case
             when v_mode <> 'auto' then null
             when v_from_model = 'v2.5' then bv.cost_adjustment_snapshot
             else cur.cost_adjustment
           end
      from public.standard_estimate_revision_baseline_variants bv
      left join public.option_variant_cost_versions cur
        on cur.variant_choice_id = bv.variant_choice_id and cur.superseded_at is null
     where bv.baseline_item_id = b.id;

    -- 位置・用途の選択枠の選べる商品も写す（v2.5 PR-S1。新しい版へ枠の識別子と選べる商品を引き継ぐ）
    if b.slot_code is not null then
      insert into public.standard_estimate_revision_slot_options (revision_id, slot_code, option_id, sort_order)
      select p_to_revision_id, so.slot_code, so.option_id, so.sort_order
        from public.standard_estimate_revision_slot_options so
       where so.revision_id = p_from_revision_id and so.slot_code = b.slot_code;
    end if;
  end loop;
end;
$$;

-- ---------- 下書きの保存：位置・用途の選択枠と選べる商品 ----------

create or replace function public.save_standard_estimate_v25_draft(p_revision_id uuid, p_expected_lock_version integer, p_payload jsonb)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions%rowtype;
  m public.standard_estimate_masters%rowtype;
  v_model public.base_models%rowtype;
  v_sales_fee numeric;
  v_expense numeric;
  v_markup numeric;
  v_adjustment integer;
  v_reason text;
  v_old jsonb;
  v_prev jsonb;
  item jsonb;
  v_index integer := 0;
  v_option_id uuid;
  v_qty numeric;
  v_mode text;
  v_manual integer;
  v_baseline_key uuid;
  v_choice_ids uuid[];
  v_choice_id uuid;
  v_identity text;
  v_seen uuid[] := '{}'::uuid[];
  v_seen_keys uuid[] := '{}'::uuid[];
  v_groups uuid[];
  v_reuse boolean;
  v_cost_pin uuid;
  v_variant_pin uuid;
  v_variant_adjustment integer;
  o public.options%rowtype;
  c public.option_categories%rowtype;
  g public.option_variant_groups%rowtype;
  ch public.option_variant_choices%rowtype;
  v_item_id uuid;
  v_section text;
  v_name text;
  v_unit_price integer;
  v_line_key uuid;
  v_auto_sections text[];
  v_section_of_slot text;
  -- 位置・用途の選択枠（v2.5 PR-S1）
  v_slot_code text;
  v_slot_label text;
  v_seen_option_slots text[] := '{}'::text[];
  v_seen_slots text[] := '{}'::text[];
  v_seen_labels text[] := '{}'::text[];
  v_selectable jsonb;
  v_alt_ids uuid[];
  v_alt_id uuid;
  v_alt public.options%rowtype;
  v_alt_index integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 標準見積が見つかりません';
  end if;
  if not coalesce(public.can_edit_standard_estimate_master(rev.standard_estimate_master_id), false) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: この標準見積を編集できません';
  end if;
  if rev.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'LOCKED: 公開済みの Revision は変更できません。新しい下書きを作成してください';
  end if;
  if rev.pricing_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の下書きではありません。先に v2.5 の下書きに切り替えてください';
  end if;
  if rev.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'LOCKED: 他の画面でこの標準見積が更新されています。再読み込みして内容を確認してください';
  end if;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.jsonb_typeof(p_payload -> 'rates') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_payload -> 'slots') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_payload -> 'lines') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 保存する内容の形式が不正です';
  end if;
  if pg_catalog.jsonb_array_length(p_payload -> 'slots') > 200 or pg_catalog.jsonb_array_length(p_payload -> 'lines') > 300 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 商品は 200 件、明細は 300 行までです';
  end if;
  begin
    v_sales_fee := (p_payload -> 'rates' ->> 'sales_fee_rate')::numeric;
    v_expense := (p_payload -> 'rates' ->> 'expense_rate')::numeric;
    v_markup := (p_payload -> 'rates' ->> 'markup_rate')::numeric;
    v_adjustment := coalesce((p_payload ->> 'adjustment')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 率・調整額の形式が不正です';
  end;
  if v_sales_fee is null or v_sales_fee < 1 or v_sales_fee > 1.5 or v_sales_fee <> round(v_sales_fee, 4) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 販売費率は 100〜150% の範囲で入力してください';
  end if;
  if v_expense is null or v_expense < 0 or v_expense > 0.3 or v_expense <> round(v_expense, 4) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 経費率は 0〜30% の範囲で入力してください';
  end if;
  if v_markup is null or v_markup < 1 or v_markup > 2.5 or v_markup <> round(v_markup, 4) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 掛率は 100〜250% の範囲で入力してください';
  end if;
  v_reason := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'adjustment_reason', '')), '');
  if v_adjustment <> 0 and v_reason is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 調整額を入れる場合は理由を入力してください';
  end if;
  if v_reason is not null and pg_catalog.char_length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 調整額の理由は 500 文字までです';
  end if;

  perform public.standard_estimate_v25_set_writer(true);

  select * into m from public.standard_estimate_masters sm where sm.id = rev.standard_estimate_master_id;
  select * into v_model from public.base_models bm where bm.id = m.base_model_id;
  select rule.auto_price_sections into v_auto_sections
    from public.pricing_calculation_rule_versions rule where rule.id = rev.calc_rule_version_id;

  -- 保存前の auto の選択枠の固定（商品＋選択肢の組み合わせごと）
  select coalesce(pg_catalog.jsonb_object_agg(x.identity, x.pins), '{}'::jsonb)
    into v_old
    from (
      select coalesce(b.slot_code, '') || '#' || b.option_id::text || '|' || coalesce((
               select string_agg(bv.variant_choice_id::text, ',' order by bv.variant_choice_id)
                 from public.standard_estimate_revision_baseline_variants bv
                where bv.baseline_item_id = b.id), '') as identity,
             pg_catalog.jsonb_build_object(
               'cost_pin', b.standard_cost_version_id,
               'variants', coalesce((
                 select pg_catalog.jsonb_object_agg(bv.variant_choice_id::text,
                          pg_catalog.jsonb_build_object('pin', bv.variant_cost_version_id, 'adjustment', bv.cost_adjustment_snapshot))
                   from public.standard_estimate_revision_baseline_variants bv
                  where bv.baseline_item_id = b.id), '{}'::jsonb)) as pins
        from public.standard_estimate_revision_baseline_items b
       where b.revision_id = rev.id
         and b.price_mode = 'auto'
    ) x;

  update public.standard_estimate_revisions r
     set sales_fee_rate = v_sales_fee,
         expense_rate = v_expense,
         markup_rate = v_markup,
         lock_version = r.lock_version + 1,
         updated_by = v_uid
   where r.id = rev.id
  returning * into rev;

  delete from public.standard_estimate_revision_baseline_items b where b.revision_id = rev.id;

  for item in select x.value from pg_catalog.jsonb_array_elements(p_payload -> 'slots') x loop
    v_index := v_index + 1;
    if pg_catalog.jsonb_typeof(item) <> 'object' then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の形式が不正です', v_index);
    end if;
    begin
      v_option_id := (item ->> 'option_id')::uuid;
      v_qty := coalesce((item ->> 'quantity')::numeric, 1);
      v_mode := coalesce(item ->> 'price_mode', 'auto');
      v_manual := (item ->> 'manual_unit_price')::integer;
      v_baseline_key := nullif(item ->> 'baseline_key', '')::uuid;
      v_slot_code := nullif(pg_catalog.btrim(coalesce(item ->> 'slot_code', '')), '');
      v_slot_label := nullif(pg_catalog.btrim(coalesce(item ->> 'slot_label', '')), '');
      v_selectable := coalesce(item -> 'selectable_option_ids', '[]'::jsonb);
      if pg_catalog.jsonb_typeof(v_selectable) <> 'array' or pg_catalog.jsonb_array_length(v_selectable) > 50 then
        raise invalid_parameter_value;
      end if;
      v_alt_ids := coalesce(array(
        select y.value::uuid from pg_catalog.jsonb_array_elements_text(v_selectable) y(value)
      ), '{}'::uuid[]);
      v_choice_ids := coalesce(array(
        select y.value::uuid from pg_catalog.jsonb_array_elements_text(coalesce(item -> 'variant_choice_ids', '[]'::jsonb)) y(value)
      ), '{}'::uuid[]);
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の商品・数量・選択肢・単価・選べる商品の形式が不正です（選べる商品は 50 件まで）', v_index);
    end;
    if v_option_id is null then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の商品を選んでください', v_index);
    end if;
    -- 位置・用途の選択枠（v2.5 PR-S1）：識別子と名前は両方。識別子は英小文字・数字・ハイフン（40 字まで）で版の中で一意
    if (v_slot_code is null) <> (v_slot_label is null) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：位置・用途の識別子と名前は両方入力してください', v_index);
    end if;
    if v_slot_code is not null and v_slot_code !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 商品 %s 件目：位置・用途の識別子は英小文字・数字・ハイフン（40 字まで。先頭は英小文字か数字）で入力してください', v_index);
    end if;
    if v_slot_label is not null and pg_catalog.char_length(v_slot_label) > 40 then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：位置・用途の名前は 40 文字までです', v_index);
    end if;
    if v_slot_code is not null then
      if v_slot_code = any(v_seen_slots) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：位置・用途の識別子が重複しています（%s）', v_index, v_slot_code);
      end if;
      v_seen_slots := array_append(v_seen_slots, v_slot_code);
    elsif pg_catalog.cardinality(v_alt_ids) > 0 then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：選べる商品は、位置・用途の選択枠にだけ指定できます', v_index);
    end if;
    -- 同じ商品は、位置・用途が違えば複数の枠で使える（カテゴリー単位の枠は、これまでどおり商品ごとに 1 つ）
    if (v_option_id::text || '#' || coalesce(v_slot_code, '')) = any(v_seen_option_slots) then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 商品 %s 件目：同じ商品が重複しています（位置ごとに分けるときは、位置・用途の選択枠にします）', v_index);
    end if;
    v_seen_option_slots := array_append(v_seen_option_slots, v_option_id::text || '#' || coalesce(v_slot_code, ''));
    if v_baseline_key is not null then
      if v_baseline_key = any(v_seen_keys) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：選択枠の識別子が重複しています', v_index);
      end if;
      v_seen_keys := array_append(v_seen_keys, v_baseline_key);
    end if;
    if v_qty::text in ('NaN', 'Infinity', '-Infinity') or v_qty <= 0 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください', v_index);
    end if;
    if v_mode not in ('auto', 'manual', 'por') then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の価格の決め方が不正です', v_index);
    end if;
    if v_mode = 'manual' and (v_manual is null or v_manual < 0) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の売価単価（税別・経費別、0 円以上）を入力してください', v_index);
    end if;
    if v_mode <> 'manual' then
      v_manual := null;
    end if;

    select * into o from public.options x where x.id = v_option_id;
    if not found or o.status <> 'published' or (o.base_model_id is not null and o.base_model_id <> m.base_model_id) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：この商品モデルで使える登録済みの商品を選んでください', v_index);
    end if;
    select * into c from public.option_categories x where x.id = o.category_id;
    if not coalesce(public.customer_category_selectable(v_model.slug, m.spec_code, c.code), false) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：この仕様ではお客様が選べないカテゴリーの商品です（%s）', v_index, c.name);
    end if;
    if v_slot_code is not null then
      -- 外壁は 4 面の専用の仕組み、防火仕様は版で決まるので、位置の枠にしない。位置の枠は数量 1
      if c.code in ('exterior-wall', 'fireproof') then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：外壁・防火仕様には位置・用途の選択枠を作れません', v_index);
      end if;
      if v_qty <> 1 then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：位置・用途の選択枠の数量は 1 です', v_index);
      end if;
      if (c.id::text || '#' || v_slot_label) = any(v_seen_labels) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：同じカテゴリーに同じ名前の位置・用途があります（%s）', v_index, v_slot_label);
      end if;
      v_seen_labels := array_append(v_seen_labels, c.id::text || '#' || v_slot_label);
    end if;
    v_section_of_slot := public.estimate_section_for_option(c.code, o.is_installation);
    if v_mode = 'auto' and not (v_section_of_slot = any(coalesce(v_auto_sections, '{}'::text[]))) then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 商品 %s 件目：別途工事の商品は自動計算（販売費・掛率）にできません。決めた税別売価を入力するか、別途見積にしてください', v_index);
    end if;

    -- 選択肢を確かめ、組み合わせの同一性（商品＋選択肢）を作る
    v_groups := '{}'::uuid[];
    foreach v_choice_id in array v_choice_ids loop
      select * into ch from public.option_variant_choices x where x.id = v_choice_id;
      if not found or ch.status <> 'published' then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：商品の選択肢が見つかりません', v_index);
      end if;
      select * into g from public.option_variant_groups x where x.id = ch.group_id;
      if not found or g.option_id <> o.id or g.status <> 'published' then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：この商品の選択肢ではありません', v_index);
      end if;
      if g.id = any(v_groups) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：同じ選択項目の選択肢が重複しています', v_index);
      end if;
      v_groups := array_append(v_groups, g.id);
    end loop;
    v_identity := o.id::text || '|' || coalesce(array_to_string(array(select z from unnest(v_choice_ids) z order by z), ','), '');
    v_prev := case when v_mode = 'auto' then v_old -> (coalesce(v_slot_code, '') || '#' || v_identity) end;
    v_reuse := v_prev is not null;

    v_cost_pin := case
      when v_mode <> 'auto' then null
      when v_reuse then (v_prev ->> 'cost_pin')::uuid
      else (select v.id from public.option_standard_cost_versions v where v.option_id = o.id and v.superseded_at is null)
    end;

    insert into public.standard_estimate_revision_baseline_items (
      revision_id, baseline_key, option_id, option_category_id, section_code, selection_target_code, quantity,
      option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot,
      unit_price_snapshot, price_on_request_snapshot, sort_order,
      price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label
    )
    values (
      rev.id, coalesce(v_baseline_key, gen_random_uuid()), o.id, c.id, public.estimate_section_for_option(c.code, o.is_installation), c.code, v_qty,
      o.code, o.name, c.code, c.name,
      case when o.price_on_request then 0 else o.price end, o.price_on_request, v_index,
      v_mode, v_cost_pin, v_manual, v_slot_code, v_slot_label
    )
    returning id into v_item_id;

    v_groups := '{}'::uuid[];
    foreach v_choice_id in array v_choice_ids loop
      select * into ch from public.option_variant_choices x where x.id = v_choice_id;
      select * into g from public.option_variant_groups x where x.id = ch.group_id;
      v_groups := array_append(v_groups, g.id);
      if v_mode <> 'auto' then
        v_variant_pin := null;
        v_variant_adjustment := null;
      elsif v_reuse then
        v_variant_pin := (v_prev -> 'variants' -> ch.id::text ->> 'pin')::uuid;
        v_variant_adjustment := (v_prev -> 'variants' -> ch.id::text ->> 'adjustment')::integer;
      else
        select cv.id, cv.cost_adjustment into v_variant_pin, v_variant_adjustment
          from public.option_variant_cost_versions cv
         where cv.variant_choice_id = ch.id and cv.superseded_at is null;
        if not found then
          v_variant_pin := null;
          v_variant_adjustment := null;
        end if;
      end if;
      insert into public.standard_estimate_revision_baseline_variants (
        baseline_item_id, variant_group_id, variant_choice_id,
        variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot,
        extra_price_snapshot, price_on_request_snapshot, sort_order,
        variant_cost_version_id, cost_adjustment_snapshot
      )
      values (
        v_item_id, g.id, ch.id, g.code, g.name, ch.code, ch.name,
        case when ch.price_on_request then 0 else ch.extra_price end, ch.price_on_request, cardinality(v_groups),
        v_variant_pin, v_variant_adjustment
      );
    end loop;

    -- 枠ごとの選べる商品（標準の商品は常に選べるので入れない）。同じカテゴリーの、この商品モデルで使える登録済みの商品だけ
    -- （販売停止・廃番は公開とスイッチで確かめる：standard_estimate_v25_slot_rule_issues）
    if v_slot_code is not null then
      v_alt_index := 0;
      foreach v_alt_id in array v_alt_ids loop
        if v_alt_id = o.id then
          continue;
        end if;
        select * into v_alt from public.options x where x.id = v_alt_id;
        if not found or v_alt.status <> 'published' or v_alt.category_id <> o.category_id
           or (v_alt.base_model_id is not null and v_alt.base_model_id <> m.base_model_id) then
          raise exception using errcode = 'P0001',
            message = format('VALIDATION: 商品 %s 件目：選べる商品は、標準の商品と同じカテゴリーの、この商品モデルで使える登録済みの商品にしてください', v_index);
        end if;
        v_alt_index := v_alt_index + 1;
        insert into public.standard_estimate_revision_slot_options (revision_id, slot_code, option_id, sort_order)
        values (rev.id, v_slot_code, v_alt_id, v_alt_index)
        on conflict (revision_id, slot_code, option_id) do nothing;
      end loop;
    end if;
  end loop;

  delete from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id;
  v_index := 0;
  for item in select x.value from pg_catalog.jsonb_array_elements(p_payload -> 'lines') x loop
    v_index := v_index + 1;
    if pg_catalog.jsonb_typeof(item) <> 'object' then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目の形式が不正です', v_index);
    end if;
    v_section := item ->> 'section_code';
    if v_section is null or v_section not in ('interior_exterior', 'option', 'sitework') then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目の区分が不正です（本体の明細は本体マスターで管理します）', v_index);
    end if;
    v_name := nullif(pg_catalog.btrim(coalesce(item ->> 'name', '')), '');
    if v_name is null or pg_catalog.char_length(v_name) > 120 then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目の品名は 1〜120 文字で入力してください', v_index);
    end if;
    v_mode := coalesce(item ->> 'price_mode', 'manual');
    if v_mode not in ('manual', 'por') then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 明細 %s 行目の価格の決め方は manual（金額確定）か別途見積です。商品台帳の商品は商品として追加してください', v_index);
    end if;
    begin
      v_qty := coalesce((item ->> 'quantity')::numeric, 1);
      v_unit_price := (item ->> 'unit_price')::integer;
      v_line_key := nullif(item ->> 'line_key', '')::uuid;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目の数量・単価・識別子の形式が不正です', v_index);
    end;
    if v_qty::text in ('NaN', 'Infinity', '-Infinity') or v_qty <= 0 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください', v_index);
    end if;
    if v_mode = 'manual' and (v_unit_price is null or v_unit_price < 0) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目の売価単価（税別・経費別、0 円以上）を入力してください', v_index);
    end if;
    if v_mode = 'por' then
      v_unit_price := null;
    end if;
    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order
    )
    values (
      rev.id, coalesce(v_line_key, gen_random_uuid()), v_section,
      nullif(pg_catalog.btrim(coalesce(item ->> 'group_label', '')), ''), v_name, v_qty,
      nullif(pg_catalog.btrim(coalesce(item ->> 'unit', '')), ''),
      v_mode, v_unit_price, case when v_unit_price is null then null else trunc(v_qty * v_unit_price)::integer end,
      nullif(pg_catalog.btrim(coalesce(item ->> 'remark', '')), ''),
      coalesce((item ->> 'review_required')::boolean, false), v_index
    );
  end loop;

  perform public.standard_estimate_v25_recalculate(rev.id, false, v_adjustment, v_reason);
  perform public.standard_estimate_v25_set_writer(false);
  select * into rev from public.standard_estimate_revisions r where r.id = rev.id;
  return rev;
end;
$$;

-- ---------- 選択枠の決まり：位置・用途の枠と選べる商品（v2.5 PR-S1） ----------

-- C1 の決まり（外壁は数量 4、それ以外は数量 1、シミュレーターで 1 つだけ選べるカテゴリーのカテゴリー単位の枠は 1 つ）に、
-- 位置・用途の枠の決まりを足す（2026-10-30 先方回答）：
-- * 位置の枠は外壁・防火仕様に作らない（外壁は 4 面の専用の仕組み、防火仕様は版で決まる）
-- * 1 つのカテゴリーで、カテゴリー単位の枠と位置の枠を混ぜない（シミュレーターで、そのカテゴリーの選び方を 1 つに決めるため）
-- * 1 つだけ選べるカテゴリーでも、位置の枠は位置ごとに 1 つ選ぶので何枠でもよい
-- * 選べる商品は、その枠の標準の商品と同じカテゴリーの、公開中で販売停止・廃番でない商品
-- 問題が無ければ null、あれば内容の文。内部の部品
create or replace function public.standard_estimate_v25_slot_rule_issues(p_revision_id uuid)
returns text
language sql
stable
set search_path = ''
as $slot_rules$
  with slots as (
    select bi.option_name_snapshot as name, bi.quantity, bi.slot_code, bi.slot_label,
           c.id as category_id, c.name as category_name, c.code as category_code,
           (c.selection_mode = 'single' or c.code in ('boiler', 'aircon', 'washbasin', 'toilet', 'kitchen')) as single_select,
           case when o.code in ('washbasin-kb', 'faucet-kb') then 'washbasin-standard-set' else bi.id::text end as display_key
      from public.standard_estimate_revision_baseline_items bi
      join public.options o on o.id = bi.option_id
      join public.option_categories c on c.id = o.category_id
     where bi.revision_id = p_revision_id
  ),
  slot_options as (
    select so.slot_code, o.name, o.category_id, o.status, o.archived_at, o.discontinued_at, s.category_id as slot_category_id
      from public.standard_estimate_revision_slot_options so
      join public.options o on o.id = so.option_id
      join slots s on s.slot_code = so.slot_code
     where so.revision_id = p_revision_id
  )
  select nullif(pg_catalog.concat_ws('／',
    (select '外壁の選択枠は数量 4（面）にしてください：' || string_agg(distinct '「' || s.name || '」', '・')
       from slots s where s.category_code = 'exterior-wall' and s.quantity <> 4),
    (select '外壁以外の選択枠は数量 1 にしてください（個別に変えるものは選択枠を分け、個別に選ばない数量は明細にします）：'
            || string_agg(distinct '「' || s.name || '」', '・')
       from slots s where s.category_code <> 'exterior-wall' and s.quantity <> 1),
    (select '外壁・防火仕様には位置・用途の選択枠を作れません：' || string_agg(distinct '「' || s.name || '」', '・')
       from slots s where s.slot_code is not null and s.category_code in ('exterior-wall', 'fireproof')),
    (select 'カテゴリー単位の選択枠と位置・用途の選択枠を、同じカテゴリーに混ぜられません：'
            || string_agg('「' || x.category_name || '」', '・' order by x.category_name)
       from (select s.category_id, s.category_name
               from slots s
              group by s.category_id, s.category_name
             having bool_or(s.slot_code is null) and bool_or(s.slot_code is not null)) x),
    (select '1 つだけ選べるカテゴリーの選択枠は 1 つにしてください：'
            || string_agg('「' || x.category_name || '」', '・' order by x.category_name)
            || '（位置ごとに分けるときは、位置・用途の選択枠にします）'
       from (select s.category_id, s.category_name
               from slots s
              where s.single_select and s.slot_code is null
              group by s.category_id, s.category_name
             having count(distinct s.display_key) > 1) x),
    (select '選べる商品は、その枠の標準の商品と同じカテゴリーの、公開中で販売停止・廃番でない商品にしてください：'
            || string_agg(distinct '「' || so.name || '」', '・')
       from slot_options so
      where so.category_id <> so.slot_category_id or so.status <> 'published'
         or so.archived_at is not null or so.discontinued_at is not null)
  ), '');
$slot_rules$;

comment on function public.standard_estimate_v25_slot_rule_issues(uuid) is
  'v2.5 の版の選択枠が、シミュレーターと連携する決まり（外壁は数量 4、それ以外は数量 1、シミュレーターで 1 つだけ選べるカテゴリーのカテゴリー単位の枠は 1 つ。位置・用途の枠は外壁・防火仕様に作らず、カテゴリー単位の枠と混ぜない。選べる商品は同じカテゴリーの公開中で販売中の商品。カテゴリーは商品の今のカテゴリー）に合うか。合わなければ内容の文。内部の部品。';


-- ---------- 売価単価：位置・用途の枠ごと（v2.5 PR-S1） ----------

create function public.standard_estimate_v25_selection_unit(p_revision_id uuid, p_option_id uuid, p_choice_ids uuid[], p_slot_code text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  rev record;
  o record;
  b record;
  v_choices uuid[];
  v_auto_sections text[];
  v_cost bigint;
  v_adjustment bigint := 0;
  v_one bigint;
  v_choice uuid;
begin
  select r.id, r.sales_fee_rate, r.markup_rate, r.calc_rule_version_id
    into rev
    from public.standard_estimate_revisions r
   where r.id = p_revision_id and r.pricing_model = 'v2.5';
  if not found then
    return null;
  end if;
  v_choices := array(select distinct z from unnest(coalesce(p_choice_ids, '{}'::uuid[])) z order by z);

  -- 版の選択枠と同じ「商品＋選択肢」は、公開した版の売価（auto は固定した原価から、manual は入力した売価、por は未確定）。
  -- 位置・用途の枠（p_slot_code）はその枠の標準とだけ、カテゴリー単位（null）はカテゴリー単位の枠とだけ照らす（v2.5 PR-S1）
  select bi.price_mode, bi.sale_unit_price, bi.manual_unit_price
    into b
    from public.standard_estimate_revision_baseline_items bi
   where bi.revision_id = rev.id
     and bi.option_id = p_option_id
     and bi.slot_code is not distinct from p_slot_code
     and array(select bv.variant_choice_id from public.standard_estimate_revision_baseline_variants bv
                where bv.baseline_item_id = bi.id order by bv.variant_choice_id) = v_choices
   limit 1;
  if found then
    return case b.price_mode when 'auto' then b.sale_unit_price when 'manual' then b.manual_unit_price else null end;
  end if;

  -- それ以外は、今の原価 Version とこの版の率で v2.5 の auto の式
  select x.id, x.price_on_request, x.is_installation, c.code as category_code
    into o
    from public.options x
    join public.option_categories c on c.id = x.category_id
   where x.id = p_option_id and x.status = 'published';
  if not found or o.price_on_request then
    return null;
  end if;
  select rv.auto_price_sections into v_auto_sections
    from public.pricing_calculation_rule_versions rv where rv.id = rev.calc_rule_version_id;
  if not (public.estimate_section_for_option(o.category_code, o.is_installation) = any(coalesce(v_auto_sections, '{}'::text[]))) then
    return null;
  end if;
  select v.standard_cost into v_cost
    from public.option_standard_cost_versions v
   where v.option_id = o.id and v.superseded_at is null;
  if v_cost is null then
    return null;
  end if;
  foreach v_choice in array v_choices loop
    v_one := null;
    select cv.cost_adjustment into v_one
      from public.option_variant_cost_versions cv
      join public.option_variant_choices vc on vc.id = cv.variant_choice_id and vc.status = 'published'
      join public.option_variant_groups vg on vg.id = vc.group_id and vg.status = 'published'
     where cv.variant_choice_id = v_choice
       and cv.superseded_at is null
       and vg.option_id = o.id;
    if v_one is null then
      return null;
    end if;
    v_adjustment := v_adjustment + v_one;
  end loop;
  if v_cost + v_adjustment < 0 then
    return null;
  end if;
  return trunc(trunc((v_cost + v_adjustment) * rev.sales_fee_rate) * rev.markup_rate)::integer;
end;
$$;

comment on function public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text) is
  'v2.5 の標準見積の版での「商品＋選択肢」の売価単価（税別・経費別）。位置・用途の枠（p_slot_code）はその枠の標準と同じなら公開した版の売価、カテゴリー単位（null）はカテゴリー単位の枠と同じなら公開した版の売価、それ以外は今の原価 Version と版の率。null は価格未確定。内部の部品。';

-- 3 引数（売価の表・表に無い組み合わせの計算）は、カテゴリー単位の選択として 4 引数を呼ぶ
create or replace function public.standard_estimate_v25_selection_unit(p_revision_id uuid, p_option_id uuid, p_choice_ids uuid[])
returns integer
language sql
stable
set search_path = ''
as $$
  select public.standard_estimate_v25_selection_unit(p_revision_id, p_option_id, p_choice_ids, null::text);
$$;

-- ---------- 売価だけの形：位置・用途の枠と選べる商品（v2.5 PR-S1） ----------

create or replace function public.standard_estimate_v25_sale_view(p_revision_id uuid, p_with_prices boolean)
returns jsonb
language sql
stable
set search_path = ''
as $sale_view$
  select pg_catalog.jsonb_build_object(
           'pricing_model', 'v2.5',
           'revision_id', r.id,
           'version', r.version,
           'base_model_id', m.base_model_id,
           'spec_code', m.spec_code,
           'size_code', mr.size_code,
           'fire_spec_code', bm.fire_spec_code,
           'tax_rate', r.tax_rate,
           'expense_rate', r.expense_rate,
           'subtotal_raw', r.subtotal_raw,
           'adjustment', r.standard_adjustment_amount,
           'subtotal', r.subtotal,
           'tax', r.tax,
           'total', r.total,
           'has_por', r.has_por,
           'sections', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'code', s.section_code,
                      'expense_method', s.expense_method,
                      'line_subtotal', s.line_subtotal,
                      'expense_amount', s.expense_amount,
                      'total', s.total,
                      'has_por', s.has_por
                    ) order by case s.section_code when 'base' then 0 when 'interior_exterior' then 1 when 'option' then 2 else 3 end)
               from public.standard_estimate_revision_sections s
              where s.revision_id = r.id
           ), '[]'::jsonb),
           'base_lines', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'section', l.section,
                      'name', l.name,
                      'quantity', l.quantity,
                      'unit', l.unit,
                      'unit_price', trunc(trunc(l.unit_price * r.sales_fee_rate) * r.markup_rate)::integer,
                      'amount', trunc(l.quantity * trunc(trunc(l.unit_price * r.sales_fee_rate) * r.markup_rate))::integer
                    ) order by l.sort_order, l.id)
               from public.base_master_revision_lines l
              where l.revision_id = r.base_master_revision_id
           ), '[]'::jsonb),
           -- 見積書の明細：商品の選択枠（売価）と、工事費などの明細。価格未確定は is_por
           'lines', coalesce((
             select pg_catalog.jsonb_agg(x.line order by x.sort_key)
               from (
                 select pg_catalog.jsonb_build_object(
                          'section_code', bi.section_code,
                          'group_label', case when bi.slot_label is null then bi.category_name_snapshot
                                              else bi.category_name_snapshot || '（' || bi.slot_label || '）' end,
                          'option_id', bi.option_id,
                          'slot_code', bi.slot_code,
                          'name', bi.option_name_snapshot || coalesce((
                            select ' ／ ' || string_agg(bv.variant_choice_name_snapshot, '・' order by bv.sort_order)
                              from public.standard_estimate_revision_baseline_variants bv where bv.baseline_item_id = bi.id), ''),
                          'quantity', bi.quantity,
                          'unit', '式',
                          'unit_price', bi.sale_unit_price,
                          'amount', bi.amount,
                          'is_por', bi.amount is null
                        ) as line,
                        pg_catalog.lpad(bi.sort_order::text, 6, '0') || '-a' as sort_key
                   from public.standard_estimate_revision_baseline_items bi
                  where bi.revision_id = r.id
                 union all
                 select pg_catalog.jsonb_build_object(
                          'section_code', l.section_code,
                          'group_label', l.group_label,
                          'name', l.name,
                          'quantity', l.quantity,
                          'unit', l.unit,
                          'unit_price', l.unit_price,
                          'amount', l.amount,
                          'is_por', l.price_mode = 'por' or l.amount is null,
                          'option_id', null,
                          'slot_code', null
                        ),
                        pg_catalog.lpad((100000 + l.sort_order)::text, 6, '0') || '-b'
                   from public.standard_estimate_revision_v25_lines l
                  where l.revision_id = r.id
               ) x
           ), '[]'::jsonb),
           -- 差額の基準（版の選択枠）。unit_price は公開した版の売価（未確定は 0・price_on_request）
           'baseline', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'option_id', bi.option_id,
                      'section_code', bi.section_code,
                      'selection_target_code', bi.selection_target_code,
                      'quantity', bi.quantity,
                      'unit_price', coalesce(bi.sale_unit_price, 0),
                      'price_on_request', bi.amount is null,
                      'variant_choice_ids', coalesce((
                        select pg_catalog.jsonb_agg(bv.variant_choice_id order by bv.variant_choice_id)
                          from public.standard_estimate_revision_baseline_variants bv where bv.baseline_item_id = bi.id), '[]'::jsonb),
                      'variant_extra', 0,
                      'amount', bi.amount,
                      -- 位置・用途の選択枠（v2.5 PR-S1）。選べる商品は標準の商品を先頭に、指定した順
                      'slot_code', bi.slot_code,
                      'slot_label', bi.slot_label,
                      'category_id', bi.option_category_id,
                      'selectable_option_ids', case when bi.slot_code is null then null else
                        pg_catalog.jsonb_build_array(bi.option_id) || coalesce((
                          select pg_catalog.jsonb_agg(so.option_id order by so.sort_order, so.option_id)
                            from public.standard_estimate_revision_slot_options so
                           where so.revision_id = bi.revision_id and so.slot_code = bi.slot_code), '[]'::jsonb) end
                    ) order by bi.sort_order, bi.id)
               from public.standard_estimate_revision_baseline_items bi
              where bi.revision_id = r.id
           ), '[]'::jsonb),
           'prices', case when p_with_prices then coalesce((
             select pg_catalog.jsonb_object_agg(o.id::text, public.standard_estimate_v25_price_table(r.id, o.id))
               from public.options o
              where o.status = 'published'
                and (o.base_model_id is null or o.base_model_id = m.base_model_id)
           ), '{}'::jsonb) else null end
         )
    from public.standard_estimate_revisions r
    join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
    join public.base_masters bm on bm.id = m.base_master_id
    join public.matrix_rows mr on mr.id = bm.matrix_row_id
   where r.id = p_revision_id
     and r.pricing_model = 'v2.5';
$sale_view$;

-- ---------- 保存した仕様の金額：位置・用途の枠ごと（v2.5 PR-S1） ----------

create or replace function public.standard_estimate_v25_configuration_money(p_configuration_id uuid, p_revision_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cfg public.configurations;
  rev public.standard_estimate_revisions%rowtype;
  v_fire_revision boolean;
  v_has_faces boolean;
  v_code text;
  s record;
  item record;
  face record;
  v_unit integer;
  v_item_por boolean := false;
  v_current bigint;
  v_baseline bigint;
  v_delta bigint;
  v_line bigint;
  v_expense bigint;
  v_raw bigint := 0;
  v_subtotal bigint;
  v_tax bigint;
  v_sections jsonb := '{}'::jsonb;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id and r.pricing_model = 'v2.5';
  if cfg.id is null or rev.id is null then
    return null;
  end if;
  select bm.fire_spec_code = 'fire' into v_fire_revision
    from public.standard_estimate_masters m join public.base_masters bm on bm.id = m.base_master_id
   where m.id = rev.standard_estimate_master_id;
  v_has_faces := pg_catalog.jsonb_typeof(cfg.exterior_faces) = 'array' and pg_catalog.jsonb_array_length(cfg.exterior_faces) = 4;

  foreach v_code in array array['base', 'interior_exterior', 'option', 'sitework'] loop
    select x.expense_method, x.line_subtotal, x.expense_amount into s
      from public.standard_estimate_revision_sections x where x.revision_id = rev.id and x.section_code = v_code;
    if v_code = 'base' then
      v_delta := 0;
      v_line := coalesce(s.line_subtotal, 0);
      v_expense := coalesce(s.expense_amount, 0);
    else
      v_current := 0;
      for item in
        select ci.option_id, ci.quantity, coalesce(ci.variant_choice_ids, '{}'::uuid[]) as choice_ids, ci.slot_code
          from public.configuration_items ci
          join public.options o on o.id = ci.option_id and o.status = 'published'
          join public.option_categories cat on cat.id = o.category_id
         where ci.configuration_id = cfg.id
           and public.estimate_section_for_option(cat.code, o.is_installation) = v_code
           and not (v_has_faces and cat.code = 'exterior-wall')
           -- 防火の版を使うときは、防火仕様の行は版に含まれるので数えない
           and not (coalesce(v_fire_revision, false) and cat.code = 'fireproof')
      loop
        -- 位置・用途の枠の明細は、その枠の標準と照らす（v2.5 PR-S1）
        v_unit := public.standard_estimate_v25_selection_unit(rev.id, item.option_id, item.choice_ids, item.slot_code);
        if v_unit is null then
          v_item_por := true;
        else
          v_current := v_current + v_unit::bigint * item.quantity;
        end if;
      end loop;
      if v_code = 'interior_exterior' and v_has_faces then
        for face in
          select (f.value ->> 'option_id')::uuid as option_id,
                 coalesce(array(select pg_catalog.jsonb_array_elements_text(coalesce(f.value -> 'variant_choice_ids', '[]'::jsonb))::uuid), '{}'::uuid[]) as choice_ids
            from pg_catalog.jsonb_array_elements(cfg.exterior_faces) as f(value)
            join public.options o on o.id = (f.value ->> 'option_id')::uuid and o.status = 'published'
            join public.option_categories cat on cat.id = o.category_id and cat.code = 'exterior-wall'
        loop
          v_unit := public.standard_estimate_v25_selection_unit(rev.id, face.option_id, face.choice_ids);
          if v_unit is null then
            v_item_por := true;
          else
            v_current := v_current + v_unit;
          end if;
        end loop;
      end if;
      select coalesce(sum(bi.amount), 0) into v_baseline
        from public.standard_estimate_revision_baseline_items bi
       where bi.revision_id = rev.id and bi.section_code = v_code and bi.amount is not null;
      v_delta := v_current - v_baseline;
      v_line := coalesce(s.line_subtotal, 0) + v_delta;
      v_expense := case when s.expense_method = 'rate' then trunc(v_line * rev.expense_rate)::bigint else 0 end;
    end if;
    v_sections := v_sections || pg_catalog.jsonb_build_object(v_code, pg_catalog.jsonb_build_object(
      'line_subtotal', v_line,
      'expense_amount', v_expense,
      'total', v_line + v_expense,
      'delta_line', v_delta,
      'expense_method', coalesce(s.expense_method, 'none')
    ));
    v_raw := v_raw + v_line + v_expense;
  end loop;

  v_subtotal := v_raw + rev.standard_adjustment_amount;
  v_tax := trunc(v_subtotal * rev.tax_rate)::bigint;
  return pg_catalog.jsonb_build_object(
    'sections', v_sections,
    'subtotal_raw', v_raw,
    'adjustment', rev.standard_adjustment_amount,
    'subtotal', v_subtotal,
    'tax', v_tax,
    'total', v_subtotal + v_tax,
    'tax_rate', rev.tax_rate,
    'expense_rate', rev.expense_rate,
    'has_por', coalesce(rev.has_por, false) or v_item_por
  );
end;
$$;

-- ---------- 見積依頼の明細：位置ごとの選択の確認と写し（v2.5 PR-S1） ----------

create or replace function public.write_standard_estimate_quote_items(p_configuration_id uuid, p_quote_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $write_quote_items$
declare
  cfg public.configurations;
  v_revision uuid;
  v_view jsonb;
  v_money jsonb;
  v_sections jsonb;
  v_rate_label text;
  v_code text;
  v_kind text;
  v_base_sort integer;
  v_amount integer;
begin
  if not public.simulator_standard_pricing_enabled() then
    return false;
  end if;
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then
    return false;
  end if;
  v_revision := public.standard_estimate_v25_revision_for_configuration(p_configuration_id);
  if v_revision is null then
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'base', '本体・選択した商品一式', '標準見積の準備中の仕様のため、価格は担当者がお見積りします', '式',
            '価格未確定（別途お見積り）', 0, 1, 0, 1);
    return true;
  end if;
  -- 位置・用途の選択枠（v2.5 PR-S1）：保存したプランの選択が、今の公開中の版の位置の枠と 1 対 1 で、その枠で選べる商品か。
  -- 版が変わった後の古い保存は、シミュレーターで開いて保存し直してから（保存で、位置ごとに選べる商品を確かめ直す）
  if exists (
    select 1 from public.standard_estimate_revision_baseline_items bi
     where bi.revision_id = v_revision and bi.slot_code is not null
       and not exists (select 1 from public.configuration_items ci where ci.configuration_id = cfg.id and ci.slot_code = bi.slot_code)
  ) or exists (
    select 1 from public.configuration_items ci
     where ci.configuration_id = cfg.id and ci.slot_code is not null
       and not exists (
         select 1 from public.standard_estimate_revision_baseline_items bi
          where bi.revision_id = v_revision and bi.slot_code = ci.slot_code
            and (bi.option_id = ci.option_id or exists (
                   select 1 from public.standard_estimate_revision_slot_options so
                    where so.revision_id = v_revision and so.slot_code = bi.slot_code and so.option_id = ci.option_id))
       )
  ) then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 標準の構成（窓などの位置ごとの選択）が更新されています。シミュレーターでプランを開いて保存し直してから、見積を依頼してください';
  end if;

  v_view := public.standard_estimate_v25_sale_view(v_revision, false);
  v_money := public.standard_estimate_v25_configuration_money(p_configuration_id, v_revision);
  v_sections := v_money -> 'sections';
  v_rate_label := trim(trailing '.' from to_char((v_view ->> 'expense_rate')::numeric * 100, 'FM990.99'));

  -- 本体：固定した本体 Revision の明細（売価）
  insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
  select p_quote_id, 'base', l.value ->> 'name', l.value ->> 'section', l.value ->> 'unit',
         (l.value ->> 'unit_price')::integer, (l.value ->> 'quantity')::numeric, (l.value ->> 'amount')::integer, l.ordinality::integer
    from pg_catalog.jsonb_array_elements(v_view -> 'base_lines') with ordinality as l(value, ordinality);

  v_amount := (v_sections #>> '{base,expense_amount}')::numeric::integer;
  if v_amount <> 0 then
    insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, 900);
  end if;

  foreach v_code in array array['interior_exterior', 'option', 'sitework'] loop
    v_kind := case v_code when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'installation' end;
    v_base_sort := case v_code when 'interior_exterior' then 1000 when 'option' then 2000 else 3000 end;

    -- 標準見積の明細（売価）。価格未確定の行は 0 円で「別途お見積り」と明記する
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    select p_quote_id, v_kind, l.value ->> 'name', l.value ->> 'group_label', coalesce(l.value ->> 'unit', ''),
           case when (l.value ->> 'is_por')::boolean then '価格未確定（別途お見積り）' end,
           case when (l.value ->> 'is_por')::boolean then 0 else (l.value ->> 'unit_price')::integer end,
           coalesce((l.value ->> 'quantity')::numeric, 1),
           case when (l.value ->> 'is_por')::boolean then 0 else (l.value ->> 'amount')::integer end,
           v_base_sort + l.ordinality::integer
      from pg_catalog.jsonb_array_elements(v_view -> 'lines') with ordinality as l(value, ordinality)
     where l.value ->> 'section_code' = v_code;

    -- 位置・用途の選択枠ごとに、選んだ商品と仕様を 0 円の写しで残す（価格は選択商品の変更差額に反映済み。外壁の面と同じ形）
    insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, unit, amount, image_url, remark, sort_order)
    select p_quote_id, v_kind,
           bi.category_name_snapshot || '（' || bi.slot_label || '）',
           o.name || coalesce(' ／ ' || vl.label, ''),
           0, 1, '式', 0, o.image_url,
           case when ci.option_id = bi.option_id then '価格は選択商品の変更差額に反映・見積発行時点の位置ごとの仕様（標準の商品）'
                else '価格は選択商品の変更差額に反映・見積発行時点の位置ごとの仕様（標準から変更）' end,
           v_base_sort + 700 + bi.sort_order
      from public.configuration_items ci
      join public.standard_estimate_revision_baseline_items bi on bi.revision_id = v_revision and bi.slot_code = ci.slot_code
      join public.options o on o.id = ci.option_id
      left join lateral (
        select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) as label
          from pg_catalog.unnest(coalesce(ci.variant_choice_ids, '{}'::uuid[])) as j(choice_id)
          join public.option_variant_choices vc on vc.id = j.choice_id
          join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
      ) vl on true
     where ci.configuration_id = cfg.id and ci.slot_code is not null and bi.section_code = v_code;

    v_amount := (v_sections #>> array[v_code, 'delta_line'])::numeric::integer;
    if v_amount <> 0 then
      insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
      values (p_quote_id, v_kind, '選択商品の変更差額', '標準状態の商品との差額', '式', v_amount, 1, v_amount, v_base_sort + 900);
    end if;

    -- 外壁の面別の仕様は 0 円のスナップショットとして残す（価格は変更差額に反映済み）
    if v_code = 'interior_exterior' and pg_catalog.jsonb_typeof(cfg.exterior_faces) = 'array' and pg_catalog.jsonb_array_length(cfg.exterior_faces) = 4 then
      insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, unit, amount, image_url, remark, sort_order)
      select p_quote_id, 'interior_exterior',
             '外壁仕様（' || case f.face_code when 'front' then '正面' when 'right' then '右側面' when 'back' then '背面' when 'left' then '左側面' else f.face_code end || '）',
             o.name || case when coalesce(v.label, '') = '' then '' else ' ／ ' || v.label end,
             0, 1, '面', 0, o.image_url,
             '価格は選択商品の変更差額に反映・見積発行時点の面別外壁仕様',
             1800 + case f.face_code when 'front' then 1 when 'right' then 2 when 'back' then 3 when 'left' then 4 else 9 end
        from (
          select x.value ->> 'face_code' as face_code,
                 (x.value ->> 'option_id')::uuid as option_id,
                 coalesce(x.value -> 'variant_choice_ids', '[]'::jsonb) as variant_choice_ids
            from pg_catalog.jsonb_array_elements(cfg.exterior_faces) as x(value)
        ) f
        join public.options o on o.id = f.option_id
        left join lateral (
          select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) as label
            from pg_catalog.jsonb_array_elements_text(f.variant_choice_ids) as j(choice_id)
            join public.option_variant_choices vc on vc.id = j.choice_id::uuid
            join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
        ) v on true;
    end if;

    v_amount := (v_sections #>> array[v_code, 'expense_amount'])::numeric::integer;
    if v_amount <> 0 then
      insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
      values (
        p_quote_id,
        case v_code when 'interior_exterior' then 'interior_exterior_expense' when 'option' then 'option_expense' else 'installation' end,
        case v_code when 'interior_exterior' then '内外装工事経費' when 'option' then 'オプション諸費用' else '別途工事経費' end,
        '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, v_base_sort + 950
      );
    end if;
  end loop;

  -- 選んだ商品に価格未確定（別途見積・原価未設定など）があれば、合計に含めていないことを明記する
  if (v_money ->> 'has_por')::boolean then
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'option', '価格未確定の商品', '選んだ商品のうち価格が未確定のもの（合計に含めていません）', '式',
            '価格未確定（別途お見積り）', 0, 1, 0, 2899);
  end if;

  return true;
end;
$write_quote_items$;

-- ---------- 商品の選び方の検査：位置の枠の商品は「1 つだけ選択」の数に入れない（v2.5 PR-S1） ----------

create function public.validate_configuration_items(p_model_id uuid, p_option_ids uuid[], p_finish_level text, p_slot_option_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_rank integer := public.finish_level_rank(p_finish_level);
  -- 位置・用途の選択枠の商品（v2.5 PR-S1）。競合・前提・注文範囲・必須は、カテゴリー単位の選択と合わせて確かめる
  v_all uuid[] := coalesce(p_option_ids, '{}'::uuid[]) || coalesce(p_slot_option_ids, '{}'::uuid[]);
begin
  for r in
    select c.option_id, c.conflicts_with_option_id, c.message from public.option_conflicts c
    where c.option_id = any (v_all) and c.conflicts_with_option_id = any (v_all)
  loop
    raise exception 'CONFLICT: %', coalesce(r.message, '同時に選択できないオプションが含まれています') using errcode = 'P0001';
  end loop;
  -- 依存ルールは候補の絞り込みに関係なく常に検証する（前提商品を選べない仕様では明示エラーになる）
  for r in
    select d.option_id, d.requires_option_id, d.message from public.option_dependencies d
    where d.option_id = any (v_all) and not (d.requires_option_id = any (v_all))
  loop
    raise exception 'DEPENDENCY: %', coalesce(r.message, '前提となるオプションが選択されていません') using errcode = 'P0001';
  end loop;
  -- 注文範囲外のカテゴリーの商品が混ざっていたら弾く（本体のみなのに内装が入っている等）
  for r in
    select cat.name from public.option_categories cat
    join public.options o on o.category_id = cat.id
    where o.id = any (v_all) and public.finish_level_rank(cat.finish_level) > v_rank
    group by cat.id, cat.name
  loop
    raise exception 'REQUIRED: 「%」は選択された注文範囲に含まれません', r.name using errcode = 'P0001';
  end loop;
  for r in
    select cat.name from public.option_categories cat
    where cat.status = 'published' and cat.is_required
      and public.customer_business_item_for_category(cat.code) is null
      and public.finish_level_rank(cat.finish_level) <= v_rank
      and exists (select 1 from public.options o where o.category_id = cat.id and o.status = 'published'
                  and o.archived_at is null and o.simulator_visible
                  and (o.base_model_id is null or o.base_model_id = p_model_id))
      and not exists (select 1 from public.options o where o.category_id = cat.id and o.id = any (v_all))
  loop
    raise exception 'REQUIRED: 「%」を選択してください', r.name using errcode = 'P0001';
  end loop;
  for r in
    select cat.name, count(*) as n from public.option_categories cat
    join public.options o on o.category_id = cat.id
    -- 「1 つだけ選択」はカテゴリー単位の選択だけ（位置・用途の枠は、枠ごとに 1 つを保存の関数で確かめる）
    where cat.selection_mode = 'single' and o.id = any (p_option_ids)
    group by cat.id, cat.name having count(*) > 1
  loop
    raise exception 'SINGLE: 「%」は 1 つだけ選択してください', r.name using errcode = 'P0001';
  end loop;
end;
$$;

-- 3 引数（これまでの呼び出し）は、位置の枠の商品なしとして 4 引数を呼ぶ
create or replace function public.validate_configuration_items(p_model_id uuid, p_option_ids uuid[], p_finish_level text default 'full'::text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.validate_configuration_items(p_model_id, p_option_ids, p_finish_level, '{}'::uuid[]);
end;
$$;

-- ---------- 保存：位置・用途の選択枠ごとの選択（v2.5 PR-S1） ----------

-- 引数を足すため、作り直す（引数を名前で渡す呼び出しは、p_slot_selections を渡さなくても今までどおり動く）
drop function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer);

create function public.save_configuration_atomic(p_configuration_id uuid, p_base_model_id uuid, p_name text, p_option_ids uuid[], p_preview_image_url text, p_notes text, p_finish_level text DEFAULT 'full'::text, p_variant_choice_ids uuid[] DEFAULT '{}'::uuid[], p_spec_code text DEFAULT NULL::text, p_exterior_faces jsonb DEFAULT '[]'::jsonb, p_site_prefecture text DEFAULT NULL::text, p_site_municipality text DEFAULT NULL::text, p_site_location_undecided boolean DEFAULT false, p_expected_lock_version integer DEFAULT NULL::integer, p_slot_selections jsonb DEFAULT '[]'::jsonb)
 RETURNS configurations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid := p_configuration_id;
  v_uid uuid := auth.uid();
  v_cfg public.configurations;
  v_options uuid[] := coalesce(p_option_ids, '{}'::uuid[]);
  v_variants uuid[] := coalesce(p_variant_choice_ids, '{}'::uuid[]);
  v_level text := coalesce(nullif(p_finish_level, ''), 'full');
  v_face jsonb;
  v_face_option_id uuid;
  v_face_variants uuid[];
  v_face_codes text[];
  -- 位置・用途の選択枠ごとの選択（v2.5 PR-S1）
  v_slot jsonb;
  v_slot_code text;
  v_slot_option_id uuid;
  v_slot_variants uuid[];
  v_slot_codes text[] := '{}'::text[];
  v_slot_option_ids uuid[] := '{}'::uuid[];
  v_revision uuid;
  v_missing text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_id is not null then
    select * into v_cfg from public.configurations where id = v_id for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_cfg.user_id <> v_uid and not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if v_cfg.status <> 'draft' then
      raise exception 'LOCKED: Draft以外の仕様は通常保存できません。複製して編集してください。' using errcode = 'P0001';
    end if;
    -- 同時編集の検知（optimistic locking）。読み込んだ時点の版と一致しない保存は拒否し、後勝ちにしない。
    -- 行は上で FOR UPDATE 済みなので、同時に届いた保存は直列化され、後から来た方がここで止まる。
    -- 版の指定が無い（NULL）保存も拒否する。
    if v_cfg.lock_version is distinct from p_expected_lock_version then
      raise exception 'LOCKED: 他の画面でこのプランが更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
    end if;
  end if;
  if v_level not in ('shell', 'equipment', 'full') then
    raise exception 'VALIDATION: 注文範囲の指定が不正です' using errcode = 'P0001';
  end if;
  if p_site_location_undecided and (p_site_prefecture is not null or p_site_municipality is not null) then
    raise exception 'VALIDATION: 設置予定地を未定にする場合、都道府県・市区町村は指定できません' using errcode = 'P0001';
  end if;
  if p_site_municipality is not null and p_site_prefecture is null then
    raise exception 'VALIDATION: 市区町村を指定する場合、都道府県も指定してください' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.base_models m
     where m.id = p_base_model_id and m.status = 'published'
  ) then
    raise exception 'VALIDATION: 公開中のモデルではありません' using errcode = 'P0001';
  end if;
  -- Keep the DB allow-list aligned with simulatorEstimateChoices(): base is
  -- universal; model presets and same-model estimate templates are valid.
  if p_spec_code is not null
     and p_spec_code <> 'base'
     and not exists (
       select 1
         from public.base_models m
         cross join lateral jsonb_array_elements(coalesce(m.presets, '[]'::jsonb)) preset
        where m.id = p_base_model_id and preset ->> 'code' = p_spec_code
     )
     and not exists (
       select 1
         from public.estimate_templates t
        where t.base_model_id = p_base_model_id
          and t.spec_code = p_spec_code
     ) then
    raise exception 'VALIDATION: このモデルでは指定された仕様を選べません' using errcode = 'P0001';
  end if;
  if cardinality(v_options) <> cardinality(array(select distinct unnest(v_options))) then
    raise exception 'VALIDATION: 同じオプションを複数回保存できません' using errcode = 'P0001';
  end if;
  if cardinality(v_variants) <> cardinality(array(select distinct unnest(v_variants))) then
    raise exception 'VALIDATION: 同じバリエーションを複数回保存できません' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from unnest(v_options) input(option_id)
      left join public.options o on o.id = input.option_id
      left join public.option_categories c on c.id = o.category_id
     where o.id is null
        or o.status <> 'published'
        or (o.base_model_id is not null and o.base_model_id <> p_base_model_id)
        or public.finish_level_rank(c.finish_level) > public.finish_level_rank(v_level)
        or (p_spec_code is not null and cardinality(o.spec_codes) > 0 and not (p_spec_code = any(o.spec_codes)))
  ) then
    raise exception 'VALIDATION: 選択できないオプションが含まれています' using errcode = 'P0001';
  end if;
  -- 位置・用途の選択枠ごとの選択（v2.5 PR-S1）。新しい価格（スイッチ）の間だけ。版の位置の枠との照合は、明細を書いた後に行う
  if p_slot_selections is null or jsonb_typeof(p_slot_selections) <> 'array' then
    raise exception 'VALIDATION: 位置ごとの選択の形式が不正です' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_slot_selections) > 100 then
    raise exception 'VALIDATION: 位置ごとの選択は 100 件までです' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_slot_selections) > 0 and not public.simulator_standard_pricing_enabled() then
    raise exception 'VALIDATION: 位置ごとの選択は、新しい価格の標準見積でだけ保存できます' using errcode = 'P0001';
  end if;
  for v_slot in select value from jsonb_array_elements(p_slot_selections)
  loop
    if jsonb_typeof(v_slot) <> 'object'
       or jsonb_typeof(v_slot -> 'slot_code') <> 'string'
       or (v_slot ->> 'slot_code') !~ '^[a-z0-9][a-z0-9-]{0,39}$'
       or jsonb_typeof(v_slot -> 'option_id') <> 'string'
       or (v_slot ->> 'option_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(coalesce(v_slot -> 'variant_choice_ids', '[]'::jsonb)) <> 'array'
    then
      raise exception 'VALIDATION: 位置ごとの選択の指定が不正です' using errcode = 'P0001';
    end if;
    v_slot_code := v_slot ->> 'slot_code';
    if v_slot_code = any(v_slot_codes) then
      raise exception 'VALIDATION: 同じ位置の選択が重複しています' using errcode = 'P0001';
    end if;
    v_slot_codes := array_append(v_slot_codes, v_slot_code);
    v_slot_option_id := (v_slot ->> 'option_id')::uuid;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_slot -> 'variant_choice_ids', '[]'::jsonb)) choice(value)
       where choice.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
      raise exception 'VALIDATION: 位置ごとの選択のバリエーション指定が不正です' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_slot_variants
      from jsonb_array_elements_text(coalesce(v_slot -> 'variant_choice_ids', '[]'::jsonb));
    if not exists (
      select 1
        from public.options o
        join public.option_categories c on c.id = o.category_id
       where o.id = v_slot_option_id
         and o.status = 'published'
         and (o.base_model_id is null or o.base_model_id = p_base_model_id)
         and public.finish_level_rank(c.finish_level) <= public.finish_level_rank(v_level)
         and (p_spec_code is null or cardinality(o.spec_codes) = 0 or p_spec_code = any(o.spec_codes))
    ) then
      raise exception 'VALIDATION: 位置ごとの選択に、選択できない商品が含まれています' using errcode = 'P0001';
    end if;
    if exists (
      select 1
        from unnest(v_slot_variants) input(choice_id)
        left join public.option_variant_choices vc on vc.id = input.choice_id
        left join public.option_variant_groups vg on vg.id = vc.group_id
       where vc.id is null or vc.status <> 'published' or vg.status <> 'published' or vg.option_id <> v_slot_option_id
    ) then
      raise exception 'VALIDATION: 位置ごとの選択のバリエーション指定が不正です' using errcode = 'P0001';
    end if;
    if exists (
      select 1
        from unnest(v_slot_variants) input(choice_id)
        join public.option_variant_choices vc on vc.id = input.choice_id
        join public.option_variant_groups vg on vg.id = vc.group_id
       where vg.depends_on_group_code is not null
         and cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) > 0
         and exists (
           select 1
             from public.option_variant_groups dependency_group
            where dependency_group.option_id = vg.option_id
              and dependency_group.code = vg.depends_on_group_code
              and dependency_group.status = 'published'
         )
         and not exists (
           select 1
             from public.option_variant_choices dependency_choice
             join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
            where dependency_choice.id = any(v_slot_variants)
              and dependency_group.option_id = vg.option_id
              and dependency_group.code = vg.depends_on_group_code
              and dependency_group.status = 'published'
              and dependency_choice.code = any(vg.depends_on_choice_codes)
         )
    ) then
      raise exception 'VALIDATION: 位置ごとの選択に、非表示のバリエーションは保存できません' using errcode = 'P0001';
    end if;
    if cardinality(v_slot_variants) <> cardinality(array(select distinct unnest(v_slot_variants))) then
      raise exception 'VALIDATION: 位置ごとの選択のバリエーションが重複しています' using errcode = 'P0001';
    end if;
    if exists (
      select 1
        from public.option_variant_choices vc
        join public.option_variant_groups vg on vg.id = vc.group_id
       where vc.id = any(v_slot_variants)
       group by vg.id having count(*) > 1
    ) then
      raise exception 'VALIDATION: 位置ごとの選択で、同じ選択項目から複数のバリエーションは選べません' using errcode = 'P0001';
    end if;
    if exists (
      select 1
        from public.option_variant_groups vg
       where vg.option_id = v_slot_option_id
         and vg.status = 'published'
         and vg.is_required
         and (
           vg.depends_on_group_code is null
           or cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) = 0
           or not exists (
             select 1
               from public.option_variant_groups dependency_group
              where dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
           )
           or exists (
             select 1
               from public.option_variant_choices dependency_choice
               join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
              where dependency_choice.id = any(v_slot_variants)
                and dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
                and dependency_choice.code = any(vg.depends_on_choice_codes)
           )
         )
         and not exists (
           select 1 from public.option_variant_choices selected_choice
            where selected_choice.id = any(v_slot_variants) and selected_choice.group_id = vg.id
         )
    ) then
      raise exception 'REQUIRED: 位置ごとの選択で、必須のバリエーションを選択してください' using errcode = 'P0001';
    end if;
    v_slot_option_ids := array_append(v_slot_option_ids, v_slot_option_id);
  end loop;

  -- 位置の枠の商品は「1 つだけ選択」の数に入れない（競合・前提・注文範囲・必須はカテゴリー単位の選択と合わせて確かめる）
  perform public.validate_configuration_items(p_base_model_id, v_options, v_level, v_slot_option_ids);

  if exists (
    select 1
      from unnest(v_variants) input(choice_id)
      left join public.option_variant_choices vc on vc.id = input.choice_id
      left join public.option_variant_groups vg on vg.id = vc.group_id
     where vc.id is null
        or vc.status <> 'published'
        or vg.status <> 'published'
        or not (vg.option_id = any(v_options))
  ) then
    raise exception 'VALIDATION: 選択できないバリエーションが含まれています' using errcode = 'P0001';
  end if;
  -- Mirror pruneHiddenVariantChoices(): a group is hidden only when its
  -- configured dependency group exists and none of its allowed choices is
  -- selected.  Hidden choices, including price-bearing choices, are never
  -- accepted by the RPC.
  if exists (
    select 1
      from unnest(v_variants) input(choice_id)
      join public.option_variant_choices vc on vc.id = input.choice_id
      join public.option_variant_groups vg on vg.id = vc.group_id
     where vg.depends_on_group_code is not null
       and cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) > 0
       and exists (
         select 1
           from public.option_variant_groups dependency_group
          where dependency_group.option_id = vg.option_id
            and dependency_group.code = vg.depends_on_group_code
            and dependency_group.status = 'published'
       )
       and not exists (
         select 1
           from public.option_variant_choices dependency_choice
           join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
          where dependency_choice.id = any(v_variants)
            and dependency_group.option_id = vg.option_id
            and dependency_group.code = vg.depends_on_group_code
            and dependency_group.status = 'published'
            and dependency_choice.code = any(vg.depends_on_choice_codes)
       )
  ) then
    raise exception 'VALIDATION: 非表示のバリエーションは保存できません' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.option_variant_choices vc
      join public.option_variant_groups vg on vg.id = vc.group_id
     where vc.id = any(v_variants)
     group by vg.id
    having count(*) > 1
  ) then
    raise exception 'VALIDATION: 同じ選択項目から複数のバリエーションは選べません' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.option_variant_groups vg
     where vg.option_id = any(v_options)
       and vg.status = 'published'
       and vg.is_required
       and (
         vg.depends_on_group_code is null
         or cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) = 0
         or not exists (
           select 1
             from public.option_variant_groups dependency_group
            where dependency_group.option_id = vg.option_id
              and dependency_group.code = vg.depends_on_group_code
              and dependency_group.status = 'published'
         )
         or exists (
           select 1
             from public.option_variant_choices dependency_choice
             join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
            where dependency_choice.id = any(v_variants)
              and dependency_group.option_id = vg.option_id
              and dependency_group.code = vg.depends_on_group_code
              and dependency_group.status = 'published'
              and dependency_choice.code = any(vg.depends_on_choice_codes)
         )
       )
       and not exists (
         select 1 from public.option_variant_choices selected_choice
          where selected_choice.id = any(v_variants) and selected_choice.group_id = vg.id
       )
  ) then
    raise exception 'REQUIRED: 必須のバリエーションを選択してください' using errcode = 'P0001';
  end if;

  if p_exterior_faces is null or jsonb_typeof(p_exterior_faces) <> 'array' then
    raise exception 'VALIDATION: 外壁4面の形式が不正です' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_exterior_faces) not in (0, 4) then
    raise exception 'VALIDATION: 外壁は4面すべてを指定してください' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_exterior_faces) = 0 then
    -- [] is a read/unchanged compatibility state for legacy configurations;
    -- it cannot create a new exterior selection or undo an existing 4-face one.
    if v_id is null and exists (
      select 1
        from unnest(v_options) input(option_id)
        join public.options o on o.id = input.option_id
        join public.option_categories c on c.id = o.category_id
       where c.code = 'exterior-wall'
    ) then
      raise exception 'VALIDATION: 新規Configurationの外壁は4面すべてを指定してください' using errcode = 'P0001';
    end if;
    if v_id is not null and jsonb_array_length(coalesce(v_cfg.exterior_faces, '[]'::jsonb)) = 4 then
      raise exception 'VALIDATION: 4面化済みConfigurationを旧外壁方式へ戻すことはできません' using errcode = 'P0001';
    end if;
    if v_id is not null and coalesce(v_cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb
       and (
         exists (
           select 1
             from public.configuration_items ci
             join public.options o on o.id = ci.option_id
             join public.option_categories c on c.id = o.category_id
            where ci.configuration_id = v_id
              and c.code = 'exterior-wall'
              and not exists (
                select 1
                  from unnest(v_options) input(option_id)
                 where input.option_id = ci.option_id
                   and coalesce(array(
                     select vc.id
                       from public.option_variant_choices vc
                       join public.option_variant_groups vg on vg.id = vc.group_id
                      where vc.id = any(v_variants)
                        and vg.option_id = ci.option_id
                      order by vc.id
                   ), '{}'::uuid[]) = coalesce(array(
                     select distinct legacy_choice_id
                       from unnest(coalesce(ci.variant_choice_ids, '{}'::uuid[])) legacy_choice_id
                      order by legacy_choice_id
                   ), '{}'::uuid[])
              )
         )
         or exists (
           select 1
             from unnest(v_options) input(option_id)
             join public.options o on o.id = input.option_id
             join public.option_categories c on c.id = o.category_id
            where c.code = 'exterior-wall'
              and not exists (
                select 1
                  from public.configuration_items ci
                 where ci.configuration_id = v_id
                   and ci.option_id = input.option_id
                   and coalesce(array(
                     select vc.id
                       from public.option_variant_choices vc
                       join public.option_variant_groups vg on vg.id = vc.group_id
                      where vc.id = any(v_variants)
                        and vg.option_id = input.option_id
                      order by vc.id
                   ), '{}'::uuid[]) = coalesce(array(
                     select distinct legacy_choice_id
                       from unnest(coalesce(ci.variant_choice_ids, '{}'::uuid[])) legacy_choice_id
                      order by legacy_choice_id
                   ), '{}'::uuid[])
              )
         )
       ) then
      raise exception 'VALIDATION: legacy外壁を変更する場合は4面すべてを指定してください' using errcode = 'P0001';
    end if;
  end if;
  if jsonb_array_length(p_exterior_faces) = 4 then
    select array_agg(face ->> 'face_code') into v_face_codes
      from jsonb_array_elements(p_exterior_faces) face;
    if cardinality(v_face_codes) <> 4
       or cardinality(array(select distinct unnest(v_face_codes))) <> 4
       or not (v_face_codes @> array['front', 'right', 'back', 'left']) then
      raise exception 'VALIDATION: 外壁は正面・右側面・背面・左側面を各1面指定してください' using errcode = 'P0001';
    end if;
    for v_face in select value from jsonb_array_elements(p_exterior_faces)
    loop
      if jsonb_typeof(v_face) <> 'object'
         or jsonb_typeof(v_face -> 'option_id') <> 'string'
         or (v_face ->> 'option_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or jsonb_typeof(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb)) <> 'array'
      then
        raise exception 'VALIDATION: 外壁の指定が不正です' using errcode = 'P0001';
      end if;
      v_face_option_id := (v_face ->> 'option_id')::uuid;
      if exists (
        select 1 from jsonb_array_elements_text(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb)) choice(value)
         where choice.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) then
        raise exception 'VALIDATION: 外壁のバリエーション指定が不正です' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_face_variants
        from jsonb_array_elements_text(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb));
      if not exists (
        select 1
          from public.options o
          join public.option_categories c on c.id = o.category_id
         where o.id = v_face_option_id
           and o.status = 'published'
           and c.code = 'exterior-wall'
           and (o.base_model_id is null or o.base_model_id = p_base_model_id)
           and (p_spec_code is null or cardinality(o.spec_codes) = 0 or p_spec_code = any(o.spec_codes))
      ) then
        raise exception 'VALIDATION: 外壁の商品指定が不正です' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from unnest(v_face_variants) input(choice_id)
          left join public.option_variant_choices vc on vc.id = input.choice_id
          left join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id is null or vc.status <> 'published' or vg.status <> 'published' or vg.option_id <> v_face_option_id
      ) then
        raise exception 'VALIDATION: 外壁のバリエーション指定が不正です' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from unnest(v_face_variants) input(choice_id)
          join public.option_variant_choices vc on vc.id = input.choice_id
          join public.option_variant_groups vg on vg.id = vc.group_id
         where vg.depends_on_group_code is not null
           and cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) > 0
           and exists (
             select 1
               from public.option_variant_groups dependency_group
              where dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
           )
           and not exists (
             select 1
               from public.option_variant_choices dependency_choice
               join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
              where dependency_choice.id = any(v_face_variants)
                and dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
                and dependency_choice.code = any(vg.depends_on_choice_codes)
           )
      ) then
        raise exception 'VALIDATION: 非表示の外壁バリエーションは保存できません' using errcode = 'P0001';
      end if;
      if cardinality(v_face_variants) <> cardinality(array(select distinct unnest(v_face_variants))) then
        raise exception 'VALIDATION: 外壁のバリエーションが重複しています' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from public.option_variant_choices vc
          join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id = any(v_face_variants)
         group by vg.id having count(*) > 1
      ) then
        raise exception 'VALIDATION: 外壁で同じ選択項目から複数のバリエーションは選べません' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from public.option_variant_groups vg
         where vg.option_id = v_face_option_id
           and vg.status = 'published'
           and vg.is_required
           and (
             vg.depends_on_group_code is null
             or cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) = 0
             or not exists (
               select 1
                 from public.option_variant_groups dependency_group
                where dependency_group.option_id = vg.option_id
                  and dependency_group.code = vg.depends_on_group_code
                  and dependency_group.status = 'published'
             )
             or exists (
               select 1
                 from public.option_variant_choices dependency_choice
                 join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
                where dependency_choice.id = any(v_face_variants)
                  and dependency_group.option_id = vg.option_id
                  and dependency_group.code = vg.depends_on_group_code
                  and dependency_group.status = 'published'
                  and dependency_choice.code = any(vg.depends_on_choice_codes)
             )
           )
           and not exists (
             select 1 from public.option_variant_choices selected_choice
              where selected_choice.id = any(v_face_variants) and selected_choice.group_id = vg.id
           )
      ) then
        raise exception 'REQUIRED: 外壁の必須バリエーションを選択してください' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  if v_id is null then
    insert into public.configurations (
      user_id, base_model_id, name, preview_image_url, notes, finish_level, spec_code,
      exterior_faces, site_prefecture, site_municipality, site_location_undecided
    ) values (
      v_uid, p_base_model_id, coalesce(nullif(p_name, ''), '無題の仕様'), p_preview_image_url, p_notes, v_level, p_spec_code,
      p_exterior_faces, case when p_site_location_undecided then null else p_site_prefecture end,
      case when p_site_location_undecided then null else p_site_municipality end, p_site_location_undecided
    ) returning id into v_id;
  else
    update public.configurations
       set name = coalesce(nullif(p_name, ''), name), base_model_id = p_base_model_id,
           preview_image_url = p_preview_image_url, notes = p_notes, finish_level = v_level,
           spec_code = p_spec_code, exterior_faces = p_exterior_faces,
           site_prefecture = case when p_site_location_undecided then null else p_site_prefecture end,
           site_municipality = case when p_site_location_undecided then null else p_site_municipality end,
           site_location_undecided = p_site_location_undecided,
           lock_version = lock_version + 1
     where id = v_id;
    delete from public.configuration_items where configuration_id = v_id;
  end if;

  -- 選択肢は、その明細の商品の選択肢だけを入れる（input.option_id を明示する。無修飾の option_id は vg.option_id と解釈され、
  -- すべての明細にすべての選択肢が入っていた）
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  select v_id, input.option_id, 1,
    coalesce((
      select array_agg(vc.id order by vc.id)
        from public.option_variant_choices vc
        join public.option_variant_groups vg on vg.id = vc.group_id
       where vc.id = any(v_variants) and vg.option_id = input.option_id
    ), '{}'::uuid[])
    from unnest(v_options) input(option_id);

  -- 位置・用途の選択枠ごとの明細（v2.5 PR-S1）。選択肢は、その位置で選んだものだけ
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids, slot_code)
  select v_id, (s.value ->> 'option_id')::uuid, 1,
         coalesce(array(
           select x.value::uuid from jsonb_array_elements_text(coalesce(s.value -> 'variant_choice_ids', '[]'::jsonb)) x(value)
            order by x.value::uuid
         ), '{}'::uuid[]),
         s.value ->> 'slot_code'
    from jsonb_array_elements(p_slot_selections) s(value);

  -- 新しい価格（スイッチ）の間：公開中の v2.5 の版の位置の枠と 1 対 1 で、その枠で選べる商品か。
  -- 位置で選ぶカテゴリーの商品を、カテゴリー単位でも選んでいないか（同じ商品を二重に数えない）
  if public.simulator_standard_pricing_enabled() then
    v_revision := public.standard_estimate_v25_revision_for_configuration(v_id);
    if v_revision is null then
      if jsonb_array_length(p_slot_selections) > 0 then
        raise exception 'VALIDATION: この仕様の標準見積には、位置ごとの選択がありません' using errcode = 'P0001';
      end if;
    else
      select string_agg(bi.slot_label, '・' order by bi.sort_order) into v_missing
        from public.standard_estimate_revision_baseline_items bi
       where bi.revision_id = v_revision and bi.slot_code is not null
         and not (bi.slot_code = any(v_slot_codes));
      if v_missing is not null then
        raise exception 'VALIDATION: 位置ごとの選択がそろっていません（%）。シミュレーターで開き直してください', v_missing using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.configuration_items ci
         where ci.configuration_id = v_id and ci.slot_code is not null
           and not exists (
             select 1 from public.standard_estimate_revision_baseline_items bi
              where bi.revision_id = v_revision and bi.slot_code = ci.slot_code
                and (bi.option_id = ci.option_id or exists (
                       select 1 from public.standard_estimate_revision_slot_options so
                        where so.revision_id = v_revision and so.slot_code = bi.slot_code and so.option_id = ci.option_id))
           )
      ) then
        raise exception 'VALIDATION: その位置では選べない商品が含まれています。シミュレーターで開き直してください' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from public.configuration_items ci
          join public.options o on o.id = ci.option_id
         where ci.configuration_id = v_id and ci.slot_code is null
           and exists (
             select 1 from public.standard_estimate_revision_baseline_items bi
              where bi.revision_id = v_revision and bi.slot_code is not null and bi.option_category_id = o.category_id
           )
      ) then
        raise exception 'VALIDATION: 位置ごとに選ぶカテゴリーの商品は、位置ごとに選んでください。シミュレーターで開き直してください' using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_cfg := public.recalculate_configuration(v_id);
  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (v_id, 'saved', public.configuration_pricing_json(v_id));
  return v_cfg;
end;
$function$;

-- ---------- 既存の関数に、目印を確かめて差し込む（本体を丸ごと写さない。#529 と同じやり方） ----------

-- 適用済みの定義（pg_get_functiondef）の目印がちょうど 1 か所あることを確かめてから置き換える。
-- 想定と違う定義なら何も変えずに止まる。所有者・SECURITY DEFINER・search_path・EXECUTE は前後で変わらないことを確かめる
create function pg_temp.s1_patch_function(p_target regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $patch$
declare
  v_def text;
  v_count integer;
  v_before text;
  v_after text;
begin
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''))
    into v_before
    from pg_catalog.pg_proc p where p.oid = p_target;
  v_def := pg_catalog.pg_get_functiondef(p_target);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, p_old, ''))) / pg_catalog.length(p_old);
  if v_count <> 1 then
    raise exception 'PRECONDITION: the definition of % has % markers (expected 1)', p_target, v_count;
  end if;
  execute pg_catalog.replace(v_def, p_old, p_new);
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''))
    into v_after
    from pg_catalog.pg_proc p where p.oid = p_target;
  if v_after is distinct from v_before then
    raise exception 'POSTCONDITION: owner / security definer / search_path / ACL of % changed (% -> %)', p_target, v_before, v_after;
  end if;
end;
$patch$;

-- 見積依頼：商品の選び方の検査で、位置の枠の商品を「1 つだけ選択」の数に入れない
select pg_temp.s1_patch_function(
  'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure,
  $old$  perform public.validate_configuration_items(
    cfg.base_model_id,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id), '{}'),
    cfg.finish_level
  );$old$,
  $new$  -- 位置・用途の選択枠の明細（slot_code）は「1 つだけ選択」の数に入れない（v2.5 PR-S1）
  perform public.validate_configuration_items(
    cfg.base_model_id,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and slot_code is null), '{}'),
    cfg.finish_level,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and slot_code is not null), '{}')
  );$new$
);

-- プランの複製：位置・用途の選択枠の明細は、位置ごと写す（写さないと同じ商品の 2 行がカテゴリー単位の一意の条件に当たる）
select pg_temp.s1_patch_function(
  'public.duplicate_configuration(uuid)'::regprocedure,
  $old$  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  select v_id, ci.option_id, ci.quantity, ci.variant_choice_ids
    from public.configuration_items ci
   where ci.configuration_id = p_configuration_id;$old$,
  $new$  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids, slot_code)
  select v_id, ci.option_id, ci.quantity, ci.variant_choice_ids, ci.slot_code
    from public.configuration_items ci
   where ci.configuration_id = p_configuration_id;$new$
);

-- 商品の安全な削除：枠ごとの選べる商品で使っている商品も消さない（FK の restrict の前に、業務向けの明示のエラーを返す）
select pg_temp.s1_patch_function(
  'public.assert_option_unreferenced(uuid, text)'::regprocedure,
  $old$  if exists (
    select 1
    from public.standard_estimate_revision_baseline_items bi
    where bi.option_id = p_option_id
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;$old$,
  $new$  if exists (
    select 1
    from public.standard_estimate_revision_baseline_items bi
    where bi.option_id = p_option_id
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- 標準見積Revisionの位置・用途の選択枠ごとの選べる商品（v2.5 PR-S1）。
  if exists (
    select 1
    from public.standard_estimate_revision_slot_options so
    where so.option_id = p_option_id
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;$new$
);

drop function pg_temp.s1_patch_function(regprocedure, text, text);


-- ---------- 所有者と権限 ----------

alter function public.options_window_type_guard() owner to postgres;
alter function public.option_categories_window_type_guard() owner to postgres;
alter function public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text) owner to postgres;
alter function public.validate_configuration_items(uuid, uuid[], text, uuid[]) owner to postgres;
alter function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb) owner to postgres;

-- 内部の部品・トリガー関数は API のロールから直接実行させない（Supabase は public の関数へ既定で EXECUTE を付けるため明示して外す）
revoke all on function public.options_window_type_guard() from public, anon, authenticated, service_role;
revoke all on function public.option_categories_window_type_guard() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text) from public, anon, authenticated, service_role;
revoke all on function public.validate_configuration_items(uuid, uuid[], text, uuid[]) from public, anon, authenticated, service_role;

-- 保存は、これまでと同じくログインした利用者だけ（作り直したので権限を付け直す）
revoke all on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)
  to authenticated;

-- ---------- postconditions ----------

do $postconditions$
begin
  if (select count(*) from public.window_types where status = 'active') <> 4 then
    raise exception 'POSTCONDITION: the 4 initial window types must exist';
  end if;
  -- アプリが読む新しい列は、旧価格の表でも anon・authenticated が読める（C1b の列ごとの権限）
  if not has_column_privilege('anon', 'public.options', 'window_type_code', 'SELECT')
     or not has_column_privilege('authenticated', 'public.options', 'window_type_code', 'SELECT') then
    raise exception 'POSTCONDITION: options.window_type_code must be readable by anon / authenticated';
  end if;
  if has_column_privilege('anon', 'public.options', 'price', 'SELECT')
     or has_column_privilege('authenticated', 'public.options', 'price', 'SELECT') then
    raise exception 'POSTCONDITION: options.price must stay unreadable by anon / authenticated';
  end if;
  -- 内部の部品は API のロールから実行できない。保存はログインした利用者だけ
  if has_function_privilege('anon', 'public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.validate_configuration_items(uuid, uuid[], text, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)', 'EXECUTE') then
    raise exception 'POSTCONDITION: function privileges are not as expected';
  end if;
  -- 既存のデータは変えていない（位置の枠・位置の選択はまだ無い）
  if exists (select 1 from public.configuration_items where slot_code is not null)
     or exists (select 1 from public.standard_estimate_revision_baseline_items where slot_code is not null)
     or exists (select 1 from public.standard_estimate_revision_slot_options)
     or exists (select 1 from public.options where window_type_code is not null) then
    raise exception 'POSTCONDITION: existing data must not change';
  end if;
end;
$postconditions$;

commit;

