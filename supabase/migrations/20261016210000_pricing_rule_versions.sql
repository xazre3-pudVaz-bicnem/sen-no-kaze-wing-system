-- v2.5 PR-A2：計算ルール Version・税ルール Version と、正式計算の関数。
--
-- 金額正本・価格ライフサイクル設計 v2.5 の第2章・第11章・第12章：
-- * 計算ルール・税ルールも Version で持つ。作った Version は変えない。現在有効な Version は同時に 1 つだけ
-- * 正式計算の順序と切り捨て（0 方向・1 円未満）の境界
--     auto：選択状態標準原価 = 商品標準原価 + バリエーション標準原価調整額（0 円未満なら計算しない）
--           見積用原価単価 = trunc(選択状態標準原価 × 販売費率)
--           売価単価       = trunc(見積用原価単価 × 掛率)
--           明細売価       = trunc(売価単価 × 数量)
--     manual：明細売価 = trunc(manual 売価単価 × 数量)（販売費・掛率を再適用しない）
--     por：金額未確定。0 円ではない。区分・合計・税まで「未確定」を伝える
--     区分小計 = 金額確定済みの明細売価の合計、区分経費 = trunc(区分小計 × 経費率)（経費対象区分だけ）
--     別途工事（2026-10-19 先方の確定方針）：販売費・経費・掛率を掛けない。auto は使えず、決めた税別売価の manual か por だけ
--       （計算ルールの auto_price_sections・expense_target_sections に別途工事を含めない）
--     税別小計 = Σ(区分小計 + 区分経費)、調整後税別額 = 税別小計 + 調整額（整数円・0 円以上）
--     税額 = trunc(課税対象税別額 × 税率)（全額課税・単一税率）、税込総額 = 調整後税別額 + 税額
--   宣言した境界以外では丸めない。1,000 円未満の自動切り捨ては持たない
-- * DB は numeric で計算する。TypeScript（lib/domain/pricing-v25.ts）は同じ式を BigInt の固定小数で計算し、
--   実 DB の検査で同じ入力から同じ結果になることを確かめる
--
-- この migration は表と関数を足すだけで、既存の標準見積・シミュレーター・見積の計算は変えない
-- （既存の Revision は計算ルール未設定＝v2.5 以前の計算のまま。呼び出し側への組み込みは後続の PR）。

begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.pricing_calculation_rule_versions') is not null
     or to_regclass('public.tax_rule_versions') is not null
     or to_regprocedure('public.pricing_calculate(uuid, uuid, jsonb)') is not null then
    raise exception 'PRECONDITION: pricing rule version objects already exist';
  end if;
  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.current_organization_member_rank(uuid)') is null then
    raise exception 'PRECONDITION: organization permission helpers are missing';
  end if;
end;
$preflight$;

-- ---------- 計算ルール Version ----------

create table public.pricing_calculation_rule_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
  version_no integer not null unique check (version_no >= 1),
  -- 計算の式（順序と切り捨ての境界）。DB と TypeScript の両方に同じ式を実装したものだけを置く
  formula_code text not null check (formula_code in ('v2.5')),
  rounding_mode text not null default 'trunc' check (rounding_mode = 'trunc'),
  -- 経費を計算する区分（本体・内外装・オプション・別途工事のうち）
  expense_target_sections text[] not null
    check (expense_target_sections <@ array['base', 'interior_exterior', 'option', 'sitework']::text[]),
  -- auto（販売費率・掛率による自動計算）を使える区分。含まれない区分の明細は manual か por だけ
  auto_price_sections text[] not null
    check (auto_price_sections <@ array['base', 'interior_exterior', 'option', 'sitework']::text[]),
  description text not null check (pg_catalog.char_length(pg_catalog.btrim(description)) between 1 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  constraint pricing_calculation_rule_versions_superseded_pair check ((superseded_at is null) = (superseded_by_version_id is null)),
  constraint pricing_calculation_rule_versions_superseded_after check (superseded_at is null or superseded_at >= created_at),
  constraint pricing_calculation_rule_versions_superseded_by_fkey foreign key (superseded_by_version_id)
    references public.pricing_calculation_rule_versions(id) deferrable initially deferred
);

