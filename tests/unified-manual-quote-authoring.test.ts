import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260929124500_unified_manual_quote_authoring.sql'),
  'utf8'
);
const casePage = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const newQuotePage = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');
const workbench = fs.readFileSync(path.join(root, 'components/admin/manual-quote-workbench.tsx'), 'utf8');
const draftEditor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');

describe('unified manual quote authoring', () => {
  it('uses estimate creation as the single primary entry from case management', () => {
    expect(casePage).toContain('＋見積書を作成');
    expect(casePage).not.toContain('＋案件を登録');
    expect(casePage).toContain('href="/admin/quotes/new"');
  });

  it('opens the Excel-style workbench immediately instead of a separate case registration form', () => {
    expect(newQuotePage).toContain('title="見積書を作成"');
    expect(newQuotePage).toContain('<ManualQuoteWorkbench');
    expect(newQuotePage).not.toContain('<ManualQuoteForm');
    expect(workbench).toContain('data-testid="manual-quote-workbench"');
    expect(workbench).toContain('data-testid="case-info-panel"');
    expect(workbench).toContain('data-testid="new-estimate-excel"');
    expect(workbench).toContain('案件名（任意）');
    expect(workbench).toContain('見積書');
    expect(workbench).toContain('プランボード');
    expect(workbench).toContain('図面');
    expect(workbench).toContain('下書き保存して続ける');
  });

  it('opens an estimate-list popup from the top of the estimate frame', () => {
    expect(workbench).toContain('data-testid="estimate-picker-open"');
    expect(workbench).toContain('data-testid="estimate-picker-dialog"');
    expect(workbench).toContain('見積書一覧');
    expect(workbench).toContain('顧客名・見積番号・商品モデルで検索');
    expect(workbench).toContain('data-testid="estimate-picker-row"');
  });

  it('submits the case fields and editable line JSON from one screen', () => {
    for (const name of [
      'case_name',
      'customer_name',
      'customer_company',
      'site_address',
      'base_model_id',
      'spec_code',
      'finish_level',
      'memo',
      'items_json',
      'adjustment',
      'adjustment_reason',
    ]) {
      expect(workbench).toContain(`name="${name}"`);
    }
    expect(workbench).toContain('createManualQuoteWorkbenchAction');
    expect(actions).toContain('manualQuoteWorkbenchSchema.safeParse');
    expect(actions).toContain('store.createManualQuoteDraftWithItems(actor');
  });

  it('creates case + Draft + initial lines atomically without issuing formal Revision 1', () => {
    expect(migration).toContain('add column if not exists case_name text');
    expect(migration).toContain('create or replace function public.create_manual_quote_draft_with_items(');
    expect(migration).toContain('v_draft_id := public.create_manual_quote_case(');
    expect(migration).toContain('perform public.save_quote_draft(');
    expect(migration).toContain('update public.quote_requests');
    expect(migration).toContain('set case_name = v_case_name');
    const wrapper = migration.slice(migration.indexOf('create or replace function public.create_manual_quote_draft_with_items('));
    expect(wrapper).not.toContain('insert into public.quotes');
    expect(wrapper).not.toContain('insert into public.quote_items');
  });

  it('keeps the new lifecycle entry behind the authenticated SECURITY DEFINER boundary', () => {
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain(
      'alter function public.create_manual_quote_draft_with_items(\n  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text\n) owner to postgres;'
    );
    expect(migration).toContain(
      'revoke execute on function public.create_manual_quote_draft_with_items('
    );
    expect(migration).toContain(
      'grant execute on function public.create_manual_quote_draft_with_items('
    );
    expect(migration).toContain('to authenticated;');
  });

  it('returns the persisted case name when the Draft editor is reopened', () => {
    expect(migration).toContain("'case_name', r.case_name");
    expect(store).toContain("'id' | 'case_name' | 'status'");
    expect(draftEditor).toContain('detail.request.case_name');
  });

  it('connects the app to one atomic creation RPC', () => {
    expect(store).toContain('createManualQuoteDraftWithItems');
    expect(supabaseStore).toContain("db.rpc('create_manual_quote_draft_with_items'");
    expect(supabaseStore).toContain('p_items: input.items');
    expect(supabaseStore).toContain('p_adjustment: input.adjustment');
  });
});
