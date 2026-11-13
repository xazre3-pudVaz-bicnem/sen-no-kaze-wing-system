-- =============================================================
-- A-2 ⑥：v2.5 の経費を、標準見積と案件見積の両方で「率で計算」か「金額を手動」で決められるようにする
-- =============================================================
-- 2026-11-04 の先方回答（A-2 ⑥）：
-- * v2.5 でも、標準見積と案件見積の両方で、率による自動計算と金額の手動指定を可能にする
-- * 手動で確定した経費額は、通常の再計算だけで上書きしない。全体の調整額とは区別する
-- * 操作画面は既存の Excel 風の画面を使う（共通化の方法は任せる）
-- 作り（区分ごと。経費を掛ける区分＝計算ルールの expense_target_sections だけ。別途工事は今と同じく経費なし）：
-- * 計算（pricing_calculate）：区分に expense_amount（整数円）があれば、その区分の経費は率で計算せず、その額にする。
--   結果の区分に expense_method（rate / fixed / none）を足す。expense_amount が無ければ今と同じ
-- * 標準見積（v2.5 の版）：区分の経費の方法に fixed（手動の額は expense_amount）を使えるようにする（v2.5 の RPC の中だけ）。
--   下書きの保存の expenses で決め、再計算は手動の額を変えない。新しい下書きへは方法と額を写す。
--   原価側の経費（社内の記録）は、手動の区分も今と同じく率で見積もる
-- * シミュレーター・Web の第 1 版の見積：版で手動にした区分の経費は、お客様が商品を変えても手動の額のまま。
--   見積の経費の行の説明に率を出さない。見積に区分の決め方（quotes.v25_expenses）を残す（発行後は変えない）
-- * Web の第 2 版以降（create_quote_revision_v25）：前の版の決め方を引き継ぎ、明細の「経費」の指定（source: expense）で変える
-- * Web 以外の案件の下書き（v2.5 の版から作ったものだけ）：区分の経費の方法に fixed と額（p_expense_methods の amounts）を使える。
--   版の率（販売費率・経費率・掛率）は今と同じく変えられない。経費を掛ける区分は「率」か「手動」（「なし」にはしない）。
--   下書きの社内の記録（quote_draft_internals）と発行の記録（quote_internal_snapshots）に手動の額（expense_amounts）を残す
-- * 旧来（v2.5 でない）の標準見積・見積・下書きは変えない（固定額は今と同じく使えない）。スイッチは入れない。データは変えない
-- 既存 migration は編集しない（既存の関数は、目印を確かめて差し込む。#529・S1・D1・D1c と同じやり方）。
-- =============================================================

begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regprocedure('public.pricing_calculate(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.prevent_new_fixed_standard_estimate_expense()') is null
     or to_regprocedure('public.standard_estimate_v25_writer_active()') is null
     or to_regprocedure('public.standard_estimate_v25_calc_input(uuid, integer)') is null
     or to_regprocedure('public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)') is null
     or to_regprocedure('public.start_standard_estimate_v25_draft(uuid, integer, uuid)') is null
     or to_regprocedure('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)') is null
     or to_regprocedure('public.standard_estimate_v25_configuration_money(uuid, uuid)') is null
     or to_regprocedure('public.write_standard_estimate_quote_items(uuid, uuid)') is null
     or to_regprocedure('public.get_quote_v25_context(uuid)') is null
     or to_regprocedure('public.create_quote_revision_v25(uuid, jsonb, integer, text, text)') is null
     or to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null then
    raise exception 'PRECONDITION: v2.5 (20261019100000 - 20261102130000) must be applied first';
  end if;
  if to_regprocedure('public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)') is null
     or to_regprocedure('public.materialize_standard_quote_draft(uuid, uuid)') is null
     or to_regprocedure('public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text)') is null
     or to_regprocedure('public.write_quote_internal_snapshot(uuid, uuid)') is null
     or to_regprocedure('public.prepare_quote_revision_draft(uuid, uuid)') is null then
    raise exception 'PRECONDITION: standard quote draft functions were not found';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute
              where attrelid = 'public.quotes'::regclass and attname = 'v25_expenses' and not attisdropped)
     or exists (select 1 from pg_catalog.pg_attribute
                 where attrelid = 'public.quote_draft_internals'::regclass and attname = 'expense_amounts' and not attisdropped)
     or exists (select 1 from pg_catalog.pg_attribute
                 where attrelid = 'public.quote_internal_snapshots'::regclass and attname = 'expense_amounts' and not attisdropped)
     or to_regprocedure('public.standard_estimate_v25_expense_settings(uuid)') is not null then
    raise exception 'PRECONDITION: v2.5 manual expense objects already exist';
  end if;
end;
$preflight$;

-- ---------- 内部の部品 ----------