comment on table public.pricing_calculation_rule_versions is
  '正式計算の計算ルール（式・切り捨て・経費対象区分）の Version。作った後は変えない。現在有効な Version は 1 つだけ。';

create unique index pricing_calculation_rule_versions_current_key
  on public.pricing_calculation_rule_versions ((true))
  where superseded_at is null;

-- ---------- 税ルール Version ----------

create table public.tax_rule_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
  version_no integer not null unique check (version_no >= 1),
  -- 初期仕様は全額課税・単一税率だけ
  tax_mode text not null check (tax_mode in ('full_single_rate')),
  tax_rate numeric(8, 6) not null check (tax_rate >= 0 and tax_rate <= 1),
  rounding_mode text not null default 'trunc' check (rounding_mode = 'trunc'),
  description text not null check (pg_catalog.char_length(pg_catalog.btrim(description)) between 1 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  constraint tax_rule_versions_superseded_pair check ((superseded_at is null) = (superseded_by_version_id is null)),
  constraint tax_rule_versions_superseded_after check (superseded_at is null or superseded_at >= created_at),
  constraint tax_rule_versions_superseded_by_fkey foreign key (superseded_by_version_id)
    references public.tax_rule_versions(id) deferrable initially deferred
);

comment on table public.tax_rule_versions is
  '正式計算の税ルール（課税方式・税率・切り捨て）の Version。作った後は変えない。現在有効な Version は 1 つだけ。';

create unique index tax_rule_versions_current_key
  on public.tax_rule_versions ((true))
  where superseded_at is null;

-- ---------- Version を変えさせない ----------

-- 変えてよいのは、現在の Version を閉じるときの superseded_at・superseded_by_version_id（空 → 値、1 回だけ）。削除はさせない
create function public.pricing_rule_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 計算ルール・税ルールの Version は削除できません（変更は新しい Version を作ります）';
  end if;
  if old.superseded_at is not null
     or new.superseded_at is null
     or new.superseded_by_version_id is null
     or (pg_catalog.to_jsonb(new) - 'superseded_at' - 'superseded_by_version_id')
        is distinct from (pg_catalog.to_jsonb(old) - 'superseded_at' - 'superseded_by_version_id') then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 計算ルール・税ルールの Version は変更できません（変更は新しい Version を作ります）';
  end if;
  return new;
end;
$$;

create trigger pricing_calculation_rule_versions_immutable
before update or delete on public.pricing_calculation_rule_versions
for each row execute function public.pricing_rule_version_immutable();

create trigger tax_rule_versions_immutable
before update or delete on public.tax_rule_versions
for each row execute function public.pricing_rule_version_immutable();

-- ---------- 読み取り（標準見積と同じく、admin と本部の editor 以上）。書き込みは migration だけ ----------

create function public.can_view_pricing_rule_versions()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
         or exists (
           select 1
             from public.organizations o
            where o.organization_type = 'headquarters'
              and o.status = 'active'
              and public.current_organization_member_rank(o.id) >= 1
         );
$$;

alter table public.pricing_calculation_rule_versions enable row level security;
alter table public.tax_rule_versions enable row level security;
revoke all on table public.pricing_calculation_rule_versions from public, anon, authenticated, service_role;
revoke all on table public.tax_rule_versions from public, anon, authenticated, service_role;
grant select on table public.pricing_calculation_rule_versions to authenticated;
grant select on table public.tax_rule_versions to authenticated;

create policy pricing_calculation_rule_versions_hq_read
on public.pricing_calculation_rule_versions
for select
to authenticated
using (public.can_view_pricing_rule_versions());

create policy tax_rule_versions_hq_read
on public.tax_rule_versions
for select
to authenticated
using (public.can_view_pricing_rule_versions());

-- ---------- 初期の Version（v2.5 の初期仕様） ----------

