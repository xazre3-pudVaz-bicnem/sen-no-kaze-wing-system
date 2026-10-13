-- PR E：標準見積（Standard Estimate）の identity・金額の取り決め・RPC（統合版依頼書 §6・§7 の M7 / M8 / M9）。
--
-- 対象の表（standard_estimate_*）は 20260915012500 で作られ、アプリからはまだ使われていない（本番も未適用で 0 件）。
-- 既存の行がある DB では、金額の正本を後から変えないよう何も変更せずに停止する。
--
-- M7 identity：標準見積は本体マスター（PR D1：組織 × 機種・用途・サイズ × 防火）に紐づき、機種・用途は本体マスターの行と一致する。
--             Revision は公開中の本体 Revision を固定（pin）する。
-- M8 金額：Revision に販売費率（100〜150%）・経費率（0〜30%）・掛率（100〜250%）を保存し、すべての計算境界で trunc。
--     本体は本体マスターの明細を写さず、固定した本体 Revision の整数の基準原価単価から計算する（二重に持たない）。
--     明細の price_mode は auto（率で計算）・manual（売価単価を直接入力）・por（価格未確定。金額は NULL、合計から除外）。
--     経費は区分ごとに rate / none だけ。fixed は新しく使わない（既存の fixed は読み取り互換のみ）。
-- M9 RPC：作成・保存・公開・次の Revision。lock_version で同時編集を検知し、公開済みは変更しない。
--
-- 式は lib/domain/standard-estimate-money.ts（画面の試算）と同じ。正本はこの RPC の計算。

begin;

-- ---------- preflight ----------

do $$
begin
  if to_regclass('public.standard_estimate_revisions') is null then
    raise exception 'PRECONDITION: standard estimate foundation (20260915012500) is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'base_masters' and column_name = 'matrix_row_id') then
    raise exception 'PRECONDITION: base master matrix identity (PR D1) must be applied first';
  end if;
  if exists (select 1 from public.standard_estimate_revisions) then
    raise exception 'PRECONDITION: standard_estimate_revisions already has rows; review before applying the money contract';
  end if;
end;
$$;

-- ---------- M8：率・区分・明細 ----------

alter table public.standard_estimate_revisions
  add column sales_fee_rate numeric(6, 4) not null default 1.0000,
  add column expense_rate numeric(6, 4) not null default 0.1500,
  add column markup_rate numeric(6, 4) not null default 1.5000,
  add column cost_total integer not null default 0 check (cost_total >= 0),
  add column has_por boolean not null default false,
  add constraint standard_estimate_revisions_rate_ranges check (
    sales_fee_rate between 1.0000 and 1.5000
    and expense_rate between 0.0000 and 0.3000
    and markup_rate between 1.0000 and 2.5000
  );

comment on column public.standard_estimate_revisions.cost_total is '内部原価の合計（お客様・代理店には見せない）。POR の行は含めない。';

-- 本体（base）を区分に加え、原価側の小計・経費を持たせる（本体の明細そのものは本体マスターにあり、写さない）
alter table public.standard_estimate_revision_sections
  drop constraint if exists standard_estimate_revision_sections_section_code_check;
alter table public.standard_estimate_revision_sections
  add constraint standard_estimate_revision_sections_section_code_check
    check (section_code in ('base', 'interior_exterior', 'option', 'sitework')),
  add column cost_line_subtotal integer not null default 0 check (cost_line_subtotal >= 0),
  add column cost_expense_amount integer not null default 0 check (cost_expense_amount >= 0),
  add column cost_total integer not null default 0 check (cost_total >= 0),
  add column has_por boolean not null default false,
  add constraint standard_estimate_sections_cost_money check (
    cost_total = cost_line_subtotal + cost_expense_amount
    and (
      (expense_method = 'rate' and cost_expense_amount = trunc(cost_line_subtotal::numeric * expense_rate)::integer)
      or (expense_method = 'none' and cost_expense_amount = 0)
      or expense_method = 'fixed'
    )
  );

