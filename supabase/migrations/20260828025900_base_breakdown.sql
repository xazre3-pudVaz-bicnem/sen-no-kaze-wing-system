-- =============================================================
-- 本体内訳（分類表見積書）と、それに伴う権限・表示の整理
--
-- 2026-08-28 打合せの決定事項：
--   1. エンドユーザーが本体を選んだら、本部・総代理店・代理店に上がる見積書には
--      本体工事の明細（金物・プレカット・面材・断熱・屋根外壁・サッシ建具）が
--      エクセルの表のまま表示される
--   2. 本部・総代理店は本体の明細・金額を編集できる。代理店は明細を見られるが
--      本体は触れない（別途工事・フリー商品のみ）
--   3. 仕様（ホテル／住宅／事務所）ごとに本体内訳が異なるため、保存した仕様に
--      spec_code を持たせる
--   4. サッシはエンドユーザーに選ばせない（本体に含める）→ customer_visible
-- =============================================================

-- ---------- 保存した仕様に「仕様コード」を持たせる ----------
alter table public.configurations add column if not exists spec_code text;
comment on column public.configurations.spec_code is '仕様（hotel / residence / office）。本体内訳の解決に使う。null は旧データ';

-- ---------- カテゴリーの顧客表示（サッシは台帳専用にする） ----------
alter table public.option_categories add column if not exists customer_visible boolean not null default true;
comment on column public.option_categories.customer_visible is 'false ならシミュレーターに出さない（台帳・代理店の見積編集では使える）';

-- ---------- 本体内訳マスター ----------
-- 分類表見積書の右側（お客様見積書＝売価）だけを持つ。原価は保存しない。
create table if not exists public.base_breakdown_items (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models (id) on delete cascade,
  spec_code text not null,
  /** 工事区分（１．金物関係費用 など） */
  section text not null,
  name text not null,
  quantity numeric not null default 1,
  unit text,
  unit_price integer not null default 0,
  amount integer not null default 0,
  remark text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists base_breakdown_idx on public.base_breakdown_items (base_model_id, spec_code, sort_order);

alter table public.base_breakdown_items enable row level security;
-- 売価はお客様の見積書に載る情報なので公開読み取りでよい
drop policy if exists base_breakdown_read on public.base_breakdown_items;
create policy base_breakdown_read on public.base_breakdown_items for select using (true);
drop policy if exists base_breakdown_write on public.base_breakdown_items;
create policy base_breakdown_write on public.base_breakdown_items for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());
grant select on public.base_breakdown_items to anon, authenticated;
grant all on public.base_breakdown_items to authenticated, service_role;

/** (モデル, 仕様) の本体内訳合計。内訳が未登録なら null */
create or replace function public.base_breakdown_total(p_model uuid, p_spec text)
returns integer language sql stable set search_path = public as $$
  select sum(amount)::integer from public.base_breakdown_items
   where base_model_id = p_model and spec_code = coalesce(p_spec, '');
$$;
grant execute on function public.base_breakdown_total(uuid, text) to anon, authenticated, service_role;

-- ---------- 明細の数量を小数対応にする（17.6㎡ など） ----------
alter table public.quote_items alter column quantity type numeric using quantity::numeric;

-- ---------- 総代理店は全見積を見られるようにする ----------
-- （本部と同じく本体明細を編集するため。代理店は担当分のみのまま）
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes for select
  using (user_id = auth.uid() or public.can_edit_catalog() or (public.is_dealer() and dealer_id = auth.uid()));

drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items for select
  using (exists (
    select 1 from public.quotes q
     where q.id = quote_id
       and (q.user_id = auth.uid() or public.can_edit_catalog() or (public.is_dealer() and q.dealer_id = auth.uid()))
  ));

drop policy if exists quote_requests_select on public.quote_requests;
create policy quote_requests_select on public.quote_requests for select
  using (user_id = auth.uid() or public.can_edit_catalog());

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select
  using (id = auth.uid() or public.can_edit_catalog());

-- ---------- 仕様の再計算：本体内訳があればその合計を本体一式とする ----------
create or replace function public.recalculate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  cfg public.configurations;
  v_model public.base_models;
  v_rate numeric;
  v_base integer;
  v_bb integer;
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
  -- 本体内訳（仕様別）が登録されていればその合計、なければモデルの本体価格
  v_bb := public.base_breakdown_total(cfg.base_model_id, cfg.spec_code);
  v_base := coalesce(nullif(v_bb, 0), v_model.base_price);
  v_base_exp := floor(v_base * v_rate);

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

