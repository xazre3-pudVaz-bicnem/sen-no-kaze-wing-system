-- v2.5 PR-B1：標準見積の v2.5 の Revision（商品台帳の商品・バリエーションの選択枠、原価 Version の固定、正式計算、公開時の確認）。
--
-- 金額正本・価格ライフサイクル設計 v2.5 の第8章・第9章・第10章・第11章と、2026-10-19 の先方回答（Q1・Q2）：
-- * 標準見積の編集画面から商品台帳の商品・バリエーションを選び、v2.5 の金額計算と Revision 管理につなぐ
-- * 既存の標準見積（仮の 10 件）は編集の土台に使う。公開済みの Revision は書き換えず、新しい Draft Revision で直して公開する
-- * 繰り返し使う標準商品・部材は商品台帳の商品で auto、金額が確定している工事費は manual、確定しない工事は por（0 円にしない）
-- * 採用原価 Version は、明細の追加・商品の置換・バリエーションの変更・明示の「最新原価を取り込む」のときだけ固定する
--   （下書きの確認中に商品マスターの原価が変わっても、黙って更新しない）
-- * 公開の時に、固定した原価 Version が現在の Version と同じか・販売状態・計算ルールを確かめる（違えば公開しない）
-- * 2026-10-19 の確定方針：別途工事は販売費・経費・掛率を掛けない（auto にしない。manual か por）。
--   v2.5 以前から引き継いだ明細の「要見直し」が 1 行でも残っていれば公開しない（画面だけでなく DB で止める）
--
-- 作り：
-- * standard_estimate_revisions.pricing_model：'legacy'（v2.5 以前の計算。既存の Revision はすべてこちらのまま）／'v2.5'
--   v2.5 の Revision は計算ルール・税ルールの Version を固定し、金額は public.pricing_calculate（20261016210000）で計算する
-- * 商品の選択枠は「標準状態の商品」（standard_estimate_revision_baseline_items / _variants）に価格方式と原価 Version の固定を足す
--   （#500 の取扱終了の保護・シミュレーターの標準状態と同じ行を使う）
-- * 商品に紐づかない明細は新しい表 standard_estimate_revision_v25_lines（manual / por だけ）
-- * v2.5 の Revision は v2.5 の RPC からだけ変更できる（旧来の保存・公開・次の Revision・標準状態の変更からは変えられない。
--   RPC が同じトランザクションの中だけ有効な印（GUC）を立て、トリガーで確かめる）
-- * シミュレーターの売価の取得（get_standard_estimate_sale_views）と標準見積から作る見積は、v2.5 の Revision をまだ扱わない
--   （シミュレーターは PR-C1、見積は PR-D1 で v2.5 に対応する）
--
-- 既存 migration は編集しない。既存の標準見積のデータは変更しない（v2.5 の下書きは、本部が画面から作ったときだけできる）。

begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.option_standard_cost_versions') is null
     or to_regclass('public.option_variant_cost_versions') is null
     or to_regclass('public.pricing_calculation_rule_versions') is null
     or to_regclass('public.tax_rule_versions') is null
     or to_regprocedure('public.pricing_calculate(uuid, uuid, jsonb)') is null then
    raise exception 'PRECONDITION: v2.5 PR-A1 (20261016200000) and PR-A2 (20261016210000) must be applied first';
  end if;
  if to_regprocedure('public.publish_standard_estimate_revision(uuid, integer)') is null
     or to_regprocedure('public.start_next_standard_estimate_revision(uuid, uuid)') is null
     or to_regprocedure('public.set_standard_estimate_baseline(uuid, jsonb, integer)') is null
     or to_regprocedure('public.refresh_standard_estimate_baseline(uuid)') is null
     or to_regprocedure('public.get_standard_estimate_sale_views(uuid)') is null
     or to_regprocedure('public.customer_category_selectable(text, text, text)') is null
     or to_regprocedure('public.estimate_section_for_option(text, boolean)') is null
     or to_regprocedure('public.can_edit_standard_estimate_master(uuid)') is null
     or to_regprocedure('public.can_view_standard_estimate_revision(uuid)') is null
     or to_regprocedure('public.prevent_non_draft_standard_estimate_child_write()') is null then
    raise exception 'PRECONDITION: standard estimate functions are missing';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'standard_estimate_revisions' and column_name = 'pricing_model')
     or to_regclass('public.standard_estimate_revision_v25_lines') is not null then
    raise exception 'PRECONDITION: v2.5 standard estimate objects already exist';
  end if;
end;
$preflight$;

-- ---------- Revision：計算の方式と、固定する計算ルール・税ルール ----------

alter table public.standard_estimate_revisions
  add column pricing_model text not null default 'legacy',
  add column calc_rule_version_id uuid references public.pricing_calculation_rule_versions(id) on delete restrict,
  add column tax_rule_version_id uuid references public.tax_rule_versions(id) on delete restrict,
  add column v25_pricing_complete boolean,
  add column v25_calc_result jsonb,
  add constraint standard_estimate_revisions_pricing_model_check check (pricing_model in ('legacy', 'v2.5')),
  add constraint standard_estimate_revisions_v25_columns check (
    (pricing_model = 'legacy' and calc_rule_version_id is null and tax_rule_version_id is null
       and v25_pricing_complete is null and v25_calc_result is null)
    or (pricing_model = 'v2.5' and calc_rule_version_id is not null and tax_rule_version_id is not null
       and v25_pricing_complete is not null)
  ),
  -- 公開した v2.5 の Revision は、すべての商品の原価がそろい、計算結果を持つ
  add constraint standard_estimate_revisions_v25_published_complete check (
    pricing_model <> 'v2.5' or status = 'draft' or (v25_pricing_complete and v25_calc_result is not null)
  );

comment on column public.standard_estimate_revisions.pricing_model is
  '計算の方式。legacy=v2.5 以前の計算（既存の Revision）、v2.5=金額正本 v2.5 の正式計算（計算ルール・税ルールの Version を固定）。';
comment on column public.standard_estimate_revisions.v25_calc_result is
  'v2.5 の正式計算の結果（{calc: pricing_calculate の結果, incomplete: 原価が未設定で計算から外した選択枠}）。por を含む区分・合計は calc の中で null（未確定）。';

-- ---------- 商品の選択枠：価格方式と、固定した原価 Version ----------

-- 固定した原価 Version が同じ商品・同じ選択肢のものであることを外部キーで保証するための一意制約
alter table public.option_standard_cost_versions
  add constraint option_standard_cost_versions_id_option_key unique (id, option_id);
alter table public.option_variant_cost_versions
  add constraint option_variant_cost_versions_id_choice_key unique (id, variant_choice_id);

