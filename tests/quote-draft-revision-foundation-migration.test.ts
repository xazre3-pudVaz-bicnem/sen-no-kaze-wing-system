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
  it('adds forward-compatible metadata and safely widens issued item quantity precision', () => {
    expect(migration).toContain('alter table public.quotes');
    expect(migration).toContain('add column if not exists quote_kind text');
    expect(migration).toContain('add column if not exists base_model_id uuid');
    expect(migration).toContain('add column if not exists base_master_revision_id uuid');
    expect(migration).toContain('add column if not exists spec_code text');
    expect(migration).toContain('add column if not exists adjustment_reason text');
    expect(migration).toContain('add column if not exists created_by uuid');
    expect(migration).toContain('alter column quantity type numeric(14, 4)');
    expect(migration).toContain('using quantity::numeric(14, 4)');
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

  it('pins Draft model/spec and can pin a Base Master Revision', () => {
    expect(migration).toContain('base_model_id uuid not null');
    expect(migration).toContain('references public.base_models(id) on delete restrict');
    expect(migration).toContain('base_master_revision_id uuid');
    expect(migration).toContain('references public.base_master_revisions(id) on delete restrict');
    expect(migration).toContain('spec_code text not null');
    expect(migration).toContain("spec_code !~ '[[:space:]]'");
  });

  it('stores Draft money and optimistic lock metadata without making UI totals authoritative', () => {
    expect(migration).toContain('tax_rate numeric(5, 4) not null default 0.10');
    expect(migration).not.toContain('tax_rate numeric(8, 6)');
    expect(migration).toContain('lock_version integer not null default 0');
    expect(migration).toContain('subtotal = subtotal_raw + adjustment');
    expect(migration).toContain('tax = floor(subtotal::numeric * tax_rate)::integer');
    expect(migration).toContain('total = subtotal + tax');
    expect(migration).toContain("adjustment = 0");
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
