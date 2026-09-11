-- =============================================================
-- 標準見積Excel: 取込バージョン + 商品マスター照合
--
-- * Excel取込と本番有効化を分離する
-- * 取込1回（1シート）を1バージョンとして保持する
-- * Excel明細と商品マスター(options)のリンクを別管理する
-- * 手動照合の再利用ルールを、今回の照合結果と分離する
-- * 必須商品の未照合がある限り有効化できない
-- * 有効化時だけ既存 estimate_templates へ反映する
-- =============================================================

create table if not exists public.estimate_imports (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models(id) on delete cascade,
  spec_code text not null,
  name text not null,
  version integer not null check (version > 0),
  source_file_name text not null,
  source_sheet_name text not null,
  source_sha256 text not null,
  status text not null default 'review'
    check (status in ('review', 'ready', 'activated', 'superseded')),
  tax_rate numeric not null default 0.10,
  subtotal_raw numeric not null default 0,
  adjustment numeric not null default 0,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  -- 既存の標準見積RPCへ渡せる、検算済みテンプレート本体。
  -- 明細照合用の行は estimate_import_lines に別保存する。
  template_payload jsonb not null,
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  unique (base_model_id, spec_code, version),
  unique (base_model_id, spec_code, source_sha256)
);

create index if not exists estimate_imports_model_spec_idx
  on public.estimate_imports(base_model_id, spec_code, version desc);

create table if not exists public.estimate_import_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.estimate_imports(id) on delete cascade,
  section_code text not null check (section_code in ('base', 'interior_exterior', 'option', 'sitework')),
  group_label text,
  source_row integer,
  original_name text not null,
  normalized_name text not null,
  category_id uuid references public.option_categories(id) on delete set null,
  manufacturer_text text,
  model_text text,
  size_text text,
  quantity numeric,
  unit text,
  unit_price numeric,
  amount numeric not null default 0,
  remark text,
  link_policy text not null default 'none' check (link_policy in ('required', 'optional', 'none')),
  line_fingerprint text not null,
  fingerprint_ordinal integer not null default 1 check (fingerprint_ordinal > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists estimate_import_lines_import_idx
  on public.estimate_import_lines(import_id, sort_order);
create index if not exists estimate_import_lines_fingerprint_idx
  on public.estimate_import_lines(line_fingerprint);

create table if not exists public.estimate_product_links (
  id uuid primary key default gen_random_uuid(),
  import_line_id uuid not null references public.estimate_import_lines(id) on delete cascade,
  option_id uuid not null references public.options(id) on delete restrict,
  match_type text not null check (match_type in ('automatic', 'manual', 'saved_rule')),
  match_reason text,
  confidence numeric,
  status text not null default 'confirmed' check (status in ('suggested', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (import_line_id)
);

create index if not exists estimate_product_links_option_idx
  on public.estimate_product_links(option_id);

create table if not exists public.product_match_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'model', 'spec')),
  base_model_id uuid references public.base_models(id) on delete cascade,
  spec_code text,
  category_id uuid references public.option_categories(id) on delete set null,
  match_key text not null,
  option_id uuid not null references public.options(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'global' and base_model_id is null and spec_code is null)
    or (scope = 'model' and base_model_id is not null and spec_code is null)
    or (scope = 'spec' and base_model_id is not null and spec_code is not null)
  )
);