alter table public.standard_estimate_revision_baseline_items
  add column price_mode text,
  add column standard_cost_version_id uuid,
  add column manual_unit_price integer,
  add column selection_cost integer,
  add column cost_unit_price integer,
  add column sale_unit_price integer,
  add column amount integer,
  add constraint standard_estimate_baseline_items_price_mode_check check (price_mode is null or price_mode in ('auto', 'manual', 'por')),
  add constraint standard_estimate_baseline_items_cost_version_fkey foreign key (standard_cost_version_id, option_id)
    references public.option_standard_cost_versions (id, option_id) on delete restrict,
  add constraint standard_estimate_baseline_items_v25_money check (
    (price_mode is null and standard_cost_version_id is null and manual_unit_price is null
       and selection_cost is null and cost_unit_price is null and sale_unit_price is null and amount is null)
    or (price_mode = 'auto' and manual_unit_price is null
       and (amount is null or (selection_cost >= 0 and cost_unit_price >= 0 and sale_unit_price >= 0 and amount >= 0)))
    or (price_mode = 'manual' and manual_unit_price is not null and manual_unit_price >= 0
       and standard_cost_version_id is null and selection_cost is null and cost_unit_price is null
       and (amount is null or (sale_unit_price = manual_unit_price and amount = trunc(quantity * manual_unit_price)::integer)))
    or (price_mode = 'por' and standard_cost_version_id is null and manual_unit_price is null
       and selection_cost is null and cost_unit_price is null and sale_unit_price is null and amount is null)
  );

comment on column public.standard_estimate_revision_baseline_items.price_mode is
  'v2.5 の Revision の選択枠の価格方式（auto=商品の標準原価から正式計算、manual=税別・経費別の売価を入力、por=別途見積）。v2.5 以前の Revision は null。';
comment on column public.standard_estimate_revision_baseline_items.standard_cost_version_id is
  'auto の選択枠で固定した商品の標準原価 Version。明細の追加・商品の置換・選択肢の変更・最新原価の取り込みのときだけ固定し直す。';

alter table public.standard_estimate_revision_baseline_variants
  add column variant_cost_version_id uuid,
  add column cost_adjustment_snapshot integer,
  add constraint standard_estimate_baseline_variants_cost_version_fkey foreign key (variant_cost_version_id, variant_choice_id)
    references public.option_variant_cost_versions (id, variant_choice_id) on delete restrict,
  add constraint standard_estimate_baseline_variants_cost_snapshot check ((variant_cost_version_id is null) = (cost_adjustment_snapshot is null));

comment on column public.standard_estimate_revision_baseline_variants.variant_cost_version_id is
  'auto の選択枠で固定した選択肢の標準原価調整額 Version（未設定の選択肢は 0 円にせず、原価未設定として扱う）。';

-- ---------- 商品に紐づかない明細（v2.5 の Revision だけ。manual / por） ----------

create table public.standard_estimate_revision_v25_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  line_key uuid not null default gen_random_uuid(),
  section_code text not null check (section_code in ('interior_exterior', 'option', 'sitework')),
  group_label text check (group_label is null or pg_catalog.char_length(group_label) <= 120),
  name text not null check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 120),
  quantity numeric(14, 4) not null check (quantity > 0 and quantity <= 99999),
  unit text check (unit is null or pg_catalog.char_length(unit) <= 40),
  price_mode text not null check (price_mode in ('manual', 'por')),
  unit_price integer check (unit_price is null or unit_price >= 0),
  amount integer,
  remark text check (remark is null or pg_catalog.char_length(remark) <= 500),
  -- v2.5 以前の明細から写した行（商品台帳の商品への置き換え・金額の確認が済むまで「要見直し」と表示する）
  review_required boolean not null default false,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint standard_estimate_v25_lines_key unique (revision_id, line_key),
  constraint standard_estimate_v25_lines_section_fkey foreign key (revision_id, section_code)
    references public.standard_estimate_revision_sections (revision_id, section_code) on delete cascade,
  constraint standard_estimate_v25_lines_money check (
    (price_mode = 'manual' and unit_price is not null and amount = trunc(quantity * unit_price)::integer)
    or (price_mode = 'por' and unit_price is null and amount is null)
  )
);

comment on table public.standard_estimate_revision_v25_lines is
  'v2.5 の標準見積の、商品に紐づかない明細（金額が確定している工事費は manual、確定しない工事は por）。商品台帳の商品は選択枠（標準状態の商品）で持つ。';

alter table public.standard_estimate_revision_v25_lines enable row level security;
revoke all on table public.standard_estimate_revision_v25_lines from public, anon, authenticated, service_role;
grant select on table public.standard_estimate_revision_v25_lines to authenticated;

create policy standard_estimate_revision_v25_lines_read
on public.standard_estimate_revision_v25_lines
for select
to authenticated
using (public.can_view_standard_estimate_revision(revision_id));

-- 公開済みの Revision の明細は変えない（既存の明細と同じトリガー）
create trigger standard_estimate_revision_v25_lines_draft_only
before insert or update or delete on public.standard_estimate_revision_v25_lines
for each row execute function public.prevent_non_draft_standard_estimate_child_write();

-- ---------- v2.5 の Revision は v2.5 の RPC からだけ変更する ----------

-- v2.5 の RPC が同じトランザクションの中だけ立てる印
create function public.standard_estimate_v25_writer_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.current_setting('wing.standard_estimate_v25_writer', true), '') = 'on';
$$;

create function public.standard_estimate_v25_set_writer(p_on boolean)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.set_config('wing.standard_estimate_v25_writer', case when p_on then 'on' else '' end, true);
$$;

create function public.standard_estimate_v25_revision_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_writer boolean := public.standard_estimate_v25_writer_active();
begin
  if tg_op = 'INSERT' then
    if new.pricing_model = 'v2.5' and not v_writer then
      raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の標準見積は、v2.5 の下書きの作成から作ってください';
    end if;
    if new.pricing_model = 'legacy' and exists (
      select 1
        from public.standard_estimate_masters m
        join public.standard_estimate_revisions r on r.id = m.current_published_revision_id
       where m.id = new.standard_estimate_master_id
         and r.pricing_model = 'v2.5'
    ) then
      raise exception using errcode = 'P0001',
        message = 'LOCKED: この標準見積は v2.5 の計算で公開されています。v2.5 の下書きから編集してください';
    end if;
    return new;
  end if;

  if (old.pricing_model = 'v2.5' or new.pricing_model = 'v2.5') and not v_writer then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の標準見積は、v2.5 の編集画面から変更してください';
  end if;
  if old.pricing_model = 'v2.5' and new.pricing_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の標準見積を v2.5 以前の計算に戻すことはできません';
  end if;
  if old.pricing_model = 'legacy' and new.pricing_model = 'v2.5' and old.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'LOCKED: 公開済みの Revision は v2.5 に切り替えられません。新しい下書きから作ってください';
  end if;
  if old.status <> 'draft' and (
    new.pricing_model is distinct from old.pricing_model
    or new.calc_rule_version_id is distinct from old.calc_rule_version_id
    or new.tax_rule_version_id is distinct from old.tax_rule_version_id
    or new.v25_pricing_complete is distinct from old.v25_pricing_complete
    or new.v25_calc_result is distinct from old.v25_calc_result
  ) then
    raise exception using errcode = 'P0001', message = 'LOCKED: 公開済みの標準見積の計算ルール・計算結果は変更できません';
  end if;
  return new;
