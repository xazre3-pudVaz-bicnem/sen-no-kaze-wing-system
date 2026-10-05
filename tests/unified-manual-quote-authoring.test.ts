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
const authoringUi = fs.readFileSync(path.join(root, 'components/admin/quote-authoring-ui.tsx'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');
const validation = fs.readFileSync(path.join(root, 'lib/validation.ts'), 'utf8');
const workbenchAction = actions.slice(
  actions.indexOf('export async function createManualQuoteWorkbenchAction'),
  actions.indexOf('export async function createQuoteRevisionDraftAction')
);
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');

describe('unified manual quote authoring', () => {
  it('uses estimate creation as the single primary entry from case management', () => {
    expect(casePage).toContain('＋見積書を作成');
    expect(casePage).not.toContain('＋案件を登録');
    expect(casePage).toContain('href="/admin/quotes/new?return_to=%2Fadmin%2Fquotes"');
  });

  it('opens the Excel-style workbench immediately instead of a separate case registration form', () => {
    expect(newQuotePage).toContain('title="新規案件登録・初回見積"');
    expect(newQuotePage).toContain('lead="対面・電話・紹介などの非Web案件を登録し、案件管理へ引き継ぐための最初の見積下書きを作成"');
    expect(newQuotePage).toContain('<ManualQuoteWorkbench');
    expect(newQuotePage).not.toContain('<ManualQuoteForm');
    expect(workbench).toContain('data-testid="manual-quote-workbench"');
    expect(workbench).toContain('data-testid="manual-quote-editor-shell"');
    expect(workbench).toContain('data-testid="case-info-panel"');
    expect(workbench).toContain('<QuoteAuthoringGrid');
    expect(workbench).toContain('<QuoteFinancialSummary');
    expect(workbench).not.toContain('<CustomerQuotePreview');
    expect(workbench).toContain('rounded-lg border border-slate-300 bg-white shadow-sm');
    expect(workbench).toContain('function CompactField');
    expect(workbench).toContain('label="案件名"');
    expect(workbench).toContain('label="法人名"');
    expect(workbench).toContain('label="Wingの設置予定地"');
    expect(workbench).toContain('label="案件メモ"');
    expect(workbench).toContain('label="防火仕様"');
    expect(workbench).toContain('label="適用地域"');
    expect(workbench).toContain('label="電話番号"');
    expect(workbench).toContain('label="メールアドレス"');
    expect(workbench).toContain('label="お客様住所"');
    expect(workbench).toContain('data-testid="new-case-contact-pending"');
    expect(workbench).toContain('電話・メール・お客様住所の入力機能は現在準備中です');
    expect(workbench).toContain('保存されない項目を入力済みとして扱わないため、現在は入力できません。');
    expect(workbench).toContain('placeholder="現在準備中"');
    expect(workbench).toContain('data-testid="new-quote-base-master-pending"');
    expect(workbench).toContain('商品モデル・仕様・防火仕様を選ぶと、登録済みの本体内容が自動で反映されます。この機能は現在準備中です。');
    expect(workbench).toContain('<QuoteInternalRateStrip showPlannedDefaults />');
    expect(workbench).not.toContain('name="customer_phone"');
    expect(workbench).not.toContain('name="customer_email"');
    expect(workbench).not.toContain('name="customer_address"');
    expect(workbench).not.toContain('label="注文範囲"');
    expect(workbench).toContain('name="finish_level" value="full"');
    expect(workbench).not.toContain('（任意）');
    expect(authoringUi).toContain('見積書');
    expect(authoringUi).toContain('プランボード');
    expect(authoringUi).toContain('図面');
    expect(authoringUi).toContain('原価');
    expect(authoringUi).toContain('原価金額');
    expect(authoringUi).toContain('売価');
    expect(authoringUi).toContain('売価金額');
    expect(authoringUi).toContain('粗利');
    expect(workbench).toContain('label="案件として登録"');
    expect(workbench).toContain('data-testid="manual-quote-role-note"');
    expect(workbench).toContain('非Web案件の初期登録');
    expect(workbench).toContain('Webから届いた見積依頼は、この画面で新規登録し直しません。');
    expect(workbench).toContain('この画面では正式見積を発行しません');
    expect(workbench).toContain('現場工事金額は、案件登録後に現地確認を行い、案件管理から入力します。');
    expect(workbench).not.toContain('初回Draft保存後に正式発行できます');
    expect(workbench).not.toContain('見積書を作りながら、この案件の基本情報も登録できます。');
    expect(workbench).not.toContain('Excelのように明細を追加・修正してから下書き保存します。');
    expect(workbench).not.toContain('まず下書き保存');
    for (const internalTerm of ['Published Base Master Revision', 'Quote Draft', 'DB基盤', 'plan state', 'version管理', '正式Quote Revision']) {
      expect(workbench).not.toContain(internalTerm);
    }
  });

  it('requires explicit model and spec selection for a brand-new case', () => {
    expect(workbench).toContain("const [modelId, setModelId] = useState('');");
    expect(workbench).toContain('<option value="">選択してください</option>');
    expect(workbench).toContain("const [specCode, setSpecCode] = useState('');");
    expect(workbench).toContain('value={specCode}');
    expect(workbench).toContain('setSpecCode(\'\')');
    expect(workbench).toContain("disabled={!modelId}");
  });

  it('keeps product-catalog selection inside the existing Quote Draft item contract', () => {
    expect(authoringUi).toContain('＋商品');
    expect(authoringUi).toContain('＋自由明細');
    expect(authoringUi).toContain('data-testid="quote-product-picker-dialog"');
    expect(workbench).toContain('option_id: product.id');
    expect(draftEditor).toContain('option_id: product.id');
    expect(workbench).toContain('products={products}');
    expect(draftEditor).toContain('products={products}');
    expect(store).toContain('option_id?: string | null');
  });

  it('opens the past-estimate clone source picker on a new estimate while keeping the edit list popup', () => {
    expect(workbench).toContain('<QuoteEditorTopbar');
    expect(authoringUi).toContain('data-testid="estimate-picker-dialog"');
    expect(authoringUi).toContain('過去見積から複製');
    expect(authoringUi).toContain('複製する過去見積を選択');
    expect(authoringUi).toContain('案件見積一覧');
    expect(authoringUi).toContain('案件名・顧客名・見積番号・商品モデルで検索');
    expect(authoringUi).toContain('data-testid="estimate-clone-source-row"');
    expect(authoringUi).toContain('data-testid="estimate-picker-row"');
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
    expect(workbenchAction).toContain('manualQuoteWorkbenchSchema.safeParse');
    expect(workbenchAction).toContain('store.createManualQuoteDraftWithItems(actor');
    expect(workbenchAction).toContain("redirect('/admin/quotes')");
    expect(workbenchAction).not.toContain('redirect(`/admin/quotes/drafts/${draftId}?');
  });

  it('keeps the new-case adjustment editor only in the lower financial summary', () => {
    expect(workbench).not.toContain('<EstimateMoneyStrip');
    expect(workbench).toContain('adjustmentLabel="値引き等調整額"');
    expect(workbench).toContain('adjustmentReason={adjustmentReason}');
    expect(workbench).toContain('onAdjustmentReason={(value) => {');
    expect(workbench).toContain('showAdjustmentReason');
    expect(workbench).toContain('showTaxExclContractAmount');
    expect(workbench).toContain('totalLabel="見積金額（税込）"');
  });

  it('recalculates tax-excluded contract amount, tax, and total immediately for a discount', () => {
    const subtotalRaw = 10_000;
    const adjustment = -750;
    const taxExclContractAmount = Math.max(0, subtotalRaw + adjustment);
    const tax = Math.floor(taxExclContractAmount * 0.1);
    const total = taxExclContractAmount + tax;

    expect(taxExclContractAmount).toBe(9_250);
    expect(tax).toBe(925);
    expect(total).toBe(10_175);
    expect(workbench).toContain('const taxExclContractAmount = Math.max(0, subtotalRaw + adjustment);');
    expect(workbench).toContain('const tax = Math.floor(taxExclContractAmount * 0.1);');
    expect(workbench).toContain('const total = taxExclContractAmount + tax;');
  });

  it('keeps zero adjustment identical to the previous subtotal/tax/total flow', () => {
    const subtotalRaw = 10_000;
    const adjustment = 0;
    const taxExclContractAmount = Math.max(0, subtotalRaw + adjustment);
    const tax = Math.floor(taxExclContractAmount * 0.1);
    expect(taxExclContractAmount).toBe(10_000);
    expect(tax).toBe(1_000);
    expect(taxExclContractAmount + tax).toBe(11_000);
  });

  it('connects the existing required adjustment reason to the new-case UI', () => {
    expect(workbench).toContain("const [adjustmentReason, setAdjustmentReason] = useState('');");
    expect(workbench).toContain('name="adjustment_reason"');
    expect(workbench).toContain('adjustmentReason={adjustmentReason}');
    expect(workbench).toContain('onAdjustmentReason={(value) => {');
    expect(authoringUi).toContain('調整理由');
    expect(workbenchAction).toContain("adjustment_reason: formData.get('adjustment_reason')");
    expect(validation).toContain("if (data.adjustment !== 0 && !data.adjustment_reason?.trim())");
    expect(validation).toContain("message: '調整額を設定する場合は理由を入力してください'");
  });

  it('does not show a customer preview on the new-case entry screen', () => {
    expect(workbench).not.toContain('showPreview');
    expect(workbench).not.toContain('CustomerQuotePreview');
    expect(workbench).not.toContain("プレビューを閉じる");
    expect(workbench).not.toContain(">プレビュー<");
    expect(workbench).toContain('登録すると案件一覧に追加されます。');
    expect(workbench).toContain('label="案件として登録"');
    expect(draftEditor).toContain('<CustomerQuotePreview');
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

  it('warns before leaving an unsaved new estimate and exposes non-fake plan/drawing states', () => {
    expect(workbench).toContain("window.confirm('保存していない内容があります。保存せずに別の画面へ移動しますか？')");
    expect(workbench).toContain("window.addEventListener('beforeunload'");
    expect(workbench).toContain('if (!confirmLeave()) event.preventDefault();');
    expect(authoringUi).toContain('disabled={!enabled}');
    expect(authoringUi).toContain('プランボード');
    expect(authoringUi).toContain('図面');
    expect(workbench).toContain('active={activeTab} onChange={setActiveTab}');
    expect(workbench).toContain('案件登録後、案件管理のプランボードで確認できるようにします');
    expect(workbench).toContain('案件図面の管理機能は現在準備中です');
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
    expect(casePage).toContain('data-testid="pending-case-estimate"');
    expect(casePage).toContain('data-testid="resume-initial-quote-draft"');
    expect(casePage).toContain('/admin/quotes/drafts/${selectedPendingDraft.draft_id}');
    expect(casePage).toContain('見積下書き');
    expect(casePage).toContain('見積を編集');
    expect(casePage).toContain('return_request=');
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