-- 明細：売価（unit_price / amount）は POR で NULL。原価（cost_*）を加え、丸めを round から trunc へ
alter table public.standard_estimate_revision_lines
  add column price_mode text not null default 'auto' check (price_mode in ('auto', 'manual', 'por')),
  add column cost_unit_price integer check (cost_unit_price is null or cost_unit_price >= 0),
  add column cost_amount integer check (cost_amount is null or cost_amount >= 0),
  alter column unit_price drop not null,
  alter column unit_price drop default,
  alter column amount drop not null,
  alter column amount drop default;

do $drop_round_check$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.standard_estimate_revision_lines'::regclass
       and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) ilike '%round(%'
  loop
    execute format('alter table public.standard_estimate_revision_lines drop constraint %I', v_name);
  end loop;
end;
$drop_round_check$;

alter table public.standard_estimate_revision_lines
  add constraint standard_estimate_lines_money check (
    (price_mode = 'por' and unit_price is null and amount is null and cost_unit_price is null and cost_amount is null)
    or (
      price_mode in ('auto', 'manual')
      and unit_price is not null and amount is not null and cost_unit_price is not null and cost_amount is not null
      and amount = trunc(quantity * unit_price)::integer
      and cost_amount = trunc(quantity * cost_unit_price)::integer
    )
  );

-- fixed は新しく使わない（新規作成・rate / none からの変更を拒否。既存の fixed は読み取り互換）
create function public.prevent_new_fixed_standard_estimate_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expense_method = 'fixed' and (tg_op = 'INSERT' or old.expense_method is distinct from 'fixed') then
    raise exception 'VALIDATION: 経費の計算方法は「率」か「なし」を選んでください（固定額は使えません）' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger standard_estimate_sections_no_new_fixed
before insert or update of expense_method on public.standard_estimate_revision_sections
for each row execute function public.prevent_new_fixed_standard_estimate_expense();

create function public.prevent_published_standard_estimate_money_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.sales_fee_rate is distinct from old.sales_fee_rate
    or new.expense_rate is distinct from old.expense_rate
    or new.markup_rate is distinct from old.markup_rate
    or new.cost_total is distinct from old.cost_total
    or new.has_por is distinct from old.has_por
  ) then
    raise exception 'LOCKED: 公開済みの標準見積の率・金額は変更できません' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger standard_estimate_revisions_money_immutable
before update on public.standard_estimate_revisions
for each row execute function public.prevent_published_standard_estimate_money_change();

-- ---------- M7：identity ----------

create function public.enforce_standard_estimate_master_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bm public.base_masters;
  mr public.matrix_rows;
begin
  select * into bm from public.base_masters where id = new.base_master_id;
  if not found or bm.matrix_row_id is null then
    raise exception 'VALIDATION: 標準見積の基準には、仕様マトリクスの行を持つ本体を指定してください' using errcode = 'P0001';
  end if;
  select * into mr from public.matrix_rows where id = bm.matrix_row_id;
  if mr.base_model_id is distinct from new.base_model_id or bm.base_model_id is distinct from new.base_model_id then
    raise exception 'VALIDATION: 標準見積と本体の商品モデルが一致しません' using errcode = 'P0001';
  end if;
  if mr.spec_code is distinct from new.spec_code then
    raise exception 'VALIDATION: 標準見積の用途と本体の用途（仕様マトリクスの行）が一致しません' using errcode = 'P0001';
  end if;
  if bm.owner_organization_id is distinct from new.owner_organization_id then
    raise exception 'VALIDATION: 標準見積と本体の管理元が一致しません' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger standard_estimate_masters_identity
before insert or update of base_master_id, base_model_id, spec_code, owner_organization_id on public.standard_estimate_masters
for each row execute function public.enforce_standard_estimate_master_identity();

-- ---------- 計算（内部。API からは実行させない） ----------