end;
$$;

create trigger standard_estimate_revisions_v25_guard
before insert or update on public.standard_estimate_revisions
for each row execute function public.standard_estimate_v25_revision_guard();

create function public.standard_estimate_v25_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision_id uuid;
  v_model text;
begin
  if tg_table_name = 'standard_estimate_revision_baseline_variants' then
    select b.revision_id into v_revision_id
      from public.standard_estimate_revision_baseline_items b
     where b.id = case when tg_op = 'DELETE' then old.baseline_item_id else new.baseline_item_id end;
  elsif tg_op = 'DELETE' then
    v_revision_id := old.revision_id;
  else
    v_revision_id := new.revision_id;
  end if;

  select r.pricing_model into v_model from public.standard_estimate_revisions r where r.id = v_revision_id;
  -- 親の行が無い（連鎖削除の途中）ときは、親の削除で判定済み
  if v_model is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'standard_estimate_revision_lines' and v_model = 'v2.5' and tg_op <> 'DELETE' then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: v2.5 の標準見積の明細は、商品の選択枠か v2.5 の明細（manual・別途見積）として保存してください';
  end if;
  if tg_table_name = 'standard_estimate_revision_v25_lines' and v_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の明細は v2.5 の標準見積にだけ保存できます';
  end if;
  if v_model = 'v2.5' and not public.standard_estimate_v25_writer_active() then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の標準見積は、v2.5 の編集画面から変更してください';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger standard_estimate_revision_sections_v25_guard
before insert or update or delete on public.standard_estimate_revision_sections
for each row execute function public.standard_estimate_v25_child_guard();

create trigger standard_estimate_revision_lines_v25_guard
before insert or update or delete on public.standard_estimate_revision_lines
for each row execute function public.standard_estimate_v25_child_guard();

create trigger standard_estimate_revision_baseline_items_v25_guard
before insert or update or delete on public.standard_estimate_revision_baseline_items
for each row execute function public.standard_estimate_v25_child_guard();

create trigger standard_estimate_revision_baseline_variants_v25_guard
before insert or update or delete on public.standard_estimate_revision_baseline_variants
for each row execute function public.standard_estimate_v25_child_guard();

create trigger standard_estimate_revision_v25_lines_v25_guard
before insert or update or delete on public.standard_estimate_revision_v25_lines
for each row execute function public.standard_estimate_v25_child_guard();

-- 標準見積から作る見積（PR H）は、v2.5 の Revision をまだ扱わない（v2.5 の見積の発行は PR-D1）
create function public.quote_drafts_v25_standard_estimate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.standard_estimate_revision_id is not null and exists (
    select 1 from public.standard_estimate_revisions r
     where r.id = new.standard_estimate_revision_id and r.pricing_model = 'v2.5'
  ) then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: v2.5 の標準見積から見積を作る処理は、まだ使えません（v2.5 の正式見積の発行に合わせて対応します）';
  end if;
  return new;
end;
$$;

create trigger quote_drafts_v25_standard_estimate_guard
before insert or update of standard_estimate_revision_id on public.quote_drafts
for each row execute function public.quote_drafts_v25_standard_estimate_guard();

-- ---------- 計算（内部。API からは実行させない） ----------

-- v2.5 の Revision から正式計算の入力を作る。本体は固定した本体 Revision の基準原価、選択枠は固定した原価 Version、
-- 明細は manual / por。auto の選択枠で原価 Version が無いもの（未設定）は計算から外し、incomplete に挙げる（0 円にしない）
create function public.standard_estimate_v25_calc_input(p_revision_id uuid, p_adjustment integer default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  rev public.standard_estimate_revisions%rowtype;
  v_code text;
  v_lines jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_incomplete jsonb := '[]'::jsonb;
  b record;
  v_variant_total bigint;
  v_missing_variant boolean;
begin
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 標準見積が見つかりません';
  end if;

  foreach v_code in array array['base', 'interior_exterior', 'option', 'sitework'] loop
    v_lines := '[]'::jsonb;
    if v_code = 'base' then
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'key', 'base:' || l.id, 'mode', 'auto', 'quantity', l.quantity::text, 'standard_cost', l.unit_price
             ) order by l.sort_order, l.id), '[]'::jsonb)
        into v_lines
        from public.base_master_revision_lines l
       where l.revision_id = rev.base_master_revision_id;
    else
      for b in
        select bi.id, bi.baseline_key, bi.option_id, bi.quantity, bi.price_mode, bi.standard_cost_version_id,
               bi.manual_unit_price, v.standard_cost as pinned_cost, o.name as option_name
          from public.standard_estimate_revision_baseline_items bi
          join public.options o on o.id = bi.option_id
          left join public.option_standard_cost_versions v on v.id = bi.standard_cost_version_id
         where bi.revision_id = rev.id
           and bi.section_code = v_code
         order by bi.sort_order, bi.id
      loop
        if b.price_mode = 'auto' then
          select coalesce(sum(cv.cost_adjustment), 0), coalesce(bool_or(bv.variant_cost_version_id is null), false)
            into v_variant_total, v_missing_variant
            from public.standard_estimate_revision_baseline_variants bv
            left join public.option_variant_cost_versions cv on cv.id = bv.variant_cost_version_id
           where bv.baseline_item_id = b.id;
          if b.standard_cost_version_id is null or v_missing_variant then
            v_incomplete := v_incomplete || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'key', 'slot:' || b.baseline_key,
              'baseline_key', b.baseline_key,
              'option_id', b.option_id,
              'name', b.option_name,
              'reason', case when b.standard_cost_version_id is null then 'missing_standard_cost' else 'missing_variant_cost' end));
            continue;
          end if;
          v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'key', 'slot:' || b.baseline_key, 'mode', 'auto', 'quantity', b.quantity::text,
            'standard_cost', b.pinned_cost, 'variant_adjustment', v_variant_total));
        elsif b.price_mode = 'manual' then
          v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'key', 'slot:' || b.baseline_key, 'mode', 'manual', 'quantity', b.quantity::text, 'manual_unit_price', b.manual_unit_price));
        else
          v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'key', 'slot:' || b.baseline_key, 'mode', 'por', 'quantity', b.quantity::text));
        end if;
      end loop;

      select v_lines || coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'key', 'line:' || l.line_key, 'mode', l.price_mode, 'quantity', l.quantity::text, 'manual_unit_price', l.unit_price
             ) order by l.sort_order, l.id), '[]'::jsonb)
        into v_lines
        from public.standard_estimate_revision_v25_lines l
       where l.revision_id = rev.id
         and l.section_code = v_code;
    end if;
    v_sections := v_sections || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_code, 'lines', v_lines));
  end loop;

  return pg_catalog.jsonb_build_object(
    'input', pg_catalog.jsonb_build_object(
      'rates', pg_catalog.jsonb_build_object(
        'sales_fee_rate', rev.sales_fee_rate::text,
        'markup_rate', rev.markup_rate::text,
        'expense_rate', rev.expense_rate::text),
      'adjustment', coalesce(p_adjustment, rev.standard_adjustment_amount),
      'sections', v_sections),
    'incomplete', v_incomplete);
