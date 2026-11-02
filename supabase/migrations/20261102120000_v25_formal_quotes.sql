-- =============================================================
-- v2.5 PR-D1：v2.5 の標準見積から作った見積の第 2 版以降（正式見積）を、サーバーの v2.5 の計算で発行する
-- =============================================================
-- 決まり（2026-11-02 の報告 3-2・3-4 の推奨で作る。先方の回答で変えられる形にする）
-- * 見積に版を固定する：v2.5 の標準見積で作った見積（Web の第 1 版）に、使った標準見積の版・計算ルールの Version・税ルールの Version を入れる。
--   第 2 版以降は親から引き継ぎ、変えない（最新の公開版へ切り替える操作は作らない）
-- * 第 2 版以降の金額はサーバーが作る（画面から来た単価で合計を作らない）：
--   - 前の版の行：前の版の単価のまま（数量は変えられる。本体の行は本部・総代理店だけ）。別途見積（価格未確定）の行だけ、担当者が決めた売価を入れられる
--   - 商品台帳の商品：固定した版の v2.5 の売価（standard_estimate_v25_selection_unit）。担当者は単価を変えない。価格未確定の商品は足せない
--   - 自由明細（工事費など）：担当者が決めた税別の売価（0 円以上の整数）。本体の区分は本部・総代理店だけ
--   - 経費の行：区分の明細の小計 × 版の経費率（計算ルールの経費の対象の区分だけ）。画面からは受け取らない
--   - 明細売価 = trunc(売価単価 × 数量)。調整額（0 以外は理由が必須）、税 = trunc(調整後の税別額 × 税率)。千円未満の切り捨てはしない
-- * 未確定の行は、金額を入れる・0円確定（理由）・対象外・外すのどれかにしてから発行する（#529 の判定と印をそのまま使う）。
--   お客様が選んだ別途見積の商品は、担当者の確認の記録が無ければ発行しない（#529 と同じ）
-- * 新しく足した商品の原価の Version を、社内の記録（quote_item_cost_pins。本部だけが読める）に残す（足した時点の Version）
-- * 旧来の改訂（create_quote_revision）と、承諾済みの概算からの確定（create_formal_quote_from_accepted_preliminary）は、v2.5 の見積では止める
-- * 発行済みの見積・明細は変えない（今のガードのまま）。旧来の見積（pricing_model が無い）は変わらない。Web 以外の案件は今回は対象外
-- * スイッチは入れない。データは変えない（列・表・関数を足し、3 つの関数に目印を確かめて差し込むだけ）
-- =============================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[], text)') is null
     or to_regprocedure('public.standard_estimate_v25_configuration_slot_issue(uuid, uuid)') is null then
    raise exception 'PRECONDITION: v2.5 position slots (20261102100000) must be applied first';
  end if;
  if to_regprocedure('public.write_standard_estimate_quote_items(uuid, uuid)') is null
     or to_regprocedure('public.create_quote_revision(uuid, jsonb, text)') is null
     or to_regprocedure('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)') is null then
    raise exception 'PRECONDITION: quote issuing functions were not found';
  end if;
  if to_regprocedure('public.assert_quote_lines_resolved(uuid)') is null
     or to_regprocedure('public.assert_case_por_selections_confirmed(uuid, uuid)') is null
     or to_regprocedure('public.quote_line_por_marked(uuid, text, text)') is null then
    raise exception 'PRECONDITION: quote formal POR guard (20261016111000) must be applied first';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.quotes'::regclass and attname = 'pricing_model' and not attisdropped
  ) or to_regclass('public.quote_item_cost_pins') is not null then
    raise exception 'PRECONDITION: v2.5 formal quotes already exist';
  end if;
end;
$preflight$;

-- ---------- 見積に固定する版 ----------

alter table public.quotes
  add column pricing_model text,
  add column standard_estimate_revision_id uuid references public.standard_estimate_revisions(id) on delete restrict,
  add column calc_rule_version_id uuid references public.pricing_calculation_rule_versions(id) on delete restrict,
  add column tax_rule_version_id uuid references public.tax_rule_versions(id) on delete restrict;

alter table public.quotes
  add constraint quotes_v25_pins_check check (
    (pricing_model is null and standard_estimate_revision_id is null and calc_rule_version_id is null and tax_rule_version_id is null)
    or (pricing_model = 'v2.5' and standard_estimate_revision_id is not null and calc_rule_version_id is not null and tax_rule_version_id is not null)
  );

create index quotes_standard_estimate_revision_idx
  on public.quotes(standard_estimate_revision_id)
  where standard_estimate_revision_id is not null;

comment on column public.quotes.pricing_model is
  'v2.5 の標準見積で作った見積なら v2.5（第 2 版以降も同じ）。旧来の見積は null。第 2 版以降の発行の計算の決まりを分ける（v2.5 PR-D1）';
comment on column public.quotes.standard_estimate_revision_id is
  'v2.5 の見積に固定した標準見積の版（Web の第 1 版で使った版。第 2 版以降も同じ版の売価・率を使う）';
comment on column public.quotes.calc_rule_version_id is 'v2.5 の見積に固定した計算ルールの Version（標準見積の版のもの）';
comment on column public.quotes.tax_rule_version_id is 'v2.5 の見積に固定した税ルールの Version（標準見積の版のもの）';

-- 固定した版は変えない。Web の第 1 版の発行の中で、未設定から一度だけ入れる（所有者 postgres の関数の中だけ）
create function public.quotes_v25_pin_guard()
returns trigger
language plpgsql
set search_path = ''
as $pin_guard$
begin
  if old.pricing_model is not distinct from new.pricing_model
     and old.standard_estimate_revision_id is not distinct from new.standard_estimate_revision_id
     and old.calc_rule_version_id is not distinct from new.calc_rule_version_id
     and old.tax_rule_version_id is not distinct from new.tax_rule_version_id then
    return new;
  end if;
  if current_user = 'postgres'
     and old.pricing_model is null and old.standard_estimate_revision_id is null
     and old.calc_rule_version_id is null and old.tax_rule_version_id is null
     and old.parent_quote_id is null and old.revision = 1 then
    return new;
  end if;
  raise exception 'QUOTE_LINEAGE_IMMUTABLE: 見積に固定した標準見積の版・計算ルールは変更できません' using errcode = 'P0001';
end;
$pin_guard$;

create trigger quotes_v25_pin_guard
before update of pricing_model, standard_estimate_revision_id, calc_rule_version_id, tax_rule_version_id on public.quotes
for each row execute function public.quotes_v25_pin_guard();

