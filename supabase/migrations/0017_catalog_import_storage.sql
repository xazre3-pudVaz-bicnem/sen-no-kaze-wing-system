-- Browser uploads for catalog imports are isolated by user and import session.
-- The existing bucket remains public for product display, but writes below this
-- prefix require catalog-editor privileges and ownership of the first path part.

drop policy if exists "catalog import editor insert" on storage.objects;
create policy "catalog import editor insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = 'catalog-import'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and array_length(storage.foldername(name), 1) = 3
    and public.can_edit_catalog()
  );

drop policy if exists "catalog import editor delete" on storage.objects;
create policy "catalog import editor delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = 'catalog-import'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and array_length(storage.foldername(name), 1) = 3
    and public.can_edit_catalog()
  );