end;
$$;

-- v2.5 の Revision の金額を、正式計算で作り直す。選択枠・明細・区分・Revision の金額の列を書き、計算結果を残す。
-- 区分・Revision の金額の列は、v2.5 以前と同じく「金額確定済みの合計＋has_por」で持つ（por の区分・合計は計算結果の中で null）。
-- p_require_complete（公開）のときは、原価が未設定の選択枠があれば止める。
-- 調整額・理由・税率は、行の CHECK（小計＝合計＋調整額、税＝trunc(小計×税率)）を途中で破らないよう、合計と同じ 1 文で書く
create function public.standard_estimate_v25_recalculate(
  p_revision_id uuid,
  p_require_complete boolean default false,
  p_adjustment integer default null,
  p_adjustment_reason text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  rev public.standard_estimate_revisions%rowtype;
  v_built jsonb;
  v_incomplete jsonb;
  v_result jsonb;
  v_section jsonb;
  v_line jsonb;
  v_code text;
  v_key text;
  v_target boolean;
  v_priced bigint;
  v_expense bigint;
  v_cost_lines bigint;
  v_cost_expense bigint;
  v_section_por boolean;
  v_sections_total bigint := 0;
  v_cost_total bigint := 0;
  v_has_por boolean := false;
  v_subtotal bigint;
  v_tax_rate numeric;
  v_adjustment integer;
  v_reason text;
begin
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id;
  if not found or rev.pricing_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'INTERNAL: v2.5 の標準見積ではありません';
  end if;
  select t.tax_rate into v_tax_rate from public.tax_rule_versions t where t.id = rev.tax_rule_version_id;
  v_adjustment := coalesce(p_adjustment, rev.standard_adjustment_amount);
  v_reason := case when p_adjustment is null then rev.standard_adjustment_reason
                   when p_adjustment = 0 then null
                   else pg_catalog.btrim(p_adjustment_reason) end;

  v_built := public.standard_estimate_v25_calc_input(rev.id, v_adjustment);
  v_incomplete := v_built -> 'incomplete';
  if p_require_complete and pg_catalog.jsonb_array_length(v_incomplete) > 0 then
    raise exception using errcode = 'P0001',
      message = format('LOCKED: 原価が未設定の商品があります（%s）。商品の標準原価・バリエーションの標準原価調整額を設定し、最新原価を取り込んでから公開してください',
        (select string_agg('「' || (x.value ->> 'name') || '」', '・') from pg_catalog.jsonb_array_elements(v_incomplete) x));
  end if;
  v_result := public.pricing_calculate(rev.calc_rule_version_id, rev.tax_rule_version_id, v_built -> 'input');

  update public.standard_estimate_revision_baseline_items b
     set selection_cost = null, cost_unit_price = null, sale_unit_price = null, amount = null
   where b.revision_id = rev.id;

  for v_section in select x.value from pg_catalog.jsonb_array_elements(v_result -> 'sections') x loop
    v_code := v_section ->> 'code';
    v_target := (v_section ->> 'expense_target')::boolean;
    v_section_por := (v_section ->> 'has_por')::boolean;

    for v_line in select x.value from pg_catalog.jsonb_array_elements(v_section -> 'lines') x loop
      v_key := v_line ->> 'key';
      if v_key like 'slot:%' then
        update public.standard_estimate_revision_baseline_items b
           set selection_cost = (v_line ->> 'selection_cost')::integer,
               cost_unit_price = (v_line ->> 'cost_unit_price')::integer,
               sale_unit_price = (v_line ->> 'sale_unit_price')::integer,
               amount = (v_line ->> 'amount')::integer
         where b.revision_id = rev.id
           and b.baseline_key = substr(v_key, 6)::uuid;
      end if;
    end loop;

    v_priced := (v_section ->> 'priced_subtotal')::bigint;
    v_expense := case when v_target then trunc(v_priced * rev.expense_rate)::bigint else 0 end;
    if v_code = 'base' then
      select coalesce(sum(trunc(l.quantity * trunc(l.unit_price * rev.sales_fee_rate))), 0)::bigint
        into v_cost_lines
        from public.base_master_revision_lines l
       where l.revision_id = rev.base_master_revision_id;
    else
      select coalesce(sum(trunc(b.quantity * b.cost_unit_price)), 0)::bigint
        into v_cost_lines
        from public.standard_estimate_revision_baseline_items b
       where b.revision_id = rev.id
         and b.section_code = v_code
         and b.cost_unit_price is not null;
    end if;
    v_cost_expense := case when v_target then trunc(v_cost_lines * rev.expense_rate)::bigint else 0 end;

    update public.standard_estimate_revision_sections s
       set expense_method = case when v_target then 'rate' else 'none' end,
           expense_rate = case when v_target then rev.expense_rate else null end,
           line_subtotal = v_priced,
           expense_amount = v_expense,
           total = v_priced + v_expense,
           cost_line_subtotal = v_cost_lines,
           cost_expense_amount = v_cost_expense,
           cost_total = v_cost_lines + v_cost_expense,
           has_por = v_section_por
     where s.revision_id = rev.id
       and s.section_code = v_code;

    v_sections_total := v_sections_total + v_priced + v_expense;
    v_cost_total := v_cost_total + v_cost_lines + v_cost_expense;
    v_has_por := v_has_por or v_section_por;
  end loop;

  v_subtotal := v_sections_total + v_adjustment;
  if v_subtotal < 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 調整後の小計が 0 円未満です';
  end if;

  update public.standard_estimate_revisions r
     set standard_adjustment_amount = v_adjustment,
         standard_adjustment_reason = v_reason,
         tax_rate = v_tax_rate,
         subtotal_raw = v_sections_total,
         subtotal = v_subtotal,
         tax = trunc(v_subtotal * v_tax_rate)::integer,
         total = v_subtotal + trunc(v_subtotal * v_tax_rate)::integer,
         cost_total = v_cost_total,
         has_por = v_has_por,
         v25_pricing_complete = (pg_catalog.jsonb_array_length(v_incomplete) = 0),
         v25_calc_result = pg_catalog.jsonb_build_object('calc', v_result, 'incomplete', v_incomplete)
   where r.id = rev.id;
end;
$$;

-- 選択枠の中身を別の Revision へ写す。v2.5 の Revision からは固定した原価 Version をそのまま写し（黙って更新しない）、
-- v2.5 以前の Revision からは、写し先の計算ルールで自動計算を使える区分なら auto（いま現在の原価 Version を固定。未設定なら未設定のまま）、
-- 使えない区分（別途工事）なら por（別途見積。金額は担当が決める）として写す
create function public.standard_estimate_v25_copy_slots(p_from_revision_id uuid, p_to_revision_id uuid)
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
      price_mode, standard_cost_version_id, manual_unit_price
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
      case when v_mode = 'manual' then b.manual_unit_price end
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
  end loop;
end;
$$;

-- 商品に紐づかない明細を別の Revision へ写す。v2.5 以前の明細（p_from_legacy）は、今の売価の manual（POR は por）として
-- 「要見直し」で写す。別途工事の明細は、Web では原則として金額を確定しない方針（2026-10-19）に合わせて por（要見直し）で写す。
-- v2.5 以前の下書きを v2.5 に切り替えるとき（写し元と写し先が同じ Revision）も、この引数で写し方を決める
create function public.standard_estimate_v25_copy_lines(p_from_revision_id uuid, p_to_revision_id uuid, p_from_legacy boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not p_from_legacy then
    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order
    )
    select p_to_revision_id, l.line_key, l.section_code, l.group_label, l.name, l.quantity, l.unit, l.price_mode, l.unit_price, l.amount,
           l.remark, l.review_required, l.sort_order
      from public.standard_estimate_revision_v25_lines l
     where l.revision_id = p_from_revision_id;
  else
    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order
    )
    select p_to_revision_id, l.line_key, l.section_code, l.group_label, l.name, l.quantity, l.unit,
           case when l.price_mode = 'por' or l.section_code = 'sitework' then 'por' else 'manual' end,
           case when l.price_mode = 'por' or l.section_code = 'sitework' then null else l.unit_price end,
           case when l.price_mode = 'por' or l.section_code = 'sitework' then null else trunc(l.quantity * l.unit_price)::integer end,
           l.remark, true, l.sort_order
      from public.standard_estimate_revision_lines l
     where l.revision_id = p_from_revision_id;
  end if;
