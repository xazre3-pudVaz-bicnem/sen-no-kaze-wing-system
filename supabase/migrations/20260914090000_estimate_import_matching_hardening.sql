-- Standard estimate import hardening.
-- Excel totals, baseline composition, and product-master deltas are separate sources.

alter table public.estimate_import_lines
  add column if not exists line_fingerprint_v2 text,
  add column if not exists rule_match_key_v2 text,
  add column if not exists source_row_json jsonb not null default '{}'::jsonb;

update public.estimate_import_lines
set line_fingerprint_v2 = coalesce(line_fingerprint_v2, line_fingerprint),
    rule_match_key_v2 = coalesce(rule_match_key_v2, line_fingerprint)
where line_fingerprint_v2 is null or rule_match_key_v2 is null;

alter table public.estimate_import_lines
  alter column line_fingerprint_v2 set not null,
  alter column rule_match_key_v2 set not null;

create index if not exists estimate_import_lines_fingerprint_v2_idx
  on public.estimate_import_lines(import_id, line_fingerprint_v2, fingerprint_ordinal);
create index if not exists estimate_import_lines_rule_key_v2_idx
  on public.estimate_import_lines(import_id, rule_match_key_v2);

alter table public.product_match_rules
  add column if not exists rule_match_key_v2 text;

update public.product_match_rules
set rule_match_key_v2 = coalesce(rule_match_key_v2, match_key)
where rule_match_key_v2 is null;

alter table public.product_match_rules
  alter column rule_match_key_v2 set not null;