-- ---------- 第 2 版以降で新しく足した商品の原価（社内の記録。本部だけ） ----------

create table public.quote_item_cost_pins (
  quote_item_id uuid primary key references public.quote_items(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  option_id uuid not null references public.options(id) on delete restrict,
  standard_cost_version_id uuid references public.option_standard_cost_versions(id) on delete restrict,
  standard_cost integer,
  variant_cost_versions jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(variant_cost_versions) = 'array'),
  variant_adjustment integer,
  sales_fee_rate numeric(6, 4) not null,
  markup_rate numeric(6, 4) not null,
  created_at timestamptz not null default now()
);

create index quote_item_cost_pins_quote_idx on public.quote_item_cost_pins(quote_id);

comment on table public.quote_item_cost_pins is
  'v2.5 の見積の第 2 版以降で、商品台帳から足した商品の原価の Version（足した時点）と使った率。原価が未設定なら null のまま残す。社内の記録で、本部だけが読める。変えない（v2.5 PR-D1）';

alter table public.quote_item_cost_pins enable row level security;

create policy quote_item_cost_pins_hq_read on public.quote_item_cost_pins
  for select to authenticated
  using (public.current_role_rank() >= 3);

create function public.quote_item_cost_pins_immutable()
returns trigger
language plpgsql
set search_path = ''
as $cost_pins_immutable$
begin
  raise exception 'QUOTE_IMMUTABLE: 発行した見積の原価の記録は変更できません' using errcode = 'P0001';
end;
$cost_pins_immutable$;

create trigger quote_item_cost_pins_immutable
before update on public.quote_item_cost_pins
for each row execute function public.quote_item_cost_pins_immutable();

revoke all on table public.quote_item_cost_pins from public, anon, authenticated, service_role;
grant select on table public.quote_item_cost_pins to authenticated;

-- ---------- 既存の関数に、目印を確かめて差し込む（本体を丸ごと写さない。#529・S1 と同じやり方） ----------

create function pg_temp.d1_patch_function(p_target regprocedure, p_old text, p_new text)
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

-- Web の第 1 版：使った標準見積の版・計算ルール・税ルールの Version を見積に固定する
select pg_temp.d1_patch_function(
  'public.write_standard_estimate_quote_items(uuid, uuid)'::regprocedure,
  $old$  v_view := public.standard_estimate_v25_sale_view(v_revision, false);$old$,
  $new$  -- 見積に、使った標準見積の版・計算ルール・税ルールの Version を固定する（第 2 版以降もこの版で計算する。v2.5 PR-D1）
  update public.quotes q
     set pricing_model = 'v2.5',
         standard_estimate_revision_id = r.id,
         calc_rule_version_id = r.calc_rule_version_id,
         tax_rule_version_id = r.tax_rule_version_id
    from public.standard_estimate_revisions r
   where q.id = p_quote_id and r.id = v_revision;
  v_view := public.standard_estimate_v25_sale_view(v_revision, false);$new$
);

-- 旧来の改訂：v2.5 の見積は v2.5 の決まりの発行で改訂する
select pg_temp.d1_patch_function(
  'public.create_quote_revision(uuid, jsonb, text)'::regprocedure,
  $old$  if parent.status <> 'issued' then
    raise exception 'LOCKED: 改訂できるのは発行中（issued）の見積だけです' using errcode = 'P0001';
  end if;$old$,
  $new$  if parent.status <> 'issued' then
    raise exception 'LOCKED: 改訂できるのは発行中（issued）の見積だけです' using errcode = 'P0001';
  end if;

  -- v2.5 の標準見積から作った見積は、v2.5 の決まりの発行（create_quote_revision_v25）で改訂する（v2.5 PR-D1）
  if parent.pricing_model = 'v2.5' then
    raise exception 'LOCKED: v2.5 の標準見積から作った見積は、見積の編集画面（v2.5）から発行してください' using errcode = 'P0001';
  end if;$new$
);

-- 承諾済みの概算からの確定：v2.5 の見積は対象にしない（v2.5 の第 1 版は承諾できないので、通常は来ない）
select pg_temp.d1_patch_function(
  'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure,
  $old$  if req.quote_id is distinct from parent.id then
    raise exception 'LOCKED: この概算見積は現在の見積ではありません' using errcode = 'P0001';
  end if;$old$,
  $new$  if req.quote_id is distinct from parent.id then
    raise exception 'LOCKED: この概算見積は現在の見積ではありません' using errcode = 'P0001';
  end if;

  -- v2.5 の標準見積から作った見積は、v2.5 の決まりの発行（create_quote_revision_v25）で扱う（v2.5 PR-D1）
  if parent.pricing_model = 'v2.5' then
    raise exception 'LOCKED: v2.5 の標準見積から作った見積は、見積の編集画面（v2.5）から発行してください' using errcode = 'P0001';
  end if;$new$
);

drop function pg_temp.d1_patch_function(regprocedure, text, text);

-- ---------- v2.5 の見積の編集画面に渡す値（売価・経費率・税率だけ。原価・販売費率・掛率は渡さない） ----------

-- 本部はすべて、代理店・総代理店は担当の案件だけ。v2.5 の見積でなければ NOT_FOUND（見積の有無を権限の無い人に返さない）
create function public.quote_v25_editable(p_quote_id uuid)
returns public.quotes
language plpgsql
stable
security definer
set search_path = ''
as $editable$
declare
  v_uid uuid := auth.uid();
  v_rank integer := coalesce(public.current_role_rank(), 0);
  q public.quotes;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote_id;
  if not found or not (v_rank >= 3 or (v_rank >= 1 and coalesce(q.dealer_id = v_uid, false))) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if q.pricing_model is distinct from 'v2.5' then
    raise exception 'NOT_FOUND: v2.5 の標準見積から作った見積ではありません' using errcode = 'P0002';
  end if;
  return q;
end;
$editable$;