end;
$$;

-- ---------- シミュレーターの売価の取得：v2.5 の Revision はまだ扱わない（PR-C1 で対応） ----------

do $patch_sale_views$
declare
  v_signature constant text := 'public.get_standard_estimate_sale_views(uuid)';
  v_from constant text := 'join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = ''published''';
  v_to constant text := 'join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = ''published'' and r.pricing_model = ''legacy''';
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
begin
  v_oid := to_regprocedure(v_signature);
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if (length(v_definition) - length(replace(v_definition, v_from, ''))) / length(v_from) <> 1 then
    raise exception 'STANDARD_ESTIMATE_V25: % differs from the reviewed definition (anchor is not unique)', v_signature using errcode = 'P0001';
  end if;
  v_expected := replace(v_definition, v_from, v_to);
  execute v_expected;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'STANDARD_ESTIMATE_V25: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'STANDARD_ESTIMATE_V25: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_sale_views$;

-- ---------- RPC ----------

-- v2.5 の下書きを作る（本部だけ）。
-- * v2.5 以前の下書きがあれば、その下書きを v2.5 に切り替える（画面が読んだ下書きの版と一致するときだけ）
-- * v2.5 の下書きがあれば、それを返す
-- * 下書きが無ければ、公開中の Revision を土台に新しい下書きを作る（公開済みの Revision は変えない）
-- 計算ルール・税ルールは、その時点の現在の Version を固定する
create function public.start_standard_estimate_v25_draft(
  p_master_id uuid,
  p_expected_draft_lock_version integer default null,
  p_base_master_revision_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m public.standard_estimate_masters%rowtype;
  d public.standard_estimate_revisions%rowtype;
  cur public.standard_estimate_revisions%rowtype;
  v_calc_rule uuid;
  v_tax_rule uuid;
  v_tax_rate numeric;
  v_auto_sections text[];
  v_pin uuid;
  v_rev uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into m from public.standard_estimate_masters sm where sm.id = p_master_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 標準見積が見つかりません';
  end if;
  -- 権限は状態の判定より前に確認する
  if not coalesce(public.can_edit_standard_estimate_master(m.id), false) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: この標準見積を編集できません';
  end if;

  select r.id, r.auto_price_sections into v_calc_rule, v_auto_sections from public.pricing_calculation_rule_versions r where r.superseded_at is null;
  select t.id, t.tax_rate into v_tax_rule, v_tax_rate from public.tax_rule_versions t where t.superseded_at is null;
  if v_calc_rule is null or v_tax_rule is null then
    raise exception using errcode = 'P0001', message = 'INTERNAL: 現在の計算ルール・税ルールが見つかりません';
  end if;

  perform public.standard_estimate_v25_set_writer(true);

  select * into d
    from public.standard_estimate_revisions r
   where r.standard_estimate_master_id = m.id and r.status = 'draft'
   for update;

  if found then
    if d.pricing_model = 'v2.5' then
      perform public.standard_estimate_v25_set_writer(false);
      return d.id;
    end if;
    -- v2.5 以前の下書きを v2.5 に切り替える
    if p_expected_draft_lock_version is distinct from d.lock_version then
      raise exception using errcode = 'P0001',
        message = 'LOCKED: 他の画面でこの標準見積の下書きが更新されています。再読み込みして内容を確認してください';
    end if;
    update public.standard_estimate_revisions r
       set pricing_model = 'v2.5',
           calc_rule_version_id = v_calc_rule,
           tax_rule_version_id = v_tax_rule,
           v25_pricing_complete = false,
           lock_version = r.lock_version + 1,
           updated_by = v_uid
     where r.id = d.id;
    perform public.standard_estimate_v25_copy_lines(d.id, d.id, true);
    delete from public.standard_estimate_revision_lines l where l.revision_id = d.id;
    update public.standard_estimate_revision_baseline_items b
       set price_mode = 'auto',
           standard_cost_version_id = (select v.id from public.option_standard_cost_versions v where v.option_id = b.option_id and v.superseded_at is null)
     where b.revision_id = d.id and b.price_mode is null
       and b.section_code = any(coalesce(v_auto_sections, '{}'::text[]));
    update public.standard_estimate_revision_baseline_items b
       set price_mode = 'por'
     where b.revision_id = d.id and b.price_mode is null;
    update public.standard_estimate_revision_baseline_variants bv
       set variant_cost_version_id = cur_v.id,
           cost_adjustment_snapshot = cur_v.cost_adjustment
      from public.option_variant_cost_versions cur_v
     where cur_v.variant_choice_id = bv.variant_choice_id
       and cur_v.superseded_at is null
       and bv.baseline_item_id in (select b.id from public.standard_estimate_revision_baseline_items b where b.revision_id = d.id and b.price_mode = 'auto');
    perform public.standard_estimate_v25_recalculate(d.id);
    perform public.standard_estimate_v25_set_writer(false);
    return d.id;
  end if;

  -- 下書きが無い：公開中の Revision を土台に作る
  select * into cur from public.standard_estimate_revisions r where r.id = m.current_published_revision_id;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 公開中の Revision がありません。先に標準見積の下書きを作ってから v2.5 に切り替えてください';
  end if;
  if exists (select 1 from public.standard_estimate_revision_sections s where s.revision_id = cur.id and s.expense_method = 'fixed') then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 固定額の経費を含む Revision からは引き継げません。経費の計算方法を見直した下書きから作ってください';
  end if;
  v_pin := coalesce(p_base_master_revision_id, cur.base_master_revision_id);
  if not exists (
    select 1 from public.base_master_revisions b
     where b.id = v_pin and b.base_master_id = m.base_master_id and b.status = 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'LOCKED: 同じ本体の公開中の Revision を基準にしてください';
  end if;

  insert into public.standard_estimate_revisions (
    standard_estimate_master_id, version, status, base_master_revision_id, tax_rate,
    sales_fee_rate, expense_rate, markup_rate, standard_adjustment_amount, standard_adjustment_reason,
    lock_version, source_kind, created_by, updated_by,
    pricing_model, calc_rule_version_id, tax_rule_version_id, v25_pricing_complete
  )
  values (
    m.id,
    (select max(r.version) + 1 from public.standard_estimate_revisions r where r.standard_estimate_master_id = m.id),
    'draft', v_pin, v_tax_rate,
    cur.sales_fee_rate, cur.expense_rate, cur.markup_rate, 0, null,
    1, 'ui', v_uid, v_uid,
    'v2.5', v_calc_rule, v_tax_rule, false
  )
  returning id into v_rev;

  insert into public.standard_estimate_revision_sections (revision_id, section_code, expense_method, expense_rate)
  values (v_rev, 'base', 'none', null), (v_rev, 'interior_exterior', 'none', null),
         (v_rev, 'option', 'none', null), (v_rev, 'sitework', 'none', null);

  perform public.standard_estimate_v25_copy_lines(cur.id, v_rev, cur.pricing_model = 'legacy');
  perform public.standard_estimate_v25_copy_slots(cur.id, v_rev);
  perform public.standard_estimate_v25_recalculate(v_rev, false, cur.standard_adjustment_amount, cur.standard_adjustment_reason);
  perform public.standard_estimate_v25_set_writer(false);
  return v_rev;
end;
$$;

-- v2.5 の下書きを保存する（本部だけ）。率・調整額・商品の選択枠・商品に紐づかない明細を置き換える。
-- 選択枠の原価 Version は、同じ商品・同じ選択肢の auto の選択枠が保存前にあれば、その固定をそのまま引き継ぐ（黙って更新しない）。
-- 新しい選択枠・商品や選択肢を変えた選択枠・auto に変えた選択枠だけ、いま現在の原価 Version を固定する
--   p_payload：{ rates: { sales_fee_rate, markup_rate, expense_rate }, adjustment, adjustment_reason,
--               slots: [ { baseline_key?, option_id, variant_choice_ids, quantity, price_mode, manual_unit_price? } ],
--               lines: [ { line_key?, section_code, group_label?, name, quantity, unit?, price_mode, unit_price?, remark?, review_required? } ] }
create function public.save_standard_estimate_v25_draft(p_revision_id uuid, p_expected_lock_version integer, p_payload jsonb)
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
      select b.option_id::text || '|' || coalesce((
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
      v_choice_ids := coalesce(array(
        select y.value::uuid from pg_catalog.jsonb_array_elements_text(coalesce(item -> 'variant_choice_ids', '[]'::jsonb)) y(value)
      ), '{}'::uuid[]);
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の商品・数量・選択肢・単価の形式が不正です', v_index);
    end;
    if v_option_id is null then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目の商品を選んでください', v_index);
    end if;
    if v_option_id = any(v_seen) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：同じ商品が重複しています', v_index);
    end if;
    v_seen := array_append(v_seen, v_option_id);
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
    v_prev := case when v_mode = 'auto' then v_old -> v_identity end;
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
      price_mode, standard_cost_version_id, manual_unit_price
    )
    values (
      rev.id, coalesce(v_baseline_key, gen_random_uuid()), o.id, c.id, public.estimate_section_for_option(c.code, o.is_installation), c.code, v_qty,
      o.code, o.name, c.code, c.name,
      case when o.price_on_request then 0 else o.price end, o.price_on_request, v_index,
      v_mode, v_cost_pin, v_manual
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

-- 最新原価を取り込む（本部だけ）。auto の選択枠の原価 Version と、計算ルール・税ルールを現在の Version に固定し直す
create function public.refresh_standard_estimate_v25_costs(p_revision_id uuid, p_expected_lock_version integer)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions%rowtype;
  v_calc_rule uuid;
  v_tax_rule uuid;
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
  if rev.status <> 'draft' or rev.pricing_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の下書きだけ最新原価を取り込めます';
  end if;
  if rev.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'LOCKED: 他の画面でこの標準見積が更新されています。再読み込みして内容を確認してください';
  end if;
  select r.id into v_calc_rule from public.pricing_calculation_rule_versions r where r.superseded_at is null;
  select t.id into v_tax_rule from public.tax_rule_versions t where t.superseded_at is null;

  perform public.standard_estimate_v25_set_writer(true);

  update public.standard_estimate_revisions r
     set calc_rule_version_id = v_calc_rule,
         tax_rule_version_id = v_tax_rule,
         lock_version = r.lock_version + 1,
         updated_by = v_uid
   where r.id = rev.id;

  update public.standard_estimate_revision_baseline_items b
     set standard_cost_version_id = (select v.id from public.option_standard_cost_versions v where v.option_id = b.option_id and v.superseded_at is null)
   where b.revision_id = rev.id and b.price_mode = 'auto';

  update public.standard_estimate_revision_baseline_variants bv
     set variant_cost_version_id = (select cv.id from public.option_variant_cost_versions cv
                                     where cv.variant_choice_id = bv.variant_choice_id and cv.superseded_at is null),
         cost_adjustment_snapshot = (select cv.cost_adjustment from public.option_variant_cost_versions cv
                                      where cv.variant_choice_id = bv.variant_choice_id and cv.superseded_at is null)
   where bv.baseline_item_id in (
     select b.id from public.standard_estimate_revision_baseline_items b where b.revision_id = rev.id and b.price_mode = 'auto'
   );

  perform public.standard_estimate_v25_recalculate(rev.id);
  perform public.standard_estimate_v25_set_writer(false);
  select * into rev from public.standard_estimate_revisions r where r.id = rev.id;
  return rev;
end;
$$;

-- v2.5 の下書きを公開する（本部だけ）。
-- lock の順：Revision → 標準見積 → 選択枠の商品の行（FOR SHARE。原価の切替・取扱終了と順序付ける）。
-- 排他が成立した後の状態で、計算ルール・税ルールと固定した原価 Version が現在の Version と同じか、原価がそろっているかを確かめ、
-- 正式計算で金額を作り直してから公開する（違えば公開しない。最新原価を取り込んで確認してから公開し直す）
create function public.publish_standard_estimate_v25_revision(p_revision_id uuid, p_expected_lock_version integer)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions%rowtype;
  m public.standard_estimate_masters%rowtype;
  v_names text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 標準見積が見つかりません';
  end if;
  if not coalesce(public.can_edit_standard_estimate_master(rev.standard_estimate_master_id), false) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: この標準見積を公開できません';
  end if;
  select * into m from public.standard_estimate_masters sm where sm.id = rev.standard_estimate_master_id for update;
  if rev.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'LOCKED: 下書きの Revision だけ公開できます';
  end if;
  if rev.pricing_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の下書きではありません';
  end if;
  if rev.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = 'P0001', message = 'LOCKED: 他の画面でこの標準見積が更新されています。再読み込みして内容を確認してください';
  end if;
  if not exists (select 1 from public.base_master_revisions b where b.id = rev.base_master_revision_id and b.status = 'published') then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 基準の本体 Revision が公開中ではありません。最新の本体 Revision で下書きを作り直してください';
  end if;
  -- v2.5 以前から引き継いだ明細の「要見直し」が残っていれば公開しない（2026-10-19 の確定方針）
  if exists (select 1 from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id and l.review_required) then
    raise exception using errcode = 'P0001',
      message = format('LOCKED: 「要見直し」の明細が %s 行残っています。商品台帳の商品に置き換えるか、金額を確認して見直し済みにしてから公開してください',
        (select count(*) from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id and l.review_required));
  end if;

  perform public.standard_estimate_v25_set_writer(true);

  perform 1
    from public.options o
   where o.id in (select b.option_id from public.standard_estimate_revision_baseline_items b where b.revision_id = rev.id)
   order by o.id
   for share;

  if not exists (select 1 from public.pricing_calculation_rule_versions r where r.id = rev.calc_rule_version_id and r.superseded_at is null)
     or not exists (select 1 from public.tax_rule_versions t where t.id = rev.tax_rule_version_id and t.superseded_at is null) then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 計算ルール・税ルールが更新されています。最新原価を取り込んで金額を確認してから公開してください';
  end if;

  select string_agg('「' || x.name || '」', '・' order by x.sort_order, x.id)
    into v_names
    from (
      select distinct o.name, o.sort_order, o.id
        from public.standard_estimate_revision_baseline_items b
        join public.options o on o.id = b.option_id
        left join public.option_standard_cost_versions v on v.id = b.standard_cost_version_id
       where b.revision_id = rev.id
         and b.price_mode = 'auto'
         and (v.id is null
              or v.superseded_at is not null
              or exists (
                select 1
                  from public.standard_estimate_revision_baseline_variants bv
                  left join public.option_variant_cost_versions cv on cv.id = bv.variant_cost_version_id
                 where bv.baseline_item_id = b.id
                   and (cv.id is null or cv.superseded_at is not null)))
    ) x;
  if v_names is not null then
    raise exception using errcode = 'P0001',
      message = format('LOCKED: %s の原価が更新されているか、未設定です。最新原価を取り込んで金額を確認してから公開してください', v_names);
  end if;

  -- 標準状態の商品（登録済み・この仕様で選べる）を確かめ、名称・公開価格の snapshot を取り直す
  perform public.refresh_standard_estimate_baseline(rev.id);
  perform public.standard_estimate_v25_recalculate(rev.id, true);

  update public.standard_estimate_revisions r
     set status = 'superseded'
   where r.standard_estimate_master_id = m.id and r.status = 'published';

  update public.standard_estimate_revisions r
     set status = 'published', published_at = now(), published_by = v_uid, updated_by = v_uid, lock_version = r.lock_version + 1
   where r.id = rev.id;

  update public.standard_estimate_masters sm
     set current_published_revision_id = rev.id, updated_by = v_uid
   where sm.id = m.id;

  perform public.standard_estimate_v25_set_writer(false);
  select * into rev from public.standard_estimate_revisions r where r.id = rev.id;
  return rev;
end;
$$;

-- v2.5 の Revision の金額と、固定した原価 Version が現在の Version と同じかを返す（本部の編集画面用。変更はしない）
create function public.preview_standard_estimate_v25_revision(p_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions%rowtype;
  v_built jsonb;
  v_calc jsonb;
  v_error text;
  v_slots jsonb;
  v_calc_current boolean;
  v_tax_current boolean;
  v_review_lines integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 標準見積が見つかりません';
  end if;
  if not coalesce(public.can_view_standard_estimate_revision(rev.id), false) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: この標準見積を閲覧できません';
  end if;
  if rev.pricing_model <> 'v2.5' then
    raise exception using errcode = 'P0001', message = 'LOCKED: v2.5 の標準見積ではありません';
  end if;

  v_built := public.standard_estimate_v25_calc_input(rev.id);
  begin
    v_calc := public.pricing_calculate(rev.calc_rule_version_id, rev.tax_rule_version_id, v_built -> 'input');
  exception when others then
    v_calc := null;
    v_error := sqlerrm;
  end;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'baseline_key', b.baseline_key,
           'option_id', b.option_id,
           'name', o.name,
           'price_mode', b.price_mode,
           'pinned_standard_cost_version_id', b.standard_cost_version_id,
           'pinned_standard_cost', pv.standard_cost,
           'current_standard_cost_version_id', cv.id,
           'current_standard_cost', cv.standard_cost,
           'cost_status', case
             when b.price_mode <> 'auto' then null
             when cv.id is null or b.standard_cost_version_id is null then 'missing'
             when b.standard_cost_version_id <> cv.id then 'stale'
             else 'current' end,
           'variants', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'variant_choice_id', bv.variant_choice_id,
                      'pinned_version_id', bv.variant_cost_version_id,
                      'pinned_adjustment', bv.cost_adjustment_snapshot,
                      'current_version_id', ccv.id,
                      'current_adjustment', ccv.cost_adjustment,
                      'status', case
                        when b.price_mode <> 'auto' then null
                        when ccv.id is null or bv.variant_cost_version_id is null then 'missing'
                        when bv.variant_cost_version_id <> ccv.id then 'stale'
                        else 'current' end
                    ) order by bv.sort_order)
               from public.standard_estimate_revision_baseline_variants bv
               left join public.option_variant_cost_versions ccv
                 on ccv.variant_choice_id = bv.variant_choice_id and ccv.superseded_at is null
              where bv.baseline_item_id = b.id), '[]'::jsonb)
         ) order by b.sort_order, b.id), '[]'::jsonb)
    into v_slots
    from public.standard_estimate_revision_baseline_items b
    join public.options o on o.id = b.option_id
    left join public.option_standard_cost_versions pv on pv.id = b.standard_cost_version_id
    left join public.option_standard_cost_versions cv on cv.option_id = b.option_id and cv.superseded_at is null
   where b.revision_id = rev.id;

  select count(*)::integer into v_review_lines
    from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id and l.review_required;
  v_calc_current := exists (select 1 from public.pricing_calculation_rule_versions r where r.id = rev.calc_rule_version_id and r.superseded_at is null);
  v_tax_current := exists (select 1 from public.tax_rule_versions t where t.id = rev.tax_rule_version_id and t.superseded_at is null);

  return pg_catalog.jsonb_build_object(
    'revision_id', rev.id,
    'status', rev.status,
    'lock_version', rev.lock_version,
    'calc_rule_version_id', rev.calc_rule_version_id,
    'tax_rule_version_id', rev.tax_rule_version_id,
    'rules_current', v_calc_current and v_tax_current,
    'review_required_lines', v_review_lines,
    'calc', v_calc,
    'calc_error', v_error,
    'incomplete', v_built -> 'incomplete',
    'slots', v_slots,
    'publishable', rev.status = 'draft'
                   and v_calc is not null
                   and v_review_lines = 0
                   and v_calc_current and v_tax_current
                   and pg_catalog.jsonb_array_length(v_built -> 'incomplete') = 0
                   and not exists (
                     select 1 from pg_catalog.jsonb_array_elements(v_slots) s(value)
                      where s.value ->> 'cost_status' in ('stale', 'missing')
                         or exists (select 1 from pg_catalog.jsonb_array_elements(s.value -> 'variants') vv(value)
                                     where vv.value ->> 'status' in ('stale', 'missing'))));