create unique index if not exists product_match_rules_scope_key_v2_idx
  on public.product_match_rules(
    scope,
    coalesce(base_model_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(spec_code, ''),
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    rule_match_key_v2
  );

create table if not exists public.estimate_import_sections (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.estimate_imports(id) on delete cascade,
  section_code text not null check (section_code in ('base', 'interior_exterior', 'option', 'sitework')),
  label text not null,
  line_subtotal numeric not null default 0,
  expense_label text,
  expense_rate numeric,
  expense_amount numeric not null default 0,
  total numeric not null default 0,
  sort_order integer not null default 0,
  unique (import_id, section_code)
);

create index if not exists estimate_import_sections_import_idx
  on public.estimate_import_sections(import_id, sort_order);

insert into public.estimate_import_sections (
  import_id, section_code, label, line_subtotal, expense_label,
  expense_rate, expense_amount, total, sort_order
)
select i.id, x.code, x.label, x.line_subtotal, x.expense_label,
       x.expense_rate, x.expense_amount, x.total, x.sort_order
from public.estimate_imports i
cross join lateral jsonb_to_recordset(coalesce(i.template_payload -> 'sections', '[]'::jsonb)) as x(
  code text, label text, line_subtotal numeric, expense_label text,
  expense_rate numeric, expense_amount numeric, total numeric, sort_order integer
)
on conflict (import_id, section_code) do nothing;

create table if not exists public.estimate_template_baseline_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  option_id uuid not null references public.options(id) on delete restrict,
  category_id uuid not null references public.option_categories(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  slot_key text not null,
  section_code text not null check (section_code in ('base', 'interior_exterior', 'option', 'sitework')),
  source_import_line_id uuid references public.estimate_import_lines(id) on delete set null,
  sort_order integer not null default 0,
  unique (template_id, category_id, slot_key)
);

create index if not exists estimate_template_baseline_items_template_idx
  on public.estimate_template_baseline_items(template_id, sort_order);
create index if not exists estimate_template_baseline_items_option_idx
  on public.estimate_template_baseline_items(option_id);

insert into public.estimate_template_baseline_items (
  template_id, option_id, category_id, quantity, slot_key, section_code, sort_order
)
select
  t.id,
  o.id,
  o.category_id,
  1,
  case when c.code = 'exterior-wall' then slots.slot_key else c.code || ':' || ids.ordinality end,
  public.estimate_section_for_option(c.code, o.is_installation),
  ids.ordinality * 10 + slots.sort_order
from public.estimate_templates t
cross join lateral unnest(t.baseline_option_ids) with ordinality ids(option_id, ordinality)
join public.options o on o.id = ids.option_id
join public.option_categories c on c.id = o.category_id
cross join lateral (
  select slot_key, sort_order
  from (values ('front', 1), ('right', 2), ('rear', 3), ('left', 4)) v(slot_key, sort_order)
  where c.code = 'exterior-wall'
  union all
  select '', 0 where c.code <> 'exterior-wall'
) slots
on conflict (template_id, category_id, slot_key) do nothing;

alter table public.estimate_import_sections enable row level security;
alter table public.estimate_template_baseline_items enable row level security;

drop policy if exists estimate_import_sections_read on public.estimate_import_sections;
create policy estimate_import_sections_read on public.estimate_import_sections
  for select using (public.can_edit_catalog());

drop policy if exists estimate_template_baseline_items_read on public.estimate_template_baseline_items;
create policy estimate_template_baseline_items_read on public.estimate_template_baseline_items
  for select using (true);

grant select on public.estimate_import_sections to authenticated;
grant select on public.estimate_template_baseline_items to anon, authenticated;
revoke insert, update, delete on public.estimate_import_sections, public.estimate_template_baseline_items
  from anon, authenticated;
grant all on public.estimate_import_sections, public.estimate_template_baseline_items to service_role;

-- Keep at most one activated import before adding the database invariant.
with ranked as (
  select id,
         row_number() over (
           partition by base_model_id, spec_code
           order by activated_at desc nulls last, version desc, created_at desc
         ) as row_no
  from public.estimate_imports
  where status = 'activated'
)
update public.estimate_imports i
set status = 'superseded'
from ranked r
where i.id = r.id and r.row_no > 1;

create unique index if not exists estimate_imports_one_activated_idx
  on public.estimate_imports(base_model_id, spec_code)
  where status = 'activated';

create or replace function public.is_option_eligible_for_estimate(
  p_option_id uuid,
  p_base_model_id uuid,
  p_spec_code text,
  p_category_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.options o
    join public.option_categories c on c.id = o.category_id
    where o.id = p_option_id
      and o.status = 'published'
      and c.status = 'published'
      and o.category_id = p_category_id
      and (o.base_model_id is null or o.base_model_id = p_base_model_id)
      and (cardinality(o.spec_codes) = 0 or p_spec_code = any(o.spec_codes))
  );
$$;

revoke all on function public.is_option_eligible_for_estimate(uuid, uuid, text, uuid) from public;
grant execute on function public.is_option_eligible_for_estimate(uuid, uuid, text, uuid)
  to authenticated, service_role;

create or replace function public.refresh_estimate_import_status(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.estimate_imports i
     set status = case
       when exists (
         select 1
         from public.estimate_import_lines l
         where l.import_id = i.id
           and l.link_policy = 'required'
           and not exists (
             select 1
             from public.estimate_product_links pl
             where pl.import_line_id = l.id
               and pl.status = 'confirmed'
               and public.is_option_eligible_for_estimate(
                 pl.option_id, i.base_model_id, i.spec_code, l.category_id
               )
           )
       ) then 'review'
       else 'ready'
     end
   where i.id = p_import_id
     and i.status in ('review', 'ready');
end;
$$;

revoke all on function public.refresh_estimate_import_status(uuid) from public;

create or replace function public.create_estimate_imports(p_imports jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t jsonb;
  s jsonb;
  l jsonb;
  v_import_id uuid;
  v_line_id uuid;
  v_model uuid;
  v_spec text;
  v_version integer;
  v_category uuid;
  v_auto_option uuid;
  v_rule_option uuid;
  v_rule_key text;
  v_duplicate_rule_key boolean;
  v_result jsonb := '[]'::jsonb;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 標準見積を取り込む権限がありません' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_imports, '[]'::jsonb)) <> 'array' then
    raise exception 'VALIDATION: 取込データの形式が正しくありません' using errcode = 'P0001';
  end if;

  for t in select value from jsonb_array_elements(coalesce(p_imports, '[]'::jsonb))
  loop
    v_model := (t ->> 'base_model_id')::uuid;
    v_spec := nullif(t ->> 'spec_code', '');
    if v_spec is null then
      raise exception 'VALIDATION: 仕様コードがありません' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.base_models where id = v_model) then
      raise exception 'VALIDATION: 本体モデルが見つかりません' using errcode = 'P0001';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_model::text || ':' || v_spec, 76001)
    );

    if exists (
      select 1 from public.estimate_imports
      where base_model_id = v_model
        and spec_code = v_spec
        and source_sha256 = t ->> 'source_sha256'
    ) then
      raise exception 'VALIDATION: 同じExcelは既に取り込まれています（%）', t ->> 'name' using errcode = 'P0001';
    end if;

    select coalesce(max(version), 0) + 1
      into v_version
      from public.estimate_imports
     where base_model_id = v_model and spec_code = v_spec;

    insert into public.estimate_imports (
      base_model_id, spec_code, name, version,
      source_file_name, source_sheet_name, source_sha256,
      status, tax_rate, subtotal_raw, adjustment, subtotal, tax, total,
      template_payload, imported_by
    ) values (
      v_model, v_spec, t ->> 'name', v_version,
      t ->> 'source_file_name', t ->> 'source_sheet_name', t ->> 'source_sha256',
      'review', coalesce((t ->> 'tax_rate')::numeric, 0.10),
      coalesce((t ->> 'subtotal_raw')::numeric, 0),
      coalesce((t ->> 'adjustment')::numeric, 0),
      coalesce((t ->> 'subtotal')::numeric, 0),
      coalesce((t ->> 'tax')::numeric, 0),
      coalesce((t ->> 'total')::numeric, 0),
      coalesce(t -> 'template_payload', '{}'::jsonb), auth.uid()
    ) returning id into v_import_id;

    for s in select value from jsonb_array_elements(coalesce(t -> 'sections', '[]'::jsonb))
    loop
      insert into public.estimate_import_sections (
        import_id, section_code, label, line_subtotal, expense_label,
        expense_rate, expense_amount, total, sort_order
      ) values (
        v_import_id, s ->> 'section_code', s ->> 'label',
        coalesce((s ->> 'line_subtotal')::numeric, 0), nullif(s ->> 'expense_label', ''),
        nullif(s ->> 'expense_rate', '')::numeric,
        coalesce((s ->> 'expense_amount')::numeric, 0),
        coalesce((s ->> 'total')::numeric, 0),
        coalesce((s ->> 'sort_order')::integer, 0)
      );
    end loop;

    for l in select value from jsonb_array_elements(coalesce(t -> 'lines', '[]'::jsonb))
    loop
      v_category := nullif(l ->> 'category_id', '')::uuid;
      v_auto_option := nullif(l ->> 'auto_option_id', '')::uuid;
      v_rule_key := l ->> 'rule_match_key_v2';
      select count(*) > 1 into v_duplicate_rule_key
      from jsonb_array_elements(coalesce(t -> 'lines', '[]'::jsonb)) duplicate_line
      where duplicate_line ->> 'rule_match_key_v2' = v_rule_key;

      insert into public.estimate_import_lines (
        import_id, section_code, group_label, source_row,
        original_name, normalized_name, category_id,
        manufacturer_text, model_text, size_text,
        quantity, unit, unit_price, amount, remark, link_policy,
        line_fingerprint, line_fingerprint_v2, rule_match_key_v2,
        fingerprint_ordinal, source_row_json, sort_order
      ) values (
        v_import_id, l ->> 'section_code', nullif(l ->> 'group_label', ''),
        nullif(l ->> 'source_row', '')::integer, l ->> 'original_name',
        l ->> 'normalized_name', v_category,
        nullif(l ->> 'manufacturer_text', ''), nullif(l ->> 'model_text', ''),
        nullif(l ->> 'size_text', ''), nullif(l ->> 'quantity', '')::numeric,
        nullif(l ->> 'unit', ''), nullif(l ->> 'unit_price', '')::numeric,
        coalesce((l ->> 'amount')::numeric, 0), nullif(l ->> 'remark', ''),
        coalesce(nullif(l ->> 'link_policy', ''), 'none'),
        l ->> 'line_fingerprint_v2', l ->> 'line_fingerprint_v2', v_rule_key,
        coalesce(nullif(l ->> 'fingerprint_ordinal', '')::integer, 1),
        coalesce(l -> 'source_row_json', '{}'::jsonb),
        coalesce(nullif(l ->> 'sort_order', '')::integer, 0)
      ) returning id into v_line_id;

      if v_auto_option is not null
         and public.is_option_eligible_for_estimate(v_auto_option, v_model, v_spec, v_category)
         and exists (
           select 1 from public.options o
           where o.id = v_auto_option
             and lower(regexp_replace(coalesce(o.manufacturer, ''), '[[:space:]]+', '', 'g'))
                 = lower(regexp_replace(coalesce(l ->> 'manufacturer_text', ''), '[[:space:]]+', '', 'g'))
             and lower(regexp_replace(coalesce(o.model_no, ''), '[[:space:]]+', '', 'g'))
                 = lower(regexp_replace(coalesce(l ->> 'model_text', ''), '[[:space:]]+', '', 'g'))
         )
         and 1 = (
           select count(*) from public.options o
           where public.is_option_eligible_for_estimate(o.id, v_model, v_spec, v_category)
             and lower(regexp_replace(coalesce(o.manufacturer, ''), '[[:space:]]+', '', 'g'))
                 = lower(regexp_replace(coalesce(l ->> 'manufacturer_text', ''), '[[:space:]]+', '', 'g'))
             and lower(regexp_replace(coalesce(o.model_no, ''), '[[:space:]]+', '', 'g'))
                 = lower(regexp_replace(coalesce(l ->> 'model_text', ''), '[[:space:]]+', '', 'g'))
         )
      then
        insert into public.estimate_product_links (
          import_line_id, option_id, match_type, match_reason, confidence,
          status, confirmed_by, confirmed_at
        ) values (
          v_line_id, v_auto_option, 'automatic',
          coalesce(nullif(l ->> 'auto_match_reason', ''), 'メーカー＋型番完全一致'),
          1, 'confirmed', auth.uid(), now()
        );
      elsif not v_duplicate_rule_key then
        select r.option_id into v_rule_option
        from public.product_match_rules r
        where r.rule_match_key_v2 = v_rule_key
          and (r.category_id is null or r.category_id = v_category)
          and public.is_option_eligible_for_estimate(r.option_id, v_model, v_spec, v_category)
          and (
            r.scope = 'global'
            or (r.scope = 'model' and r.base_model_id = v_model)
            or (r.scope = 'spec' and r.base_model_id = v_model and r.spec_code = v_spec)
          )
        order by case r.scope when 'spec' then 1 when 'model' then 2 else 3 end, r.updated_at desc
        limit 1;

        if v_rule_option is not null then
          insert into public.estimate_product_links (
            import_line_id, option_id, match_type, match_reason, confidence,
            status, confirmed_by, confirmed_at
          ) values (
            v_line_id, v_rule_option, 'saved_rule', '前回の確認済み照合を再利用',
            1, 'confirmed', auth.uid(), now()
          );
        end if;
      end if;
      v_rule_option := null;
    end loop;

    perform public.refresh_estimate_import_status(v_import_id);
    v_result := v_result || jsonb_build_array(v_import_id::text);
  end loop;
  return v_result;
