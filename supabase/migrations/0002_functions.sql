-- =============================================================
-- サーバー側の価格再計算・採番・見積作成（クライアントを信用しない）
-- =============================================================

-- 見積番号の採番: Q + yyyymm(JST) + '-' + 4桁連番
create or replace function public.next_quote_no()
returns text language plpgsql security definer set search_path = public as $$
declare
  ym text := to_char(now() at time zone 'Asia/Tokyo', 'YYYYMM');
  n integer;
begin
  insert into public.quote_sequences (year_month, last_no) values (ym, 1)
  on conflict (year_month) do update set last_no = public.quote_sequences.last_no + 1
  returning last_no into n;
  return 'Q' || ym || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function public.next_quote_no() from public;

-- 選択集合の検証（競合・前提・必須）。問題があれば例外
create or replace function public.validate_configuration_items(p_model_id uuid, p_option_ids uuid[])
returns void language plpgsql stable security definer set search_path = public as $$
declare
  r record;
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
  for r in
    select cat.name from public.option_categories cat
    where cat.status = 'published' and cat.is_required
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

-- 保存済み仕様の金額を DB のマスターから再計算して configurations に書き戻す
create or replace function public.recalculate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  cfg public.configurations;
  v_base integer;
  v_opt integer;
  v_inst integer;
  v_sub integer;
  v_tax integer;
begin
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or cfg.user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select base_price into v_base from public.base_models where id = cfg.base_model_id;
  select coalesce(sum(case when o.price_on_request then 0 else o.price end * ci.quantity), 0)
    into v_opt
    from public.configuration_items ci join public.options o on o.id = ci.option_id
   where ci.configuration_id = cfg.id and o.status = 'published' and not o.is_installation
     and (o.base_model_id is null or o.base_model_id = cfg.base_model_id);
  select coalesce(sum(case when o.price_on_request then 0 else o.price end * ci.quantity), 0)
    into v_inst
    from public.configuration_items ci join public.options o on o.id = ci.option_id
   where ci.configuration_id = cfg.id and o.status = 'published' and o.is_installation
     and (o.base_model_id is null or o.base_model_id = cfg.base_model_id);

  v_sub := v_base + v_opt + v_inst;
  v_tax := floor(v_sub * 0.10);

  update public.configurations
     set base_price = v_base, option_subtotal = v_opt, installation_subtotal = v_inst,
         subtotal = v_sub, tax = v_tax, total = v_sub + v_tax
   where id = cfg.id
   returning * into cfg;
  return cfg;
end $$;

-- 仕様の保存（作成／更新）を 1 トランザクションで行う。
-- クライアントから金額は受け取らず、ここで再計算する。
create or replace function public.save_configuration(
  p_configuration_id uuid,      -- null なら新規
  p_base_model_id uuid,
  p_name text,
  p_option_ids uuid[],
  p_preview_image_url text,
  p_notes text
)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_configuration_id;
  v_uid uuid := auth.uid();
  cfg public.configurations;
  v_opts uuid[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.base_models m where m.id = p_base_model_id and m.status = 'published') then
    raise exception 'MODEL_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  -- 公開中かつ対象モデルのオプションだけ残す（不正 ID を除去）
  select coalesce(array_agg(distinct o.id), '{}') into v_opts
    from public.options o
   where o.id = any (p_option_ids) and o.status = 'published'
     and (o.base_model_id is null or o.base_model_id = p_base_model_id);

  perform public.validate_configuration_items(p_base_model_id, v_opts);

  if v_id is null then
    insert into public.configurations (user_id, base_model_id, name, preview_image_url, notes)
    values (v_uid, p_base_model_id, coalesce(nullif(p_name, ''), '無題の仕様'), p_preview_image_url, p_notes)
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
           preview_image_url = p_preview_image_url, notes = p_notes
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