-- 区分の経費の手動の額（区分 → 0〜100,000,000 円の整数）が、経費の方法（fixed の区分）と 1 対 1 で合うこと
create function public.quote_expense_amounts_valid(p_methods jsonb, p_amounts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_methods) = 'object'
     and pg_catalog.jsonb_typeof(p_amounts) = 'object'
     and not exists (
       select 1
         from pg_catalog.jsonb_each(p_amounts) as a(code, value)
        where coalesce(p_methods ->> a.code, '') <> 'fixed'
           or case when pg_catalog.jsonb_typeof(a.value) = 'number'
                   then (a.value #>> '{}')::numeric <> pg_catalog.trunc((a.value #>> '{}')::numeric)
                        or (a.value #>> '{}')::numeric < 0
                        or (a.value #>> '{}')::numeric > 100000000
                   else true end)
     and not exists (
       select 1
         from pg_catalog.jsonb_each(p_methods) as m(code, value)
        where m.value = '"fixed"'::jsonb
          and not (p_amounts ? m.code));
$$;

comment on function public.quote_expense_amounts_valid(jsonb, jsonb) is
  '区分の経費の手動の額（区分 → 0〜100,000,000 円の整数）が、経費の方法の fixed の区分と 1 対 1 で合うか。下書き・発行の記録の check に使う（A-2 ⑥）';

-- v2.5 の標準見積の版の、区分の経費の決め方（Web の見積に写す形）。経費を掛ける区分は rate か fixed（額つき）、掛けない区分は none
create function public.standard_estimate_v25_expense_settings(p_revision_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_object_agg(c.code,
           case when not (c.code = any(rule.expense_target_sections)) then pg_catalog.jsonb_build_object('method', 'none')
                when s.expense_method = 'fixed' then pg_catalog.jsonb_build_object('method', 'fixed', 'amount', s.expense_amount)
                else pg_catalog.jsonb_build_object('method', 'rate') end)
    from public.standard_estimate_revisions r
    join public.pricing_calculation_rule_versions rule on rule.id = r.calc_rule_version_id
   cross join pg_catalog.unnest(array['base', 'interior_exterior', 'option', 'sitework']) as c(code)
    left join public.standard_estimate_revision_sections s on s.revision_id = r.id and s.section_code = c.code
   where r.id = p_revision_id and r.pricing_model = 'v2.5';
$$;

comment on function public.standard_estimate_v25_expense_settings(uuid) is
  'v2.5 の標準見積の版の、区分の経費の決め方（{区分: {method: rate | fixed | none, amount: 手動の額}}）。Web の第 1 版の見積に写す。内部用（A-2 ⑥）';

-- 決め方を持たない v2.5 の見積（この migration より前に作ったもの）の既定：経費を掛ける区分は率、掛けない区分はなし
create function public.quote_v25_default_expenses(p_expense_sections text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_object_agg(c.code,
           pg_catalog.jsonb_build_object('method', case when c.code = any(p_expense_sections) then 'rate' else 'none' end))
    from pg_catalog.unnest(array['base', 'interior_exterior', 'option', 'sitework']) as c(code);
$$;

comment on function public.quote_v25_default_expenses(text[]) is
  '区分の経費の決め方を持たない v2.5 の見積の既定（経費を掛ける区分は率、掛けない区分はなし）。内部用（A-2 ⑥）';

-- 見積の経費の行の説明。手動の額の区分は率を出さない
create function public.quote_v25_expense_description(p_method text, p_rate_label text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '交通費、労災、安全管理費等' || case when p_method = 'fixed' then '' else '（' || p_rate_label || '%）' end;
$$;

comment on function public.quote_v25_expense_description(text, text) is
  '見積の経費の行の説明（率の区分は「（15%）」を付け、手動の額の区分は付けない）。内部用（A-2 ⑥）';

-- ---------- 見積：区分の経費の決め方（v2.5 の見積だけ。発行後は変えない） ----------

alter table public.quotes
  add column v25_expenses jsonb,
  add constraint quotes_v25_expenses_check check (
    v25_expenses is null or (pricing_model = 'v2.5' and pg_catalog.jsonb_typeof(v25_expenses) = 'object')
  );

comment on column public.quotes.v25_expenses is
  'v2.5 の見積の、区分の経費の決め方（{区分: {method: rate | fixed | none, amount: 手動の額}}）。Web の第 1 版は標準見積の版から写し、第 2 版以降は前の版を引き継いで担当者が変えられる。発行後は変えない。null はこの列より前の v2.5 の見積（率で計算）と旧来の見積（A-2 ⑥）';

create function public.quotes_v25_expenses_guard()
returns trigger
language plpgsql
set search_path = ''
as $expenses_guard$
begin
  if old.v25_expenses is not distinct from new.v25_expenses then
    return new;
  end if;
  -- Web の第 1 版の発行の中で、未設定から一度だけ入れる（所有者 postgres の関数の中だけ）
  if current_user = 'postgres' and old.v25_expenses is null and old.parent_quote_id is null and old.revision = 1 then
    return new;
  end if;
  raise exception 'QUOTE_LINEAGE_IMMUTABLE: 見積の経費の決め方は変更できません' using errcode = 'P0001';
end;
$expenses_guard$;

create trigger quotes_v25_expenses_guard
before update of v25_expenses on public.quotes
for each row execute function public.quotes_v25_expenses_guard();

-- ---------- Web 以外の案件の下書き・発行の記録：手動の額 ----------

alter table public.quote_draft_internals drop constraint quote_draft_internals_expense_methods;
alter table public.quote_draft_internals
  add column expense_amounts jsonb not null default '{}'::jsonb,
  add constraint quote_draft_internals_expense_methods check (
    jsonb_typeof(expense_methods) = 'object'
    and expense_methods - array['base', 'interior_exterior', 'option', 'sitework'] = '{}'::jsonb
    and coalesce(expense_methods ->> 'base', '') in ('rate', 'none', 'fixed')
    and coalesce(expense_methods ->> 'interior_exterior', '') in ('rate', 'none', 'fixed')
    and coalesce(expense_methods ->> 'option', '') in ('rate', 'none', 'fixed')
    and coalesce(expense_methods ->> 'sitework', '') in ('rate', 'none')
  ),
  add constraint quote_draft_internals_expense_amounts check (public.quote_expense_amounts_valid(expense_methods, expense_amounts));

comment on column public.quote_draft_internals.expense_amounts is
  '区分の経費の手動の額（区分 → 整数円。経費の方法が fixed の区分だけ）。v2.5 の標準見積の版から作った下書きだけが使う（A-2 ⑥）';

alter table public.quote_internal_snapshots
  add column expense_amounts jsonb not null default '{}'::jsonb,
  add constraint quote_internal_snapshots_expense_amounts check (public.quote_expense_amounts_valid(expense_methods, expense_amounts));

comment on column public.quote_internal_snapshots.expense_amounts is
  '発行した版の、区分の経費の手動の額（区分 → 整数円。経費の方法が fixed の区分だけ。発行時に下書きから写し、変えない。A-2 ⑥）';

-- ---------- 既存の関数に、目印を確かめて差し込む（本体を丸ごと写さない。#529・S1・D1・D1c と同じやり方） ----------

create function pg_temp.expense_patch_function(p_target regprocedure, p_old text, p_new text)
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

-- ---------- 計算：区分の手動の経費 ----------

select pg_temp.expense_patch_function(
  'public.pricing_calculate(uuid, uuid, jsonb)'::regprocedure,
  $old$  v_expense_target boolean;$old$,
  $new$  v_expense_target boolean;
  v_fixed_expense numeric;$new$
);

select pg_temp.expense_patch_function(
  'public.pricing_calculate(uuid, uuid, jsonb)'::regprocedure,
  $old$    v_expense_target := v_code = any(v_rule.expense_target_sections);$old$,
  $new$    v_expense_target := v_code = any(v_rule.expense_target_sections);
    -- 経費の手動の額（2026-11-04 の先方回答 A-2 ⑥）：区分に expense_amount（整数円・0 以上）があれば、その区分の経費は
    -- 率で計算せず、その額にする（明細を変えても変わらない）。経費を掛ける区分だけ。省略・null は今と同じく率で計算する
    v_fixed_expense := null;
    if coalesce(pg_catalog.jsonb_typeof(v_section -> 'expense_amount'), 'null') <> 'null' then
      if not v_expense_target then
        raise exception using errcode = 'P0001',
          message = format('VALIDATION: 区分 %s には経費を掛けないため、経費の手動の額は指定できません', v_code);
      end if;
      v_fixed_expense := public.pricing_input_integer(v_section -> 'expense_amount', '経費の手動の額', 0, 2147483647);
    end if;$new$
);

select pg_temp.expense_patch_function(
  'public.pricing_calculate(uuid, uuid, jsonb)'::regprocedure,
  $old$      v_section_expense := case when v_expense_target
                                then public.pricing_checked_amount(pg_catalog.trunc(v_priced * v_expense_rate), '区分経費')
                                else 0 end;$old$,
  $new$      v_section_expense := case when v_fixed_expense is not null then v_fixed_expense
                                when v_expense_target
                                then public.pricing_checked_amount(pg_catalog.trunc(v_priced * v_expense_rate), '区分経費')
                                else 0 end;$new$
);

select pg_temp.expense_patch_function(
  'public.pricing_calculate(uuid, uuid, jsonb)'::regprocedure,
  $old$      'expense_target', v_expense_target,$old$,
  $new$      'expense_target', v_expense_target,
      'expense_method', case when v_fixed_expense is not null then 'fixed' when v_expense_target then 'rate' else 'none' end,$new$
);

-- ---------- 標準見積（v2.5 の版）：区分の経費の方法に fixed を使えるようにする ----------

-- 固定額を新しく使わせないトリガー（2026-10-13）：v2.5 の版は、v2.5 の編集の RPC の中だけ fixed を使える
select pg_temp.expense_patch_function(
  'public.prevent_new_fixed_standard_estimate_expense()'::regprocedure,
  $old$  if new.expense_method = 'fixed' and (tg_op = 'INSERT' or old.expense_method is distinct from 'fixed') then$old$,
  $new$  if new.expense_method = 'fixed' and (tg_op = 'INSERT' or old.expense_method is distinct from 'fixed')
     -- v2.5 の標準見積は、区分の経費を手動の額にできる（2026-11-04 の先方回答 A-2 ⑥。v2.5 の編集の RPC の中だけ）
     and not (public.standard_estimate_v25_writer_active()
              and exists (select 1 from public.standard_estimate_revisions v25_rev
                           where v25_rev.id = new.revision_id and v25_rev.pricing_model = 'v2.5')) then$new$
);

-- 計算の入力：手動の区分は expense_amount を渡す（経費を掛ける区分だけ）
select pg_temp.expense_patch_function(
  'public.standard_estimate_v25_calc_input(uuid, integer)'::regprocedure,
  $old$    v_sections := v_sections || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_code, 'lines', v_lines));$old$,
  $new$    -- 手動の経費の区分（A-2 ⑥）は、手動の額を渡す（経費を掛ける区分だけ。掛けない区分は率でも手動でも経費なし）
    v_sections := v_sections || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', v_code, 'lines', v_lines) || coalesce((
      select pg_catalog.jsonb_build_object('expense_amount', s.expense_amount)
        from public.standard_estimate_revision_sections s
        join public.pricing_calculation_rule_versions rule on rule.id = rev.calc_rule_version_id
       where s.revision_id = rev.id and s.section_code = v_code and s.expense_method = 'fixed'
         and v_code = any(rule.expense_target_sections)), '{}'::jsonb));$new$
);

-- 再計算：手動の区分は保存した額のまま（原価側の経費は率のまま）
select pg_temp.expense_patch_function(
  'public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)'::regprocedure,
  $old$  v_cost_expense bigint;$old$,
  $new$  v_cost_expense bigint;
  v_fixed boolean;
  v_fixed_amount bigint;$new$
);

select pg_temp.expense_patch_function(
  'public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)'::regprocedure,
  $old$    v_expense := case when v_target then trunc(v_priced * rev.expense_rate)::bigint else 0 end;$old$,
  $new$    -- 手動の経費の区分（A-2 ⑥）は、保存した額のまま（明細を変えても計算し直さない）。原価側の経費（社内の記録）は率のまま
    select s.expense_method = 'fixed' and v_target, s.expense_amount into v_fixed, v_fixed_amount
      from public.standard_estimate_revision_sections s
     where s.revision_id = rev.id and s.section_code = v_code;
    v_fixed := coalesce(v_fixed, false);
    v_expense := case when v_fixed then v_fixed_amount
                      when v_target then trunc(v_priced * rev.expense_rate)::bigint else 0 end;$new$
);

select pg_temp.expense_patch_function(
  'public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)'::regprocedure,
  $old$       set expense_method = case when v_target then 'rate' else 'none' end,
           expense_rate = case when v_target then rev.expense_rate else null end,$old$,
  $new$       set expense_method = case when v_fixed then 'fixed' when v_target then 'rate' else 'none' end,
           expense_rate = case when v_fixed then null when v_target then rev.expense_rate else null end,$new$
);

-- 下書きを作る：v2.5 の版の手動の経費は写す。v2.5 以前の下書きを切り替えるときの固定額は引き継がない（今までどおり率になる）
select pg_temp.expense_patch_function(
  'public.start_standard_estimate_v25_draft(uuid, integer, uuid)'::regprocedure,
  $old$    perform public.standard_estimate_v25_recalculate(d.id);$old$,
  $new$    -- v2.5 以前の固定額の経費は引き継がない（v2.5 の手動の経費は、v2.5 の編集画面で決める。A-2 ⑥）
    update public.standard_estimate_revision_sections s
       set expense_method = 'none', expense_rate = null, expense_amount = 0, total = s.line_subtotal,
           cost_expense_amount = 0, cost_total = s.cost_line_subtotal
     where s.revision_id = d.id and s.expense_method = 'fixed';
    perform public.standard_estimate_v25_recalculate(d.id);$new$
);

select pg_temp.expense_patch_function(
  'public.start_standard_estimate_v25_draft(uuid, integer, uuid)'::regprocedure,
  $old$  if exists (select 1 from public.standard_estimate_revision_sections s where s.revision_id = cur.id and s.expense_method = 'fixed') then$old$,
  $new$  if cur.pricing_model is distinct from 'v2.5'
     and exists (select 1 from public.standard_estimate_revision_sections s where s.revision_id = cur.id and s.expense_method = 'fixed') then$new$
);

select pg_temp.expense_patch_function(
  'public.start_standard_estimate_v25_draft(uuid, integer, uuid)'::regprocedure,
  $old$  insert into public.standard_estimate_revision_sections (revision_id, section_code, expense_method, expense_rate)
  values (v_rev, 'base', 'none', null), (v_rev, 'interior_exterior', 'none', null),
         (v_rev, 'option', 'none', null), (v_rev, 'sitework', 'none', null);$old$,
  $new$  insert into public.standard_estimate_revision_sections (revision_id, section_code, expense_method, expense_rate)
  values (v_rev, 'base', 'none', null), (v_rev, 'interior_exterior', 'none', null),
         (v_rev, 'option', 'none', null), (v_rev, 'sitework', 'none', null);

  -- v2.5 の版の手動の経費（区分の方法と額）を引き継ぐ（A-2 ⑥。再計算は手動の額を変えない）
  if cur.pricing_model = 'v2.5' then
    update public.standard_estimate_revision_sections s
       set expense_method = 'fixed', expense_rate = null, expense_amount = src.expense_amount,
           total = s.line_subtotal + src.expense_amount
      from public.standard_estimate_revision_sections src
     where s.revision_id = v_rev and src.revision_id = cur.id
       and src.section_code = s.section_code and src.expense_method = 'fixed';
  end if;$new$
);

-- 下書きの保存：p_payload の expenses で区分の経費の決め方を変える（書いた区分だけ。無ければ今のまま）
select pg_temp.expense_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$  perform public.standard_estimate_v25_recalculate(rev.id, false, v_adjustment, v_reason);$old$,
  $new$  -- 区分の経費の決め方（2026-11-04 の先方回答 A-2 ⑥）：p_payload の expenses
  --   { "base" | "interior_exterior" | "option": { "method": "rate" | "fixed", "amount": 手動の額（fixed だけ。0〜100,000,000 円の整数） } }
  -- 書いた区分だけ変える（無い区分・expenses が無いときは今の決め方のまま。手動の額は、ここで変えない限り再計算でも変わらない）。
  -- 経費を掛ける区分（計算ルール）だけ。率に戻すと、再計算で率の経費になる
  declare
    v_exp record;
    v_exp_label text;
    v_exp_method text;
    v_exp_amount numeric;
    v_exp_targets text[];
  begin
    if coalesce(pg_catalog.jsonb_typeof(p_payload -> 'expenses'), 'null') <> 'null' then
      if pg_catalog.jsonb_typeof(p_payload -> 'expenses') <> 'object' then
        raise exception using errcode = 'P0001', message = 'VALIDATION: 経費の決め方の形式が不正です';
      end if;
      select rule.expense_target_sections into v_exp_targets
        from public.pricing_calculation_rule_versions rule where rule.id = rev.calc_rule_version_id;
      for v_exp in select e.key as code, e.value from pg_catalog.jsonb_each(p_payload -> 'expenses') as e loop
        v_exp_label := case v_exp.code when 'base' then '本体' when 'interior_exterior' then '内外装工事'
                                        when 'option' then 'オプション' when 'sitework' then '別途工事' else v_exp.code end;
        if not (v_exp.code = any(coalesce(v_exp_targets, '{}'::text[]))) then
          raise exception using errcode = 'P0001',
            message = format('VALIDATION: %s には経費を掛けないため、経費の決め方は指定できません', v_exp_label);
        end if;
        v_exp_method := case when pg_catalog.jsonb_typeof(v_exp.value) = 'object' then v_exp.value ->> 'method' end;
        if v_exp_method is null or v_exp_method not in ('rate', 'fixed') then
          raise exception using errcode = 'P0001',
            message = format('VALIDATION: %sの経費の決め方は「率で計算」か「金額を手動」を選んでください', v_exp_label);
        end if;
        if v_exp_method = 'fixed' then
          v_exp_amount := case when pg_catalog.jsonb_typeof(v_exp.value -> 'amount') = 'number' then (v_exp.value ->> 'amount')::numeric end;
          if v_exp_amount is null or v_exp_amount <> pg_catalog.trunc(v_exp_amount) or v_exp_amount < 0 or v_exp_amount > 100000000 then
            raise exception using errcode = 'P0001',
              message = format('VALIDATION: %sの経費の手動の額は、0〜100,000,000 円の整数で入力してください', v_exp_label);
          end if;
          update public.standard_estimate_revision_sections s
             set expense_method = 'fixed', expense_rate = null, expense_amount = v_exp_amount::integer,
                 total = s.line_subtotal + v_exp_amount::integer
           where s.revision_id = rev.id and s.section_code = v_exp.code;
        else
          update public.standard_estimate_revision_sections s
             set expense_method = 'none', expense_rate = null, expense_amount = 0, total = s.line_subtotal,
                 cost_expense_amount = 0, cost_total = s.cost_line_subtotal
           where s.revision_id = rev.id and s.section_code = v_exp.code and s.expense_method = 'fixed';
        end if;
      end loop;
    end if;
  end;

  perform public.standard_estimate_v25_recalculate(rev.id, false, v_adjustment, v_reason);$new$
);