create function public.recalculate_standard_estimate_revision(
  p_revision_id uuid,
  p_adjustment integer default null,
  p_adjustment_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rev public.standard_estimate_revisions;
  s record;
  v_cost_lines integer;
  v_sale_lines integer;
  v_por boolean;
  v_subtotal_raw integer := 0;
  v_cost_total integer := 0;
  v_has_por boolean := false;
  v_subtotal integer;
  v_adjustment integer;
  v_reason text;
begin
  select * into rev from public.standard_estimate_revisions where id = p_revision_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  for s in select * from public.standard_estimate_revision_sections where revision_id = rev.id order by section_code loop
    if s.section_code = 'base' then
      -- 本体：固定した本体 Revision の整数の基準原価単価 × 販売費率 → 原価単価、× 掛率 → 売価単価（すべて trunc）
      select coalesce(sum(trunc(l.quantity * trunc(l.unit_price * rev.sales_fee_rate))), 0)::integer,
             coalesce(sum(trunc(l.quantity * trunc(trunc(l.unit_price * rev.sales_fee_rate) * rev.markup_rate))), 0)::integer,
             false
        into v_cost_lines, v_sale_lines, v_por
        from public.base_master_revision_lines l
       where l.revision_id = rev.base_master_revision_id;
    else
      select coalesce(sum(l.cost_amount) filter (where l.price_mode <> 'por'), 0)::integer,
             coalesce(sum(l.amount) filter (where l.price_mode <> 'por'), 0)::integer,
             coalesce(bool_or(l.price_mode = 'por'), false)
        into v_cost_lines, v_sale_lines, v_por
        from public.standard_estimate_revision_lines l
       where l.revision_id = rev.id and l.section_code = s.section_code;
    end if;

    update public.standard_estimate_revision_sections
       set expense_rate = case when s.expense_method = 'rate' then rev.expense_rate else null end,
           line_subtotal = v_sale_lines,
           expense_amount = case when s.expense_method = 'rate' then trunc(v_sale_lines * rev.expense_rate)::integer
                                 when s.expense_method = 'fixed' then s.expense_amount else 0 end,
           total = v_sale_lines + case when s.expense_method = 'rate' then trunc(v_sale_lines * rev.expense_rate)::integer
                                       when s.expense_method = 'fixed' then s.expense_amount else 0 end,
           cost_line_subtotal = v_cost_lines,
           cost_expense_amount = case when s.expense_method = 'rate' then trunc(v_cost_lines * rev.expense_rate)::integer else 0 end,
           cost_total = v_cost_lines + case when s.expense_method = 'rate' then trunc(v_cost_lines * rev.expense_rate)::integer else 0 end,
           has_por = v_por
     where id = s.id
    returning total, cost_total, has_por into v_sale_lines, v_cost_lines, v_por;

    v_subtotal_raw := v_subtotal_raw + v_sale_lines;
    v_cost_total := v_cost_total + v_cost_lines;
    v_has_por := v_has_por or v_por;
  end loop;

  -- 調整額は整数円をそのまま加減算し、税だけ trunc。合計と同じ 1 文で書く（行の CHECK を途中の状態で破らない）
  v_adjustment := coalesce(p_adjustment, rev.standard_adjustment_amount);
  v_reason := case when p_adjustment is null then rev.standard_adjustment_reason
                   when p_adjustment = 0 then null
                   else btrim(p_adjustment_reason) end;
  v_subtotal := v_subtotal_raw + v_adjustment;
  if v_subtotal < 0 then
    raise exception 'VALIDATION: 調整後の小計が 0 円未満です' using errcode = 'P0001';
  end if;

  update public.standard_estimate_revisions
     set standard_adjustment_amount = v_adjustment,
         standard_adjustment_reason = v_reason,
         subtotal_raw = v_subtotal_raw,
         subtotal = v_subtotal,
         tax = trunc(v_subtotal * tax_rate)::integer,
         total = v_subtotal + trunc(v_subtotal * tax_rate)::integer,
         cost_total = v_cost_total,
         has_por = v_has_por
   where id = rev.id;
end;
$$;

-- ---------- M9：RPC ----------

create function public.create_standard_estimate_draft(p_base_master_revision_id uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  bmr public.base_master_revisions;
  bm public.base_masters;
  mr public.matrix_rows;
  m public.standard_estimate_masters;
  v_rev uuid;
  v_version integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into bmr from public.base_master_revisions where id = p_base_master_revision_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into bm from public.base_masters where id = bmr.base_master_id;
  -- 権限は状態の判定より前に確認する
  if not coalesce(public.can_create_standard_estimate_master_for_org(bm.owner_organization_id), false) then
    raise exception 'FORBIDDEN: この本体の標準見積を作成できません' using errcode = '42501';
  end if;
  if bmr.status <> 'published' then
    raise exception 'LOCKED: 公開中の本体 Revision だけを標準見積の基準にできます' using errcode = 'P0001';
  end if;
  if bm.status <> 'active' or bm.matrix_row_id is null then
    raise exception 'LOCKED: 仕様マトリクスの行を持つ有効な本体だけを基準にできます' using errcode = 'P0001';
  end if;
  select * into mr from public.matrix_rows where id = bm.matrix_row_id;

  select * into m from public.standard_estimate_masters
   where owner_organization_id = bm.owner_organization_id and base_master_id = bm.id and spec_code = mr.spec_code
   for update;
  if not found then
    insert into public.standard_estimate_masters (owner_organization_id, base_model_id, base_master_id, spec_code, name, created_by, updated_by)
    values (bm.owner_organization_id, bm.base_model_id, bm.id, mr.spec_code,
            coalesce(nullif(btrim(coalesce(p_name, '')), ''), bm.name), v_uid, v_uid)
    returning * into m;
  elsif exists (select 1 from public.standard_estimate_revisions r where r.standard_estimate_master_id = m.id and r.status = 'draft') then
    raise exception 'LOCKED: この標準見積には編集中の下書きがあります' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.standard_estimate_revisions where standard_estimate_master_id = m.id;
  insert into public.standard_estimate_revisions (standard_estimate_master_id, version, status, base_master_revision_id, lock_version, source_kind, created_by, updated_by)
  values (m.id, v_version, 'draft', bmr.id, 1, 'ui', v_uid, v_uid)
  returning id into v_rev;

  insert into public.standard_estimate_revision_sections (revision_id, section_code, expense_method, expense_rate)
  values (v_rev, 'base', 'rate', 0.1500), (v_rev, 'interior_exterior', 'rate', 0.1500), (v_rev, 'option', 'rate', 0.1500), (v_rev, 'sitework', 'none', null);

  perform public.recalculate_standard_estimate_revision(v_rev);
  return v_rev;
end;
$$;

create function public.save_standard_estimate_draft(
  p_revision_id uuid,
  p_sales_fee_rate numeric,
  p_expense_rate numeric,
  p_markup_rate numeric,
  p_adjustment integer,
  p_adjustment_reason text,
  p_section_methods jsonb,
  p_lines jsonb,
  p_expected_lock_version integer
)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions;
  v_section text;
  v_method text;
  line jsonb;
  v_sort integer := 0;
  v_mode text;
  v_qty numeric;
  v_cost integer;
  v_sale integer;
  v_name text;
  v_key uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into rev from public.standard_estimate_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_edit_standard_estimate_master(rev.standard_estimate_master_id), false) then
    raise exception 'FORBIDDEN: この標準見積を編集できません' using errcode = '42501';
  end if;
  if rev.status <> 'draft' then
    raise exception 'LOCKED: 公開済みの Revision は変更できません。次の Revision を作成してください' using errcode = 'P0001';
  end if;
  if rev.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの標準見積が更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
  end if;

  if p_sales_fee_rate is null or p_sales_fee_rate < 1 or p_sales_fee_rate > 1.5 or p_sales_fee_rate <> round(p_sales_fee_rate, 4) then
    raise exception 'VALIDATION: 販売費率は 100〜150%% の範囲で入力してください' using errcode = 'P0001';
  end if;
  if p_expense_rate is null or p_expense_rate < 0 or p_expense_rate > 0.3 or p_expense_rate <> round(p_expense_rate, 4) then
    raise exception 'VALIDATION: 経費率は 0〜30%% の範囲で入力してください' using errcode = 'P0001';
  end if;
  if p_markup_rate is null or p_markup_rate < 1 or p_markup_rate > 2.5 or p_markup_rate <> round(p_markup_rate, 4) then
    raise exception 'VALIDATION: 掛率は 100〜250%% の範囲で入力してください' using errcode = 'P0001';
  end if;
  if p_adjustment is null or (p_adjustment <> 0 and nullif(btrim(coalesce(p_adjustment_reason, '')), '') is null) then
    raise exception 'VALIDATION: 調整額を入れる場合は理由を入力してください' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 300 then
    raise exception 'VALIDATION: 明細の形式が不正です（300 行以内）' using errcode = 'P0001';
  end if;
  if p_section_methods is null or jsonb_typeof(p_section_methods) <> 'object' then
    raise exception 'VALIDATION: 区分の経費の計算方法を指定してください' using errcode = 'P0001';
  end if;

  update public.standard_estimate_revisions
     set sales_fee_rate = p_sales_fee_rate,
         expense_rate = p_expense_rate,
         markup_rate = p_markup_rate,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = rev.id
  returning * into rev;

  foreach v_section in array array['base', 'interior_exterior', 'option', 'sitework'] loop
    v_method := coalesce(p_section_methods ->> v_section, case when v_section = 'sitework' then 'none' else 'rate' end);
    if v_method not in ('rate', 'none') then
      raise exception 'VALIDATION: 経費の計算方法は「率」か「なし」を選んでください（固定額は使えません）' using errcode = 'P0001';
    end if;
    update public.standard_estimate_revision_sections
       set expense_method = v_method,
           expense_rate = case when v_method = 'rate' then rev.expense_rate else null end,
           line_subtotal = 0, expense_amount = 0, total = 0,
           cost_line_subtotal = 0, cost_expense_amount = 0, cost_total = 0, has_por = false
     where revision_id = rev.id and section_code = v_section;
  end loop;

  delete from public.standard_estimate_revision_lines where revision_id = rev.id;

  for line in select value from jsonb_array_elements(p_lines) loop
    v_sort := v_sort + 1;
    v_section := line ->> 'section_code';
    if v_section is null or v_section not in ('interior_exterior', 'option', 'sitework') then
      raise exception 'VALIDATION: %行目の区分が不正です（本体の明細は本体マスターで管理します）', v_sort using errcode = 'P0001';
    end if;
    v_name := nullif(btrim(coalesce(line ->> 'name', '')), '');
    if v_name is null or length(v_name) > 120 then
      raise exception 'VALIDATION: %行目の品名は 1〜120 文字で入力してください', v_sort using errcode = 'P0001';
    end if;
    v_mode := coalesce(line ->> 'price_mode', 'auto');
    if v_mode not in ('auto', 'manual', 'por') then
      raise exception 'VALIDATION: %行目の価格の決め方が不正です', v_sort using errcode = 'P0001';
    end if;
    begin
      v_qty := coalesce((line ->> 'quantity')::numeric, 1);
      v_cost := (line ->> 'cost_unit_price')::integer;
      v_sale := (line ->> 'unit_price')::integer;
      v_key := nullif(line ->> 'line_key', '')::uuid;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'VALIDATION: %行目の数量・単価・識別子の形式が不正です', v_sort using errcode = 'P0001';
    end;
    if v_qty <= 0 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception 'VALIDATION: %行目の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください', v_sort using errcode = 'P0001';
    end if;

    if v_mode = 'por' then
      v_cost := null;
      v_sale := null;
    else
      if v_cost is null or v_cost < 0 then
        raise exception 'VALIDATION: %行目の原価単価（0 円以上）を入力してください', v_sort using errcode = 'P0001';
      end if;
      if v_mode = 'auto' then
        v_sale := trunc(v_cost * rev.markup_rate)::integer;
      elsif v_sale is null or v_sale < 0 then
        raise exception 'VALIDATION: %行目の売価単価（0 円以上）を入力してください', v_sort using errcode = 'P0001';
      end if;
    end if;

    insert into public.standard_estimate_revision_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit,
      price_mode, cost_unit_price, cost_amount, unit_price, amount, remark, sort_order
    )
    values (
      rev.id, coalesce(v_key, gen_random_uuid()), v_section,
      nullif(btrim(coalesce(line ->> 'group_label', '')), ''), v_name, v_qty,
      nullif(btrim(coalesce(line ->> 'unit', '')), ''),
      v_mode, v_cost, case when v_cost is null then null else trunc(v_qty * v_cost)::integer end,
      v_sale, case when v_sale is null then null else trunc(v_qty * v_sale)::integer end,
      nullif(btrim(coalesce(line ->> 'remark', '')), ''), v_sort
    );
  end loop;

  perform public.recalculate_standard_estimate_revision(rev.id, p_adjustment, p_adjustment_reason);
  select * into rev from public.standard_estimate_revisions where id = rev.id;
  return rev;