insert into public.pricing_calculation_rule_versions (
  code, version_no, formula_code, rounding_mode, expense_target_sections, auto_price_sections, description
)
values (
  'CALC-V25-1', 1, 'v2.5', 'trunc',
  array['base', 'interior_exterior', 'option']::text[],
  array['base', 'interior_exterior', 'option']::text[],
  '金額正本 v2.5 第11章の正式計算順序（初期仕様）。販売費率・掛率・数量・経費・税の各境界で 0 方向に 1 円未満を切り捨てる。経費と自動計算の対象は本体・内外装・オプション。別途工事は販売費・経費・掛率を掛けず、決めた税別売価か別途見積（2026-10-19 先方の確定方針）'
);

insert into public.tax_rule_versions (code, version_no, tax_mode, tax_rate, rounding_mode, description)
values (
  'TAX-10-1', 1, 'full_single_rate', 0.100000, 'trunc',
  '全額課税・単一税率 10%（初期仕様）。税額は 0 方向に 1 円未満を切り捨てる'
);

-- ---------- 正式計算（内部。API からは実行させない） ----------

-- 10 進数（JSON の数値または文字列）を numeric にする。小数は p_max_scale 桁まで（末尾の 0 は数えない）
create function public.pricing_input_decimal(p_value jsonb, p_label text, p_max_scale integer)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_value numeric;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) not in ('number', 'string') then
    raise exception using errcode = 'P0001', message = format('VALIDATION: %s がありません', p_label);
  end if;
  v_text := p_value #>> '{}';
  if pg_catalog.jsonb_typeof(p_value) = 'string' and v_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception using errcode = 'P0001', message = format('VALIDATION: %s の形式が正しくありません', p_label);
  end if;
  v_value := v_text::numeric;
  if pg_catalog.min_scale(v_value) > p_max_scale then
    raise exception using errcode = 'P0001', message = format('VALIDATION: %s の小数は %s 桁までです', p_label, p_max_scale);
  end if;
  return v_value;
end;
$$;