-- ---------- シミュレーター・保存した仕様の金額：手動の区分は手動の額のまま ----------

select pg_temp.expense_patch_function(
  'public.standard_estimate_v25_configuration_money(uuid, uuid)'::regprocedure,
  $old$      v_expense := case when s.expense_method = 'rate' then trunc(v_line * rev.expense_rate)::bigint else 0 end;$old$,
  $new$      -- 版で手動にした区分の経費は、お客様が商品を変えても手動の額のまま（A-2 ⑥）
      v_expense := case when s.expense_method = 'rate' then trunc(v_line * rev.expense_rate)::bigint
                        when s.expense_method = 'fixed' then s.expense_amount::bigint
                        else 0 end;$new$
);

-- ---------- Web の第 1 版の見積：決め方を見積に残し、手動の区分は経費の行に率を出さない ----------

select pg_temp.expense_patch_function(
  'public.write_standard_estimate_quote_items(uuid, uuid)'::regprocedure,
  $old$         tax_rule_version_id = r.tax_rule_version_id
    from public.standard_estimate_revisions r
   where q.id = p_quote_id and r.id = v_revision;$old$,
  $new$         tax_rule_version_id = r.tax_rule_version_id,
         -- 区分の経費の決め方（率／手動の額。A-2 ⑥）。第 2 版以降は、この決め方を引き継ぐ
         v25_expenses = public.standard_estimate_v25_expense_settings(r.id)
    from public.standard_estimate_revisions r
   where q.id = p_quote_id and r.id = v_revision;$new$
);

