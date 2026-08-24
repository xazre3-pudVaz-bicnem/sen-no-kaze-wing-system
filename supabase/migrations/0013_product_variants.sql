-- =============================================================
-- 商品のバリエーション（ネットショップ型の選択）
--
--   商品（options）
--     └ 選択項目（option_variant_groups）    例：壁プラン／壁色／水栓・シャワー／扉色／ミラー
--         └ 選択肢（option_variant_choices）  例：オークグレージュ（＋価格・画像）
--
-- 先方の商品マスター（Wing_product_master.xlsx）の「お客様選択項目」シートに対応する。
-- 商品を選ぶと、その商品に紐づく選択項目が出て、色や仕様を選べる。
-- 選択肢の追加価格は商品価格に加算され、見積明細にも「（壁色：オークグレージュ）」と出る。
-- =============================================================

-- ---------- 商品側の追加情報（ショップ表示用） ----------
alter table public.options
  add column if not exists manufacturer text,
  add column if not exists model_no text,
  add column if not exists size_note text,
  add column if not exists list_price integer,
  add column if not exists highlight text;

comment on column public.options.manufacturer is 'メーカー名（ハウステック／LIXIL 等）';
comment on column public.options.model_no is '型番・シリーズ名';
comment on column public.options.size_note is '主なサイズ（表示用の自由記述）';
comment on column public.options.list_price is 'メーカー参考価格（税抜）。表示のみで見積計算には使わない';
comment on column public.options.highlight is '位置づけ（標準候補／おすすめ候補／上位候補 など）';

