-- =============================================================
-- Generic Quote Draft / Revision foundation
--
-- This migration is additive only. It prepares the existing
-- quote_requests -> quotes -> quote_items lifecycle for a shared Draft /
-- Revision flow used by both Web and non-Web cases.
--
-- IMPORTANT:
-- - No RPC is added or replaced here.
-- - Existing quote rows/items are not backfilled or rewritten here.
-- - Existing Quote lifecycle behavior is unchanged in this migration.
-- - Draft tables are intentionally closed to ordinary roles until the
--   follow-up Draft RPC / RLS policies are introduced.
-- =============================================================

begin;

-- ---------- Future Revision snapshot metadata on existing Quote ----------
alter table public.quotes
  add column if not exists quote_kind text,
  add column if not exists base_model_id uuid references public.base_models(id) on delete restrict,
  add column if not exists base_master_revision_id uuid references public.base_master_revisions(id) on delete restrict,
  add column if not exists spec_code text,
  add column if not exists adjustment_reason text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.quotes
  drop constraint if exists quotes_quote_kind_check;
alter table public.quotes
  add constraint quotes_quote_kind_check
  check (quote_kind is null or quote_kind in ('preliminary', 'formal'));

alter table public.quotes
  drop constraint if exists quotes_spec_code_format_check;
alter table public.quotes
  add constraint quotes_spec_code_format_check
  check (
    spec_code is null
    or (
      length(spec_code) > 0
      and spec_code = lower(spec_code)
      and spec_code = btrim(spec_code)
      and spec_code !~ '[[:space:]]'
    )
  );

create index if not exists quotes_base_model_spec_idx
  on public.quotes(base_model_id, spec_code, revision desc)
  where base_model_id is not null;

create index if not exists quotes_base_master_revision_idx
  on public.quotes(base_master_revision_id)
  where base_master_revision_id is not null;

-- quote_items remains the immutable issued-Revision snapshot.
-- line_key is nullable in this foundation migration so existing rows do not
-- need a data rewrite. A later lifecycle migration will backfill and enforce
-- Revision-level identity before relying on it.
alter table public.quote_items
  alter column quantity type numeric(14, 4)
    using quantity::numeric(14, 4),
  add column if not exists line_key uuid,
  add column if not exists option_id uuid references public.options(id) on delete restrict;

create index if not exists quote_items_line_key_idx
  on public.quote_items(quote_id, line_key)
  where line_key is not null;

create index if not exists quote_items_option_idx
  on public.quote_items(option_id)
  where option_id is not null;

-- ---------- Editable Quote Draft ----------
-- One case has at most one current editable Draft. Once finalized, the Draft
-- is removed by the follow-up lifecycle RPC and the immutable result lives in
-- quotes / quote_items.
create table if not exists public.quote_drafts (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null
    references public.quote_requests(id) on delete cascade,
  parent_quote_id uuid
    references public.quotes(id) on delete restrict,
  base_model_id uuid not null
    references public.base_models(id) on delete restrict,
  base_master_revision_id uuid
    references public.base_master_revisions(id) on delete restrict,
  spec_code text not null,
  quote_kind text not null default 'formal'
    check (quote_kind in ('preliminary', 'formal')),
  tax_rate numeric(5, 4) not null default 0.10
    check (tax_rate >= 0 and tax_rate <= 1),
  adjustment integer not null default 0,
  adjustment_reason text,
  subtotal_raw integer not null default 0
    check (subtotal_raw >= 0),
  subtotal integer not null default 0
    check (subtotal >= 0),
  tax integer not null default 0
    check (tax >= 0),
  total integer not null default 0
    check (total >= 0),
  lock_version integer not null default 0
    check (lock_version >= 0),
  dealer_note text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_request_id),
  check (
    length(spec_code) > 0
    and spec_code = lower(spec_code)
    and spec_code = btrim(spec_code)
    and spec_code !~ '[[:space:]]'
  ),
  check (subtotal = subtotal_raw + adjustment),
  check (tax = floor(subtotal::numeric * tax_rate)::integer),
  check (total = subtotal + tax),
  check (
    adjustment = 0
    or nullif(btrim(coalesce(adjustment_reason, '')), '') is not null
  )
);

create index if not exists quote_drafts_parent_idx
  on public.quote_drafts(parent_quote_id)
  where parent_quote_id is not null;

create index if not exists quote_drafts_base_model_idx
  on public.quote_drafts(base_model_id, spec_code);

create index if not exists quote_drafts_base_revision_idx
  on public.quote_drafts(base_master_revision_id)
  where base_master_revision_id is not null;

drop trigger if exists trg_quote_drafts_updated on public.quote_drafts;
create trigger trg_quote_drafts_updated
before update on public.quote_drafts
for each row execute function public.set_updated_at();

-- ---------- Editable Draft lines ----------
-- amount is deliberately not constrained to quantity * unit_price here.
-- Existing issued Quote snapshots can contain historical rounding/Excel
-- amounts that differ by a yen from a fresh multiplication. Follow-up save
-- RPCs will validate/recalculate changed lines while allowing unchanged
-- source lines to preserve their authoritative issued amount.
create table if not exists public.quote_draft_items (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null
    references public.quote_drafts(id) on delete cascade,
  line_key uuid not null default gen_random_uuid(),
  kind text not null
    check (kind in (
      'base',
      'base_expense',
      'interior_exterior',
      'interior_exterior_expense',
      'option',
      'option_expense',
      'installation',
      'free',
      'discount'
    )),
  option_id uuid references public.options(id) on delete restrict,
  name text not null,
  description text,
  unit text,
  remark text,
  unit_price integer not null default 0,
  quantity numeric(14, 4) not null default 1
    check (quantity > 0),
  amount integer not null default 0,
  image_url text,
  sort_order integer not null default 0
    check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, line_key),
  unique (draft_id, sort_order),
  check (length(btrim(name)) > 0)
);

create index if not exists quote_draft_items_option_idx
  on public.quote_draft_items(option_id)
  where option_id is not null;

drop trigger if exists trg_quote_draft_items_updated on public.quote_draft_items;
create trigger trg_quote_draft_items_updated
before update on public.quote_draft_items
for each row execute function public.set_updated_at();

-- ---------- Closed-by-default access boundary ----------
alter table public.quote_drafts enable row level security;
alter table public.quote_draft_items enable row level security;

revoke all privileges on table public.quote_drafts,
                                public.quote_draft_items
from public, anon, authenticated;

grant all privileges on table public.quote_drafts,
                               public.quote_draft_items
to service_role;

comment on table public.quote_drafts is
  '案件見積の編集中Draft。正式Revisionではなく、保存を繰り返してもRevision番号を消費しない。後続RPCからのみ更新する。';

comment on table public.quote_draft_items is
  '案件見積Draftの編集明細。line_keyは将来のRevision間同一明細追跡に使用する。通常roleからの直接writeは許可しない。';

comment on column public.quotes.quote_kind is
  '見積Revisionの意味。preliminary=概算、formal=正式。既存Revisionは移行完了までNULLを許容する。';

comment on column public.quotes.base_master_revision_id is
  '見積Revisionが参照した本体Master Revision。既存Web見積との互換のため移行完了までNULLを許容する。';

comment on column public.quote_items.line_key is
  'Revision間で同一明細を追跡するidentity。既存行は後続migrationでbackfillするため現段階ではNULL可。';

commit;
