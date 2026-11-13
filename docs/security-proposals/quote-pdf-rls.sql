-- REVIEW PROPOSAL ONLY. Move to a CLI-generated migration after independent review.
-- Do not backfill, delete or re-write already issued PDF files or their metadata.
begin;

do $preflight$
begin
  if to_regclass('public.quotes') is null or to_regclass('public.quote_documents') is null
     or to_regprocedure('public.is_dealer()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'PRECONDITION: required table/role helpers are missing';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid='public.quote_documents'::regclass) then
    raise exception 'PRECONDITION: quote_documents RLS must be enabled';
  end if;
  if (select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename='quote_documents' and policyname='quote_documents_select') <> 1 then
    raise exception 'PRECONDITION: quote_documents_select policy is missing or ambiguous';
  end if;
  if (select count(*) from pg_catalog.pg_policies where schemaname='public'
        and tablename='quote_documents' and cmd='SELECT') <> 1 then
    raise exception 'PRECONDITION: unreviewed extra SELECT policy exists';
  end if;
  if not exists (select 1 from storage.buckets where id='quote-documents' and public=false) then
    raise exception 'PRECONDITION: quote-documents bucket must be private';
  end if;
end;
$preflight$;

drop policy quote_documents_select on public.quote_documents;

-- PDF has personal information. Match only the owner/HQ/direct assigned sales dealer;
-- do NOT make PDF visible to all quote readers or manufacturing-only roles.
create policy quote_documents_select on public.quote_documents
for select to authenticated
using (
  exists (
    select 1 from public.quotes q
    where q.id = quote_documents.quote_id
      and (
        q.user_id = (select auth.uid())
        or public.is_admin()
        or (public.is_dealer() and q.dealer_id = (select auth.uid()))
      )
  )
);

-- Keep metadata read-only to end users. Storage remains private and service-only.
revoke all on table public.quote_documents from public, anon, authenticated;
grant select on table public.quote_documents to authenticated;

do $postflight$
begin
  if has_table_privilege('anon','public.quote_documents','SELECT')
     or has_table_privilege('authenticated','public.quote_documents','INSERT')
     or has_table_privilege('authenticated','public.quote_documents','UPDATE')
     or has_table_privilege('authenticated','public.quote_documents','DELETE')
     or not has_table_privilege('authenticated','public.quote_documents','SELECT') then
    raise exception 'POSTCONDITION: quote document ACL invalid';
  end if;
  if exists (select 1 from storage.buckets where id='quote-documents' and public) then
    raise exception 'POSTCONDITION: quote documents storage became public';
  end if;
end;
$postflight$;

commit;
