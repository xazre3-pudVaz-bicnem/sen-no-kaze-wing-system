import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'supabase/migrations/20260928130000_quote_draft_revision_foundation.sql'
  ),
  'utf8'
);

describe('quote draft / revision foundation migration', () => {
  it('adds forward-compatible metadata without rewriting issued Quote quantities', () => {
    expect(migration).toContain('alter table public.quotes');
    expect(migration).toContain('add column if not exists quote_kind text');
    expect(migration).toContain('add column if not exists base_model_id uuid');
    expect(migration).toContain('add column if not exists base_master_revision_id uuid');
    expect(migration).toContain('add column if not exists spec_code text');
    expect(migration).toContain('add column if not exists adjustment_reason text');
    expect(migration).toContain('add column if not exists created_by uuid');
    expect(migration).not.toMatch(/alter\s+column\s+quantity\s+type/i);
    expect(migration).toContain('quote_items.quantity is intentionally left as the existing unconstrained');
    expect(migration).toContain('add column if not exists line_key uuid');
    expect(migration).toContain('add column if not exists option_id uuid');
    expect(migration).not.toMatch(/add column if not exists line_key uuid\s+not null/i);
    expect(migration).not.toMatch(/add column if not exists quote_kind text\s+not null/i);
  });

  it('creates one current Draft per QuoteRequest without inventing a Quote master', () => {
    expect(migration).toContain('create table if not exists public.quote_drafts');
    expect(migration).toContain('references public.quote_requests(id) on delete cascade');
    expect(migration).toContain('unique (quote_request_id)');
    expect(migration).toContain('parent_quote_id uuid');
    expect(migration).toContain('references public.quotes(id) on delete restrict');
    expect(migration).not.toContain('create table if not exists public.quote_masters');
    expect(migration).not.toContain('create table if not exists public.quote_revisions');
  });

  it('pins Draft model/spec and requires quote kind to be explicit', () => {
    expect(migration).toContain('base_model_id uuid not null');
    expect(migration).toContain('references public.base_models(id) on delete restrict');
    expect(migration).toContain('base_master_revision_id uuid');
    expect(migration).toContain('references public.base_master_revisions(id) on delete restrict');
    expect(migration).toContain('spec_code text not null');
    expect(migration).toContain("spec_code !~ '[[:space:]]'");
    expect(migration).toContain('quote_kind text not null\n    check');
    expect(migration).not.toContain("quote_kind text not null default 'formal'");
  });

  it('protects new Quote snapshot metadata through the existing lifecycle guard', () => {
    expect(migration).toContain('create or replace function public.guard_quote_lineage_transition()');
    expect(migration).toContain('old.quote_kind is distinct from new.quote_kind');
    expect(migration).toContain('old.base_model_id is distinct from new.base_model_id');
    expect(migration).toContain('old.base_master_revision_id is distinct from new.base_master_revision_id');
    expect(migration).toContain('old.spec_code is distinct from new.spec_code');
    expect(migration).toContain('old.adjustment_reason is distinct from new.adjustment_reason');
    expect(migration).toContain('old.created_by is distinct from new.created_by');
    expect(migration).toContain("current_user <> 'postgres'");
  });

  it('requires pinned Base Revisions to match the product model and be immutable history', () => {
    expect(migration).toContain('create or replace function public.validate_quote_base_revision_ref()');
    expect(migration).toContain("r.status in ('published', 'superseded')");
    expect(migration).toContain('m.base_model_id = new.base_model_id');
    expect(migration).toContain('create trigger quotes_base_revision_ref');
    expect(migration).toContain('create trigger quote_drafts_base_revision_ref');
  });

  it('requires a Draft parent Quote to belong to the same QuoteRequest', () => {
    expect(migration).toContain('create or replace function public.validate_quote_draft_parent_ref()');
    expect(migration).toContain('q.id = new.parent_quote_id');
    expect(migration).toContain('q.quote_request_id = new.quote_request_id');
    expect(migration).toContain('create trigger quote_drafts_parent_ref');
  });

  it('stores Draft money and optimistic lock metadata without making UI totals authoritative', () => {
    expect(migration).toContain('tax_rate numeric(5, 4) not null default 0.10');
    expect(migration).not.toContain('tax_rate numeric(8, 6)');
    expect(migration).toContain('lock_version integer not null default 0');
    expect(migration).toContain('subtotal = subtotal_raw + adjustment');
    expect(migration).toContain('tax = floor(subtotal::numeric * tax_rate)::integer');
    expect(migration).toContain('total = subtotal + tax');
    expect(migration).toContain('adjustment = 0');
    expect(migration).toContain('adjustment_reason');
  });

  it('creates Draft lines with stable line identity and product reference', () => {
    expect(migration).toContain('create table if not exists public.quote_draft_items');
    expect(migration).toContain('line_key uuid not null default gen_random_uuid()');
    expect(migration).toContain('option_id uuid references public.options(id) on delete restrict');
    expect(migration).toContain('unique (draft_id, line_key)');
    expect(migration).toContain('unique (draft_id, sort_order)');
    expect(migration).toContain("'interior_exterior'");
    expect(migration).toContain("'discount'");
  });

  it('does not force Draft item amount to a fresh multiplication in the foundation', () => {
    expect(migration).toContain('amount is deliberately not constrained');
    expect(migration).not.toMatch(/check\s*\(\s*amount\s*=\s*round\s*\(\s*quantity\s*\*\s*unit_price/i);
  });

  it('uses valid tagged dollar quoting for added trigger functions', () => {
    expect(migration).toContain('as $quote_guard$');
    expect(migration).toContain('$quote_guard$;');
    expect(migration).toContain('as $base_ref_guard$');
    expect(migration).toContain('$base_ref_guard$;');
    expect(migration).toContain('as $parent_ref_guard$');
    expect(migration).toContain('$parent_ref_guard$;');
    expect(migration).not.toContain('\nas $\nbegin');
  });

  it('keeps new Draft tables closed to ordinary roles until RPCs are added', () => {
    expect(migration).toContain('alter table public.quote_drafts enable row level security');
    expect(migration).toContain('alter table public.quote_draft_items enable row level security');
    expect(migration).toContain('revoke all privileges on table public.quote_drafts');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('grant all privileges on table public.quote_drafts');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('create policy quote_drafts');
  });

  it('does not change existing Quote RPCs or existing row data', () => {
    expect(migration).not.toContain('create or replace function public.create_quote_from_configuration');
    expect(migration).not.toContain('create or replace function public.create_quote_revision');
    expect(migration).not.toContain('create or replace function public.respond_to_quote');
    expect(migration).not.toContain('alter table public.quote_requests');
    expect(migration).not.toMatch(/update\s+public\.(quotes|quote_items|quote_requests)/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.(quotes|quote_items|quote_requests)/i);
  });
});