end;
$$;

-- ---------- 所有者と実行権限 ----------

alter function public.standard_estimate_v25_writer_active() owner to postgres;
alter function public.standard_estimate_v25_set_writer(boolean) owner to postgres;
alter function public.standard_estimate_v25_revision_guard() owner to postgres;
alter function public.standard_estimate_v25_child_guard() owner to postgres;
alter function public.quote_drafts_v25_standard_estimate_guard() owner to postgres;
alter function public.standard_estimate_v25_calc_input(uuid, integer) owner to postgres;
alter function public.standard_estimate_v25_recalculate(uuid, boolean, integer, text) owner to postgres;
alter function public.standard_estimate_v25_copy_slots(uuid, uuid) owner to postgres;
alter function public.standard_estimate_v25_copy_lines(uuid, uuid, boolean) owner to postgres;
alter function public.start_standard_estimate_v25_draft(uuid, integer, uuid) owner to postgres;
alter function public.save_standard_estimate_v25_draft(uuid, integer, jsonb) owner to postgres;
alter function public.refresh_standard_estimate_v25_costs(uuid, integer) owner to postgres;
alter function public.publish_standard_estimate_v25_revision(uuid, integer) owner to postgres;
alter function public.preview_standard_estimate_v25_revision(uuid) owner to postgres;