-- 整数円（JSON の整数）を numeric にする。無い・null は p_default（p_default も null なら必須）
create function public.pricing_input_integer(p_value jsonb, p_label text, p_min numeric, p_max numeric, p_default numeric default null)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value numeric;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    if p_default is null then
      raise exception using errcode = 'P0001', message = format('VALIDATION: %s がありません', p_label);
    end if;
    return p_default;
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'number' then
    raise exception using errcode = 'P0001', message = format('VALIDATION: %s は整数円の数値で指定してください', p_label);
  end if;
  v_value := (p_value #>> '{}')::numeric;
  if v_value <> pg_catalog.trunc(v_value) or v_value < p_min or v_value > p_max then
    raise exception using errcode = 'P0001', message = format('VALIDATION: %s は %s〜%s の整数円です', p_label, p_min, p_max);
  end if;
  return pg_catalog.trunc(v_value);
end;
$$;

-- 計算した金額が扱える範囲（±999,999,999,999 円）に収まることを確かめる
create function public.pricing_checked_amount(p_value numeric, p_label text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value > 999999999999 or p_value < -999999999999 then
    raise exception using errcode = 'P0001', message = format('VALIDATION: %s が扱える金額の範囲を超えています', p_label);
  end if;
  return p_value;
end;
$$;

-- 正式計算。入力と結果の形は lib/domain/pricing-v25.ts の型と同じ
--   入力：{ rates: { sales_fee_rate, markup_rate, expense_rate }, adjustment?, sections: [ { code, lines: [ { key, mode, quantity,
--          standard_cost?, variant_adjustment?, manual_unit_price? } ] } ] }
--   率は小数 4 桁まで（販売費率・掛率は 0 より大きく、経費率は 0 以上、いずれも 99.9999 まで）。数量は小数 4 桁まで・0 以上
--   結果の金額は整数円。por を含む区分・合計・税は null（未確定）
create function public.pricing_calculate(p_calc_rule_version_id uuid, p_tax_rule_version_id uuid, p_input jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rule public.pricing_calculation_rule_versions%rowtype;
  v_tax public.tax_rule_versions%rowtype;
  v_sales_fee numeric;
  v_markup numeric;
  v_expense_rate numeric;
  v_adjustment numeric;
  v_section jsonb;
  v_line jsonb;
  v_code text;
  v_seen_codes text[] := '{}';
  v_seen_keys text[] := '{}';
  v_key text;
  v_mode text;
  v_qty numeric;
  v_standard_cost numeric;
  v_variant numeric;
  v_selection numeric;
  v_cost_unit numeric;
  v_sale_unit numeric;
  v_amount numeric;
  v_priced numeric;
  v_section_por boolean;
  v_section_subtotal numeric;
  v_section_expense numeric;
  v_section_total numeric;
  v_expense_target boolean;
  v_lines jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_has_por boolean := false;
  v_adjusted numeric;
  v_tax_amount numeric;
  v_total numeric;
begin
  select * into v_rule from public.pricing_calculation_rule_versions r where r.id = p_calc_rule_version_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 計算ルールの Version が見つかりません';
  end if;
  if v_rule.formula_code <> 'v2.5' or v_rule.rounding_mode <> 'trunc' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この計算ルールの式には対応していません';
  end if;
  select * into v_tax from public.tax_rule_versions t where t.id = p_tax_rule_version_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 税ルールの Version が見つかりません';
  end if;
  if v_tax.tax_mode <> 'full_single_rate' or v_tax.rounding_mode <> 'trunc' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この税ルールには対応していません';
  end if;

  if p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object'
     or pg_catalog.jsonb_typeof(p_input -> 'rates') is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 計算の入力の形式が正しくありません';
  end if;
  v_sales_fee := public.pricing_input_decimal(p_input -> 'rates' -> 'sales_fee_rate', '販売費率', 4);
  v_markup := public.pricing_input_decimal(p_input -> 'rates' -> 'markup_rate', '掛率', 4);
  v_expense_rate := public.pricing_input_decimal(p_input -> 'rates' -> 'expense_rate', '経費率', 4);
  if v_sales_fee <= 0 or v_sales_fee > 99.9999 or v_markup <= 0 or v_markup > 99.9999
     or v_expense_rate < 0 or v_expense_rate > 99.9999 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 率が範囲外です（販売費率・掛率は 0 より大きく、経費率は 0 以上、いずれも 99.9999 まで）';
  end if;
  v_adjustment := public.pricing_input_integer(p_input -> 'adjustment', '調整額', -2147483648, 2147483647, 0);

  if pg_catalog.jsonb_typeof(p_input -> 'sections') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 区分の一覧がありません';
  end if;

  for v_section in select value from pg_catalog.jsonb_array_elements(p_input -> 'sections')
  loop
    if pg_catalog.jsonb_typeof(v_section) <> 'object' then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 区分の形式が正しくありません';
    end if;
    v_code := case when pg_catalog.jsonb_typeof(v_section -> 'code') = 'string' then v_section ->> 'code' end;
    if v_code is null or v_code not in ('base', 'interior_exterior', 'option', 'sitework') then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 区分のコードが正しくありません';
    end if;
    if v_code = any(v_seen_codes) then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 区分 %s が重複しています', v_code);
    end if;
    v_seen_codes := v_seen_codes || v_code;
    if pg_catalog.jsonb_typeof(v_section -> 'lines') is distinct from 'array' then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 区分 %s の明細の一覧がありません', v_code);
    end if;

    v_priced := 0;
    v_section_por := false;
    v_lines := '[]'::jsonb;

    for v_line in select value from pg_catalog.jsonb_array_elements(v_section -> 'lines')
    loop
      if pg_catalog.jsonb_typeof(v_line) <> 'object' then
        raise exception using errcode = 'P0001', message = 'VALIDATION: 明細の形式が正しくありません';
      end if;
      v_key := case when pg_catalog.jsonb_typeof(v_line -> 'key') = 'string' then v_line ->> 'key' end;
      if v_key is null or v_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
        raise exception using errcode = 'P0001', message = 'VALIDATION: 明細のキーが正しくありません';
      end if;
      if v_key = any(v_seen_keys) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 明細のキー %s が重複しています', v_key);
      end if;
      v_seen_keys := v_seen_keys || v_key;
      v_mode := case when pg_catalog.jsonb_typeof(v_line -> 'mode') = 'string' then v_line ->> 'mode' end;
      if v_mode is null or v_mode not in ('auto', 'manual', 'por') then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s の価格方式が正しくありません', v_key);
      end if;
      v_qty := public.pricing_input_decimal(v_line -> 'quantity', '数量', 4);
      if v_qty < 0 or v_qty > 9999999999.9999 then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s の数量が範囲外です', v_key);
      end if;

      if v_mode = 'auto' then
        if not (v_code = any(v_rule.auto_price_sections)) then
          raise exception using errcode = 'P0001',
            message = format('VALIDATION: 明細 %s：この区分（%s）では自動計算（販売費率・掛率）を使えません。決めた税別売価を入力するか、別途見積にしてください', v_key, v_code);
        end if;
        v_standard_cost := public.pricing_input_integer(v_line -> 'standard_cost', '商品標準原価', 0, 2147483647);
        v_variant := public.pricing_input_integer(v_line -> 'variant_adjustment', 'バリエーション標準原価調整額', -2147483648, 2147483647, 0);
        v_selection := v_standard_cost + v_variant;
        if v_selection < 0 then
          raise exception using errcode = 'P0001',
            message = format('VALIDATION: 明細 %s の選択状態標準原価が 0 円未満です（調整額を見直してください）', v_key);
        end if;
        v_cost_unit := public.pricing_checked_amount(pg_catalog.trunc(v_selection * v_sales_fee), '見積用原価単価');
        v_sale_unit := public.pricing_checked_amount(pg_catalog.trunc(v_cost_unit * v_markup), '売価単価');
        v_amount := public.pricing_checked_amount(pg_catalog.trunc(v_sale_unit * v_qty), '明細売価');
        v_priced := public.pricing_checked_amount(v_priced + v_amount, '区分小計');
        v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'key', v_key, 'mode', v_mode, 'selection_cost', v_selection, 'cost_unit_price', v_cost_unit,
          'sale_unit_price', v_sale_unit, 'amount', v_amount));
      elsif v_mode = 'manual' then
        v_sale_unit := public.pricing_input_integer(v_line -> 'manual_unit_price', 'manual 売価単価', 0, 2147483647);
        v_amount := public.pricing_checked_amount(pg_catalog.trunc(v_sale_unit * v_qty), '明細売価');
        v_priced := public.pricing_checked_amount(v_priced + v_amount, '区分小計');
        v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'key', v_key, 'mode', v_mode, 'selection_cost', null, 'cost_unit_price', null,
          'sale_unit_price', v_sale_unit, 'amount', v_amount));
      else
        v_section_por := true;
        v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'key', v_key, 'mode', v_mode, 'selection_cost', null, 'cost_unit_price', null,
          'sale_unit_price', null, 'amount', null));
      end if;
    end loop;

    v_expense_target := v_code = any(v_rule.expense_target_sections);
    if v_section_por then
      v_section_subtotal := null;
      v_section_expense := null;
      v_section_total := null;
      v_has_por := true;
    else
      v_section_subtotal := v_priced;
      v_section_expense := case when v_expense_target
                                then public.pricing_checked_amount(pg_catalog.trunc(v_priced * v_expense_rate), '区分経費')
                                else 0 end;
      v_section_total := public.pricing_checked_amount(v_section_subtotal + v_section_expense, '区分合計');
      v_subtotal := public.pricing_checked_amount(v_subtotal + v_section_total, '税別小計');
    end if;

    v_sections := v_sections || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code', v_code,
      'expense_target', v_expense_target,
      'has_por', v_section_por,
      'priced_subtotal', v_priced,
      'subtotal', v_section_subtotal,
      'expense', v_section_expense,
      'total', v_section_total,
      'lines', v_lines));
  end loop;

  if v_has_por then
    return pg_catalog.jsonb_build_object(
      'formula_code', v_rule.formula_code,
      'calc_rule_version_id', v_rule.id,
      'tax_rule_version_id', v_tax.id,
      'has_por', true,
      'subtotal', null,
      'adjustment', v_adjustment,
      'adjusted_subtotal', null,
      'taxable_amount', null,
      'tax', null,
      'total', null,
      'sections', v_sections);
  end if;

  v_adjusted := public.pricing_checked_amount(v_subtotal + v_adjustment, '調整後税別額');
  if v_adjusted < 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 調整後税別額が 0 円未満です';
  end if;
  v_tax_amount := public.pricing_checked_amount(pg_catalog.trunc(v_adjusted * v_tax.tax_rate), '税額');
  v_total := public.pricing_checked_amount(v_adjusted + v_tax_amount, '税込総額');

  return pg_catalog.jsonb_build_object(
    'formula_code', v_rule.formula_code,
    'calc_rule_version_id', v_rule.id,
    'tax_rule_version_id', v_tax.id,
    'has_por', false,
    'subtotal', v_subtotal,
    'adjustment', v_adjustment,
    'adjusted_subtotal', v_adjusted,
    'taxable_amount', v_adjusted,
    'tax', v_tax_amount,
    'total', v_total,
    'sections', v_sections);
