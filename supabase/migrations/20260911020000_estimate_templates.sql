-- =============================================================
-- 標準見積テンプレート（実物Excelを価格の正本として保持）
--
-- 方針:
--   * 4分類 = 本体 / 内外装工事 / オプション / 別途
--   * 本体の明細は既存 base_breakdown_items を唯一の正本とし、ここへ複製しない
--   * 本体以外の明細だけ estimate_template_lines に保持する
--   * preset + options.price から標準見積を再構成しない。標準見積の価格源はExcelのみ
--   * 防火テンプレートは今回対象外
-- =============================================================

create table if not exists public.estimate_templates (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models(id) on delete cascade,
  spec_code text not null,
  name text not null,
  source_file_name text not null,
  source_sheet_name text not null,
  source_sha256 text not null,
  tax_rate numeric not null default 0.10,
  subtotal_raw integer not null default 0,
  adjustment integer not null default 0,
  subtotal integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (base_model_id, spec_code)
);

create table if not exists public.estimate_template_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  code text not null check (code in ('base', 'interior_exterior', 'option', 'sitework')),
  label text not null,
  line_subtotal integer not null default 0,
  expense_label text,
  expense_rate numeric,
  expense_amount integer not null default 0,
  total integer not null default 0,
  sort_order integer not null default 0,
  unique (template_id, code)
);

create table if not exists public.estimate_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  -- base 明細は base_breakdown_items に置くため、ここでは禁止する
  section_code text not null check (section_code in ('interior_exterior', 'option', 'sitework')),
  group_label text,
  name text not null,
  quantity numeric,
  unit text,
  unit_price integer,
  amount integer not null default 0,
  remark text,
  sort_order integer not null default 0
);

create index if not exists estimate_template_lines_idx
  on public.estimate_template_lines(template_id, section_code, sort_order);

alter table public.estimate_templates enable row level security;
alter table public.estimate_template_sections enable row level security;
alter table public.estimate_template_lines enable row level security;

drop policy if exists estimate_templates_read on public.estimate_templates;
create policy estimate_templates_read on public.estimate_templates for select using (true);
drop policy if exists estimate_templates_write on public.estimate_templates;
create policy estimate_templates_write on public.estimate_templates for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists estimate_template_sections_read on public.estimate_template_sections;
create policy estimate_template_sections_read on public.estimate_template_sections for select using (true);
drop policy if exists estimate_template_sections_write on public.estimate_template_sections;
create policy estimate_template_sections_write on public.estimate_template_sections for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists estimate_template_lines_read on public.estimate_template_lines;
create policy estimate_template_lines_read on public.estimate_template_lines for select using (true);
drop policy if exists estimate_template_lines_write on public.estimate_template_lines;
create policy estimate_template_lines_write on public.estimate_template_lines for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

grant select on public.estimate_templates, public.estimate_template_sections, public.estimate_template_lines to anon, authenticated;
grant all on public.estimate_templates, public.estimate_template_sections, public.estimate_template_lines to authenticated, service_role;