end;
$$;

revoke all on function public.create_estimate_imports(jsonb) from public;
grant execute on function public.create_estimate_imports(jsonb) to authenticated, service_role;

create or replace function public.update_estimate_import_line_review(
  p_line_id uuid,
  p_category_id uuid,
  p_link_policy text,
  p_option_id uuid,
  p_save_rule boolean default false,
  p_rule_scope text default 'spec'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import_id uuid;
  v_model uuid;
  v_spec text;
  v_rule_key text;
  v_import_status text;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 商品照合を変更する権限がありません' using errcode = '42501';
  end if;
  if p_link_policy not in ('required', 'optional', 'none') then
    raise exception 'VALIDATION: 紐付け区分が正しくありません' using errcode = 'P0001';
  end if;
  if p_rule_scope not in ('global', 'model', 'spec') then
    raise exception 'VALIDATION: 照合ルールの範囲が正しくありません' using errcode = 'P0001';
  end if;

  select l.import_id, i.base_model_id, i.spec_code,
         regexp_replace(
           l.rule_match_key_v2,
           '^v2\|[^|]*\|',
           'v2|' || coalesce(p_category_id::text, '') || '|'
         ),
         i.status
    into v_import_id, v_model, v_spec, v_rule_key, v_import_status
    from public.estimate_import_lines l
    join public.estimate_imports i on i.id = l.import_id
   where l.id = p_line_id
   for update of l;

  if v_import_id is null then
    raise exception 'NOT_FOUND: 見積明細が見つかりません' using errcode = 'P0002';
  end if;
  if v_import_status not in ('review', 'ready') then
    raise exception 'LOCKED: 有効化済みの取込は変更できません' using errcode = 'P0001';
  end if;

  update public.estimate_import_lines
     set category_id = p_category_id,
         link_policy = p_link_policy,
         rule_match_key_v2 = v_rule_key
   where id = p_line_id;
  delete from public.estimate_product_links where import_line_id = p_line_id;

  if p_link_policy <> 'none' and p_option_id is not null then
    if not public.is_option_eligible_for_estimate(p_option_id, v_model, v_spec, p_category_id) then
      raise exception 'VALIDATION: 選択した商品はこの明細のカテゴリ・本体・仕様に対応していません' using errcode = 'P0001';
    end if;
    insert into public.estimate_product_links (
      import_line_id, option_id, match_type, match_reason, confidence,
      status, confirmed_by, confirmed_at
    ) values (
      p_line_id, p_option_id, 'manual', '管理画面で確認',
      1, 'confirmed', auth.uid(), now()
    );

    if p_save_rule then
      delete from public.product_match_rules r
      where r.scope = p_rule_scope
        and r.rule_match_key_v2 = v_rule_key
        and coalesce(r.category_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(p_category_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          (p_rule_scope = 'global' and r.base_model_id is null and r.spec_code is null)
          or (p_rule_scope = 'model' and r.base_model_id = v_model and r.spec_code is null)
          or (p_rule_scope = 'spec' and r.base_model_id = v_model and r.spec_code = v_spec)
        );
      insert into public.product_match_rules (
        scope, base_model_id, spec_code, category_id, match_key,
        rule_match_key_v2, option_id, created_by
      ) values (
        p_rule_scope,
        case when p_rule_scope = 'global' then null else v_model end,
        case when p_rule_scope = 'spec' then v_spec else null end,
        p_category_id, v_rule_key, v_rule_key, p_option_id, auth.uid()
      );
    end if;
  end if;
  perform public.refresh_estimate_import_status(v_import_id);
end;
$$;

revoke all on function public.update_estimate_import_line_review(uuid, uuid, text, uuid, boolean, text) from public;
grant execute on function public.update_estimate_import_line_review(uuid, uuid, text, uuid, boolean, text)
  to authenticated, service_role;

-- Replace the active template and persist its normalized baseline in the same transaction.
create or replace function public.replace_estimate_templates_with_baselines(p_templates jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t jsonb;
  v_template_id uuid;
  v_model uuid;
  v_spec text;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 標準見積を更新する権限がありません' using errcode = '42501';
  end if;

  perform public.replace_estimate_templates(p_templates);

  for t in select value from jsonb_array_elements(coalesce(p_templates, '[]'::jsonb))
  loop
    v_model := (t ->> 'base_model_id')::uuid;
    v_spec := t ->> 'spec_code';
    select id into v_template_id
    from public.estimate_templates
    where base_model_id = v_model and spec_code = v_spec;

    if jsonb_array_length(coalesce(t -> 'baseline_items', '[]'::jsonb)) > 0 then
      if exists (
        select 1
        from jsonb_to_recordset(t -> 'baseline_items') as x(
          option_id uuid, category_id uuid, quantity numeric, slot_key text,
          section_code text, source_import_line_id uuid, sort_order integer
        )
        where not public.is_option_eligible_for_estimate(x.option_id, v_model, v_spec, x.category_id)
           or x.quantity <= 0
           or x.section_code not in ('base', 'interior_exterior', 'option', 'sitework')
           or coalesce(x.slot_key, '') = ''
      ) then
        raise exception 'VALIDATION: baselineに不適合な商品または構成があります' using errcode = 'P0001';
      end if;

      insert into public.estimate_template_baseline_items (
        template_id, option_id, category_id, quantity, slot_key,
        section_code, source_import_line_id, sort_order
      )
      select v_template_id, x.option_id, x.category_id, x.quantity, x.slot_key,
             x.section_code, x.source_import_line_id, x.sort_order
      from jsonb_to_recordset(t -> 'baseline_items') as x(
        option_id uuid, category_id uuid, quantity numeric, slot_key text,
        section_code text, source_import_line_id uuid, sort_order integer
      );
    else
      -- Compatibility for callers which still provide baseline_option_ids only.
      insert into public.estimate_template_baseline_items (
        template_id, option_id, category_id, quantity, slot_key, section_code, sort_order
      )
      select
        v_template_id,
        o.id,
        o.category_id,
        1,
        case when c.code = 'exterior-wall' then slots.slot_key else c.code || ':' || ids.ordinality end,
        public.estimate_section_for_option(c.code, o.is_installation),
        ids.ordinality * 10 + slots.sort_order
      from jsonb_array_elements_text(coalesce(t -> 'baseline_option_ids', '[]'::jsonb))
        with ordinality ids(option_id, ordinality)
      join public.options o on o.id = ids.option_id::uuid
      join public.option_categories c on c.id = o.category_id
      cross join lateral (
        select slot_key, sort_order
        from (values ('front', 1), ('right', 2), ('rear', 3), ('left', 4)) v(slot_key, sort_order)
        where c.code = 'exterior-wall'
        union all
        select '', 0 where c.code <> 'exterior-wall'
      ) slots
      where public.is_option_eligible_for_estimate(o.id, v_model, v_spec, o.category_id);
    end if;

    if exists (
      select 1
      from public.estimate_template_baseline_items b
      join public.option_categories c on c.id = b.category_id
      where b.template_id = v_template_id and c.selection_mode = 'single'
      group by b.category_id, c.name
      having count(distinct b.option_id) > 1
    ) then
      raise exception 'VALIDATION: singleカテゴリのbaselineに複数商品があります' using errcode = 'P0001';
    end if;

    if exists (
      select 1
      from public.option_categories c
      join public.estimate_template_baseline_items b on b.category_id = c.id
      where b.template_id = v_template_id and c.code = 'exterior-wall'
      group by b.category_id
      having count(*) <> 4
          or count(distinct b.slot_key) <> 4
          or array_agg(distinct b.slot_key order by b.slot_key)
             <> array['front', 'left', 'rear', 'right']::text[]
    ) then
      raise exception 'VALIDATION: 外壁baselineはfront/right/rear/leftの4slotが必要です' using errcode = 'P0001';
    end if;

    update public.estimate_templates
       set baseline_option_ids = coalesce((
         select array_agg(distinct b.option_id order by b.option_id)
         from public.estimate_template_baseline_items b
         where b.template_id = v_template_id
       ), '{}'::uuid[])
     where id = v_template_id;
  end loop;
end;
$$;

revoke all on function public.replace_estimate_templates_with_baselines(jsonb) from public;
grant execute on function public.replace_estimate_templates_with_baselines(jsonb)
  to authenticated, service_role;

create or replace function public.activate_estimate_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.estimate_imports%rowtype;
  v_payload jsonb;
  v_sections jsonb;
  v_base_lines jsonb;
  v_other_lines jsonb;
  v_baseline_items jsonb;
  v_baseline_ids jsonb;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 標準見積を有効化する権限がありません' using errcode = '42501';
  end if;

  select * into v_import from public.estimate_imports where id = p_import_id;
  if v_import.id is null then
    raise exception 'NOT_FOUND: 取込データが見つかりません' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_import.base_model_id::text || ':' || v_import.spec_code, 76002)
  );
  select * into v_import
  from public.estimate_imports
  where id = p_import_id
  for update;

  if v_import.status not in ('review', 'ready') then
    raise exception 'LOCKED: この取込は有効化できません' using errcode = 'P0001';
  end if;
  perform public.refresh_estimate_import_status(p_import_id);
  select * into v_import from public.estimate_imports where id = p_import_id;
  if v_import.status <> 'ready' then
    raise exception 'VALIDATION: 必須商品に未照合または不適合商品があります' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.estimate_import_lines l
    join public.estimate_product_links pl
      on pl.import_line_id = l.id and pl.status = 'confirmed'
    where l.import_id = p_import_id
      and (
        l.link_policy = 'none'
        or not public.is_option_eligible_for_estimate(
          pl.option_id, v_import.base_model_id, v_import.spec_code, l.category_id
        )
      )
  ) then
    raise exception 'VALIDATION: 照合後に不適合となった商品があります' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.estimate_import_lines l
    join public.estimate_product_links pl
      on pl.import_line_id = l.id and pl.status = 'confirmed'
    join public.option_categories c on c.id = l.category_id
    where l.import_id = p_import_id and l.link_policy <> 'none'
    group by c.id, c.name, c.selection_mode
    having c.selection_mode = 'single' and count(distinct pl.option_id) > 1
  ) then
    raise exception 'VALIDATION: singleカテゴリに複数の商品が照合されています' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.estimate_import_lines l
    join public.estimate_product_links pl
      on pl.import_line_id = l.id and pl.status = 'confirmed'
    join public.option_categories c on c.id = l.category_id and c.code = 'exterior-wall'
    where l.import_id = p_import_id and l.link_policy <> 'none'
    group by c.id
    having count(distinct pl.option_id) <> 1
  ) then
    raise exception 'VALIDATION: 外壁baselineは1商品を4面へ割り当ててください' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', s.section_code,
    'label', s.label,
    'line_subtotal', s.line_subtotal,
    'expense_label', s.expense_label,
    'expense_rate', s.expense_rate,
    'expense_amount', s.expense_amount,
    'total', s.total,
    'sort_order', s.sort_order
  ) order by s.sort_order), '[]'::jsonb)
  into v_sections
  from public.estimate_import_sections s
  where s.import_id = p_import_id;

  if jsonb_array_length(v_sections) <> 4 then
    raise exception 'VALIDATION: 取込の4分類が揃っていません' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'section', coalesce(l.group_label, '本体工事'),
    'name', l.original_name,
    'quantity', coalesce(l.quantity, 1),
    'unit', l.unit,
    'unit_price', coalesce(l.unit_price, l.amount),
    'amount', l.amount,
    'remark', l.remark,
    'sort_order', l.sort_order
  ) order by l.sort_order), '[]'::jsonb)
  into v_base_lines
  from public.estimate_import_lines l
  where l.import_id = p_import_id and l.section_code = 'base';

  select coalesce(jsonb_agg(jsonb_build_object(
    'section_code', l.section_code,
    'group_label', l.group_label,
    'name', l.original_name,
    'quantity', l.quantity,
    'unit', l.unit,
    'unit_price', l.unit_price,
    'amount', l.amount,
    'remark', l.remark,
    'sort_order', l.sort_order
  ) order by l.sort_order), '[]'::jsonb)
  into v_other_lines
  from public.estimate_import_lines l
  where l.import_id = p_import_id and l.section_code <> 'base';

  with linked as (
    select l.*, pl.option_id, c.code as category_code, c.selection_mode
    from public.estimate_import_lines l
    join public.estimate_product_links pl
      on pl.import_line_id = l.id and pl.status = 'confirmed'
    join public.option_categories c on c.id = l.category_id
    where l.import_id = p_import_id and l.link_policy <> 'none'
  ), single_items as (
    select option_id, category_id, sum(coalesce(quantity, 1)) as quantity,
           category_code as slot_key, min(section_code) as section_code,
           (array_agg(id order by sort_order, id))[1] as source_import_line_id,
           min(sort_order) as sort_order
    from linked
    where selection_mode = 'single' and category_code <> 'exterior-wall'
    group by option_id, category_id, category_code
  ), multi_items as (
    select option_id, category_id, coalesce(quantity, 1) as quantity,
           category_code || ':' || row_number() over (
             partition by category_id order by sort_order, id
           ) as slot_key,
           section_code, id as source_import_line_id, sort_order
    from linked
    where selection_mode = 'multi' and category_code <> 'exterior-wall'
  ), exterior_source as (
    select distinct on (category_id)
           option_id, category_id, section_code, id as source_import_line_id, sort_order
    from linked
    where category_code = 'exterior-wall'
    order by category_id, sort_order, id
  ), exterior_items as (
    select e.option_id, e.category_id, 1::numeric as quantity,
           slots.slot_key, e.section_code, e.source_import_line_id,
           e.sort_order * 10 + slots.sort_order as sort_order
    from exterior_source e
    cross join (values ('front', 1), ('right', 2), ('rear', 3), ('left', 4)) slots(slot_key, sort_order)
  ), all_items as (
    select * from single_items
    union all select * from multi_items
    union all select * from exterior_items
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'option_id', option_id,
      'category_id', category_id,
      'quantity', quantity,
      'slot_key', slot_key,
      'section_code', section_code,
      'source_import_line_id', source_import_line_id,
      'sort_order', sort_order
    ) order by sort_order), '[]'::jsonb),
    coalesce(jsonb_agg(distinct to_jsonb(option_id)), '[]'::jsonb)
  into v_baseline_items, v_baseline_ids
  from all_items;

  v_payload := jsonb_build_object(
    'base_model_id', v_import.base_model_id,
    'spec_code', v_import.spec_code,
    'name', v_import.name,
    'source_file_name', v_import.source_file_name,
    'source_sheet_name', v_import.source_sheet_name,
    'source_sha256', v_import.source_sha256,
    'tax_rate', v_import.tax_rate,
    'subtotal_raw', v_import.subtotal_raw,
    'adjustment', v_import.adjustment,
    'subtotal', v_import.subtotal,
    'tax', v_import.tax,
    'total', v_import.total,
    'sections', v_sections,
    'base_breakdown_items', v_base_lines,
    'lines', v_other_lines,
    'baseline_option_ids', v_baseline_ids,
    'baseline_items', v_baseline_items
  );

  perform public.replace_estimate_templates_with_baselines(jsonb_build_array(v_payload));

  update public.estimate_imports
     set status = 'superseded'
   where base_model_id = v_import.base_model_id
     and spec_code = v_import.spec_code
     and status = 'activated'
     and id <> p_import_id;

  update public.estimate_imports
     set status = 'activated', activated_by = auth.uid(), activated_at = now()
   where id = p_import_id;