select pg_temp.expense_patch_function(
  'public.write_standard_estimate_quote_items(uuid, uuid)'::regprocedure,
  $old$    values (p_quote_id, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, 900);$old$,
  $new$    values (p_quote_id, 'base_expense', '本体諸費用', public.quote_v25_expense_description(v_sections #>> '{base,expense_method}', v_rate_label),
            '式', v_amount, 1, v_amount, 900);$new$
);

select pg_temp.expense_patch_function(
  'public.write_standard_estimate_quote_items(uuid, uuid)'::regprocedure,
  $old$        '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, v_base_sort + 950$old$,
  $new$        public.quote_v25_expense_description(v_sections #>> array[v_code, 'expense_method'], v_rate_label), '式', v_amount, 1, v_amount, v_base_sort + 950$new$
);

-- ---------- Web の第 2 版以降：前の版の決め方を引き継ぎ、明細の「経費」の指定で変える ----------

-- 編集画面に、この版の見積の決め方を渡す（売価側の額だけ。原価・販売費率・掛率は今と同じく渡さない）
select pg_temp.expense_patch_function(
  'public.get_quote_v25_context(uuid)'::regprocedure,
  $old$    'expense_sections', pg_catalog.to_jsonb(rule.expense_target_sections),$old$,
  $new$    'expense_sections', pg_catalog.to_jsonb(rule.expense_target_sections),
    -- 区分の経費の決め方（この見積の決め方。第 2 版の既定。A-2 ⑥）
    'expenses', coalesce(q.v25_expenses, public.quote_v25_default_expenses(rule.expense_target_sections)),$new$
);

select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$  v_pin jsonb;$old$,
  $new$  v_pin jsonb;
  v_expense_settings jsonb;
  v_expense_method text;
  v_expense_amount numeric;
  v_expense_seen text[] := '{}'::text[];$new$
);

select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$  if 'sitework' = any(rule.expense_target_sections) then
    raise exception 'VALIDATION: 別途工事に経費を掛ける計算ルールには対応していません' using errcode = 'P0001';
  end if;$old$,
  $new$  if 'sitework' = any(rule.expense_target_sections) then
    raise exception 'VALIDATION: 別途工事に経費を掛ける計算ルールには対応していません' using errcode = 'P0001';
  end if;
  -- 区分の経費の決め方（A-2 ⑥）：前の版の決め方を引き継ぐ（手動の額は、担当者が明細の「経費」で変えない限りそのまま）
  v_expense_settings := coalesce(parent.v25_expenses, public.quote_v25_default_expenses(rule.expense_target_sections));$new$
);