create function public.get_quote_v25_context(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $context$
declare
  q public.quotes;
  rev public.standard_estimate_revisions;
  rule public.pricing_calculation_rule_versions;
  tax public.tax_rule_versions;
  v_master record;
begin
  q := public.quote_v25_editable(p_quote_id);
  select * into rev from public.standard_estimate_revisions where id = q.standard_estimate_revision_id;
  select * into rule from public.pricing_calculation_rule_versions where id = q.calc_rule_version_id;
  select * into tax from public.tax_rule_versions where id = q.tax_rule_version_id;
  select m.base_model_id, m.spec_code, bm.slug as model_slug into v_master
    from public.standard_estimate_masters m join public.base_models bm on bm.id = m.base_model_id
   where m.id = rev.standard_estimate_master_id;
  return pg_catalog.jsonb_build_object(
    'revision_id', rev.id,
    'revision_version', rev.version,
    'base_model_id', v_master.base_model_id,
    'model_slug', v_master.model_slug,
    'spec_code', v_master.spec_code,
    'expense_rate', rev.expense_rate::text,
    'expense_sections', pg_catalog.to_jsonb(rule.expense_target_sections),
    'tax_rate', rev.tax_rate::text,
    'standard_adjustment_reason', rev.standard_adjustment_reason
  );
end;
$context$;

comment on function public.get_quote_v25_context(uuid) is
  'v2.5 の見積の編集画面に渡す値（固定した版の経費率・経費の対象の区分・税率・商品モデルと仕様）。原価・販売費率・掛率は返さない。本部と担当の代理店・総代理店だけ（v2.5 PR-D1）';

-- p_items：[{ option_id, choice_ids: [選択肢] }]（300 件まで）。結果は同じ順の売価単価の配列（価格未確定は null）
create function public.get_quote_v25_units(p_quote_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $units$
declare
  q public.quotes;
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  q := public.quote_v25_editable(p_quote_id);
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' or pg_catalog.jsonb_array_length(p_items) > 300 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 商品の指定が正しくありません（300 件まで）';
  end if;
  for v_item in select e.value from pg_catalog.jsonb_array_elements(p_items) as e(value) loop
    if pg_catalog.jsonb_typeof(v_item -> 'choice_ids') is distinct from 'array' or pg_catalog.jsonb_array_length(v_item -> 'choice_ids') > 30 then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 選択肢の指定が正しくありません（30 件まで）';
    end if;
    begin
      v_out := v_out || pg_catalog.jsonb_build_array(public.standard_estimate_v25_selection_unit(
        q.standard_estimate_revision_id,
        (v_item ->> 'option_id')::uuid,
        array(select c.value::uuid from pg_catalog.jsonb_array_elements_text(v_item -> 'choice_ids') as c(value)),
        null));
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 商品・選択肢の指定が正しくありません';
    end;
  end loop;
  return v_out;
end;
$units$;

comment on function public.get_quote_v25_units(uuid, jsonb) is
  'v2.5 の見積の編集画面で、商品台帳の「商品＋選択肢」の売価単価を、見積に固定した版で返す（価格未確定は null。原価は返さない）。本部と担当の代理店・総代理店だけ（v2.5 PR-D1）';

-- ---------- 第 2 版以降の発行（v2.5 の見積） ----------

-- p_lines：画面の行（区分ごとに、この並びで明細にする）
--   { "source": "parent", "parent_item_id": 前の版の明細の id, "quantity": 数量（省略は前の版のまま）,
--     "unit_price": 売価（前の版で別途見積の行だけ）, "state": null | "zero_confirmed" | "excluded", "state_reason": 理由・メモ }
--   { "source": "catalog", "section": "interior_exterior" | "option" | "sitework", "option_id": 商品, "variant_choice_ids": [選択肢], "quantity": 数量 }
--   { "source": "manual", "section": "base" | "interior_exterior" | "option" | "sitework", "name", "description", "unit", "quantity",
--     "unit_price": 税別の売価（0 以上の整数）, "remark", "state", "state_reason" }
-- 経費の行は受け取らず、区分の小計から作る。前の版の経費の行は指定できない
create function public.create_quote_revision_v25(
  p_quote_id uuid,
  p_lines jsonb,
  p_adjustment integer,
  p_adjustment_reason text,
  p_dealer_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $revision_v25$
declare
  v_uid uuid := auth.uid();
  v_rank integer := coalesce(public.current_role_rank(), 0);
  parent public.quotes;
  req public.quote_requests;
  rev public.standard_estimate_revisions;
  rule public.pricing_calculation_rule_versions;
  tax public.tax_rule_versions;
  v_master record;
  v_can_edit_base boolean;
  v_line jsonb;
  v_index integer := 0;
  v_source text;
  v_section text;
  v_kind text;
  v_parent_item public.quote_items;
  v_seen_parent uuid[] := '{}'::uuid[];
  v_option public.options;
  v_category public.option_categories;
  v_choices uuid[];
  v_qty numeric;
  v_unit integer;
  v_amount numeric;
  v_name text;
  v_description text;
  v_unit_label text;
  v_remark text;
  v_state text;
  v_reason text;
  v_image text;
  v_por boolean;
  v_rows jsonb := '[]'::jsonb;
  v_section_codes constant text[] := array['base', 'interior_exterior', 'option', 'sitework'];
  v_line_totals numeric[] := array[0, 0, 0, 0];
  v_expenses numeric[] := array[0, 0, 0, 0];
  v_pos integer;
  v_raw numeric := 0;
  v_subtotal numeric;
  v_tax numeric;
  v_adjustment integer := coalesce(p_adjustment, 0);
  v_adjustment_reason text := nullif(pg_catalog.btrim(coalesce(p_adjustment_reason, '')), '');
  v_new uuid;
  v_item_id uuid;
  v_sort integer;
  v_rate_label text;
  v_row jsonb;
  v_std_version uuid;
  v_std_cost integer;
  v_variant_versions jsonb;
  v_variant_adjustment integer;
  v_baseline_id uuid;
  v_pin jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- 見積を先に、次に見積依頼をロックする（今の発行の関数と同じ順）
  select * into parent from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 担当の権限は、状態の判定より前に確かめる（本部はすべて、代理店・総代理店は担当の案件だけ）
  if not (v_rank >= 3 or (v_rank >= 1 and coalesce(parent.dealer_id = v_uid, false))) then
    raise exception 'FORBIDDEN: この見積を編集できる権限がありません' using errcode = '42501';
  end if;
  if parent.pricing_model is distinct from 'v2.5' then
    raise exception 'LOCKED: v2.5 の標準見積から作った見積ではありません（これまでの見積の編集で発行してください）' using errcode = 'P0001';
  end if;
  if parent.status <> 'issued' then
    raise exception 'LOCKED: 改訂できるのは発行中（issued）の見積だけです' using errcode = 'P0001';
  end if;
  if parent.configuration_id is null then
    raise exception 'LOCKED: Web 以外の案件は、見積の下書きから発行してください' using errcode = 'P0001';
  end if;
  select * into req from public.quote_requests where id = parent.quote_request_id for update;
  if not found or req.quote_id is distinct from parent.id then
    raise exception 'LOCKED: 最新の版から改訂してください' using errcode = 'P0001';
  end if;

  select * into rev from public.standard_estimate_revisions where id = parent.standard_estimate_revision_id;
  select * into rule from public.pricing_calculation_rule_versions where id = parent.calc_rule_version_id;
  select * into tax from public.tax_rule_versions where id = parent.tax_rule_version_id;
  if rev.id is null or rule.id is null or tax.id is null or rev.pricing_model is distinct from 'v2.5' then
    raise exception 'VALIDATION: 見積に固定した標準見積の版・計算ルールが見つかりません' using errcode = 'P0001';
  end if;
  if rule.formula_code <> 'v2.5' or rule.rounding_mode <> 'trunc' or tax.tax_mode <> 'full_single_rate' or tax.rounding_mode <> 'trunc' then
    raise exception 'VALIDATION: 見積に固定した計算ルール・税ルールには対応していません' using errcode = 'P0001';
  end if;
  -- 別途工事は経費を掛けない（2026-10-19 の確定方針）。経費の行を区分の種類で見分けるため、別途工事の経費は扱わない
  if 'sitework' = any(rule.expense_target_sections) then
    raise exception 'VALIDATION: 別途工事に経費を掛ける計算ルールには対応していません' using errcode = 'P0001';
  end if;
  select m.base_model_id, m.spec_code, bm.slug as model_slug into v_master
    from public.standard_estimate_masters m join public.base_models bm on bm.id = m.base_model_id
   where m.id = rev.standard_estimate_master_id;

  v_can_edit_base := v_rank >= 2;
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines) <> 'array' then
    raise exception 'VALIDATION: 明細の形式が正しくありません' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(p_lines) > 300 then
    raise exception 'VALIDATION: 明細は 300 行までです' using errcode = 'P0001';
  end if;
  -- 調整額：0 以外は理由が必須（前の版の調整額のままなら、前の版・標準見積の理由を引き継ぐ）
  if v_adjustment <> 0 and v_adjustment_reason is null then
    if v_adjustment = parent.adjustment then
      v_adjustment_reason := coalesce(parent.adjustment_reason, nullif(pg_catalog.btrim(coalesce(rev.standard_adjustment_reason, '')), ''), '標準見積の調整額');
    else
      raise exception 'VALIDATION: 調整額を入れる場合は理由を入力してください' using errcode = 'P0001';
    end if;
  end if;
  if pg_catalog.length(coalesce(v_adjustment_reason, '')) > 500 then
    raise exception 'VALIDATION: 調整額の理由は 500 文字以内で入力してください' using errcode = 'P0001';
  end if;
  if pg_catalog.length(coalesce(p_dealer_note, '')) > 1000 then
    raise exception 'VALIDATION: 申し送りは 1000 文字以内で入力してください' using errcode = 'P0001';
  end if;

  -- 代理店（本体を変えられない）は、前の版の本体の行をそのまま写す（画面から来た本体の行は使わない）
  if not v_can_edit_base then
    for v_parent_item in
      select * from public.quote_items i where i.quote_id = parent.id and i.kind = 'base' order by i.sort_order, i.id
    loop
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'section', 'base', 'kind', 'base', 'source', 'parent', 'parent_item_id', v_parent_item.id,
        'name', v_parent_item.name, 'description', v_parent_item.description, 'unit', v_parent_item.unit,
        'remark', v_parent_item.remark, 'unit_price', v_parent_item.unit_price, 'quantity', v_parent_item.quantity,
        'amount', v_parent_item.amount, 'image_url', v_parent_item.image_url, 'option_id', v_parent_item.option_id,
        'line_key', v_parent_item.line_key));
      v_line_totals[1] := v_line_totals[1] + v_parent_item.amount;
      v_seen_parent := v_seen_parent || v_parent_item.id;
    end loop;
    v_parent_item := null;
  end if;

  for v_line in select value from pg_catalog.jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;
    v_parent_item := null;
    v_option := null;
    v_choices := '{}'::uuid[];
    v_pin := null;
    if pg_catalog.jsonb_typeof(v_line) <> 'object' then
      raise exception 'VALIDATION: % 行目の形式が正しくありません', v_index using errcode = 'P0001';
    end if;
    v_source := v_line ->> 'source';
    v_state := nullif(v_line ->> 'state', '');
    v_reason := nullif(pg_catalog.btrim(coalesce(v_line ->> 'state_reason', '')), '');
    if v_state is not null and v_state not in ('zero_confirmed', 'excluded') then
      raise exception 'VALIDATION: % 行目の状態の指定が正しくありません', v_index using errcode = 'P0001';
    end if;
    if pg_catalog.length(coalesce(v_reason, '')) > 190 then
      raise exception 'VALIDATION: % 行目の理由・メモは 190 文字以内で入力してください', v_index using errcode = 'P0001';
    end if;
    if v_state = 'zero_confirmed' and v_reason is null then
      raise exception 'VALIDATION: % 行目：0円確定の明細は理由を入力してください', v_index using errcode = 'P0001';
    end if;
    -- 数量：0 より大きく 99999 以下・小数 4 桁まで（省略は前の版のまま／1）
    begin
      v_qty := case when pg_catalog.jsonb_typeof(v_line -> 'quantity') in ('number', 'string') then (v_line ->> 'quantity')::numeric end;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: % 行目の数量が正しくありません', v_index using errcode = 'P0001';
    end;
    if v_qty is not null and (v_qty <= 0 or v_qty > 99999 or v_qty <> pg_catalog.round(v_qty, 4)) then
      raise exception 'VALIDATION: % 行目の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください', v_index using errcode = 'P0001';
    end if;

    if v_source = 'parent' then
      begin
        select * into v_parent_item from public.quote_items i
         where i.id = (v_line ->> 'parent_item_id')::uuid and i.quote_id = parent.id;
      exception when invalid_text_representation then
        raise exception 'VALIDATION: % 行目の前の版の明細の指定が正しくありません', v_index using errcode = 'P0001';
      end;
      if v_parent_item.id is null then
        raise exception 'VALIDATION: % 行目：前の版の明細が見つかりません', v_index using errcode = 'P0001';
      end if;
      if v_parent_item.kind = 'base' and not v_can_edit_base then
        -- 代理店の本体の行は、上で前の版のまま写した
        continue;
      end if;
      if v_parent_item.id = any(v_seen_parent) then
        raise exception 'VALIDATION: % 行目：前の版の同じ明細が重複しています', v_index using errcode = 'P0001';
      end if;
      if v_parent_item.kind in ('base_expense', 'interior_exterior_expense', 'option_expense') then
        raise exception 'VALIDATION: % 行目：経費の行は区分の小計から作り直すため、指定できません', v_index using errcode = 'P0001';
      end if;
      v_seen_parent := v_seen_parent || v_parent_item.id;
      v_kind := v_parent_item.kind;
      v_section := case v_kind when 'base' then 'base' when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'sitework' end;
      v_unit := v_parent_item.unit_price;
      v_por := coalesce(v_parent_item.unit_price, 0) = 0
               and public.quote_line_por_marked(v_parent_item.option_id, v_parent_item.description, v_parent_item.remark);
      -- 単価は前の版のまま。別途見積（価格未確定）の行だけ、担当者が決めた売価を入れられる
      if pg_catalog.jsonb_typeof(v_line -> 'unit_price') in ('number', 'string') then
        if not v_por then
          raise exception 'VALIDATION: % 行目：前の版の明細の単価は変えられません（調整額か自由明細で調整してください）', v_index using errcode = 'P0001';
        end if;
        begin
          v_unit := (v_line ->> 'unit_price')::integer;
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'VALIDATION: % 行目の売価が正しくありません', v_index using errcode = 'P0001';
        end;
        if v_unit < 1 or v_unit > 100000000 then
          raise exception 'VALIDATION: % 行目の売価は 1 以上 100000000 以下の整数で入力してください（0 円にするときは「0円確定」を選んでください）', v_index using errcode = 'P0001';
        end if;
        -- 第 1 版の「価格未確定の商品」（選んだ商品のうち価格が未確定のものの集約の行）には金額を入れない
        if pg_catalog.strpos(coalesce(v_parent_item.description, ''), '合計に含めていません') > 0 then
          raise exception 'VALIDATION: % 行目：「%」の行には金額を入れられません。商品ごとの明細を足し、この行は「0円確定」か「対象外」にするか外してください', v_index, v_parent_item.name using errcode = 'P0001';
        end if;
      end if;
      -- 選択商品の変更差額の行は、数量を変えない（区分の差額をそのまま写す）
      if v_qty is not null and v_qty <> v_parent_item.quantity and pg_catalog.btrim(v_parent_item.name) = '選択商品の変更差額' then
        raise exception 'VALIDATION: % 行目：選択商品の変更差額の数量は変えられません', v_index using errcode = 'P0001';
      end if;
      v_qty := coalesce(v_qty, v_parent_item.quantity);
      v_name := v_parent_item.name;
      v_description := v_parent_item.description;
      v_unit_label := v_parent_item.unit;
      v_remark := v_parent_item.remark;
      v_image := v_parent_item.image_url;
      -- 商品台帳の紐付けは引き継ぐ（販売停止・廃番の商品の行は、明細のトリガーが発行を止める）
      v_option.id := v_parent_item.option_id;
      -- 別途見積の行に売価を入れたら、未確定の目印（備考・説明）を外す
      if v_por and v_unit <> 0 then
        v_remark := null;
        if pg_catalog.btrim(coalesce(v_description, '')) = '設置場所確認後に別途お見積り' then
          v_description := null;
        end if;
      end if;
    elsif v_source = 'catalog' then
      v_section := v_line ->> 'section';
      if v_section is null or v_section not in ('interior_exterior', 'option', 'sitework') then
        raise exception 'VALIDATION: % 行目：商品台帳の商品は、内外装・オプション・別途工事の区分に足してください', v_index using errcode = 'P0001';
      end if;
      if v_state is not null then
        raise exception 'VALIDATION: % 行目：商品台帳の商品には状態を付けられません（外すときは行を削除してください）', v_index using errcode = 'P0001';
      end if;
      begin
        select * into v_option from public.options o where o.id = (v_line ->> 'option_id')::uuid;
        v_choices := coalesce(array(
          select x.value::uuid from pg_catalog.jsonb_array_elements_text(coalesce(v_line -> 'variant_choice_ids', '[]'::jsonb)) x(value)
           order by x.value::uuid), '{}'::uuid[]);
      exception when invalid_text_representation then
        raise exception 'VALIDATION: % 行目の商品・選択肢の指定が正しくありません', v_index using errcode = 'P0001';
      end;
      if v_option.id is null then
        raise exception 'VALIDATION: % 行目：商品が見つかりません', v_index using errcode = 'P0001';
      end if;
      select * into v_category from public.option_categories c where c.id = v_option.category_id;
      -- 新しく選べる商品だけ（公開中・販売中・この商品モデルと仕様で選べる）。販売停止・廃番は明細のトリガーでも止める
      if v_option.status <> 'published'
         or public.product_lifecycle_state(v_option.status, v_option.archived_at) = 'retired'
         or (v_option.base_model_id is not null and v_option.base_model_id is distinct from v_master.base_model_id)
         or not public.customer_product_spec_selectable(v_master.model_slug, v_master.spec_code, v_option.spec_codes) then
        raise exception 'VALIDATION: % 行目：「%」は、この見積の商品モデル・仕様で選べない商品です', v_index, v_option.name using errcode = 'P0001';
      end if;
      if pg_catalog.cardinality(v_choices) <> (select count(distinct x) from unnest(v_choices) x) then
        raise exception 'VALIDATION: % 行目の選択肢が重複しています', v_index using errcode = 'P0001';
      end if;
      -- 選択肢はその商品の公開中の選択肢だけ・同じ選択項目から 1 つ
      if exists (
        select 1 from unnest(v_choices) c(id)
          left join public.option_variant_choices vc on vc.id = c.id
          left join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id is null or vc.status <> 'published' or vg.status <> 'published' or vg.option_id <> v_option.id
      ) or exists (
        select 1 from public.option_variant_choices vc where vc.id = any(v_choices) group by vc.group_id having count(*) > 1
      ) then
        raise exception 'VALIDATION: % 行目の選択肢が正しくありません', v_index using errcode = 'P0001';
      end if;
      -- 表示条件を満たさない選択項目の選択肢は選べない（save_configuration_atomic と同じ決まり）
      if exists (
        select 1
          from unnest(v_choices) input(choice_id)
          join public.option_variant_choices vc on vc.id = input.choice_id
          join public.option_variant_groups vg on vg.id = vc.group_id
         where vg.depends_on_group_code is not null
           and pg_catalog.cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) > 0
           and exists (
             select 1 from public.option_variant_groups dependency_group
              where dependency_group.option_id = vg.option_id and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published')
           and not exists (
             select 1
               from public.option_variant_choices dependency_choice
               join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
              where dependency_choice.id = any(v_choices)
                and dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
                and dependency_choice.code = any(vg.depends_on_choice_codes))
      ) then
        raise exception 'VALIDATION: % 行目：表示されない仕様の選択肢は選べません', v_index using errcode = 'P0001';
      end if;
      -- 表示される必須の選択項目は、選択肢を 1 つ選ぶ（必須の仕様が抜けたまま安い単価で発行しない）
      if exists (
        select 1
          from public.option_variant_groups vg
         where vg.option_id = v_option.id
           and vg.status = 'published'
           and vg.is_required
           and exists (select 1 from public.option_variant_choices c where c.group_id = vg.id and c.status = 'published')
           and (
             vg.depends_on_group_code is null
             or pg_catalog.cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) = 0
             or not exists (
               select 1 from public.option_variant_groups dependency_group
                where dependency_group.option_id = vg.option_id and dependency_group.code = vg.depends_on_group_code
                  and dependency_group.status = 'published')
             or exists (
               select 1
                 from public.option_variant_choices dependency_choice
                 join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
                where dependency_choice.id = any(v_choices)
                  and dependency_group.option_id = vg.option_id
                  and dependency_group.code = vg.depends_on_group_code
                  and dependency_group.status = 'published'
                  and dependency_choice.code = any(vg.depends_on_choice_codes))
           )
           and not exists (select 1 from public.option_variant_choices selected where selected.id = any(v_choices) and selected.group_id = vg.id)
      ) then
        raise exception 'VALIDATION: % 行目：「%」の必須の仕様を選んでください', v_index, v_option.name using errcode = 'P0001';
      end if;
      -- 区分は商品のカテゴリーで決まる（DB の estimate_section_for_option と同じ）
      if public.estimate_section_for_option(v_category.code, v_option.is_installation) <> v_section then
        raise exception 'VALIDATION: % 行目：「%」は「%」の区分の商品です', v_index, v_option.name,
          case public.estimate_section_for_option(v_category.code, v_option.is_installation)
            when 'interior_exterior' then '内外装工事' when 'option' then 'オプション' else '別途工事' end
          using errcode = 'P0001';
      end if;
      v_unit := public.standard_estimate_v25_selection_unit(rev.id, v_option.id, v_choices, null);
      if v_unit is null then
        raise exception 'VALIDATION: % 行目：「%」は価格が未確定です。自由明細で金額を入れてください', v_index, v_option.name using errcode = 'P0001';
      end if;
      -- 原価の記録：版の選択枠（カテゴリー単位）と同じ「商品＋選択肢」なら、売価の元の版に固定した原価。ほかは今の原価 Version
      v_baseline_id := null;
      select bi.id into v_baseline_id
        from public.standard_estimate_revision_baseline_items bi
       where bi.revision_id = rev.id and bi.slot_code is null and bi.option_id = v_option.id
         and coalesce((select array_agg(bv.variant_choice_id order by bv.variant_choice_id)
                         from public.standard_estimate_revision_baseline_variants bv where bv.baseline_item_id = bi.id), '{}'::uuid[]) = v_choices
       limit 1;
      v_std_version := null;
      v_std_cost := null;
      if v_baseline_id is not null then
        select bi.standard_cost_version_id, cv.standard_cost into v_std_version, v_std_cost
          from public.standard_estimate_revision_baseline_items bi
          left join public.option_standard_cost_versions cv on cv.id = bi.standard_cost_version_id
         where bi.id = v_baseline_id;
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'variant_choice_id', bv.variant_choice_id, 'version_id', bv.variant_cost_version_id, 'cost_adjustment', bv.cost_adjustment_snapshot)
                 order by bv.variant_choice_id), '[]'::jsonb),
               case when count(*) = count(bv.variant_cost_version_id) then coalesce(sum(bv.cost_adjustment_snapshot), 0)::integer end
          into v_variant_versions, v_variant_adjustment
          from public.standard_estimate_revision_baseline_variants bv
         where bv.baseline_item_id = v_baseline_id;
      else
        select cv.id, cv.standard_cost into v_std_version, v_std_cost
          from public.option_standard_cost_versions cv
         where cv.option_id = v_option.id and cv.superseded_at is null;
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'variant_choice_id', c.id, 'version_id', vv.id, 'cost_adjustment', vv.cost_adjustment) order by c.id), '[]'::jsonb),
               case when count(*) = count(vv.id) then coalesce(sum(vv.cost_adjustment), 0)::integer end
          into v_variant_versions, v_variant_adjustment
          from unnest(v_choices) c(id)
          left join public.option_variant_cost_versions vv on vv.variant_choice_id = c.id and vv.superseded_at is null;
      end if;
      v_pin := pg_catalog.jsonb_build_object('std_version', v_std_version, 'std_cost', v_std_cost,
                                             'variants', v_variant_versions, 'variant_adjustment', v_variant_adjustment);
      v_qty := coalesce(v_qty, 1);
      v_kind := case v_section when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'installation' end;
      v_name := v_option.name || coalesce(' ／ ' || (
        select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order)
          from public.option_variant_choices vc join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id = any(v_choices)), '');
      v_description := v_category.name;
      v_unit_label := '式';
      v_remark := nullif(pg_catalog.concat_ws(' ／ ', nullif(v_option.manufacturer, ''), nullif(v_option.model_no, '')), '');
      v_image := v_option.image_url;
    elsif v_source = 'manual' then
      v_section := v_line ->> 'section';
      if v_section is null or not (v_section = any(v_section_codes)) then
        raise exception 'VALIDATION: % 行目の区分が正しくありません', v_index using errcode = 'P0001';
      end if;
      if v_section = 'base' and not v_can_edit_base then
        raise exception 'FORBIDDEN: 本体を編集できるのは総代理店・本部だけです' using errcode = '42501';
      end if;
      v_name := nullif(pg_catalog.btrim(coalesce(v_line ->> 'name', '')), '');
      if v_name is null or pg_catalog.length(v_name) > 120 then
        raise exception 'VALIDATION: % 行目の品名は 1〜120 文字で入力してください', v_index using errcode = 'P0001';
      end if;
      v_description := nullif(pg_catalog.btrim(coalesce(v_line ->> 'description', '')), '');
      v_unit_label := coalesce(nullif(pg_catalog.btrim(coalesce(v_line ->> 'unit', '')), ''), '式');
      v_remark := nullif(pg_catalog.btrim(coalesce(v_line ->> 'remark', '')), '');
      if pg_catalog.length(coalesce(v_description, '')) > 200 or pg_catalog.length(v_unit_label) > 40 or pg_catalog.length(coalesce(v_remark, '')) > 200 then
        raise exception 'VALIDATION: % 行目の説明・単位・備考が長すぎます', v_index using errcode = 'P0001';
      end if;
      begin
        v_unit := coalesce((v_line ->> 'unit_price')::integer, 0);
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'VALIDATION: % 行目の売価が正しくありません', v_index using errcode = 'P0001';
      end;
      if v_unit < 0 or v_unit > 100000000 then
        raise exception 'VALIDATION: % 行目の売価は 0 以上 100000000 以下の整数で入力してください', v_index using errcode = 'P0001';
      end if;
      v_qty := coalesce(v_qty, 1);
      v_kind := case v_section when 'base' then 'base' when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'installation' end;
      v_image := null;
    else
      raise exception 'VALIDATION: % 行目の種類が正しくありません', v_index using errcode = 'P0001';
    end if;

    -- 状態（0円確定・対象外）：#529 と同じ印を備考に付け、0 円にする（本体・経費の行には付けられない。DB のトリガーでも止める）
    if v_state is not null then
      if v_kind not in ('interior_exterior', 'option', 'installation', 'free') then
        raise exception 'VALIDATION: % 行目：「0円確定」「対象外」は本体の明細には使えません', v_index using errcode = 'P0001';
      end if;
      v_unit := 0;
      v_remark := case v_state when 'zero_confirmed' then '［0円確定］：' || v_reason else '［今回の契約対象外］' || coalesce(v_reason, '') end;
    elsif v_source <> 'parent' and (coalesce(v_remark, '') like '［今回の契約対象外］%' or coalesce(v_remark, '') like '［0円確定］%') then
      raise exception 'VALIDATION: % 行目：「0円確定」「対象外」は状態の選択から付けてください', v_index using errcode = 'P0001';
    end if;

    v_amount := pg_catalog.trunc(v_unit::numeric * v_qty);
    -- 前の版の行は、単価・数量・状態を変えなければ前の版の金額のまま
    if v_source = 'parent' and v_unit = v_parent_item.unit_price and v_qty = v_parent_item.quantity and v_state is null then
      v_amount := v_parent_item.amount;
    end if;
    if v_amount < -100000000000 or v_amount > 100000000000 then
      raise exception 'VALIDATION: % 行目の金額が大きすぎます', v_index using errcode = 'P0001';
    end if;
    v_pos := pg_catalog.array_position(v_section_codes, v_section);
    v_line_totals[v_pos] := v_line_totals[v_pos] + v_amount;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'section', v_section, 'kind', v_kind, 'source', v_source,
      'name', v_name, 'description', v_description, 'unit', v_unit_label, 'remark', v_remark,
      'unit_price', v_unit, 'quantity', v_qty, 'amount', v_amount, 'image_url', v_image,
      'option_id', v_option.id, 'variant_choice_ids', pg_catalog.to_jsonb(v_choices),
      'parent_item_id', v_parent_item.id, 'pin', v_pin,
      'line_key', case when v_source = 'parent' then v_parent_item.line_key end));
  end loop;

  -- 経費：区分の明細の小計 × 版の経費率（計算ルールの経費の対象の区分だけ。0 方向に切り捨て）
  foreach v_section in array v_section_codes loop
    v_pos := pg_catalog.array_position(v_section_codes, v_section);
    if v_section = any(rule.expense_target_sections) then
      v_expenses[v_pos] := pg_catalog.trunc(v_line_totals[v_pos] * rev.expense_rate);
    end if;
    v_raw := v_raw + v_line_totals[v_pos] + v_expenses[v_pos];
  end loop;
  v_subtotal := v_raw + v_adjustment;
  if v_subtotal < 0 then
    raise exception 'VALIDATION: 調整後の税別額が 0 円未満です' using errcode = 'P0001';
  end if;
  -- 税は第 1 版と同じく版の税率（版を作ったときの税ルールの Version の率）
  v_tax := pg_catalog.trunc(v_subtotal * rev.tax_rate);
  if v_subtotal + v_tax > 2147483647 or v_raw > 2147483647
     or exists (select 1 from unnest(v_line_totals || v_expenses) x where x < -2147483648 or x > 2147483647) then
    raise exception 'VALIDATION: 見積金額が保存できる範囲を超えています' using errcode = 'P0001';
  end if;

  insert into public.quotes(
    quote_no, quote_request_id, configuration_id, user_id, status, quote_kind,
    base_model_id, base_master_revision_id, spec_code,
    issued_at, valid_until, customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment, adjustment_reason,
    subtotal, tax_rate, tax, total, preview_image_url, notes, dealer_id, dealer_note, revision, parent_quote_id, created_by,
    pricing_model, standard_estimate_revision_id, calc_rule_version_id, tax_rule_version_id
  )
  values(
    parent.quote_no || '-' || (parent.revision + 1), parent.quote_request_id, parent.configuration_id, parent.user_id, 'issued', 'formal',
    v_master.base_model_id, rev.base_master_revision_id, v_master.spec_code,
    now(), now() + interval '30 days', parent.customer_no, parent.customer_name, parent.customer_company, parent.base_model_name, parent.finish_level,
    v_line_totals[1], v_expenses[1], v_line_totals[2] + v_line_totals[3], v_expenses[2] + v_expenses[3], v_line_totals[4] + v_expenses[4],
    v_adjustment, v_adjustment_reason,
    v_subtotal, rev.tax_rate, v_tax, v_subtotal + v_tax, parent.preview_image_url,
    '本見積書は標準見積を基に、担当者が案件内容を反映して作成した確定見積です。',
    coalesce(parent.dealer_id, case when v_rank = 1 then v_uid end),
    nullif(pg_catalog.btrim(coalesce(p_dealer_note, '')), ''), parent.revision + 1, parent.id, v_uid,
    'v2.5', rev.id, rule.id, tax.id
  )
  returning id into v_new;

  -- 明細：区分ごとに画面の並びのまま。経費の行は区分の最後（第 1 版と同じ並び）
  v_rate_label := pg_catalog.rtrim(pg_catalog.to_char(rev.expense_rate * 100, 'FM990.99'), '.');
  foreach v_section in array v_section_codes loop
    v_pos := pg_catalog.array_position(v_section_codes, v_section);
    v_sort := case v_section when 'base' then 0 when 'interior_exterior' then 1000 when 'option' then 2000 else 3000 end;
    for v_row in select r.value from pg_catalog.jsonb_array_elements(v_rows) with ordinality as r(value, ord) where r.value ->> 'section' = v_section order by r.ord
    loop
      v_sort := v_sort + 1;
      insert into public.quote_items (
        quote_id, line_key, kind, option_id, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order
      )
      values (
        v_new, coalesce((v_row ->> 'line_key')::uuid, gen_random_uuid()), v_row ->> 'kind', (v_row ->> 'option_id')::uuid,
        v_row ->> 'name', v_row ->> 'description', v_row ->> 'unit', v_row ->> 'remark',
        (v_row ->> 'unit_price')::integer, (v_row ->> 'quantity')::numeric, (v_row ->> 'amount')::numeric::integer, v_row ->> 'image_url', v_sort
      )
      returning id into v_item_id;
      -- 新しく足した商品の原価の Version（足した時点）を社内の記録に残す（原価が未設定なら null のまま）
      if v_row ->> 'source' = 'catalog' then
        insert into public.quote_item_cost_pins (
          quote_item_id, quote_id, option_id, standard_cost_version_id, standard_cost, variant_cost_versions, variant_adjustment,
          sales_fee_rate, markup_rate
        )
        values (
          v_item_id, v_new, (v_row ->> 'option_id')::uuid, (v_row #>> '{pin,std_version}')::uuid, (v_row #>> '{pin,std_cost}')::integer,
          coalesce(v_row #> '{pin,variants}', '[]'::jsonb), (v_row #>> '{pin,variant_adjustment}')::integer,
          rev.sales_fee_rate, rev.markup_rate
        );
      elsif v_row ->> 'source' = 'parent' and v_row ->> 'parent_item_id' is not null then
        -- 前の版で足した商品の行は、足した時点の原価の記録をそのまま引き継ぐ（新しい原価で黙って置き換えない）
        insert into public.quote_item_cost_pins (
          quote_item_id, quote_id, option_id, standard_cost_version_id, standard_cost, variant_cost_versions, variant_adjustment,
          sales_fee_rate, markup_rate
        )
        select v_item_id, v_new, p.option_id, p.standard_cost_version_id, p.standard_cost, p.variant_cost_versions, p.variant_adjustment,
               p.sales_fee_rate, p.markup_rate
          from public.quote_item_cost_pins p
         where p.quote_item_id = (v_row ->> 'parent_item_id')::uuid;
      end if;
    end loop;
    if v_expenses[v_pos] <> 0 then
      insert into public.quote_items (quote_id, line_key, kind, name, description, unit, unit_price, quantity, amount, sort_order)
      values (
        v_new, gen_random_uuid(),
        case v_section when 'base' then 'base_expense' when 'interior_exterior' then 'interior_exterior_expense' else 'option_expense' end,
        case v_section when 'base' then '本体諸費用' when 'interior_exterior' then '内外装工事経費' else 'オプション諸費用' end,
        '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_expenses[v_pos]::integer, 1, v_expenses[v_pos]::integer,
        case v_section when 'base' then 900 when 'interior_exterior' then 1950 else 2950 end
      );
    end if;
  end loop;

  -- 金額未確定の明細・お客様が選んだ別途見積の商品の確認（#529 と同じ）
  perform public.assert_quote_lines_resolved(v_new);
  perform public.assert_case_por_selections_confirmed(parent.id, v_uid);

  update public.quotes set status = 'superseded' where id = parent.id;
  update public.quote_requests set quote_id = v_new, status = 'sent' where id = parent.quote_request_id;
  return v_new;
end;
$revision_v25$;

comment on function public.create_quote_revision_v25(uuid, jsonb, integer, text, text) is
  'v2.5 の標準見積から作った Web の見積の第 2 版以降を、固定した版の v2.5 の決まりで発行する（前の版の行は前の版の単価、商品台帳の商品は v2.5 の売価、自由明細は担当者の売価、経費・税はサーバーが計算。千円未満の切り捨てなし）。本部と担当の代理店・総代理店だけ（v2.5 PR-D1）';

-- ---------- 所有者と権限 ----------

alter function public.quotes_v25_pin_guard() owner to postgres;
alter function public.quote_item_cost_pins_immutable() owner to postgres;
alter function public.quote_v25_editable(uuid) owner to postgres;
alter function public.get_quote_v25_context(uuid) owner to postgres;
alter function public.get_quote_v25_units(uuid, jsonb) owner to postgres;
alter function public.create_quote_revision_v25(uuid, jsonb, integer, text, text) owner to postgres;

-- トリガー関数・内部の部品は API のロールから直接実行させない（Supabase は public の関数へ既定で EXECUTE を付けるため明示して外す）
revoke all on function public.quotes_v25_pin_guard() from public, anon, authenticated, service_role;
revoke all on function public.quote_item_cost_pins_immutable() from public, anon, authenticated, service_role;
revoke all on function public.quote_v25_editable(uuid) from public, anon, authenticated, service_role;

-- 編集画面と発行は、ログインした担当者だけ（中で本部・担当の代理店かを確かめる）
revoke all on function public.get_quote_v25_context(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_quote_v25_units(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_quote_revision_v25(uuid, jsonb, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_quote_v25_context(uuid) to authenticated;
grant execute on function public.get_quote_v25_units(uuid, jsonb) to authenticated;
grant execute on function public.create_quote_revision_v25(uuid, jsonb, integer, text, text) to authenticated;

-- ---------- postconditions ----------

do $postconditions$
begin
  -- 既存の見積は変えていない（版の固定はこれからの v2.5 の見積だけ）
  if exists (select 1 from public.quotes where pricing_model is not null) or exists (select 1 from public.quote_item_cost_pins) then
    raise exception 'POSTCONDITION: existing quotes must not change';
  end if;
  if has_function_privilege('anon', 'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_quote_v25_units(uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_quote_v25_context(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.quote_v25_editable(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.quotes_v25_pin_guard()', 'EXECUTE') then
    raise exception 'POSTCONDITION: function privileges are not as expected';
  end if;
  if has_table_privilege('anon', 'public.quote_item_cost_pins', 'SELECT')
     or has_table_privilege('authenticated', 'public.quote_item_cost_pins', 'INSERT')
     or has_table_privilege('authenticated', 'public.quote_item_cost_pins', 'UPDATE') then
    raise exception 'POSTCONDITION: quote_item_cost_pins privileges are not as expected';
  end if;
end;
$postconditions$;

commit;