create unique index if not exists product_match_rules_scope_key_idx
  on public.product_match_rules(
    scope,
    coalesce(base_model_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(spec_code, ''),
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    match_key
  );

create trigger trg_product_match_rules_updated
before update on public.product_match_rules
for each row execute function public.set_updated_at();

alter table public.estimate_imports enable row level security;
alter table public.estimate_import_lines enable row level security;
alter table public.estimate_product_links enable row level security;
alter table public.product_match_rules enable row level security;

drop policy if exists estimate_imports_read on public.estimate_imports;
create policy estimate_imports_read on public.estimate_imports
  for select using (public.can_edit_catalog());

drop policy if exists estimate_import_lines_read on public.estimate_import_lines;
create policy estimate_import_lines_read on public.estimate_import_lines
  for select using (public.can_edit_catalog());

drop policy if exists estimate_product_links_read on public.estimate_product_links;
create policy estimate_product_links_read on public.estimate_product_links
  for select using (public.can_edit_catalog());

drop policy if exists product_match_rules_read on public.product_match_rules;
create policy product_match_rules_read on public.product_match_rules
  for select using (public.can_edit_catalog());

grant select on public.estimate_imports, public.estimate_import_lines, public.estimate_product_links, public.product_match_rules
  to authenticated;
revoke insert, update, delete on public.estimate_imports, public.estimate_import_lines, public.estimate_product_links, public.product_match_rules
  from authenticated;
grant all on public.estimate_imports, public.estimate_import_lines, public.estimate_product_links, public.product_match_rules
  to service_role;

-- 必須商品の照合状況から review / ready を更新する。
create or replace function public.refresh_estimate_import_status(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public
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
            )
       ) then 'review'
       else 'ready'
     end
   where i.id = p_import_id
     and i.status in ('review', 'ready');
end;
$$;

revoke all on function public.refresh_estimate_import_status(uuid) from public;

