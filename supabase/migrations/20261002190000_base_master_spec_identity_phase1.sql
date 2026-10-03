-- =============================================================
-- Base Master spec identity corrective - Phase 1
--
-- Confirmed business identity:
--   owner organization x product model x spec x fire spec
--
-- This phase is intentionally additive and production-safe:
--   * add nullable spec_code
--   * validate spec_code format when present
--   * reserve exact identity for corrected/new non-null rows
--   * include spec_code in Published/Superseded identity immutability
--
-- This phase DOES NOT:
--   * backfill legacy rows
--   * infer spec from names/BOM/quotes
--   * set spec_code NOT NULL
--   * change create/save/publish RPC signatures
--   * change Simulator / Quote / Standard Estimate reads
--
-- Production legacy rows must be audited before Phase 2/3/4.
-- =============================================================

begin;

alter table public.base_masters
  add column if not exists spec_code text;

comment on column public.base_masters.spec_code is
  'Base Master identity spec. Phase 1 allows NULL only for unresolved legacy rows; do not infer/backfill without audit.';

do $constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'base_masters_spec_code_format'
       and conrelid = 'public.base_masters'::regclass
  ) then
    alter table public.base_masters
      add constraint base_masters_spec_code_format
      check (
        spec_code is null
        or (
          length(spec_code) > 0
          and spec_code = lower(spec_code)
          and spec_code = btrim(spec_code)
          and spec_code !~ '[[:space:]]'
        )
      ) not valid;
  end if;
end
$constraint$;

alter table public.base_masters
  validate constraint base_masters_spec_code_format;

-- Existing NULL legacy rows are intentionally outside this index.
-- Once a row has an audited spec_code, owner/model/spec/fire cannot duplicate.
create unique index if not exists base_masters_owner_model_spec_fire_nonnull_uidx
  on public.base_masters(
    owner_organization_id,
    base_model_id,
    spec_code,
    fire_spec_code
  )
  where spec_code is not null;

-- Published/Superseded history permanently fixes all identity dimensions.
create or replace function public.prevent_base_master_identity_change_after_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $identity$
begin
  if exists (
    select 1
      from public.base_master_revisions r
     where r.base_master_id = old.id
       and r.status in ('published', 'superseded')
  ) and (
    new.base_model_id is distinct from old.base_model_id
    or new.owner_organization_id is distinct from old.owner_organization_id
    or new.spec_code is distinct from old.spec_code
    or new.fire_spec_code is distinct from old.fire_spec_code
    or new.cloned_from_revision_id is distinct from old.cloned_from_revision_id
  ) then
    raise exception 'LOCKED: 公開履歴のある本体は商品モデル・所有組織・仕様・防火区分・複製元を変更できません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$identity$;

alter function public.prevent_base_master_identity_change_after_publish()
  owner to postgres;

revoke execute on function public.prevent_base_master_identity_change_after_publish()
  from public, anon, authenticated, service_role;

drop trigger if exists base_masters_identity_immutable on public.base_masters;
create trigger base_masters_identity_immutable
before update of base_model_id, owner_organization_id, spec_code, fire_spec_code, cloned_from_revision_id
on public.base_masters
for each row execute function public.prevent_base_master_identity_change_after_publish();

commit;