end;
$$;

create function public.publish_standard_estimate_revision(p_revision_id uuid, p_expected_lock_version integer)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions;
  m public.standard_estimate_masters;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into rev from public.standard_estimate_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_edit_standard_estimate_master(rev.standard_estimate_master_id), false) then
    raise exception 'FORBIDDEN: この標準見積を公開できません' using errcode = '42501';
  end if;
  select * into m from public.standard_estimate_masters where id = rev.standard_estimate_master_id for update;
  if rev.status <> 'draft' then
    raise exception 'LOCKED: 下書きの Revision だけ公開できます' using errcode = 'P0001';
  end if;
  if rev.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの標準見積が更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.base_master_revisions b where b.id = rev.base_master_revision_id and b.status = 'published') then
    raise exception 'LOCKED: 基準の本体 Revision が公開中ではありません。最新の本体 Revision で次の Revision を作成してください' using errcode = 'P0001';
  end if;
  -- auto の売価が現在の掛率と一致しているか（保存後に率だけが変わっていないこと）
  if exists (
    select 1 from public.standard_estimate_revision_lines l
     where l.revision_id = rev.id and l.price_mode = 'auto' and l.unit_price <> trunc(l.cost_unit_price * rev.markup_rate)::integer
  ) then
    raise exception 'VALIDATION: 掛率と売価が一致しない明細があります。保存し直してください' using errcode = 'P0001';
  end if;

  perform public.recalculate_standard_estimate_revision(rev.id);

  update public.standard_estimate_revisions
     set status = 'superseded'
   where standard_estimate_master_id = m.id and status = 'published';

  update public.standard_estimate_revisions
     set status = 'published', published_at = now(), published_by = v_uid, updated_by = v_uid, lock_version = lock_version + 1
   where id = rev.id;

  update public.standard_estimate_masters
     set current_published_revision_id = rev.id, updated_by = v_uid
   where id = m.id;

  select * into rev from public.standard_estimate_revisions where id = rev.id;
  return rev;
