-- =============================================================
-- 見積書テンプレート（20260821見積書テンプレート.xlsx）への対応
--   - 本体／オプションそれぞれに諸費用 15%（base_models.expense_rate）
--   - 値引き等調整額（千円未満切捨て）
--   - 3 モデル（Wing / BOX / フラット）とプラン（presets）
--   - 顧客番号（profiles.customer_no）
--   - 見積明細に商品画像（quote_items.image_url）
--   - 第二段階: 別途工事を入力する代理店（quotes.dealer_id）
-- =============================================================

alter table public.base_models
  add column if not exists expense_rate numeric(5, 4) not null default 0.15,
  add column if not exists presets jsonb not null default '[]'::jsonb;

-- 顧客番号: C + 6 桁連番
create sequence if not exists public.customer_no_seq;
alter table public.profiles add column if not exists customer_no text unique;
create or replace function public.assign_customer_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_no is null then
    new.customer_no := 'C' || lpad(nextval('public.customer_no_seq')::text, 6, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_customer_no on public.profiles;
create trigger trg_profiles_customer_no before insert on public.profiles for each row execute function public.assign_customer_no();
update public.profiles set customer_no = 'C' || lpad(nextval('public.customer_no_seq')::text, 6, '0') where customer_no is null;

alter table public.configurations
  add column if not exists base_expense integer not null default 0,
  add column if not exists option_expense integer not null default 0,
  add column if not exists adjustment integer not null default 0;

alter table public.quotes
  add column if not exists customer_no text,
  add column if not exists base_expense integer not null default 0,
  add column if not exists option_expense integer not null default 0,
  add column if not exists adjustment integer not null default 0,
  add column if not exists dealer_id uuid; -- 第二段階: partners.id

alter table public.quote_items drop constraint if exists quote_items_kind_check;
alter table public.quote_items add constraint quote_items_kind_check
  check (kind in ('base', 'base_expense', 'option', 'option_expense', 'installation'));
alter table public.quote_items add column if not exists image_url text;

-- 金額不変トリガーに新列を追加
create or replace function public.guard_quote_amounts()
returns trigger language plpgsql as $$
begin
  if new.base_price <> old.base_price or new.base_expense <> old.base_expense
     or new.option_subtotal <> old.option_subtotal or new.option_expense <> old.option_expense
     or new.installation_subtotal <> old.installation_subtotal or new.adjustment <> old.adjustment
     or new.subtotal <> old.subtotal or new.tax <> old.tax or new.total <> old.total
     or new.quote_no <> old.quote_no then
    raise exception 'QUOTE_IMMUTABLE: 発行済み見積の金額は変更できません' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------- 再計算（テンプレートの計算構造） ----------
create or replace function public.recalculate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  cfg public.configurations;
  v_rate numeric;
  v_base integer;
  v_base_exp integer;
  v_opt integer;
  v_opt_exp integer;
  v_inst integer;
  v_raw integer;
  v_sub integer;
  v_tax integer;
begin
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or cfg.user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select base_price, coalesce(expense_rate, 0.15) into v_base, v_rate from public.base_models where id = cfg.base_model_id;
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

  v_base_exp := floor(v_base * v_rate);
  v_opt_exp := floor(v_opt * v_rate);
  v_raw := v_base + v_base_exp + v_opt + v_opt_exp + v_inst;
  v_sub := floor(v_raw / 1000.0) * 1000;
  v_tax := floor(v_sub * 0.10);

  update public.configurations
     set base_price = v_base, base_expense = v_base_exp,
         option_subtotal = v_opt, option_expense = v_opt_exp,
         installation_subtotal = v_inst, adjustment = v_sub - v_raw,
         subtotal = v_sub, tax = v_tax, total = v_sub + v_tax
   where id = cfg.id
   returning * into cfg;
  return cfg;
end $$;

create or replace function public.configuration_pricing_json(p_configuration_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'base_model_id', c.base_model_id,
    'model_name', m.name,
    'base_price', c.base_price,
    'expense_rate', coalesce(m.expense_rate, 0.15),
    'base_expense', c.base_expense,
    'base_total', c.base_price + c.base_expense,
    'option_subtotal', c.option_subtotal,
    'option_expense', c.option_expense,
    'option_total', c.option_subtotal + c.option_expense,
    'installation_subtotal', c.installation_subtotal,
    'subtotal_raw', c.subtotal - c.adjustment,
    'adjustment', c.adjustment,
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
        'is_installation', o.is_installation, 'price_on_request', o.price_on_request,
        'image_url', o.image_url
      ) order by cat.sort_order, o.sort_order)
      from public.configuration_items ci
      join public.options o on o.id = ci.option_id
      join public.option_categories cat on cat.id = o.category_id
      where ci.configuration_id = c.id), '[]'::jsonb)
  )
  from public.configurations c join public.base_models m on m.id = c.base_model_id
  where c.id = p_configuration_id;
$$;

-- ---------- 見積作成（明細スナップショット・画像付き） ----------
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
  v_sort integer := 1;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if cfg.user_id <> v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select coalesce(array_agg(option_id), '{}') into v_opts from public.configuration_items where configuration_id = cfg.id;
  perform public.validate_configuration_items(cfg.base_model_id, v_opts);
  cfg := public.recalculate_configuration(cfg.id);
  select * into v_model from public.base_models where id = cfg.base_model_id;
  select customer_no into v_customer_no from public.profiles where id = v_uid;

  insert into public.quote_requests (configuration_id, user_id, status, message, contact)
  values (cfg.id, v_uid, 'new', p_message, coalesce(p_contact, '{}'::jsonb))
  returning id into v_req;

  v_no := public.next_quote_no();

  insert into public.quotes (
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment,
    subtotal, tax_rate, tax, total, preview_image_url, notes)
  values (
    v_no, v_req, cfg.id, v_uid, 'issued', now(), now() + interval '30 days',
    v_customer_no, coalesce(p_contact ->> 'full_name', ''), nullif(p_contact ->> 'company_name', ''), v_model.name,
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

-- =============================================================
-- 第二段階の予約:
--   partners(id, code, name, ...)                  代理店
--   quotes.dealer_id → partners.id                   別途工事を入力した代理店
--   quote_items.kind = 'installation' に代理店入力の金額を追加（現在は 0 円・要見積）
-- =============================================================