select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$    v_source := v_line ->> 'source';$old$,
  $new$    v_source := v_line ->> 'source';
    -- 経費の決め方（A-2 ⑥）：{ "source": "expense", "section", "method": "rate" | "fixed", "amount": 手動の額 }。明細にはしない。
    -- 本体諸費用の決め方は、本体の行と同じく本部・総代理店だけが変えられる
    if v_source = 'expense' then
      v_section := v_line ->> 'section';
      if v_section is null or not (v_section = any(rule.expense_target_sections)) then
        raise exception 'VALIDATION: % 行目：経費を掛ける区分（本体・内外装工事・オプション）を指定してください', v_index using errcode = 'P0001';
      end if;
      if v_section = any(v_expense_seen) then
        raise exception 'VALIDATION: % 行目：同じ区分の経費の決め方が重複しています', v_index using errcode = 'P0001';
      end if;
      v_expense_seen := v_expense_seen || v_section;
      v_expense_method := v_line ->> 'method';
      if v_expense_method = 'rate' then
        v_row := pg_catalog.jsonb_build_object('method', 'rate');
      elsif v_expense_method = 'fixed' then
        v_expense_amount := case when pg_catalog.jsonb_typeof(v_line -> 'amount') = 'number' then (v_line ->> 'amount')::numeric end;
        if v_expense_amount is null or v_expense_amount <> pg_catalog.trunc(v_expense_amount) or v_expense_amount < 0 or v_expense_amount > 100000000 then
          raise exception 'VALIDATION: % 行目：経費の手動の額は 0〜100,000,000 円の整数で入力してください', v_index using errcode = 'P0001';
        end if;
        v_row := pg_catalog.jsonb_build_object('method', 'fixed', 'amount', v_expense_amount::integer);
      else
        raise exception 'VALIDATION: % 行目：経費の決め方は「率で計算」か「金額を手動」を選んでください', v_index using errcode = 'P0001';
      end if;
      if v_section = 'base' and not v_can_edit_base and (v_expense_settings -> 'base') is distinct from v_row then
        raise exception 'VALIDATION: % 行目：本体諸費用の決め方は、本部・総代理店だけが変えられます', v_index using errcode = 'P0001';
      end if;
      v_expense_settings := v_expense_settings || pg_catalog.jsonb_build_object(v_section, v_row);
      v_row := null;
      continue;
    end if;$new$
);

-- 明細は 300 行まで。経費の決め方（source: expense。区分ごとに 1 つ）は明細に数えない（区分は 3 つなので全体は 303 まで）
select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$  if pg_catalog.jsonb_array_length(p_lines) > 300 then
    raise exception 'VALIDATION: 明細は 300 行までです' using errcode = 'P0001';
  end if;$old$,
  $new$  if pg_catalog.jsonb_array_length(p_lines) > 303
     or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_lines) as e(value)
          where (e.value ->> 'source') is distinct from 'expense') > 300 then
    raise exception 'VALIDATION: 明細は 300 行までです' using errcode = 'P0001';
  end if;$new$
);

select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$    if v_section = any(rule.expense_target_sections) then
      v_expenses[v_pos] := pg_catalog.trunc(v_line_totals[v_pos] * rev.expense_rate);
    end if;$old$,
  $new$    if v_section = any(rule.expense_target_sections) then
      -- 手動の額の区分は、その額のまま（明細を変えても計算し直さない。A-2 ⑥）
      v_expenses[v_pos] := case when v_expense_settings #>> array[v_section, 'method'] = 'fixed'
                                then (v_expense_settings #>> array[v_section, 'amount'])::numeric
                                else pg_catalog.trunc(v_line_totals[v_pos] * rev.expense_rate) end;
    end if;$new$
);