end;
$$;

revoke all on function public.activate_estimate_import(uuid) from public;
grant execute on function public.activate_estimate_import(uuid) to authenticated, service_role;

-- Baseline totals use explicit quantity and section; no category-specific implicit multiplier.
create or replace function public.estimate_baseline_master_section_total(
  p_template_id uuid,
  p_section text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    (
      case when o.price_on_request then 0 else o.price end
      + coalesce(default_variants.extra, 0)
    ) * b.quantity
  ), 0)
  from public.estimate_template_baseline_items b
  join public.options o on o.id = b.option_id
  left join lateral (
    select coalesce(sum(chosen.extra_price), 0) as extra
    from public.option_variant_groups vg
    left join lateral (
      select case when vc.price_on_request then 0 else vc.extra_price end as extra_price
      from public.option_variant_choices vc
      where vc.group_id = vg.id and vc.status = 'published'
      order by case when vc.kind in ('standard', 'fixed') then 0 else 1 end, vc.sort_order
      limit 1
    ) chosen on true
    where vg.option_id = o.id and vg.status = 'published'
  ) default_variants on true
  where b.template_id = p_template_id
    and b.section_code = p_section
    and o.status = 'published';
$$;

revoke all on function public.estimate_baseline_master_section_total(uuid, text) from public;
grant execute on function public.estimate_baseline_master_section_total(uuid, text)
  to authenticated, service_role;