end;
$$;

create function public.start_next_standard_estimate_revision(p_master_id uuid, p_base_master_revision_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m public.standard_estimate_masters;
  cur public.standard_estimate_revisions;
  v_pin uuid;
  v_rev uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into m from public.standard_estimate_masters where id = p_master_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_edit_standard_estimate_master(m.id), false) then
    raise exception 'FORBIDDEN: この標準見積を編集できません' using errcode = '42501';
  end if;
  if exists (select 1 from public.standard_estimate_revisions r where r.standard_estimate_master_id = m.id and r.status = 'draft') then
    raise exception 'LOCKED: この標準見積には編集中の下書きがあります' using errcode = 'P0001';
  end if;
  select * into cur from public.standard_estimate_revisions where id = m.current_published_revision_id;
  if not found then
    raise exception 'LOCKED: 公開中の Revision がありません' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.standard_estimate_revision_sections s where s.revision_id = cur.id and s.expense_method = 'fixed') then
    raise exception 'LOCKED: 固定額の経費を含む Revision からは自動で引き継げません。経費の計算方法（率／なし）を選んで新しく作成してください' using errcode = 'P0001';
  end if;

  v_pin := coalesce(p_base_master_revision_id, cur.base_master_revision_id);
  if not exists (
    select 1 from public.base_master_revisions b
     where b.id = v_pin and b.base_master_id = m.base_master_id and b.status = 'published'
  ) then
    raise exception 'LOCKED: 同じ本体の公開中の Revision を基準にしてください' using errcode = 'P0001';
  end if;

  insert into public.standard_estimate_revisions (
    standard_estimate_master_id, version, status, base_master_revision_id, tax_rate,
    sales_fee_rate, expense_rate, markup_rate, standard_adjustment_amount, standard_adjustment_reason,
    lock_version, source_kind, created_by, updated_by
  )
  select m.id, (select max(version) + 1 from public.standard_estimate_revisions where standard_estimate_master_id = m.id), 'draft', v_pin, cur.tax_rate,
         cur.sales_fee_rate, cur.expense_rate, cur.markup_rate, 0, null,
         1, 'ui', v_uid, v_uid
  returning id into v_rev;

  insert into public.standard_estimate_revision_sections (revision_id, section_code, expense_method, expense_rate)
  select v_rev, s.section_code, s.expense_method, case when s.expense_method = 'rate' then cur.expense_rate else null end
    from public.standard_estimate_revision_sections s
   where s.revision_id = cur.id;

  insert into public.standard_estimate_revision_lines (
    revision_id, line_key, section_code, group_label, name, quantity, unit,
    price_mode, cost_unit_price, cost_amount, unit_price, amount, remark, sort_order
  )
  select v_rev, l.line_key, l.section_code, l.group_label, l.name, l.quantity, l.unit,
         l.price_mode, l.cost_unit_price, l.cost_amount, l.unit_price, l.amount, l.remark, l.sort_order
    from public.standard_estimate_revision_lines l
   where l.revision_id = cur.id;

  -- 調整額は合計と同じ 1 文で引き継ぐ（行の CHECK を途中の状態で破らない）
  perform public.recalculate_standard_estimate_revision(v_rev, cur.standard_adjustment_amount, cur.standard_adjustment_reason);
  return v_rev;