end;
$$;

-- ---------- 所有者と実行権限 ----------

alter function public.pricing_rule_version_immutable() owner to postgres;
alter function public.can_view_pricing_rule_versions() owner to postgres;
alter function public.pricing_input_decimal(jsonb, text, integer) owner to postgres;
alter function public.pricing_input_integer(jsonb, text, numeric, numeric, numeric) owner to postgres;
alter function public.pricing_checked_amount(numeric, text) owner to postgres;
alter function public.pricing_calculate(uuid, uuid, jsonb) owner to postgres;

revoke all on function public.pricing_rule_version_immutable() from public, anon, authenticated, service_role;
revoke all on function public.can_view_pricing_rule_versions() from public, anon, authenticated, service_role;
revoke all on function public.pricing_input_decimal(jsonb, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.pricing_input_integer(jsonb, text, numeric, numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function public.pricing_checked_amount(numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.pricing_calculate(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
-- RLS の判定に使うので、ログインした利用者だけが実行できる（結果は真偽だけ）
grant execute on function public.can_view_pricing_rule_versions() to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_table text;
  v_fn record;
begin
  foreach v_table in array array['pricing_calculation_rule_versions', 'tax_rule_versions'] loop
    if not exists (select 1 from pg_class c where c.oid = ('public.' || v_table)::regclass and c.relrowsecurity) then
      raise exception 'POSTCONDITION: % RLS is not enabled', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('service_role', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'POSTCONDITION: anon or service_role retains % privileges', v_table;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'POSTCONDITION: authenticated % ACL is not SELECT-only', v_table;
    end if;
    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal and t.tgenabled <> 'D'
         and t.tgname = v_table || '_immutable'
    ) then
      raise exception 'POSTCONDITION: % immutability trigger is missing', v_table;
    end if;
  end loop;

  if (select count(*) from public.pricing_calculation_rule_versions where superseded_at is null) <> 1
     or (select count(*) from public.tax_rule_versions where superseded_at is null) <> 1 then
    raise exception 'POSTCONDITION: exactly one current calculation rule and tax rule are required';
  end if;

  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('pricing_rule_version_immutable', 'can_view_pricing_rule_versions', 'pricing_input_decimal',
                         'pricing_input_integer', 'pricing_checked_amount', 'pricing_calculate')
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
    if v_fn.proname = 'can_view_pricing_rule_versions' then
      if not v_fn.prosecdef or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'POSTCONDITION: can_view_pricing_rule_versions must be SECURITY DEFINER and executable by authenticated';
      end if;
    else
      if v_fn.prosecdef then
        raise exception 'POSTCONDITION: % must not be SECURITY DEFINER', v_fn.proname;
      end if;
      if has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'POSTCONDITION: internal function % must not be executable by authenticated', v_fn.proname;
      end if;
    end if;
  end loop;
end;
$postcondition$;

commit;
