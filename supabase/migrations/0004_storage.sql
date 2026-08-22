-- =============================================================
-- Storage バケット
--   product-images : 商品・オプション・プレビュー画像（公開読み取り、管理者アップロード）
--   quote-documents: 見積書PDF（非公開。アプリのサーバー側から service role で読み書き）
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-documents', 'quote-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "product images public read" on storage.objects for select
  using (bucket_id = 'product-images');
create policy "product images admin write" on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "product images admin update" on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin());
create policy "product images admin delete" on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());

-- quote-documents はポリシーなし（= anon/authenticated からは直接触れない。service role のみ）