-- ---------- 選択項目 ----------
create table if not exists public.option_variant_groups (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options (id) on delete cascade,
  code text not null,
  name text not null,
  /** 表示に関する補足（「壁プランでアクセントを選んだ場合」など） */
  note text,
  sort_order integer not null default 0,
  is_required boolean not null default true,
  status text not null default 'published' check (status in ('published', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (option_id, code)
);
create index if not exists option_variant_groups_option_idx on public.option_variant_groups (option_id, sort_order);

-- ---------- 選択肢 ----------
create table if not exists public.option_variant_choices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_variant_groups (id) on delete cascade,
  code text not null,
  name text not null,
  /** standard=標準で選ばれる / option=追加 / fixed=変更できない */
  kind text not null default 'option' check (kind in ('standard', 'option', 'fixed')),
  extra_price integer not null default 0,
  price_on_request boolean not null default false,
  image_url text,
  note text,
  sort_order integer not null default 0,
  status text not null default 'published' check (status in ('published', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, code)
);
create index if not exists option_variant_choices_group_idx on public.option_variant_choices (group_id, sort_order);

-- ---------- 保存された仕様が持つ選択肢 ----------
alter table public.configuration_items
  add column if not exists variant_choice_ids uuid[] not null default '{}';

-- ---------- RLS ----------
alter table public.option_variant_groups enable row level security;
alter table public.option_variant_choices enable row level security;

drop policy if exists variant_groups_read on public.option_variant_groups;
create policy variant_groups_read on public.option_variant_groups for select
  using (status = 'published' or public.is_dealer());
drop policy if exists variant_groups_write on public.option_variant_groups;
create policy variant_groups_write on public.option_variant_groups for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists variant_choices_read on public.option_variant_choices;
create policy variant_choices_read on public.option_variant_choices for select
  using (status = 'published' or public.is_dealer());
drop policy if exists variant_choices_write on public.option_variant_choices;
create policy variant_choices_write on public.option_variant_choices for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

grant select on public.option_variant_groups, public.option_variant_choices to anon, authenticated;
grant all on public.option_variant_groups, public.option_variant_choices to authenticated, service_role;

-- ---------- 選択肢の追加価格を含めて再計算する ----------
create or replace function public.recalculate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  cfg public.configurations;
  v_model public.base_models;
  v_rate numeric;
  v_base integer;
  v_base_exp integer;
  v_opt integer;
  v_opt_exp integer;
  v_inst integer;
  v_sub_raw integer;
  v_sub integer;
  v_tax integer;
begin
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or cfg.user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_model from public.base_models where id = cfg.base_model_id;
  v_rate := coalesce(v_model.expense_rate, 0.15);
  v_base := v_model.base_price;
  v_base_exp := floor(v_base * v_rate);

  -- オプション本体＋選択肢の追加価格。フリー商品と別途工事は諸費用の対象外
  select coalesce(sum(
           (case when o.price_on_request then 0 else o.price end
            + coalesce((
                select sum(case when vc.price_on_request then 0 else vc.extra_price end)
                  from public.option_variant_choices vc
                 where vc.id = any (ci.variant_choice_ids)
              ), 0)
           ) * ci.quantity), 0)
    into v_opt
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = cfg.id and o.status = 'published'
     and not o.is_installation and cat.code <> 'free-product'
     and (o.base_model_id is null or o.base_model_id = cfg.base_model_id);
  v_opt_exp := floor(v_opt * v_rate);

  select coalesce(sum(
           (case when o.price_on_request then 0 else o.price end
            + coalesce((
                select sum(case when vc.price_on_request then 0 else vc.extra_price end)
                  from public.option_variant_choices vc
                 where vc.id = any (ci.variant_choice_ids)
              ), 0)
           ) * ci.quantity), 0)
    into v_inst
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = cfg.id and o.status = 'published'
     and (o.is_installation or cat.code = 'free-product')
     and (o.base_model_id is null or o.base_model_id = cfg.base_model_id);

  v_sub_raw := v_base + v_base_exp + v_opt + v_opt_exp + v_inst;
  v_sub := floor(v_sub_raw / 1000.0)::integer * 1000;
  v_tax := floor(v_sub * 0.10);

  update public.configurations
     set base_price = v_base, base_expense = v_base_exp,
         option_subtotal = v_opt, option_expense = v_opt_exp,
         installation_subtotal = v_inst,
         adjustment = v_sub - v_sub_raw, subtotal = v_sub, tax = v_tax, total = v_sub + v_tax
   where id = p_configuration_id
   returning * into cfg;
  return cfg;
end $$;

-- ---------- 保存時に選択肢も保存する ----------
create or replace function public.save_configuration(
  p_configuration_id uuid,
  p_base_model_id uuid,
  p_name text,
  p_option_ids uuid[],
  p_preview_image_url text,
  p_notes text,
  p_finish_level text default 'full',
  p_variant_choice_ids uuid[] default '{}'
)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_configuration_id;
  v_uid uuid := auth.uid();
  cfg public.configurations;
  v_opts uuid[];
  v_level text := coalesce(nullif(p_finish_level, ''), 'full');
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if v_level not in ('shell', 'equipment', 'full') then
    raise exception 'VALIDATION: 注文範囲の指定が不正です' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.base_models m where m.id = p_base_model_id and m.status = 'published') then
    raise exception 'MODEL_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct o.id), '{}') into v_opts
    from public.options o
    join public.option_categories cat on cat.id = o.category_id
   where o.id = any (p_option_ids) and o.status = 'published'
     and (o.base_model_id is null or o.base_model_id = p_base_model_id)
     and public.finish_level_rank(cat.finish_level) <= public.finish_level_rank(v_level);

  perform public.validate_configuration_items(p_base_model_id, v_opts, v_level);

  if v_id is null then
    insert into public.configurations (user_id, base_model_id, name, preview_image_url, notes, finish_level)
    values (v_uid, p_base_model_id, coalesce(nullif(p_name, ''), '無題の仕様'), p_preview_image_url, p_notes, v_level)
    returning id into v_id;
  else
    select * into cfg from public.configurations where id = v_id for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if cfg.user_id <> v_uid and not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if cfg.status <> 'draft' and not public.is_admin() then
      raise exception 'LOCKED: 見積依頼済みの仕様は編集できません。複製して編集してください' using errcode = 'P0001';
    end if;
    update public.configurations
       set name = coalesce(nullif(p_name, ''), name), base_model_id = p_base_model_id,
           preview_image_url = p_preview_image_url, notes = p_notes, finish_level = v_level
     where id = v_id;
    delete from public.configuration_items where configuration_id = v_id;
  end if;

  -- 各商品に、その商品の選択項目に属する選択肢だけを紐付ける
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  select v_id, o.id, 1,
         coalesce((
           select array_agg(vc.id)
             from public.option_variant_choices vc
             join public.option_variant_groups vg on vg.id = vc.group_id
            where vg.option_id = o.id and vc.id = any (p_variant_choice_ids)
         ), '{}')
    from unnest(v_opts) as t(oid)
    join public.options o on o.id = t.oid;

  cfg := public.recalculate_configuration(v_id);

  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (v_id, 'saved', public.configuration_pricing_json(v_id));

  return cfg;
end $$;

-- 見積作成時に、選んだ仕様（壁色など）を明細名へ残す
create or replace function public.create_quote_from_configuration(
  p_configuration_id uuid,
  p_contact jsonb,
  p_message text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cfg public.configurations;
  v_uid uuid := auth.uid();
  v_req uuid;
  v_quote uuid;
  v_no text;
  v_model public.base_models;
  v_opts uuid[];
  v_customer_no text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if cfg.user_id <> v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select coalesce(array_agg(option_id), '{}') into v_opts from public.configuration_items where configuration_id = cfg.id;
  perform public.validate_configuration_items(cfg.base_model_id, v_opts, cfg.finish_level);
  cfg := public.recalculate_configuration(cfg.id);
  select * into v_model from public.base_models where id = cfg.base_model_id;
  select customer_no into v_customer_no from public.profiles where id = v_uid;

  insert into public.quote_requests (configuration_id, user_id, status, message, contact)
  values (cfg.id, v_uid, 'new', p_message, coalesce(p_contact, '{}'::jsonb))
  returning id into v_req;

  v_no := public.next_quote_no();

  insert into public.quotes (
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment,
    subtotal, tax_rate, tax, total, preview_image_url, notes)
  values (
    v_no, v_req, cfg.id, v_uid, 'issued', now(), now() + interval '30 days',
    v_customer_no, coalesce(p_contact ->> 'full_name', ''), nullif(p_contact ->> 'company_name', ''), v_model.name, cfg.finish_level,
    cfg.base_price, cfg.base_expense, cfg.option_subtotal, cfg.option_expense, cfg.installation_subtotal, cfg.adjustment,
    cfg.subtotal, 0.10, cfg.tax, cfg.total, cfg.preview_image_url,
    '本見積書は概算です。別途工事（運送費・現地工事費等）は設置場所の確認後に確定します。')
  returning id into v_quote;

  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
  values (v_quote, 'base', v_model.name || ' 本体一式', '工場生産分（躯体・金物・断熱・屋根外壁・サッシ建具）', v_model.base_price, 1, v_model.base_price, 0),
         (v_quote, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || round(coalesce(v_model.expense_rate, 0.15) * 100) || '%）', cfg.base_expense, 1, cfg.base_expense, 1);

  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, image_url, sort_order)
  select v_quote,
         case when cat.code = 'free-product' then 'free'
              when o.is_installation then 'installation'
              else 'option' end,
         o.name || coalesce(v.label, ''),
         case when o.price_on_request then '設置場所確認後に別途お見積り' else cat.name end,
         case when o.price_on_request then 0 else o.price end + coalesce(v.extra, 0),
         ci.quantity,
         (case when o.price_on_request then 0 else o.price end + coalesce(v.extra, 0)) * ci.quantity,
         o.image_url,
         10 + row_number() over (order by o.is_installation, cat.sort_order, o.sort_order)
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
    left join lateral (
      select '（' || string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) || '）' as label,
             sum(case when vc.price_on_request then 0 else vc.extra_price end) as extra
        from public.option_variant_choices vc
        join public.option_variant_groups vg on vg.id = vc.group_id
       where vc.id = any (ci.variant_choice_ids)
    ) v on true
   where ci.configuration_id = cfg.id;

  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
  values (v_quote, 'option_expense', 'オプション諸費用', '交通費、労災、安全管理費等（' || round(coalesce(v_model.expense_rate, 0.15) * 100) || '%）', cfg.option_expense, 1, cfg.option_expense, 9000);

  update public.quote_requests set quote_id = v_quote where id = v_req;
  update public.configurations set status = 'quote_requested' where id = cfg.id;

  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (cfg.id, 'quote_requested', public.configuration_pricing_json(cfg.id));

  return v_quote;
end $$;
