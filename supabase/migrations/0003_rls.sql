-- =============================================================
-- Row Level Security
--   公開マスター: 誰でも published を閲覧、管理者のみ編集
--   顧客データ  : 本人のみ、管理者は全件
-- =============================================================

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.base_models enable row level security;
alter table public.product_images enable row level security;
alter table public.option_categories enable row level security;
alter table public.options enable row level security;
alter table public.option_dependencies enable row level security;
alter table public.option_conflicts enable row level security;
alter table public.preview_image_rules enable row level security;
alter table public.configurations enable row level security;
alter table public.configuration_items enable row level security;
alter table public.configuration_snapshots enable row level security;
alter table public.quote_requests enable row level security;
alter table public.quote_sequences enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_documents enable row level security;

-- roles: 閲覧のみ
create policy roles_read on public.roles for select using (true);

-- profiles
create policy profiles_select_own on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update using (id = auth.uid() or public.is_admin())
  with check (
    -- 一般ユーザーは自分の role_code を変更できない
    (id = auth.uid() and role_code = (select p.role_code from public.profiles p where p.id = auth.uid()))
    or public.is_admin()
  );
create policy profiles_insert_self on public.profiles for insert with check (id = auth.uid());

-- マスター（公開読み取り／管理者編集）
create policy base_models_read on public.base_models for select using (status = 'published' or public.is_admin());
create policy base_models_admin on public.base_models for all using (public.is_admin()) with check (public.is_admin());

create policy product_images_read on public.product_images for select
  using (public.is_admin() or exists (select 1 from public.base_models m where m.id = base_model_id and m.status = 'published'));
create policy product_images_admin on public.product_images for all using (public.is_admin()) with check (public.is_admin());

create policy option_categories_read on public.option_categories for select using (status = 'published' or public.is_admin());
create policy option_categories_admin on public.option_categories for all using (public.is_admin()) with check (public.is_admin());

create policy options_read on public.options for select using (status = 'published' or public.is_admin());
create policy options_admin on public.options for all using (public.is_admin()) with check (public.is_admin());

create policy option_dependencies_read on public.option_dependencies for select using (true);
create policy option_dependencies_admin on public.option_dependencies for all using (public.is_admin()) with check (public.is_admin());

create policy option_conflicts_read on public.option_conflicts for select using (true);
create policy option_conflicts_admin on public.option_conflicts for all using (public.is_admin()) with check (public.is_admin());

create policy preview_rules_read on public.preview_image_rules for select using (status = 'published' or public.is_admin());
create policy preview_rules_admin on public.preview_image_rules for all using (public.is_admin()) with check (public.is_admin());

-- 顧客データ: 本人 or 管理者。作成・更新は RPC（security definer）経由だが、
-- 直接操作されても他人のデータに触れないようポリシーで二重に守る。
create policy configurations_select on public.configurations for select using (user_id = auth.uid() or public.is_admin());
create policy configurations_insert on public.configurations for insert with check (user_id = auth.uid());
create policy configurations_update on public.configurations for update using (user_id = auth.uid() or public.is_admin());
create policy configurations_delete on public.configurations for delete using (user_id = auth.uid() or public.is_admin());

create policy configuration_items_select on public.configuration_items for select
  using (exists (select 1 from public.configurations c where c.id = configuration_id and (c.user_id = auth.uid() or public.is_admin())));
create policy configuration_items_write on public.configuration_items for all
  using (exists (select 1 from public.configurations c where c.id = configuration_id and (c.user_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.configurations c where c.id = configuration_id and (c.user_id = auth.uid() or public.is_admin())));

create policy configuration_snapshots_select on public.configuration_snapshots for select
  using (exists (select 1 from public.configurations c where c.id = configuration_id and (c.user_id = auth.uid() or public.is_admin())));

create policy quote_requests_select on public.quote_requests for select using (user_id = auth.uid() or public.is_admin());
create policy quote_requests_admin_update on public.quote_requests for update using (public.is_admin()) with check (public.is_admin());

-- 採番テーブルは関数（security definer）からのみ触る
-- （ポリシーなし = 全拒否）

create policy quotes_select on public.quotes for select using (user_id = auth.uid() or public.is_admin());
create policy quotes_admin_update on public.quotes for update using (public.is_admin()) with check (public.is_admin());
-- 発行済み見積の金額列は管理者でも変更不可（ステータスのみ変更可）
create or replace function public.guard_quote_amounts()
returns trigger language plpgsql as $$
begin
  if new.base_price <> old.base_price or new.option_subtotal <> old.option_subtotal
     or new.installation_subtotal <> old.installation_subtotal or new.subtotal <> old.subtotal
     or new.tax <> old.tax or new.total <> old.total or new.quote_no <> old.quote_no then
    raise exception 'QUOTE_IMMUTABLE: 発行済み見積の金額は変更できません' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_quotes_immutable before update on public.quotes for each row execute function public.guard_quote_amounts();

create policy quote_items_select on public.quote_items for select
  using (exists (select 1 from public.quotes q where q.id = quote_id and (q.user_id = auth.uid() or public.is_admin())));

create policy quote_documents_select on public.quote_documents for select
  using (exists (select 1 from public.quotes q where q.id = quote_id and (q.user_id = auth.uid() or public.is_admin())));
-- quote_documents の insert は service role（PDF 生成ルート）のみ