-- Excelの解析結果を一括で置き換える。1回のRPC全体が1トランザクションなので途中状態を残さない。
create or replace function public.replace_estimate_templates(p_templates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t jsonb;
  v_template_id uuid;
  v_model uuid;
  v_spec text;
  v_count integer;
  v_base_lines integer;
  v_section_lines integer;
  v_section_total integer;
  s record;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 標準見積を更新する権限がありません' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_templates, '[]'::jsonb)) <> 'array' then
    raise exception 'VALIDATION: 標準見積データの形式が正しくありません' using errcode = 'P0001';
  end if;

  for t in select value from jsonb_array_elements(coalesce(p_templates, '[]'::jsonb))
  loop
    v_model := (t ->> 'base_model_id')::uuid;
    v_spec := nullif(t ->> 'spec_code', '');
    if v_spec is null then
      raise exception 'VALIDATION: 仕様コードがありません' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.base_models where id = v_model) then
      raise exception 'VALIDATION: 本体モデルが見つかりません' using errcode = 'P0001';
    end if;

    delete from public.estimate_templates where base_model_id = v_model and spec_code = v_spec;
    delete from public.base_breakdown_items where base_model_id = v_model and spec_code = v_spec;

    insert into public.estimate_templates (
      base_model_id, spec_code, name, source_file_name, source_sheet_name, source_sha256,
      tax_rate, subtotal_raw, adjustment, subtotal, tax, total, imported_at, updated_at
    )
    values (
      v_model, v_spec, t ->> 'name', t ->> 'source_file_name', t ->> 'source_sheet_name', t ->> 'source_sha256',
      coalesce((t ->> 'tax_rate')::numeric, 0.10),
      coalesce((t ->> 'subtotal_raw')::integer, 0),
      coalesce((t ->> 'adjustment')::integer, 0),
      coalesce((t ->> 'subtotal')::integer, 0),
      coalesce((t ->> 'tax')::integer, 0),
      coalesce((t ->> 'total')::integer, 0),
      now(), now()
    )
    returning id into v_template_id;

    insert into public.estimate_template_sections (
      template_id, code, label, line_subtotal, expense_label, expense_rate, expense_amount, total, sort_order
    )
    select
      v_template_id,
      x.code,
      x.label,
      x.line_subtotal,
      nullif(x.expense_label, ''),
      x.expense_rate,
      x.expense_amount,
      x.total,
      x.sort_order
    from jsonb_to_recordset(coalesce(t -> 'sections', '[]'::jsonb)) as x(
      code text,
      label text,
      line_subtotal integer,
      expense_label text,
      expense_rate numeric,
      expense_amount integer,
      total integer,
      sort_order integer
    );

    insert into public.base_breakdown_items (
      base_model_id, spec_code, section, name, quantity, unit, unit_price, amount, remark, sort_order
    )
    select
      v_model,
      v_spec,
      x.section,
      x.name,
      x.quantity,
      nullif(x.unit, ''),
      x.unit_price,
      x.amount,
      nullif(x.remark, ''),
      x.sort_order
    from jsonb_to_recordset(coalesce(t -> 'base_breakdown_items', '[]'::jsonb)) as x(
      section text,
      name text,
      quantity numeric,
      unit text,
      unit_price integer,
      amount integer,
      remark text,
      sort_order integer
    );

    insert into public.estimate_template_lines (
      template_id, section_code, group_label, name, quantity, unit, unit_price, amount, remark, sort_order
    )
    select
      v_template_id,
      x.section_code,
      nullif(x.group_label, ''),
      x.name,
      x.quantity,
      nullif(x.unit, ''),
      x.unit_price,
      x.amount,
      nullif(x.remark, ''),
      x.sort_order
    from jsonb_to_recordset(coalesce(t -> 'lines', '[]'::jsonb)) as x(
      section_code text,
      group_label text,
      name text,
      quantity numeric,
      unit text,
      unit_price integer,
      amount integer,
      remark text,
      sort_order integer
    );

    select count(*) into v_count
      from public.estimate_template_sections
     where template_id = v_template_id;
    if v_count <> 4 then
      raise exception 'VALIDATION: 標準見積の4分類が揃っていません（%）', v_spec using errcode = 'P0001';
    end if;

    select coalesce(sum(amount), 0)::integer into v_base_lines
      from public.base_breakdown_items
     where base_model_id = v_model and spec_code = v_spec;

    for s in
      select code, line_subtotal, expense_amount, total
        from public.estimate_template_sections
       where template_id = v_template_id
    loop
      if s.code = 'base' then
        v_section_lines := v_base_lines;
      else
        select coalesce(sum(amount), 0)::integer into v_section_lines
          from public.estimate_template_lines
         where template_id = v_template_id and section_code = s.code;
      end if;
      if v_section_lines <> s.line_subtotal then
        raise exception 'VALIDATION: % の明細合計が一致しません（%）', s.code, v_spec using errcode = 'P0001';
      end if;
      if s.line_subtotal + s.expense_amount <> s.total then
        raise exception 'VALIDATION: % の分類合計が一致しません（%）', s.code, v_spec using errcode = 'P0001';
      end if;
    end loop;

    select coalesce(sum(total), 0)::integer into v_section_total
      from public.estimate_template_sections
     where template_id = v_template_id;
    if v_section_total <> (t ->> 'subtotal_raw')::integer then
      raise exception 'VALIDATION: 4分類合計と小計が一致しません（%）', v_spec using errcode = 'P0001';
    end if;
    if (t ->> 'subtotal_raw')::integer + (t ->> 'adjustment')::integer <> (t ->> 'subtotal')::integer then
      raise exception 'VALIDATION: 値引き等調整額の検算が一致しません（%）', v_spec using errcode = 'P0001';
    end if;
    if floor((t ->> 'subtotal')::numeric * (t ->> 'tax_rate')::numeric)::integer <> (t ->> 'tax')::integer then
      raise exception 'VALIDATION: 消費税の検算が一致しません（%）', v_spec using errcode = 'P0001';
    end if;
    if (t ->> 'subtotal')::integer + (t ->> 'tax')::integer <> (t ->> 'total')::integer then
      raise exception 'VALIDATION: 合計金額の検算が一致しません（%）', v_spec using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

revoke all on function public.replace_estimate_templates(jsonb) from public;
grant execute on function public.replace_estimate_templates(jsonb) to authenticated, service_role;