revoke all on function public.standard_estimate_v25_writer_active() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_set_writer(boolean) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_revision_guard() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_child_guard() from public, anon, authenticated, service_role;
revoke all on function public.quote_drafts_v25_standard_estimate_guard() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_calc_input(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_recalculate(uuid, boolean, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_copy_slots(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_copy_lines(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.start_standard_estimate_v25_draft(uuid, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_standard_estimate_v25_draft(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.refresh_standard_estimate_v25_costs(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.publish_standard_estimate_v25_revision(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.preview_standard_estimate_v25_revision(uuid) from public, anon, authenticated, service_role;

grant execute on function public.start_standard_estimate_v25_draft(uuid, integer, uuid) to authenticated;
grant execute on function public.save_standard_estimate_v25_draft(uuid, integer, jsonb) to authenticated;
grant execute on function public.refresh_standard_estimate_v25_costs(uuid, integer) to authenticated;
grant execute on function public.publish_standard_estimate_v25_revision(uuid, integer) to authenticated;
grant execute on function public.preview_standard_estimate_v25_revision(uuid) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn record;
  v_rpc constant text[] := array['start_standard_estimate_v25_draft', 'save_standard_estimate_v25_draft',
                                 'refresh_standard_estimate_v25_costs', 'publish_standard_estimate_v25_revision',
                                 'preview_standard_estimate_v25_revision'];
begin
  if exists (select 1 from public.standard_estimate_revisions r where r.pricing_model <> 'legacy') then
    raise exception 'POSTCONDITION: existing standard estimate revisions must stay legacy';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.standard_estimate_revision_v25_lines'::regclass and c.relrowsecurity) then
    raise exception 'POSTCONDITION: v2.5 lines RLS is not enabled';
  end if;
  if has_table_privilege('anon', 'public.standard_estimate_revision_v25_lines', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role', 'public.standard_estimate_revision_v25_lines', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.standard_estimate_revision_v25_lines', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('authenticated', 'public.standard_estimate_revision_v25_lines', 'SELECT') then
    raise exception 'POSTCONDITION: v2.5 lines ACL is not SELECT-only for authenticated';
  end if;
  if position('r.pricing_model = ''legacy''' in pg_catalog.pg_get_functiondef('public.get_standard_estimate_sale_views(uuid)'::regprocedure)) = 0 then
    raise exception 'POSTCONDITION: sale views must exclude v2.5 revisions';
  end if;

  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'standard_estimate_v25_%' or p.proname = any(v_rpc) or p.proname = 'quote_drafts_v25_standard_estimate_guard')
  loop
    if v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be owned by postgres', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon or service_role', v_fn.proname;
    end if;
    if v_fn.proname = any(v_rpc) then
      if not v_fn.prosecdef or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'POSTCONDITION: % must be SECURITY DEFINER and executable by authenticated', v_fn.proname;
      end if;
    elsif has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: internal function % must not be executable by authenticated', v_fn.proname;
    end if;
  end loop;
end;
$postcondition$;

commit;
