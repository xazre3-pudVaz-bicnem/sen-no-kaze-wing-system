-- =============================================================
-- 権限階層とフリー商品
--
-- 権限（profiles.role_code）
--   customer      顧客
--   dealer        代理店・工務店   … 見積の「別途工事」「その他」とフリー商品を扱える
--   master_dealer 総代理店         … 商品台帳（本体・カテゴリー・商品・価格・画像）を登録できる
--   admin         管理者（技術の杜）… すべて
--
-- フリー商品
--   代理店が自分で登録する商品（ベッド・イスなど）。options.owner_id に登録者を持ち、
--   見積書では「別途工事」の下に【フリー商品】として別枠で表示する。
--   諸費用（15%）は乗せず、別途工事と同じ扱いで小計に加える（is_installation = true）。
-- =============================================================

insert into public.roles (code, name) values
  ('dealer', '代理店・工務店'),
  ('master_dealer', '総代理店')
on conflict (code) do update set name = excluded.name;

-- 権限の順位（customer 0 < dealer 1 < master_dealer 2 < admin 3）
create or replace function public.role_rank(p_code text)
returns integer language sql immutable set search_path = public as $$
  select case p_code
           when 'admin' then 3
           when 'master_dealer' then 2
           when 'dealer' then 1
           else 0
         end;
$$;

create or replace function public.current_role_rank()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select public.role_rank(p.role_code) from public.profiles p where p.id = auth.uid()), 0);
$$;

/** 総代理店以上：商品台帳（本体・カテゴリー・商品・価格・画像・プレビュー）を編集できる */
create or replace function public.can_edit_catalog()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_rank() >= 2;
$$;

/** 代理店以上：フリー商品の登録と、見積の別途工事・その他の入力ができる */
create or replace function public.is_dealer()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_rank() >= 1;
$$;

grant execute on function public.role_rank(text), public.current_role_rank(),
                         public.can_edit_catalog(), public.is_dealer() to anon, authenticated, service_role;

-- ---------- フリー商品の所有者 ----------
alter table public.options add column if not exists owner_id uuid references public.profiles (id) on delete set null;
create index if not exists options_owner_idx on public.options (owner_id);

-- ---------- 台帳の書き込み権限を「総代理店以上」に広げる ----------
drop policy if exists base_models_admin on public.base_models;
create policy base_models_admin on public.base_models for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists product_images_admin on public.product_images;
create policy product_images_admin on public.product_images for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists option_categories_admin on public.option_categories;
create policy option_categories_admin on public.option_categories for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists option_dependencies_admin on public.option_dependencies;
create policy option_dependencies_admin on public.option_dependencies for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists option_conflicts_admin on public.option_conflicts;
create policy option_conflicts_admin on public.option_conflicts for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists preview_rules_admin on public.preview_image_rules;
create policy preview_rules_admin on public.preview_image_rules for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

drop policy if exists preview_hotspots_admin on public.preview_hotspots;
create policy preview_hotspots_admin on public.preview_hotspots for all
  using (public.can_edit_catalog()) with check (public.can_edit_catalog());

-- 商品：総代理店以上は全件。代理店は自分が登録したフリー商品だけ
drop policy if exists options_admin on public.options;
create policy options_admin on public.options for all
  using (public.can_edit_catalog() or (public.is_dealer() and owner_id = auth.uid()))
  with check (public.can_edit_catalog() or (public.is_dealer() and owner_id = auth.uid()));

-- ---------- 見積 ----------
-- フリー商品の明細を区別できるようにする
alter table public.quote_items drop constraint if exists quote_items_kind_check;
alter table public.quote_items add constraint quote_items_kind_check
  check (kind in ('base', 'base_expense', 'option', 'option_expense', 'installation', 'free', 'discount'));

-- 代理店は担当見積の別途工事・フリー商品の明細を編集できる
drop policy if exists quote_items_dealer_write on public.quote_items;
create policy quote_items_dealer_write on public.quote_items for all
  using (
    public.is_admin()
    or (public.is_dealer() and kind in ('installation', 'free')
        and exists (select 1 from public.quotes q where q.id = quote_id and q.dealer_id = auth.uid()))
  )
  with check (
    public.is_admin()
    or (public.is_dealer() and kind in ('installation', 'free')
        and exists (select 1 from public.quotes q where q.id = quote_id and q.dealer_id = auth.uid()))
  );

-- 見積作成時、フリー商品カテゴリーの明細は kind='free' で入れる
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