-- 価格内訳を JSON 化（スナップショット・クライアント表示の検算用）
create or replace function public.configuration_pricing_json(p_configuration_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'base_model_id', c.base_model_id,
    'model_name', m.name,
    'base_price', c.base_price,
    'option_subtotal', c.option_subtotal,
    'installation_subtotal', c.installation_subtotal,
    'subtotal', c.subtotal,
    'tax_rate', 0.10,
    'tax', c.tax,
    'total', c.total,
    'has_price_on_request', exists (
      select 1 from public.configuration_items ci join public.options o on o.id = ci.option_id
      where ci.configuration_id = c.id and o.price_on_request),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'option_id', o.id, 'code', o.code, 'name', o.name, 'category_name', cat.name,
        'unit_price', case when o.price_on_request then 0 else o.price end,
        'quantity', ci.quantity,
        'amount', case when o.price_on_request then 0 else o.price end * ci.quantity,
        'is_installation', o.is_installation, 'price_on_request', o.price_on_request
      ) order by cat.sort_order, o.sort_order)
      from public.configuration_items ci
      join public.options o on o.id = ci.option_id
      join public.option_categories cat on cat.id = o.category_id
      where ci.configuration_id = c.id), '[]'::jsonb)
  )
  from public.configurations c join public.base_models m on m.id = c.base_model_id
  where c.id = p_configuration_id;
$$;

-- 仕様の複製（本人のみ）
create or replace function public.duplicate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  src public.configurations;
  v_new uuid;
begin
  select * into src from public.configurations where id = p_configuration_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if src.user_id <> auth.uid() and not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into public.configurations (user_id, base_model_id, name, preview_image_url, notes)
  values (src.user_id, src.base_model_id, src.name || '（コピー）', src.preview_image_url, src.notes)
  returning id into v_new;
  insert into public.configuration_items (configuration_id, option_id, quantity)
  select v_new, option_id, quantity from public.configuration_items where configuration_id = src.id;
  return public.recalculate_configuration(v_new);
end $$;

-- 見積依頼 → 見積作成（再計算・検証・採番・明細スナップショット）を 1 トランザクションで行う
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
  v_notes text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if cfg.user_id <> v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select coalesce(array_agg(option_id), '{}') into v_opts from public.configuration_items where configuration_id = cfg.id;
  perform public.validate_configuration_items(cfg.base_model_id, v_opts);
  cfg := public.recalculate_configuration(cfg.id);
  select * into v_model from public.base_models where id = cfg.base_model_id;

  insert into public.quote_requests (configuration_id, user_id, status, message, contact)
  values (cfg.id, v_uid, 'new', p_message, coalesce(p_contact, '{}'::jsonb))
  returning id into v_req;

  v_no := public.next_quote_no();
  v_notes := '本見積書は概算です。運送費・現地工事費・諸経費等は設置場所の確認後に確定します。';

  insert into public.quotes (
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_name, customer_company, base_model_name,
    base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total,
    preview_image_url, notes)
  values (
    v_no, v_req, cfg.id, v_uid, 'issued', now(), now() + interval '30 days',
    coalesce(p_contact ->> 'full_name', ''), nullif(p_contact ->> 'company_name', ''), v_model.name,
    cfg.base_price, cfg.option_subtotal, cfg.installation_subtotal, cfg.subtotal, 0.10, cfg.tax, cfg.total,
    cfg.preview_image_url, v_notes)
  returning id into v_quote;

  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
  values (v_quote, 'base', v_model.name || ' 本体', '折り畳み式木造コンテナ 標準仕様', v_model.base_price, 1, v_model.base_price, 0);

  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
  select v_quote,
         case when o.is_installation then 'installation' else 'option' end,
         o.name,
         case when o.price_on_request then '設置場所確認後に別途お見積り' else cat.name end,
         case when o.price_on_request then 0 else o.price end,
         ci.quantity,
         case when o.price_on_request then 0 else o.price end * ci.quantity,
         row_number() over (order by cat.sort_order, o.sort_order)
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = cfg.id;

  update public.quote_requests set quote_id = v_quote where id = v_req;
  update public.configurations set status = 'quote_requested' where id = cfg.id;

  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (cfg.id, 'quote_requested', public.configuration_pricing_json(cfg.id));

  return v_quote;
end $$;

grant execute on function public.save_configuration(uuid, uuid, text, uuid[], text, text) to authenticated;
grant execute on function public.duplicate_configuration(uuid) to authenticated;
grant execute on function public.create_quote_from_configuration(uuid, jsonb, text) to authenticated;
grant execute on function public.recalculate_configuration(uuid) to authenticated;
grant execute on function public.configuration_pricing_json(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated, anon;