-- 第 2 版の見積に、区分の経費の決め方を残す（insert の文ごとを目印にする）
select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$  insert into public.quotes(
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
  returning id into v_new;$old$,
  $new$  insert into public.quotes(
    quote_no, quote_request_id, configuration_id, user_id, status, quote_kind,
    base_model_id, base_master_revision_id, spec_code,
    issued_at, valid_until, customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment, adjustment_reason,
    subtotal, tax_rate, tax, total, preview_image_url, notes, dealer_id, dealer_note, revision, parent_quote_id, created_by,
    pricing_model, standard_estimate_revision_id, calc_rule_version_id, tax_rule_version_id, v25_expenses
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
    'v2.5', rev.id, rule.id, tax.id, v_expense_settings
  )
  returning id into v_new;$new$
);

select pg_temp.expense_patch_function(
  'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure,
  $old$        '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_expenses[v_pos]::integer, 1, v_expenses[v_pos]::integer,$old$,
  $new$        public.quote_v25_expense_description(v_expense_settings #>> array[v_section, 'method'], v_rate_label),
        '式', v_expenses[v_pos]::integer, 1, v_expenses[v_pos]::integer,$new$
);

-- ---------- Web 以外の案件の下書き（v2.5 の版から作ったものだけ）：手動の額 ----------

select pg_temp.expense_patch_function(
  'public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure,
  $old$  v_rate_label text;$old$,
  $new$  v_rate_label text;
  v_amounts jsonb := '{}'::jsonb;
  v_fixed numeric;
  v_v25 boolean;
  v_expense_targets text[];$new$
);

select pg_temp.expense_patch_function(
  'public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure,
  $old$    v_method := coalesce(p_expense_methods ->> v_section, case when v_section = 'sitework' then 'none' else 'rate' end);
    if v_method not in ('rate', 'none') then
      raise exception 'VALIDATION: 経費の計算方法は「率」か「なし」を選んでください（固定額は使えません）' using errcode = 'P0001';
    end if;$old$,
  $new$    v_method := coalesce(p_expense_methods ->> v_section, case when v_section = 'sitework' then 'none' else 'rate' end);
    -- 金額を手動（fixed）は、v2.5 の標準見積の版から作った下書きの、経費を掛ける区分だけ（2026-11-04 の先方回答 A-2 ⑥）。
    -- 額は p_expense_methods の amounts（区分 → 0〜100,000,000 円の整数）。原価側の経費（社内の記録）は率のまま
    if v_v25 is null then
      select rule.expense_target_sections into v_expense_targets
        from public.standard_estimate_revisions source_rev
        join public.pricing_calculation_rule_versions rule on rule.id = source_rev.calc_rule_version_id
       where source_rev.id = d.standard_estimate_revision_id and source_rev.pricing_model = 'v2.5';
      v_v25 := found;
    end if;
    if v_method = 'fixed' and v_v25 and v_section = any(coalesce(v_expense_targets, '{}'::text[])) then
      v_fixed := case when jsonb_typeof(p_expense_methods -> 'amounts' -> v_section) = 'number'
                      then (p_expense_methods -> 'amounts' ->> v_section)::numeric end;
      if v_fixed is null or v_fixed <> trunc(v_fixed) or v_fixed < 0 or v_fixed > 100000000 then
        raise exception 'VALIDATION: %の経費の手動の額（0〜100,000,000円の整数）を入力してください',
          case v_section when 'base' then '本体' when 'interior_exterior' then '内外装工事' else 'オプション' end
          using errcode = 'P0001';
      end if;
      v_amounts := v_amounts || jsonb_build_object(v_section, v_fixed::integer);
    elsif v_method not in ('rate', 'none') then
      raise exception 'VALIDATION: 経費の計算方法は「率」か「なし」を選んでください（固定額は使えません）' using errcode = 'P0001';
    end if;$new$
);

select pg_temp.expense_patch_function(
  'public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure,
  $old$      v_cost_exp := trunc(v_cost_sums[v_pos] * p_expense_rate);
    else$old$,
  $new$      v_cost_exp := trunc(v_cost_sums[v_pos] * p_expense_rate);
    elsif v_methods ->> v_section = 'fixed' then
      -- 手動の額（売価側）。原価側の経費は率のまま（A-2 ⑥）
      v_sale_exp := (v_amounts ->> v_section)::numeric;
      v_cost_exp := trunc(v_cost_sums[v_pos] * p_expense_rate);
    else$new$
);

select pg_temp.expense_patch_function(
  'public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure,
  $old$        '交通費、労災、安全管理費等（' || v_rate_label || '%）',$old$,
  $new$        public.quote_v25_expense_description(v_methods ->> v_section, v_rate_label),$new$
);

select pg_temp.expense_patch_function(
  'public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure,
  $old$  insert into public.quote_draft_internals (draft_id, sales_fee_rate, expense_rate, markup_rate, expense_methods, cost_total, updated_at)
  values (d.id, p_sales_fee_rate, p_expense_rate, p_markup_rate, v_methods, v_cost_total::integer, now())
  on conflict (draft_id) do update
    set sales_fee_rate = excluded.sales_fee_rate,
        expense_rate = excluded.expense_rate,
        markup_rate = excluded.markup_rate,
        expense_methods = excluded.expense_methods,$old$,
  $new$  insert into public.quote_draft_internals (draft_id, sales_fee_rate, expense_rate, markup_rate, expense_methods, expense_amounts, cost_total, updated_at)
  values (d.id, p_sales_fee_rate, p_expense_rate, p_markup_rate, v_methods, v_amounts, v_cost_total::integer, now())
  on conflict (draft_id) do update
    set sales_fee_rate = excluded.sales_fee_rate,
        expense_rate = excluded.expense_rate,
        markup_rate = excluded.markup_rate,
        expense_methods = excluded.expense_methods,
        expense_amounts = excluded.expense_amounts,$new$
);

-- 下書きを作る：v2.5 の版の手動の経費は、方法と額を写す（旧来の版の固定額は今と同じく止める）
select pg_temp.expense_patch_function(
  'public.materialize_standard_quote_draft(uuid, uuid)'::regprocedure,
  $old$  if exists (select 1 from public.standard_estimate_revision_sections s
              where s.revision_id = rev.id and s.expense_method not in ('rate', 'none')) then$old$,
  $new$  if rev.pricing_model is distinct from 'v2.5' and exists (select 1 from public.standard_estimate_revision_sections s
              where s.revision_id = rev.id and s.expense_method not in ('rate', 'none')) then$new$
);

select pg_temp.expense_patch_function(
  'public.materialize_standard_quote_draft(uuid, uuid)'::regprocedure,
  $old$  select coalesce(jsonb_object_agg(s.section_code, s.expense_method), '{}'::jsonb)
    into v_methods
    from public.standard_estimate_revision_sections s
   where s.revision_id = rev.id;$old$,
  $new$  select coalesce(jsonb_object_agg(s.section_code, s.expense_method), '{}'::jsonb)
    into v_methods
    from public.standard_estimate_revision_sections s
   where s.revision_id = rev.id;
  -- v2.5 の版で手動にした区分の経費（A-2 ⑥）は、額も写す
  if rev.pricing_model = 'v2.5' then
    v_methods := v_methods || jsonb_build_object('amounts', coalesce((
      select jsonb_object_agg(s.section_code, s.expense_amount)
        from public.standard_estimate_revision_sections s
       where s.revision_id = rev.id and s.expense_method = 'fixed'), '{}'::jsonb));
  end if;$new$
);

-- 下書きの保存：v2.5 の版から作った下書きは、版の率を変えない（今と同じ）。経費は区分ごとに「率」か「金額を手動」を選べる
select pg_temp.expense_patch_function(
  'public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text)'::regprocedure,
  $old$  -- v2.5 の標準見積から作った見積は、版の率（販売費率・経費率・掛率）と区分の経費の計算方法で計算する（v2.5 PR-D1c）。
  -- 選択枠の原価単価は版で販売費率を掛けた後の値なので、率を変えると本体の行だけが変わり、版の決まりと合わなくなるため
  if exists (select 1 from public.standard_estimate_revisions source_rev
              where source_rev.id = d.standard_estimate_revision_id and source_rev.pricing_model = 'v2.5')
     and not exists (
       select 1 from public.quote_draft_internals draft_rates
        where draft_rates.draft_id = d.id
          and draft_rates.sales_fee_rate = p_sales_fee_rate
          and draft_rates.expense_rate = p_expense_rate
          and draft_rates.markup_rate = p_markup_rate
          and draft_rates.expense_methods = (
            select pg_catalog.jsonb_object_agg(sec.code, coalesce(p_expense_methods ->> sec.code, case when sec.code = 'sitework' then 'none' else 'rate' end))
              from pg_catalog.unnest(array['base', 'interior_exterior', 'option', 'sitework']) as sec(code))
     ) then
    raise exception 'VALIDATION: v2.5 の標準見積から作った見積は、版の率（販売費率・経費率・掛率）と経費の計算方法で計算します（変えられません。値引きなどは調整額で入れてください）'
      using errcode = 'P0001';
  end if;$old$,
  $new$  -- v2.5 の標準見積から作った見積は、版の率（販売費率・経費率・掛率）で計算する（v2.5 PR-D1c。区分の経費の決め方は下の A-2 ⑥）。
  -- 選択枠の原価単価は版で販売費率を掛けた後の値なので、率を変えると本体の行だけが変わり、版の決まりと合わなくなるため
  if exists (select 1 from public.standard_estimate_revisions source_rev
              where source_rev.id = d.standard_estimate_revision_id and source_rev.pricing_model = 'v2.5')
     and not exists (
       select 1 from public.quote_draft_internals draft_rates
        where draft_rates.draft_id = d.id
          and draft_rates.sales_fee_rate = p_sales_fee_rate
          and draft_rates.expense_rate = p_expense_rate
          and draft_rates.markup_rate = p_markup_rate
     ) then
    raise exception 'VALIDATION: v2.5 の標準見積から作った見積は、版の率（販売費率・経費率・掛率）で計算します（変えられません。値引きなどは調整額で入れてください）'
      using errcode = 'P0001';
  end if;
  -- 経費の決め方（2026-11-04 の先方回答 A-2 ⑥）：経費を掛ける区分は「率」か「金額を手動」、掛けない区分（別途工事）は「なし」
  if exists (
       select 1
         from public.standard_estimate_revisions source_rev
         join public.pricing_calculation_rule_versions source_rule on source_rule.id = source_rev.calc_rule_version_id
        cross join pg_catalog.unnest(array['base', 'interior_exterior', 'option', 'sitework']) as sec(code)
        where source_rev.id = d.standard_estimate_revision_id and source_rev.pricing_model = 'v2.5'
          and case when sec.code = any(source_rule.expense_target_sections)
                   then coalesce(p_expense_methods ->> sec.code, 'rate') not in ('rate', 'fixed')
                   else coalesce(p_expense_methods ->> sec.code, 'none') <> 'none' end
     ) then
    raise exception 'VALIDATION: v2.5 の標準見積から作った見積は、版の率（販売費率・経費率・掛率）で計算します。経費は、経費を掛ける区分で「率」か「金額を手動」を選んでください（「なし」にはできません）'
      using errcode = 'P0001';
  end if;$new$
);

-- 発行の記録：手動の額も残す（変えない）
select pg_temp.expense_patch_function(
  'public.write_quote_internal_snapshot(uuid, uuid)'::regprocedure,
  $old$  insert into public.quote_internal_snapshots (
    quote_id, source_kind, standard_estimate_revision_id, sales_fee_rate, expense_rate, markup_rate,
    expense_methods, subtotal, cost_total, gross_profit, lines, created_by
  )
  values (
    q.id, 'standard_estimate', d.standard_estimate_revision_id, n.sales_fee_rate, n.expense_rate, n.markup_rate,
    n.expense_methods, q.subtotal, v_cost_total::integer, q.subtotal - v_cost_total::integer, v_lines, auth.uid()
  );$old$,
  $new$  insert into public.quote_internal_snapshots (
    quote_id, source_kind, standard_estimate_revision_id, sales_fee_rate, expense_rate, markup_rate,
    expense_methods, expense_amounts, subtotal, cost_total, gross_profit, lines, created_by
  )
  values (
    q.id, 'standard_estimate', d.standard_estimate_revision_id, n.sales_fee_rate, n.expense_rate, n.markup_rate,
    n.expense_methods, n.expense_amounts, q.subtotal, v_cost_total::integer, q.subtotal - v_cost_total::integer, v_lines, auth.uid()
  );$new$
);

-- 改訂の下書き：直前の発行版の手動の額も引き継ぐ
select pg_temp.expense_patch_function(
  'public.prepare_quote_revision_draft(uuid, uuid)'::regprocedure,
  $old$  insert into public.quote_draft_internals (draft_id, sales_fee_rate, expense_rate, markup_rate, expense_methods, cost_total)
  values (d.id, s.sales_fee_rate, s.expense_rate, s.markup_rate, s.expense_methods, s.cost_total);$old$,
  $new$  insert into public.quote_draft_internals (draft_id, sales_fee_rate, expense_rate, markup_rate, expense_methods, expense_amounts, cost_total)
  values (d.id, s.sales_fee_rate, s.expense_rate, s.markup_rate, s.expense_methods, s.expense_amounts, s.cost_total);$new$
);

drop function pg_temp.expense_patch_function(regprocedure, text, text);

comment on function public.create_quote_revision_v25(uuid, jsonb, integer, text, text) is
  'v2.5 の標準見積から作った Web の見積の第 2 版以降を、固定した版の v2.5 の決まりで発行する（前の版の行は前の版の単価、商品台帳の商品は v2.5 の売価、自由明細は担当者の売価、経費・税はサーバーが計算。千円未満の切り捨てなし）。経費は区分ごとに率か手動の額（前の版の決め方を引き継ぎ、p_lines の source: expense で変える。A-2 ⑥）。本部と担当の代理店・総代理店だけ（v2.5 PR-D1）';

-- ---------- 所有者と権限 ----------

alter function public.quote_expense_amounts_valid(jsonb, jsonb) owner to postgres;
alter function public.standard_estimate_v25_expense_settings(uuid) owner to postgres;
alter function public.quote_v25_default_expenses(text[]) owner to postgres;
alter function public.quote_v25_expense_description(text, text) owner to postgres;
alter function public.quotes_v25_expenses_guard() owner to postgres;

-- 内部の部品・トリガー関数は API のロールから直接実行させない（Supabase は public の関数へ既定で EXECUTE を付けるため明示して外す）
revoke all on function public.quote_expense_amounts_valid(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_expense_settings(uuid) from public, anon, authenticated, service_role;
revoke all on function public.quote_v25_default_expenses(text[]) from public, anon, authenticated, service_role;
revoke all on function public.quote_v25_expense_description(text, text) from public, anon, authenticated, service_role;
revoke all on function public.quotes_v25_expenses_guard() from public, anon, authenticated, service_role;
-- 手動の額の検査は、下書き・発行の記録の check 制約から呼ぶ。check 制約の関数は書き込む側のロールの実行権限で動くので、
-- 2 つの表に書ける service_role（サーバーの保守用）には実行を許す（中身は検査だけ。表に書けない anon・authenticated には許さない）
grant execute on function public.quote_expense_amounts_valid(jsonb, jsonb) to service_role;

-- ---------- postconditions ----------

do $postconditions$
declare
  v_name text;
begin
  -- 差し込んだ関数（目印の文が入ったこと）
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.pricing_calculate(uuid, uuid, jsonb)'::regprocedure), 'v_fixed_expense := public.pricing_input_integer') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.prevent_new_fixed_standard_estimate_expense()'::regprocedure), 'standard_estimate_v25_writer_active()') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_calc_input(uuid, integer)'::regprocedure), '''expense_amount'', s.expense_amount') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)'::regprocedure), 'when v_fixed then ''fixed''') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.start_standard_estimate_v25_draft(uuid, integer, uuid)'::regprocedure), 'src.expense_method = ''fixed''') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure), 'p_payload -> ''expenses''') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_configuration_money(uuid, uuid)'::regprocedure), 'when s.expense_method = ''fixed'' then s.expense_amount') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.write_standard_estimate_quote_items(uuid, uuid)'::regprocedure), 'standard_estimate_v25_expense_settings(r.id)') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.get_quote_v25_context(uuid)'::regprocedure), 'quote_v25_default_expenses') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure), 'v_source = ''expense''') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)'::regprocedure), 'expense_amounts = excluded.expense_amounts') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.materialize_standard_quote_draft(uuid, uuid)'::regprocedure), 'jsonb_build_object(''amounts''') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.save_standard_quote_draft(uuid, integer, numeric, numeric, numeric, jsonb, jsonb, integer, text, text)'::regprocedure), '「率」か「金額を手動」') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.write_quote_internal_snapshot(uuid, uuid)'::regprocedure), 'n.expense_amounts') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.prepare_quote_revision_draft(uuid, uuid)'::regprocedure), 's.expense_amounts') = 0 then
    raise exception 'POSTCONDITION: the expense functions were not patched';
  end if;
  -- 内部の部品は API のロールから実行できない（check 制約の検査だけは、表に書ける service_role が実行できる）
  foreach v_name in array array[
    'public.quote_expense_amounts_valid(jsonb, jsonb)', 'public.standard_estimate_v25_expense_settings(uuid)',
    'public.quote_v25_default_expenses(text[])', 'public.quote_v25_expense_description(text, text)', 'public.quotes_v25_expenses_guard()'
  ] loop
    if has_function_privilege('anon', v_name, 'EXECUTE')
       or has_function_privilege('authenticated', v_name, 'EXECUTE')
       or has_function_privilege('service_role', v_name, 'EXECUTE') <> (v_name = 'public.quote_expense_amounts_valid(jsonb, jsonb)') then
      raise exception 'POSTCONDITION: unexpected EXECUTE privilege on % for API roles', v_name;
    end if;
  end loop;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.create_quote_revision_v25(uuid, jsonb, integer, text, text)'::regprocedure),
                       'is distinct from ''expense'') > 300') = 0 then
    raise exception 'POSTCONDITION: the line limit of create_quote_revision_v25 was not patched';
  end if;
  -- 既存のデータは変えていない（列を足しただけ）
  if exists (select 1 from public.quotes where v25_expenses is not null)
     or exists (select 1 from public.quote_draft_internals where expense_amounts <> '{}'::jsonb)
     or exists (select 1 from public.quote_internal_snapshots where expense_amounts <> '{}'::jsonb) then
    raise exception 'POSTCONDITION: existing quotes and drafts must not change';
  end if;
end;
$postconditions$;

commit;