-- ---------- 保存時に仕様コードも保存する ----------
drop function if exists public.save_configuration(uuid, uuid, text, uuid[], text, text, text, uuid[]);
create or replace function public.save_configuration(
  p_configuration_id uuid,
  p_base_model_id uuid,
  p_name text,
  p_option_ids uuid[],
  p_preview_image_url text,
  p_notes text,
  p_finish_level text default 'full',
  p_variant_choice_ids uuid[] default '{}',
  p_spec_code text default null
)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_configuration_id;
  v_uid uuid := auth.uid();
  cfg public.configurations;
  v_opts uuid[];
  v_level text := coalesce(nullif(p_finish_level, ''), 'full');
  v_spec text := nullif(p_spec_code, '');
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
    insert into public.configurations (user_id, base_model_id, name, preview_image_url, notes, finish_level, spec_code)
    values (v_uid, p_base_model_id, coalesce(nullif(p_name, ''), '無題の仕様'), p_preview_image_url, p_notes, v_level, v_spec)
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
           preview_image_url = p_preview_image_url, notes = p_notes, finish_level = v_level,
           spec_code = coalesce(v_spec, spec_code)
     where id = v_id;
    delete from public.configuration_items where configuration_id = v_id;
  end if;

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
revoke all on function public.save_configuration(uuid, uuid, text, uuid[], text, text, text, uuid[], text) from public;
grant execute on function public.save_configuration(uuid, uuid, text, uuid[], text, text, text, uuid[], text) to authenticated;

-- ---------- 見積作成：本体を内訳の行に展開する ----------
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
  v_has_breakdown boolean;
  -- 代理店・総代理店が自分で見積を作った場合は、自分を担当にする
  v_dealer uuid := case when public.current_role_rank() between 1 and 2 then v_uid else null end;
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
    subtotal, tax_rate, tax, total, preview_image_url, notes, dealer_id)
  values (
    v_no, v_req, cfg.id, v_uid, 'issued', now(), now() + interval '30 days',
    v_customer_no, coalesce(p_contact ->> 'full_name', ''), nullif(p_contact ->> 'company_name', ''), v_model.name, cfg.finish_level,
    cfg.base_price, cfg.base_expense, cfg.option_subtotal, cfg.option_expense, cfg.installation_subtotal, cfg.adjustment,
    cfg.subtotal, 0.10, cfg.tax, cfg.total, cfg.preview_image_url,
    '本見積書は概算です。別途工事（運送費・現地工事費等）は設置場所の確認後に確定します。', v_dealer)
  returning id into v_quote;

  -- 本体：内訳マスターがあれば行に展開、なければ従来どおり一式 1 行
  select exists (
    select 1 from public.base_breakdown_items b
     where b.base_model_id = cfg.base_model_id and b.spec_code = coalesce(cfg.spec_code, '')
  ) into v_has_breakdown;

  if v_has_breakdown then
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    select v_quote, 'base', b.name, b.section, b.unit, b.remark, b.unit_price, b.quantity, b.amount, b.sort_order
      from public.base_breakdown_items b
     where b.base_model_id = cfg.base_model_id and b.spec_code = coalesce(cfg.spec_code, '')
     order by b.sort_order;
  else
    insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
    values (v_quote, 'base', v_model.name || ' 本体一式', '工場生産分（躯体・金物・断熱・屋根外壁・サッシ建具）', '式', cfg.base_price, 1, cfg.base_price, 0);
  end if;

  insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
  values (v_quote, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || round(coalesce(v_model.expense_rate, 0.15) * 100) || '%）', '式', cfg.base_expense, 1, cfg.base_expense, 900);

  insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, image_url, sort_order)
  select v_quote,
         case when cat.code = 'free-product' then 'free'
              when o.is_installation then 'installation'
              else 'option' end,
         o.name || coalesce(v.label, ''),
         case when o.price_on_request then '設置場所確認後に別途お見積り' else cat.name end,
         '式',
         case when o.price_on_request then 0 else o.price end + coalesce(v.extra, 0),
         ci.quantity,
         (case when o.price_on_request then 0 else o.price end + coalesce(v.extra, 0)) * ci.quantity,
         o.image_url,
         1000 + row_number() over (order by o.is_installation, cat.sort_order, o.sort_order)
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

  insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
  values (v_quote, 'option_expense', 'オプション諸費用', '交通費、労災、安全管理費等（' || round(coalesce(v_model.expense_rate, 0.15) * 100) || '%）', '式', cfg.option_expense, 1, cfg.option_expense, 9000);

  update public.quote_requests set quote_id = v_quote where id = v_req;
  update public.configurations set status = 'quote_requested' where id = cfg.id;

  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (cfg.id, 'quote_requested', public.configuration_pricing_json(cfg.id));

  return v_quote;