-- 検算済みExcelを「照合作業用の取込バージョン」として保存する。
-- この時点では estimate_templates（本番標準見積）を変更しない。
create or replace function public.create_estimate_imports(p_imports jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t jsonb;
  l jsonb;
  v_import_id uuid;
  v_line_id uuid;
  v_model uuid;
  v_spec text;
  v_version integer;
  v_category uuid;
  v_auto_option uuid;
  v_rule_option uuid;
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
    if exists (
      select 1
        from public.estimate_imports
       where base_model_id = v_model
         and spec_code = v_spec
         and source_sha256 = t ->> 'source_sha256'
    ) then
      raise exception 'VALIDATION: 同じExcelは既に取り込まれています（%）', t ->> 'name' using errcode = 'P0001';
    end if;

    select coalesce(max(version), 0) + 1
      into v_version
      from public.estimate_imports
     where base_model_id = v_model
       and spec_code = v_spec;

    insert into public.estimate_imports (
      base_model_id, spec_code, name, version,
      source_file_name, source_sheet_name, source_sha256,
      status, tax_rate, subtotal_raw, adjustment, subtotal, tax, total,
      template_payload, imported_by
    )
    values (
      v_model,
      v_spec,
      t ->> 'name',
      v_version,
      t ->> 'source_file_name',
      t ->> 'source_sheet_name',
      t ->> 'source_sha256',
      'review',
      coalesce((t ->> 'tax_rate')::numeric, 0.10),
      coalesce((t ->> 'subtotal_raw')::numeric, 0),
      coalesce((t ->> 'adjustment')::numeric, 0),
      coalesce((t ->> 'subtotal')::numeric, 0),
      coalesce((t ->> 'tax')::numeric, 0),
      coalesce((t ->> 'total')::numeric, 0),
      coalesce(t -> 'template_payload', '{}'::jsonb),
      auth.uid()
    )
    returning id into v_import_id;

    for l in select value from jsonb_array_elements(coalesce(t -> 'lines', '[]'::jsonb))
    loop
      v_category := nullif(l ->> 'category_id', '')::uuid;
      v_auto_option := nullif(l ->> 'auto_option_id', '')::uuid;

      insert into public.estimate_import_lines (
        import_id, section_code, group_label, source_row,
        original_name, normalized_name, category_id,
        manufacturer_text, model_text, size_text,
        quantity, unit, unit_price, amount, remark,
        link_policy, line_fingerprint, fingerprint_ordinal, sort_order
      )
      values (
        v_import_id,
        l ->> 'section_code',
        nullif(l ->> 'group_label', ''),
        nullif(l ->> 'source_row', '')::integer,
        l ->> 'original_name',
        l ->> 'normalized_name',
        v_category,
        nullif(l ->> 'manufacturer_text', ''),
        nullif(l ->> 'model_text', ''),
        nullif(l ->> 'size_text', ''),
        nullif(l ->> 'quantity', '')::numeric,
        nullif(l ->> 'unit', ''),
        nullif(l ->> 'unit_price', '')::numeric,
        coalesce((l ->> 'amount')::numeric, 0),
        nullif(l ->> 'remark', ''),
        coalesce(nullif(l ->> 'link_policy', ''), 'none'),
        l ->> 'line_fingerprint',
        coalesce(nullif(l ->> 'fingerprint_ordinal', '')::integer, 1),
        coalesce(nullif(l ->> 'sort_order', '')::integer, 0)
      )
      returning id into v_line_id;

      -- 自動確定は「メーカー＋型番完全一致」など、サーバー側で厳格に判定済みのものだけ。
      if v_auto_option is not null then
        if exists (
          select 1
            from public.options o
           where o.id = v_auto_option
             and (v_category is null or o.category_id = v_category)
             and (o.base_model_id is null or o.base_model_id = v_model)
        ) then
          insert into public.estimate_product_links (
            import_line_id, option_id, match_type, match_reason, confidence,
            status, confirmed_by, confirmed_at
          )
          values (
            v_line_id, v_auto_option, 'automatic',
            coalesce(nullif(l ->> 'auto_match_reason', ''), 'メーカー＋型番完全一致'),
            1, 'confirmed', auth.uid(), now()
          );
        end if;
      else
        -- 過去に人が保存した照合ルールは、spec > model > global の順で再利用する。
        select r.option_id
          into v_rule_option
          from public.product_match_rules r
          join public.options o on o.id = r.option_id
         where r.match_key = l ->> 'line_fingerprint'
           and (r.category_id is null or r.category_id = v_category)
           and (o.base_model_id is null or o.base_model_id = v_model)
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
          )
          values (
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

-- 照合画面で、カテゴリ・必須度・紐付け商品を1行単位で確定する。
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
set search_path = public
as $$
declare
  v_import_id uuid;
  v_model uuid;
  v_spec text;
  v_fingerprint text;
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

  select l.import_id, i.base_model_id, i.spec_code, l.line_fingerprint, i.status
    into v_import_id, v_model, v_spec, v_fingerprint, v_import_status
    from public.estimate_import_lines l
    join public.estimate_imports i on i.id = l.import_id
   where l.id = p_line_id;

  if v_import_id is null then
    raise exception 'NOT_FOUND: 見積明細が見つかりません' using errcode = 'P0002';
  end if;
  if v_import_status not in ('review', 'ready') then
    raise exception 'LOCKED: 有効化済みの取込は変更できません' using errcode = 'P0001';
  end if;

  update public.estimate_import_lines
     set category_id = p_category_id,
         link_policy = p_link_policy
   where id = p_line_id;

  delete from public.estimate_product_links where import_line_id = p_line_id;

  if p_link_policy <> 'none' and p_option_id is not null then
    if not exists (
      select 1
        from public.options o
       where o.id = p_option_id
         and (p_category_id is null or o.category_id = p_category_id)
         and (o.base_model_id is null or o.base_model_id = v_model)
    ) then
      raise exception 'VALIDATION: 選択した商品はこの明細のカテゴリ・本体に対応していません' using errcode = 'P0001';
    end if;

    insert into public.estimate_product_links (
      import_line_id, option_id, match_type, match_reason, confidence,
      status, confirmed_by, confirmed_at
    )
    values (
      p_line_id, p_option_id, 'manual', '管理画面で確認',
      1, 'confirmed', auth.uid(), now()
    );

    if p_save_rule then
      -- 同じ範囲・同じ照合キーの古いルールを置き換える。
      delete from public.product_match_rules r
       where r.scope = p_rule_scope
         and r.match_key = v_fingerprint
         and coalesce(r.category_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(p_category_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and (
           (p_rule_scope = 'global' and r.base_model_id is null and r.spec_code is null)
           or (p_rule_scope = 'model' and r.base_model_id = v_model and r.spec_code is null)
           or (p_rule_scope = 'spec' and r.base_model_id = v_model and r.spec_code = v_spec)
         );

      insert into public.product_match_rules (
        scope, base_model_id, spec_code, category_id, match_key, option_id, created_by
      )
      values (
        p_rule_scope,
        case when p_rule_scope = 'global' then null else v_model end,
        case when p_rule_scope = 'spec' then v_spec else null end,
        p_category_id,
        v_fingerprint,
        p_option_id,
        auth.uid()
      );
    end if;
  end if;

  perform public.refresh_estimate_import_status(v_import_id);
end;
$$;

revoke all on function public.update_estimate_import_line_review(uuid, uuid, text, uuid, boolean, text) from public;
grant execute on function public.update_estimate_import_line_review(uuid, uuid, text, uuid, boolean, text)
  to authenticated, service_role;

-- 照合完了した取込バージョンを、初めて本番標準見積へ反映する。
create or replace function public.activate_estimate_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.estimate_imports%rowtype;
  v_payload jsonb;
  v_baselines uuid[];
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 標準見積を有効化する権限がありません' using errcode = '42501';
  end if;

  select * into v_import
    from public.estimate_imports
   where id = p_import_id
   for update;

  if v_import.id is null then
    raise exception 'NOT_FOUND: 取込データが見つかりません' using errcode = 'P0002';
  end if;
  if v_import.status not in ('review', 'ready') then
    raise exception 'LOCKED: この取込は有効化できません' using errcode = 'P0001';
  end if;

  perform public.refresh_estimate_import_status(p_import_id);
  select * into v_import from public.estimate_imports where id = p_import_id;

  if v_import.status <> 'ready' then
    raise exception 'VALIDATION: 必須商品に未照合があります。商品照合を完了してください' using errcode = 'P0001';
  end if;

  -- 確認済み商品は、同じカテゴリの旧baselineを置換する。
  -- それ以外の内装・造作等は従来baselineを残し、現行シミュレーターとの互換を保つ。
  with linked as (
    select distinct pl.option_id, o.category_id
      from public.estimate_import_lines l
      join public.estimate_product_links pl
        on pl.import_line_id = l.id
       and pl.status = 'confirmed'
      join public.options o on o.id = pl.option_id
     where l.import_id = p_import_id
       and l.link_policy <> 'none'
  ),
  fallback as (
    select value::uuid as option_id
      from jsonb_array_elements_text(coalesce(v_import.template_payload -> 'baseline_option_ids', '[]'::jsonb))
  ),
  kept_fallback as (
    select f.option_id
      from fallback f
      join public.options o on o.id = f.option_id
     where not exists (
       select 1 from linked l where l.category_id = o.category_id
     )
  ),
  combined as (
    select option_id from linked
    union
    select option_id from kept_fallback
  )
  select coalesce(array_agg(option_id order by option_id::text), '{}'::uuid[])
    into v_baselines
    from combined;

  v_payload := jsonb_set(
    v_import.template_payload,
    '{baseline_option_ids}',
    to_jsonb(v_baselines),
    true
  );

  perform public.replace_estimate_templates_with_baselines(jsonb_build_array(v_payload));

  update public.estimate_imports
     set status = 'superseded'
   where base_model_id = v_import.base_model_id
     and spec_code = v_import.spec_code
     and status = 'activated'
     and id <> p_import_id;

  update public.estimate_imports
     set status = 'activated',
         activated_by = auth.uid(),
         activated_at = now()
   where id = p_import_id;
end;
$$;

revoke all on function public.activate_estimate_import(uuid) from public;
grant execute on function public.activate_estimate_import(uuid) to authenticated, service_role;
