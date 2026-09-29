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
    expect(workbench).toContain('data-testid="manual-quote-editor-shell"');
    expect(workbench).toContain('data-testid="case-info-panel"');
    expect(workbench).toContain('data-testid="new-estimate-excel"');
    expect(workbench).toContain('rounded-lg border border-slate-300 bg-white shadow-sm');
    expect(workbench).toContain('function CompactField');
    expect(workbench).toContain('label="案件名"');
    expect(workbench).not.toContain('（任意）');
    expect(workbench).not.toContain("import { Button, Field, Input, Select, Textarea }");
    expect(newQuotePage).toContain('lead="下書き保存後に正式保存できます。"');
    expect(workbench).toContain('見積書');
    expect(workbench).toContain('プランボード');
    expect(workbench).toContain('図面');
    expect(workbench).toContain('下書き保存して続ける');
    expect(workbench).not.toContain('見積書を作りながら、この案件の基本情報も登録できます。');
    expect(workbench).not.toContain('Excelのように明細を追加・修正してから下書き保存します。');
    expect(workbench).not.toContain('まず下書き保存');
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

  it('temporarily limits initial manual Quote creation/save/finalize to headquarters admin', () => {
    expect(newQuotePage).toContain("requireAdmin('/admin/quotes/new')");
    expect(actions).toContain("requireAdmin('/admin/quotes/new')");
    expect(casePage).toContain('canCreateQuote={false}');
    expect(casePage).toContain('<CasePageHeading caseCount={requests.length} canCreateQuote />');
    expect(migration).toContain("FORBIDDEN: 初回見積書作成は現在本部管理者のみ利用できます");
    expect(migration).toContain("FORBIDDEN: 初回見積Draftの作成・編集は現在本部管理者のみ利用できます");
    expect(migration).toContain("FORBIDDEN: 初回Revision 1の正式保存は現在本部管理者のみ利用できます");
  });

  it('allows only current published Base Master Revision for a new pin while preserving an existing pin', () => {
    expect(migration).toContain("p_base_master_revision_id is not distinct from d.base_master_revision_id");
    expect(migration).toContain("rev.status in ('published', 'superseded')");
    expect(migration).toContain("rev.status = 'published'");
    expect(migration).toContain("master.status = 'active'");
    expect(migration).toContain('rev.id = master.current_published_revision_id');
    expect(migration).toContain('public.can_use_base_master(v_base_master_id)');
    expect(migration).toContain('新しく選べるのは現在公開中の本体Revisionだけです');
  });

  it('keeps the old case-only RPC internal so authenticated users cannot bypass atomic creation', () => {
    expect(migration).toContain('revoke execute on function public.create_manual_quote_case(jsonb, text, uuid, text, text)');
    expect(migration).toContain('from public, anon, authenticated, service_role;');
    expect(supabaseStore).not.toContain("db.rpc('create_manual_quote_case'");
  });

  it('warns before leaving an unsaved new estimate while keeping unavailable tabs disabled', () => {
    expect(workbench).toContain("window.confirm('保存していない内容があります。保存せずに別の画面へ移動しますか？')");
    expect(workbench).toContain("window.addEventListener('beforeunload'");
    expect(workbench).toContain('if (!confirmLeave()) event.preventDefault();');
    expect(workbench).toContain('type="button" disabled');
    expect(workbench).not.toContain('プランボード・図面は正式保存後に案件画面から利用できます');
  });

  it('lets headquarters resume a saved initial Draft from case management without opening quote_drafts SELECT', () => {
    expect(migration).toContain('create or replace function public.list_initial_quote_draft_resumes()');
    expect(migration).toContain("FORBIDDEN: 初回見積Draft一覧を取得できるのは本部管理者だけです");
    expect(migration).toContain('d.parent_quote_id is null');
    expect(migration).toContain('r.quote_id is null');
    expect(migration).toContain('alter function public.list_initial_quote_draft_resumes() owner to postgres;');
    expect(migration).toContain('revoke execute on function public.list_initial_quote_draft_resumes()');
    expect(migration).toContain('grant execute on function public.list_initial_quote_draft_resumes()');
    expect(store).toContain('listInitialQuoteDraftResumes(actor: SessionUser)');
    expect(supabaseStore).toContain("db.rpc('list_initial_quote_draft_resumes')");
    expect(casePage).toContain('store.listInitialQuoteDraftResumes(actor)');
    expect(casePage).toContain('data-testid="resume-initial-quote-draft"');
    expect(casePage).toContain('/admin/quotes/drafts/${selectedPendingDraft.draft_id}');
    expect(casePage).toContain('下書き見積を続ける');
  });

  it('keeps case management available before the Draft-resume migration is applied', () => {
    expect(supabaseStore).toContain("isMissingNamedFunction(error, 'list_initial_quote_draft_resumes')");
    expect(supabaseStore).toContain("return [];");
    expect(supabaseStore).toContain("mapPgError(error);");
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
