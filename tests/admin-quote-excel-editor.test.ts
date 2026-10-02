import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const form = fs.readFileSync(path.join(root, 'components/admin/dealer-forms.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const editPage = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/edit/page.tsx'), 'utf8');
const manualQuoteWorkbench = fs.readFileSync(path.join(root, 'components/admin/manual-quote-workbench.tsx'), 'utf8');
const quoteDraftEditor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const quoteDraftPage = fs.readFileSync(path.join(root, 'app/admin/quotes/drafts/[id]/page.tsx'), 'utf8');
const quoteAuthoringUi = fs.readFileSync(path.join(root, 'components/admin/quote-authoring-ui.tsx'), 'utf8');
const quoteTable = fs.readFileSync(path.join(root, 'components/mypage/quote-table.tsx'), 'utf8');
const adminActions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');

describe('Admin quote Excel-like editor', () => {
  it('opens legacy Web revisions in a dedicated case-estimate editor instead of inside the issued quote', () => {
    expect(workspace).toContain('data-testid="legacy-quote-edit-entry"');
    expect(workspace).toContain('href={`/admin/quotes/${quote.id}/edit`}');
    expect(workspace).toContain('canRevise={false}');
    expect(workspace).toContain('startInEditMode={false}');
    expect(editPage).toContain('data-testid="legacy-revision-edit-page"');
    expect(editPage).toContain('第{quote.revision + 1}版 見積編集');
    expect(editPage).toContain('発行済みの第{quote.revision}版は変更せず、次の版として編集します。');
    expect(editPage).toContain('案件へ戻る');
    expect(editPage).toContain('<DealerRevisionForm');
    expect(editPage).toContain('sheetMode');
  });

  it('keeps the issued quote as a read-only history view in case management', () => {
    expect(workspace).toContain('data-testid="case-issued-estimate-history"');
    expect(workspace).toContain('<h2 className="text-lg font-semibold">発行済み見積</h2>');
    expect(workspace).toContain('<QuoteEstimateSheet');
    expect(workspace).toContain('canRevise={false}');
    expect(workspace).toContain('startInEditMode={false}');
    expect(workspace).toContain('この欄は発行済み見積の確認用です。');
    expect(sheet).toContain('<QuoteTable');
  });

  it('actually reuses the same QuoteAuthoringGrid for new, Draft, and Web revision editing', () => {
    expect(manualQuoteWorkbench).toContain('<QuoteAuthoringGrid');
    expect(quoteDraftEditor).toContain('<QuoteAuthoringGrid');
    expect(form).toContain('<QuoteAuthoringGrid');
    expect(form).toContain('rows={authoringRows}');
    expect(form).toContain('products={products}');
    expect(form).toContain('editableSections={editableSections}');
    expect(form).not.toContain('revision-sheet-scroll');
    expect(form).not.toContain('data-testid="revision-preview"');
  });

  it('keeps new-case and non-Web Draft editors on the shared grid default edit behavior', () => {
    expect(quoteAuthoringUi).toContain('(row.editableFields?.[field] ?? true)');
    expect(manualQuoteWorkbench).not.toContain('editableFields:');
    expect(quoteDraftEditor).not.toContain('editableFields:');
    expect(form).toContain('editableFields: editable');
  });

  it('uses the shared compact Excel grid columns and collapsible section controls', () => {
    expect(quoteAuthoringUi).toContain('data-testid="unified-quote-excel-grid"');
    for (const label of ['品名', '数量', '単位', '原価', '原価金額', '売価', '売価金額', '粗利', '備考']) {
      expect(quoteAuthoringUi).toContain(label);
    }
    expect(quoteAuthoringUi).toContain('quote-section-summary-');
    expect(quoteAuthoringUi).toContain("section.label + 'の明細を閉じる'");
    expect(quoteAuthoringUi).toContain("section.label + 'の明細を開く'");
    expect(quoteAuthoringUi).toContain('＋商品');
    expect(quoteAuthoringUi).toContain('＋自由明細');
  });

  it('keeps Web revision base rows locked and edits installation by default', () => {
    expect(form).toContain("if (row.kind === 'base' || row.kind === 'base_expense') return false;");
    expect(form).toContain("if (row.kind === 'installation') return true;");
    expect(form).toContain("if (!scopeChangeMode) return false;");
    expect(form).toContain("['interior_exterior', 'option', 'installation']");
    expect(form).toContain("['installation']");
    expect(form).not.toContain("['base', 'interior_exterior', 'option', 'installation']");
    expect(quoteAuthoringUi).toContain('editableSections?: readonly QuoteAuthoringSection[];');
    expect(quoteAuthoringUi).toContain('const sectionEditable = editableSectionSet.has(section.key);');
  });

  it('adapts Web revision rows only for display/input while keeping the legacy issue action', () => {
    expect(form).toContain('option_id: item.option_id ?? null');
    expect(form).toContain('const authoringRows: QuoteAuthoringRow[] = [');
    expect(form).toContain('unitPrice: row.unit_price');
    expect(form).toContain('amount: amountOf(row)');
    expect(form).toContain('name={`items.${index}.kind`}');
    expect(form).toContain('name={`items.${index}.unit_price`}');
    expect(form).toContain('useActionState(createDealerRevisionAction, initial)');
    expect(adminActions).toContain('export async function createDealerRevisionAction');
    expect(form).not.toContain('saveQuoteDraftAction');
    expect(form).not.toContain('finalizeQuoteDraftAction');
  });

  it('feeds the shared product picker with the same QuoteCatalogProduct shape used by new and Draft editors', () => {
    expect(editPage).toContain('const categoryMap = new Map(categories.map((category) => [category.id, category] as const));');
    expect(editPage).toContain('baseModelId: option.base_model_id');
    expect(editPage).toContain('categoryCode: categoryMap.get(option.category_id)?.code ??');
    expect(editPage).toContain('priceOnRequest: option.price_on_request');
    expect(editPage).toContain('specCodes: option.spec_codes ?? []');
    expect(editPage).toContain('products={products}');
    expect(editPage).toContain("baseModelId={quote.base_model_id ?? ''}");
    expect(editPage).toContain("specCode={quote.spec_code ?? ''}");
    expect(form).toContain('product: QuoteCatalogProduct');
    expect(form).toContain('product.categoryName');
  });

  it('locks direct catalog-product names while allowing picker replacement, quantity, sale price, remark, and edit-mode removal', () => {
    expect(form).toContain('const catalogLinked = Boolean(row.option_id);');
    expect(form).toContain('name: !catalogLinked');
    expect(form).toContain('unit: !catalogLinked');
    expect(form).toContain('quantity: true');
    expect(form).toContain('unitPrice: true');
    expect(form).toContain('remark: true');
    expect(form).toContain("remove: row.kind === 'installation' || scopeChangeMode");
    expect(form).toContain('selectProduct: catalogProductChangeAllowed');
    expect(form).toContain("if (!scopeChangeMode || (section !== 'interior_exterior' && section !== 'option')) return;");
    expect(form).toContain('...(!catalogLinked && patch.name !== undefined ? { name: patch.name } : {})');
    expect(quoteAuthoringUi).toContain('editableFields?: QuoteAuthoringRowEditableFields;');
    expect(quoteAuthoringUi).toContain("const nameEditable = fieldEditable('name');");
    expect(quoteAuthoringUi).toContain('disabled={!nameEditable}');
    expect(quoteAuthoringUi).toContain('selectProductEditable && SECTION_PRODUCT_CATEGORY_CODES');
  });

  it('keeps free/site-work inputs editable when their section is editable', () => {
    expect(form).toContain('name: !catalogLinked');
    expect(form).toContain('unit: !catalogLinked');
    expect(form).toContain('const catalogLinked = Boolean(row.option_id);');
    expect(form).toContain("if (row.kind === 'installation') return true;");
    expect(quoteAuthoringUi).toContain("(row.editableFields?.[field] ?? true)");
  });

  it('shows Web-revision guidance for normal and scope-change modes', () => {
    expect(form).toContain('通常は現地確認後に決まる施工金額を編集します。本体は参照のみです。内外装・オプションを変更する場合は「見積内容を変更」を選択してください。');
    expect(form).toContain('Webでお客様が選択した内容を変更します。変更内容は次の見積版として発行されます。本体は参照のみです。商品台帳の商品は品名を直接書き換えず、商品選択から変更してください。');
  });

  it('uses shared rate/financial UI while keeping customer preview only on registered-case editors', () => {
    expect(manualQuoteWorkbench).toContain('<QuoteInternalRateStrip showPlannedDefaults />');
    expect(quoteDraftEditor).toContain('<QuoteInternalRateStrip showPlannedDefaults />');
    expect(form).toContain('<QuoteInternalRateStrip showPlannedDefaults />');
    expect(manualQuoteWorkbench).toContain('<QuoteFinancialSummary');
    expect(quoteDraftEditor).toContain('<QuoteFinancialSummary');
    expect(form).toContain('<QuoteFinancialSummary');
    expect(manualQuoteWorkbench).not.toContain('<CustomerQuotePreview');
    expect(quoteDraftEditor).toContain('<CustomerQuotePreview');
    expect(form).toContain('<CustomerQuotePreview');
  });

  it('keeps Web revision preview and the current automatic rounding contract unchanged', () => {
    expect(form).toContain('const subtotal = Math.floor(subRaw / 1000) * 1000;');
    expect(form).toContain('const adjustment = subtotal - subRaw;');
    expect(form).toContain('adjustmentReason="千円未満切捨て"');
    expect(form).toContain('showAdjustmentControls={false}');
    expect(form).toContain("showPreview ? 'プレビューを閉じる' : 'プレビュー'");
    expect(form).toContain('<CustomerQuotePreview');
    expect(form).not.toContain('name="adjustment"');
    expect(form).not.toContain('name="adjustment_reason"');
  });

  it('keeps unavailable cost and gross-profit values explicitly uncalculated', () => {
    expect(quoteAuthoringUi).toContain('title="原価は現在この画面では表示していません">—');
    expect(quoteAuthoringUi).toContain('<span>原価合計</span><strong className="text-slate-500">未算定</strong>');
    expect(quoteAuthoringUi).toContain('<span>粗利</span><strong className="text-slate-600">未算定</strong>');
    expect(quoteAuthoringUi).toContain('<span>粗利率</span><strong className="text-slate-600">未算定</strong>');
    expect(form).not.toContain('粗利 0');
    expect(form).not.toContain('粗利率 0%');
  });

  it('keeps the planned rates read-only until Quote persistence supports them', () => {
    expect(quoteAuthoringUi).toContain('values={{ salesExpenseRate: 100, expenseRate: 15, markupRate: 150 }}');
    expect(quoteAuthoringUi).toContain('editable={false}');
    expect(quoteAuthoringUi).toContain('販売費・経費・掛率の編集機能は現在準備中です。');
  });

  it('does not invent Web Draft persistence while sharing the editor UI', () => {
    expect(form).toContain('この既存Web案件の改訂は、途中の下書き保存には現在対応していません。');
    expect(form).not.toContain('label="下書き保存"');
    expect(form).toContain('label={`この内容で第${quote.revision + 1}版を発行`}');
    expect(quoteDraftEditor).toContain('label="下書き保存"');
  });

  it('keeps the current installation domain wording instead of splitting storage semantics in the UI', () => {
    expect(quoteAuthoringUi).toContain("{ key: 'installation', label: '別途', kinds: ['installation'] }");
    expect(form).toContain("['installation']");
    expect(form).not.toContain("'sitework'");
  });

  it('keeps the same base grouping in the issued-quote reference view', () => {
    expect(quoteTable).toContain("const fireItems = allOptionItems.filter((i) => i.name.includes('防火'));");
    expect(quoteTable).toContain('const baseSections: { section: string; items: QuoteItem[] }[] = [];');
  });

  it('uses version-aware issue wording for persisted Quote Drafts as well', () => {
    expect(quoteDraftEditor).toContain('targetRevision = 1');
    expect(quoteDraftEditor).toContain('const formalRevisionLabel = `第${targetRevision}版`;');
    expect(quoteDraftEditor).toContain('この内容で第${targetRevision}版を発行');
    expect(quoteDraftPage).toContain('第{targetRevision}版 見積下書き');
    expect(quoteDraftPage).toContain('現在の発行済み見積：第{parentQuoteDetail.quote.revision}版');
  });
});