end;
$$;

-- ---------- owner / EXECUTE ----------

alter function public.prevent_new_fixed_standard_estimate_expense() owner to postgres;
alter function public.enforce_standard_estimate_master_identity() owner to postgres;
alter function public.recalculate_standard_estimate_revision(uuid, integer, text) owner to postgres;
alter function public.prevent_published_standard_estimate_money_change() owner to postgres;
alter function public.create_standard_estimate_draft(uuid, text) owner to postgres;
alter function public.save_standard_estimate_draft(uuid, numeric, numeric, numeric, integer, text, jsonb, jsonb, integer) owner to postgres;
alter function public.publish_standard_estimate_revision(uuid, integer) owner to postgres;
alter function public.start_next_standard_estimate_revision(uuid, uuid) owner to postgres;

revoke all on function public.prevent_new_fixed_standard_estimate_expense() from public, anon, authenticated, service_role;
revoke all on function public.enforce_standard_estimate_master_identity() from public, anon, authenticated, service_role;
revoke all on function public.recalculate_standard_estimate_revision(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.prevent_published_standard_estimate_money_change() from public, anon, authenticated, service_role;
revoke all on function public.create_standard_estimate_draft(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.save_standard_estimate_draft(uuid, numeric, numeric, numeric, integer, text, jsonb, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.publish_standard_estimate_revision(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.start_next_standard_estimate_revision(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.create_standard_estimate_draft(uuid, text) to authenticated;
grant execute on function public.save_standard_estimate_draft(uuid, numeric, numeric, numeric, integer, text, jsonb, jsonb, integer) to authenticated;
grant execute on function public.publish_standard_estimate_revision(uuid, integer) to authenticated;
grant execute on function public.start_next_standard_estimate_revision(uuid, uuid) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.create_standard_estimate_draft(uuid, text)'::regprocedure,
    'public.save_standard_estimate_draft(uuid, numeric, numeric, numeric, integer, text, jsonb, jsonb, integer)'::regprocedure,
    'public.publish_standard_estimate_revision(uuid, integer)'::regprocedure,
    'public.start_next_standard_estimate_revision(uuid, uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.recalculate_standard_estimate_revision(uuid, integer, text)'::regprocedure, 'EXECUTE') then
    raise exception 'POSTCONDITION: recalculate_standard_estimate_revision must not be executable by API roles';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.standard_estimate_revision_lines'::regclass and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) ilike '%round(%'
  ) then
    raise exception 'POSTCONDITION: line amounts must use trunc, not round';
  end if;
end;
$postcondition$;

commit;
