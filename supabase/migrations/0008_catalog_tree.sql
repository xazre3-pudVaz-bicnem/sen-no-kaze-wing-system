-- =============================================================
-- 商品台帳の3階層化と、図面クリック（ホットスポット）
--   本体（base_models） › 仕様（presets: ホテル/住宅/事務所） › 分類（group） › カテゴリー › 商品
--   - options.spec_codes : 対応する仕様。空 = 全仕様共通
--   - option_categories.group_code / group_name : 先方の商品台帳フォルダ（増やせる）
--   - preview_hotspots : 平面図・立面図のクリック領域（カテゴリーへ紐付け）
-- =============================================================

alter table public.options add column if not exists spec_codes text[] not null default '{}';

alter table public.option_categories
  add column if not exists group_code text not null default 'other',
  add column if not exists group_name text not null default 'その他',
  add column if not exists group_sort integer not null default 99;

create table if not exists public.preview_hotspots (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.preview_image_rules (id) on delete cascade,
  category_id uuid not null references public.option_categories (id) on delete cascade,
  label text not null,
  -- 画像に対する割合（%）
  x numeric(5, 2) not null,
  y numeric(5, 2) not null,
  w numeric(5, 2) not null,
  h numeric(5, 2) not null,
  sort_order integer not null default 0
);
create index if not exists preview_hotspots_rule_idx on public.preview_hotspots (rule_id, sort_order);

alter table public.preview_hotspots enable row level security;
drop policy if exists preview_hotspots_read on public.preview_hotspots;
create policy preview_hotspots_read on public.preview_hotspots for select using (true);
drop policy if exists preview_hotspots_admin on public.preview_hotspots;
create policy preview_hotspots_admin on public.preview_hotspots for all using (public.is_admin()) with check (public.is_admin());

grant select on public.preview_hotspots to anon, authenticated;
grant all on public.preview_hotspots to authenticated, service_role;