create or replace function public.estimate_current_section(
  p_template_id uuid,
  p_option_id uuid,
  p_slot_key text default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with selected_option as (
    select o.*, c.code as category_code
    from public.options o
    join public.option_categories c on c.id = o.category_id
    where o.id = p_option_id
  ), baseline_section as (
    select b.section_code, 1 as priority
    from public.estimate_template_baseline_items b
    join selected_option o on o.category_id = b.category_id
    where b.template_id = p_template_id
      and p_slot_key is not null
      and b.slot_key = p_slot_key
    union all
    select b.section_code, 2
    from public.estimate_template_baseline_items b
    join selected_option o on o.category_id = b.category_id
    where b.template_id = p_template_id and b.option_id = p_option_id
    union all
    select min(b.section_code), 3
    from public.estimate_template_baseline_items b
    join selected_option o on o.category_id = b.category_id
    where b.template_id = p_template_id
    having count(distinct b.section_code) = 1
  )
  select coalesce(
    (select section_code from baseline_section order by priority limit 1),
    (select public.estimate_section_for_option(category_code, is_installation) from selected_option)
  );
$$;

revoke all on function public.estimate_current_section(uuid, uuid, text) from public;

create or replace function public.estimate_current_quantity(
  p_template_id uuid,
  p_option_id uuid,
  p_quantity numeric
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with selected_option as (
    select o.category_id, c.selection_mode
    from public.options o
    join public.option_categories c on c.id = o.category_id
    where o.id = p_option_id
  ), quantities as (
    select
      coalesce(sum(b.quantity) filter (where b.option_id = p_option_id), 0) as same_option,
      coalesce(sum(b.quantity), 0) as category_total,
      max(o.selection_mode) as selection_mode
    from selected_option o
    left join public.estimate_template_baseline_items b
      on b.template_id = p_template_id and b.category_id = o.category_id
  )
  select case
    when coalesce(p_quantity, 1) <> 1 then coalesce(p_quantity, 1)
    when same_option > 0 then same_option
    when selection_mode = 'single' and category_total > 0 then category_total
    else coalesce(p_quantity, 1)
  end
  from quantities;
$$;

revoke all on function public.estimate_current_quantity(uuid, uuid, numeric) from public;

create or replace function public.configuration_master_section_total(
  p_configuration_id uuid,
  p_section text
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.configurations;
  v_template_id uuid;
  v_total numeric := 0;
  v_faces numeric := 0;
  v_has_faces boolean := false;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then return 0; end if;
  select id into v_template_id
  from public.estimate_templates
  where base_model_id = cfg.base_model_id and spec_code = coalesce(cfg.spec_code, '')
  limit 1;
  if v_template_id is null then return 0; end if;

  v_has_faces := jsonb_typeof(cfg.exterior_faces) = 'array'
    and jsonb_array_length(cfg.exterior_faces) = 4;

  select coalesce(sum(
    (
      case when o.price_on_request then 0 else o.price end
      + coalesce(variants.extra, 0)
    ) * public.estimate_current_quantity(v_template_id, o.id, ci.quantity)
  ), 0)
  into v_total
  from public.configuration_items ci
  join public.options o on o.id = ci.option_id
  join public.option_categories c on c.id = o.category_id
  left join lateral (
    select coalesce(sum(case when vc.price_on_request then 0 else vc.extra_price end), 0) as extra
    from public.option_variant_choices vc
    join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
    where vc.id = any(ci.variant_choice_ids)
  ) variants on true
  where ci.configuration_id = cfg.id
    and o.status = 'published'
    and public.estimate_current_section(v_template_id, o.id, null) = p_section
    and not (v_has_faces and c.code = 'exterior-wall');

  if v_has_faces then
    select coalesce(sum(
      (case when o.price_on_request then 0 else o.price end) + coalesce(variants.extra, 0)
    ), 0)
    into v_faces
    from (
      select
        value ->> 'face_code' as face_code,
        (value ->> 'option_id')::uuid as option_id,
        coalesce(value -> 'variant_choice_ids', '[]'::jsonb) as variant_choice_ids
      from jsonb_array_elements(cfg.exterior_faces)
    ) face
    join public.options o on o.id = face.option_id
    join public.option_categories c on c.id = o.category_id and c.code = 'exterior-wall'
    left join lateral (
      select coalesce(sum(case when vc.price_on_request then 0 else vc.extra_price end), 0) as extra
      from jsonb_array_elements_text(face.variant_choice_ids) selected(choice_id)
      join public.option_variant_choices vc on vc.id = selected.choice_id::uuid
      join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
    ) variants on true
    where o.status = 'published'
      and public.estimate_current_section(
        v_template_id,
        o.id,
        case when face.face_code = 'back' then 'rear' else face.face_code end
      ) = p_section;
    v_total := v_total + v_faces;
  end if;
  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.configuration_master_section_total(uuid, text) from public;
grant execute on function public.configuration_master_section_total(uuid, text)
  to authenticated, service_role;