end $$;

-- ---------- 改訂版：小数の数量と商品画像を引き継ぐ ----------
create or replace function public.create_quote_revision(
  p_quote_id uuid,
  p_items jsonb,
  p_dealer_note text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  parent public.quotes;
  v_uid uuid := auth.uid();
  v_full boolean;
  v_new uuid;
  v_base integer := 0;
  v_base_exp integer := 0;
  v_opt integer := 0;
  v_opt_exp integer := 0;
  v_inst integer := 0;
  v_sub_raw integer;
  v_sub integer;
  v_tax integer;
  v_sort integer := 0;
  r jsonb;
  v_kind text;
  v_qty numeric;
  v_amount integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into parent from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- 本体まで触れるのは総代理店以上
  v_full := public.current_role_rank() >= 2;
  if not (v_full or (public.is_dealer() and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積を編集できる権限がありません' using errcode = '42501';
  end if;
  if parent.status = 'superseded' then
    raise exception 'LOCKED: この版はすでに改訂されています。最新の版から作成してください' using errcode = 'P0001';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_kind := r ->> 'kind';
    if v_kind not in ('base', 'base_expense', 'option', 'option_expense', 'installation', 'free') then
      raise exception 'VALIDATION: 区分の指定が不正です（%）', v_kind using errcode = 'P0001';
    end if;
    if not v_full and v_kind not in ('installation', 'free') then
      raise exception 'FORBIDDEN: 本体・オプションを変更できるのは本部と総代理店だけです' using errcode = '42501';
    end if;
    v_qty := greatest(coalesce((r ->> 'quantity')::numeric, 1), 0.01);
    v_amount := round(coalesce((r ->> 'unit_price')::integer, 0) * v_qty)::integer;
    if v_amount < 0 then raise exception 'VALIDATION: 金額は 0 以上で入力してください' using errcode = 'P0001'; end if;

    if v_kind = 'base' then v_base := v_base + v_amount;
    elsif v_kind = 'base_expense' then v_base_exp := v_base_exp + v_amount;
    elsif v_kind = 'option' then v_opt := v_opt + v_amount;
    elsif v_kind = 'option_expense' then v_opt_exp := v_opt_exp + v_amount;
    else v_inst := v_inst + v_amount;
    end if;
  end loop;

  v_sub_raw := v_base + v_base_exp + v_opt + v_opt_exp + v_inst;
  v_sub := floor(v_sub_raw / 1000.0)::integer * 1000;
  v_tax := floor(v_sub * parent.tax_rate)::integer;

  insert into public.quotes (
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment,
    subtotal, tax_rate, tax, total, preview_image_url, notes,
    dealer_id, dealer_note, revision, parent_quote_id)
  values (
    parent.quote_no || '-' || (parent.revision + 1), parent.quote_request_id, parent.configuration_id, parent.user_id,
    'issued', now(), now() + interval '30 days',
    parent.customer_no, parent.customer_name, parent.customer_company, parent.base_model_name, parent.finish_level,
    v_base, v_base_exp, v_opt, v_opt_exp, v_inst,
    v_sub - v_sub_raw, v_sub, parent.tax_rate, v_tax, v_sub + v_tax, parent.preview_image_url,
    case when v_full then '本見積書は最新の内容で作成した確定見積です。'
         else '本見積書は現地の代理店・工務店が別途工事を確認したうえで作成した確定見積です。' end,
    coalesce(parent.dealer_id, case when v_full then null else v_uid end), p_dealer_note, parent.revision + 1, parent.id)
  returning id into v_new;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    v_qty := greatest(coalesce((r ->> 'quantity')::numeric, 1), 0.01);
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order)
    values (
      v_new,
      r ->> 'kind',
      coalesce(nullif(r ->> 'name', ''), '（名称未設定）'),
      nullif(r ->> 'description', ''),
      coalesce(nullif(r ->> 'unit', ''), '式'),
      nullif(r ->> 'remark', ''),
      coalesce((r ->> 'unit_price')::integer, 0),
      v_qty,
      round(coalesce((r ->> 'unit_price')::integer, 0) * v_qty)::integer,
      nullif(r ->> 'image_url', ''),
      v_sort);
  end loop;

  update public.quotes set status = 'superseded' where id = parent.id;
  update public.quote_requests set quote_id = v_new, status = 'sent' where id = parent.quote_request_id;

  return v_new;
end $$;

revoke all on function public.create_quote_revision(uuid, jsonb, text) from public;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;
