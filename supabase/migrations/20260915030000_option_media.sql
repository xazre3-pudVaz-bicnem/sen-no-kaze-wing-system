-- =============================================================
-- 商品メディア管理
-- - options.image_url は既存のメイン画像として維持
-- - option_images は商品詳細用のサブ画像（複数・表示順）
-- - options.manufacturer_document_url はメーカー資料PDF
-- - dealer の編集対象は自分の free-product に限定
-- - product-documents は公開商品資料PDF専用。書き込みはアプリのservice roleのみ
-- =============================================================

alter table public.options
  add column if not exists manufacturer_document_url text;

create table if not exists public.option_images (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options(id) on delete cascade,
  url text not null check (length(trim(url)) > 0 and length(url) <= 1000),
  alt text not null default '' check (length(alt) <= 200),
  caption text check (caption is null or length(caption) <= 200),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists option_images_option_sort_idx
  on public.option_images(option_id, sort_order, id);

alter table public.option_images enable row level security;

grant select on public.option_images to anon, authenticated;
grant insert, update, delete on public.option_images to authenticated;
grant all on public.option_images to service_role;

-- 既存 options の dealer write 境界も、アプリ側と同じ
-- 「自分が所有する free-product のみ」に揃える。
drop policy if exists options_admin on public.options;
create policy options_admin on public.options
for all
using (
  public.can_edit_catalog()
  or (
    public.is_dealer()
    and owner_id = auth.uid()
    and exists (
      select 1
      from public.option_categories c
      where c.id = category_id
        and c.code = 'free-product'
    )
  )
)
with check (
  public.can_edit_catalog()
  or (
    public.is_dealer()
    and owner_id = auth.uid()
    and exists (
      select 1
      from public.option_categories c
      where c.id = category_id
        and c.code = 'free-product'
    )
  )
);

drop policy if exists option_images_read on public.option_images;
create policy option_images_read on public.option_images
for select
using (
  exists (
    select 1
    from public.options o
    where o.id = option_images.option_id
      and (
        o.status = 'published'
        or public.can_edit_catalog()
        or (
          public.is_dealer()
          and o.owner_id = auth.uid()
          and exists (
            select 1
            from public.option_categories c
            where c.id = o.category_id
              and c.code = 'free-product'
          )
        )
      )
  )
);

drop policy if exists option_images_write on public.option_images;
create policy option_images_write on public.option_images
for all
to authenticated
using (
  exists (
    select 1
    from public.options o
    where o.id = option_images.option_id
      and (
        public.can_edit_catalog()
        or (
          public.is_dealer()
          and o.owner_id = auth.uid()
          and exists (
            select 1
            from public.option_categories c
            where c.id = o.category_id
              and c.code = 'free-product'
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.options o
    where o.id = option_images.option_id
      and (
        public.can_edit_catalog()
        or (
          public.is_dealer()
          and o.owner_id = auth.uid()
          and exists (
            select 1
            from public.option_categories c
            where c.id = o.category_id
              and c.code = 'free-product'
          )
        )
      )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-documents',
  'product-documents',
  true,
  20971520,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product documents public read" on storage.objects;
create policy "product documents public read"
on storage.objects
for select
using (bucket_id = 'product-documents');

-- product-documents への insert/update/delete ポリシーは作らない。
-- 管理画面のサーバーアクションが service role でのみ書き込み、
-- anon/authenticated からの直接アップロード・削除は許可しない。
-- service role 削除時はアプリ側で option-{optionId}/{kind}/ prefix を必須検証する。
