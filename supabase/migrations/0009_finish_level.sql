-- =============================================================
-- 注文範囲（どこまで仕上げるか）
--   本体 ＝ 木造躯体＋屋根＋外壁＋サッシ が付いた状態。
--   お客様は「本体のみ（DIY）」「本体＋設備」「フル装備（完全仕上げ）」から選べる。
--
--   option_categories.finish_level : そのカテゴリーが含まれ始める注文範囲
--     shell     … 本体に必ず含まれる（サッシ・外壁・防火仕様・別途工事）
--     equipment … 設備を頼むときから選べる（浴室・トイレ・照明・家具 など）
--     full      … 完全仕上げのときだけ（床・壁天井・内部建具・造作工事）
--   configurations.finish_level / quotes.finish_level : 選ばれた注文範囲
-- =============================================================

alter table public.option_categories
  add column if not exists finish_level text not null default 'full';
alter table public.option_categories drop constraint if exists option_categories_finish_level_check;
alter table public.option_categories add constraint option_categories_finish_level_check
  check (finish_level in ('shell', 'equipment', 'full'));

alter table public.configurations
  add column if not exists finish_level text not null default 'full';
alter table public.configurations drop constraint if exists configurations_finish_level_check;
alter table public.configurations add constraint configurations_finish_level_check
  check (finish_level in ('shell', 'equipment', 'full'));

alter table public.quotes
  add column if not exists finish_level text not null default 'full';
alter table public.quotes drop constraint if exists quotes_finish_level_check;
alter table public.quotes add constraint quotes_finish_level_check
  check (finish_level in ('shell', 'equipment', 'full'));

-- 注文範囲の順位（shell < equipment < full）
create or replace function public.finish_level_rank(p_level text)
returns integer language sql immutable set search_path = public as $$
  select case p_level when 'shell' then 0 when 'equipment' then 1 else 2 end;
$$;

-- 必須カテゴリーの検証を「注文範囲に入っているカテゴリーだけ」に限定する
create or replace function public.validate_configuration_items(
  p_model_id uuid,
  p_option_ids uuid[],
  p_finish_level text default 'full'
)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_rank integer := public.finish_level_rank(p_finish_level);
begin
  for r in
    select c.option_id, c.conflicts_with_option_id, c.message from public.option_conflicts c
    where c.option_id = any (p_option_ids) and c.conflicts_with_option_id = any (p_option_ids)
  loop
    raise exception 'CONFLICT: %', coalesce(r.message, '同時に選択できないオプションが含まれています') using errcode = 'P0001';
  end loop;

  for r in
    select d.option_id, d.requires_option_id, d.message from public.option_dependencies d
    where d.option_id = any (p_option_ids) and not (d.requires_option_id = any (p_option_ids))
  loop
    raise exception 'DEPENDENCY: %', coalesce(r.message, '前提となるオプションが選択されていません') using errcode = 'P0001';
  end loop;

  -- 注文範囲外のカテゴリーの商品が混ざっていたら弾く（本体のみなのに内装が入っている等）
  for r in
    select cat.name from public.option_categories cat
    join public.options o on o.category_id = cat.id
    where o.id = any (p_option_ids) and public.finish_level_rank(cat.finish_level) > v_rank
    group by cat.id, cat.name
  loop
    raise exception 'REQUIRED: 「%」は選択された注文範囲に含まれません', r.name using errcode = 'P0001';
  end loop;

  for r in
    select cat.name from public.option_categories cat
    where cat.status = 'published' and cat.is_required
      and public.finish_level_rank(cat.finish_level) <= v_rank
      and exists (select 1 from public.options o where o.category_id = cat.id and o.status = 'published'
                  and (o.base_model_id is null or o.base_model_id = p_model_id))
      and not exists (select 1 from public.options o where o.category_id = cat.id and o.id = any (p_option_ids))
  loop
    raise exception 'REQUIRED: 「%」を選択してください', r.name using errcode = 'P0001';
  end loop;

  for r in
    select cat.name, count(*) as n from public.option_categories cat
    join public.options o on o.category_id = cat.id
    where cat.selection_mode = 'single' and o.id = any (p_option_ids)
    group by cat.id, cat.name having count(*) > 1
  loop
    raise exception 'SINGLE: 「%」は 1 つだけ選択してください', r.name using errcode = 'P0001';
  end loop;
end $$;

-- 保存時に注文範囲を受け取る
create or replace function public.save_configuration(
  p_configuration_id uuid,
  p_base_model_id uuid,
  p_name text,
  p_option_ids uuid[],
  p_preview_image_url text,
  p_notes text,
  p_finish_level text default 'full'
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

  -- 公開中かつ対象モデル、さらに注文範囲に入るカテゴリーの商品だけ残す
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

  insert into public.configuration_items (configuration_id, option_id, quantity)
  select v_id, unnest(v_opts), 1;

  cfg := public.recalculate_configuration(v_id);

  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (v_id, 'saved', public.configuration_pricing_json(v_id));

  return cfg;
end $$;

-- 複製時に注文範囲を引き継ぐ
create or replace function public.duplicate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  src public.configurations;
  v_id uuid;
begin
  select * into src from public.configurations where id = p_configuration_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or src.user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.configurations (user_id, base_model_id, name, preview_image_url, notes, finish_level)
  values (src.user_id, src.base_model_id, src.name || '（コピー）', src.preview_image_url, src.notes, src.finish_level)
  returning id into v_id;

  insert into public.configuration_items (configuration_id, option_id, quantity)
  select v_id, ci.option_id, ci.quantity from public.configuration_items ci where ci.configuration_id = p_configuration_id;

  return public.recalculate_configuration(v_id);
end $$;

-- 見積作成: 注文範囲を検証に渡し、発行済み見積へスナップショットする
-- （0005 の定義に finish_level を足したもの。他の処理は変更していない）
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

  -- 本体一式 ＋ 本体諸費用
  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
  values (v_quote, 'base', v_model.name || ' 本体一式', '工場生産分（躯体・金物・断熱・屋根外壁・サッシ建具）', v_model.base_price, 1, v_model.base_price, 0),
         (v_quote, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || round(coalesce(v_model.expense_rate, 0.15) * 100) || '%）', cfg.base_expense, 1, cfg.base_expense, 1);

  -- オプション明細（画像付き）
  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, image_url, sort_order)
  select v_quote,
         case when o.is_installation then 'installation' else 'option' end,
         o.name,
         case when o.price_on_request then '設置場所確認後に別途お見積り' else cat.name end,
         case when o.price_on_request then 0 else o.price end,
         ci.quantity,
         case when o.price_on_request then 0 else o.price end * ci.quantity,
         o.image_url,
         10 + row_number() over (order by o.is_installation, cat.sort_order, o.sort_order)
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = cfg.id;

  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
  values (v_quote, 'option_expense', 'オプション諸費用', '交通費、労災、安全管理費等（' || round(coalesce(v_model.expense_rate, 0.15) * 100) || '%）', cfg.option_expense, 1, cfg.option_expense, 9000);

  update public.quote_requests set quote_id = v_quote where id = v_req;
  update public.configurations set status = 'quote_requested' where id = cfg.id;

  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (cfg.id, 'quote_requested', public.configuration_pricing_json(cfg.id));

  return v_quote;
end $$;

grant execute on function public.finish_level_rank(text) to anon, authenticated, service_role;
