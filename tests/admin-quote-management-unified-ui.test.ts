import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const authoringUi = fs.readFileSync(path.join(root, 'components/admin/quote-authoring-ui.tsx'), 'utf8');
const manualWorkbench = fs.readFileSync(path.join(root, 'components/admin/manual-quote-workbench.tsx'), 'utf8');
const draftEditor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const newQuotePage = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');
const draftPage = fs.readFileSync(path.join(root, 'app/admin/quotes/drafts/[id]/page.tsx'), 'utf8');
const estimateTemplatesPage = fs.readFileSync(path.join(root, 'app/admin/estimate-templates/page.tsx'), 'utf8');
const adminNav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const managementTabs = fs.readFileSync(path.join(root, 'components/admin/quote-management-tabs.tsx'), 'utf8');

describe('見積書管理の正式編集UI統合', () => {
  it('見積書管理で案件見積とシミュレーター標準を明確に分ける', () => {
    expect(adminNav).toContain("label: '見積書管理'");
    expect(managementTabs).toContain('案件見積');
    expect(managementTabs).toContain('シミュレーター標準');
    expect(managementTabs).toContain('href="/admin/quote-management"');
    expect(managementTabs).toContain('href="/admin/estimate-templates"');
    expect(newQuotePage).toContain('<QuoteManagementTabs active="case" />');
    expect(draftPage).toContain('<QuoteManagementTabs active="case" />');
    expect(estimateTemplatesPage).toContain('<QuoteManagementTabs active="standard" />');
    expect(estimateTemplatesPage).toContain('＋ 案件見積を作成');
    expect(newQuotePage).toContain('<ManualQuoteWorkbench');
    expect(manualWorkbench).toContain('<QuoteEditorTopbar mode="new"');
    expect(draftEditor).toContain('<QuoteEditorTopbar mode="edit"');
    expect(manualWorkbench).toContain('<QuoteAuthoringGrid');
    expect(draftEditor).toContain('<QuoteAuthoringGrid');
  });

  it('案件情報をExcel型編集の上部へまとめる', () => {
    for (const label of ['案件名', 'お客様名', '会社名', '電話番号', 'メールアドレス', 'お客様住所', '設置予定地', '商品モデル', '仕様', '防火仕様', '適用地域', 'メモ']) {
      expect(manualWorkbench).toContain(label);
    }
    expect(manualWorkbench).toContain('電話・メール・お客様住所は現在この画面では入力できません');
    expect(manualWorkbench).toContain('placeholder="未設定"');
    expect(manualWorkbench).not.toContain('（任意）');
    expect(manualWorkbench).not.toContain('label="注文範囲"');
    expect(draftEditor).not.toContain('<span className="text-muted">注文範囲</span>');
    expect(manualWorkbench).toContain('name="finish_level" value="full"');
    expect(manualWorkbench).toContain('data-testid="case-info-panel"');
  });

  it('本体・内外装工事・オプション・別途と社内列を同じExcel型表に維持する', () => {
    for (const label of ['本体', '内外装工事', 'オプション', '別途', '原価', '原価金額', '売価', '売価金額', '粗利', '備考']) {
      expect(authoringUi).toContain(label);
    }
    expect(authoringUi).toContain('data-testid="unified-quote-excel-grid"');
    expect(authoringUi).toContain('販売費');
    expect(authoringUi).toContain('経費');
    expect(authoringUi).toContain('掛率');
    expect(authoringUi).toContain('原価は現在この画面では表示していません');
  });

  it('シミュレーター標準のExcel操作性を案件見積表へ取り入れる', () => {
    expect(authoringUi).toContain('data-testid="quote-grid-help"');
    expect(authoringUi).toContain('Tab→ ／ Enter↓ ／ Shift+Enter↑');
    expect(authoringUi).toContain('黄色＝入力 ／ グレー＝参照');
    expect(authoringUi).toContain('handleGridKeyDown');
    expect(authoringUi).toContain('event.nativeEvent.isComposing');
    expect(authoringUi).toContain("event.key !== 'Enter'");
    expect(authoringUi).toContain('event.shiftKey ? index - 1 : index + 1');
    expect(authoringUi).toContain('data-quote-grid-col="name"');
    expect(authoringUi).toContain('data-quote-grid-col="quantity"');
    expect(authoringUi).toContain('data-quote-grid-col="unit"');
    expect(authoringUi).toContain('data-quote-grid-col="sale"');
    expect(authoringUi).toContain('data-quote-grid-col="remark"');
    expect(authoringUi).toContain('sticky left-0 top-0 z-40');
    expect(authoringUi).toContain('sticky left-[1.75rem] top-0 z-40');
    expect(authoringUi).toContain('sticky left-[3.5rem] top-0 z-40');
    expect(authoringUi).toContain('w-[10.5rem]');
    expect(authoringUi).toContain('overflow-x-auto md:overflow-x-visible');
    expect(authoringUi).toContain('w-full min-w-[46rem] table-fixed border-collapse');
    expect(authoringUi).toContain('md:min-w-0');
    expect(authoringUi).toContain('data-testid={\`quote-section-summary-\${section.key}\`}');
    expect(authoringUi).toContain('const rowNumberByKey = useMemo');
    expect(authoringUi).toContain(">1</td>");
    expect(authoringUi).toContain(">式</td>");
    expect(authoringUi).toContain('＋商品');
    expect(authoringUi).toContain('＋自由明細');
    expect(authoringUi).toContain("row.locked ? 'bg-slate-100' : 'bg-amber-50'");
    expect(authoringUi).not.toContain('標準・変更可');
    expect(authoringUi).not.toContain('標準・固定');
    expect(authoringUi).not.toContain('任意オプション');
  });

  it('PCでは横スクロールを避け、空区分と金額欄をコンパクトにする', () => {
    expect(authoringUi).toContain('<col className="w-[10.5rem]" />');
    expect(authoringUi).toContain('<col className="w-10" />');
    expect(authoringUi).toContain('<col className="w-9" />');
    expect(authoringUi).toContain('text-[9px] font-semibold leading-tight');
    expect(authoringUi).toContain('h-5 min-h-5');
    expect(authoringUi).toContain('currentRows.length > 0 && <tr');
    expect(authoringUi).toContain('max-w-lg rounded-lg border border-slate-300 bg-white p-3 text-xs');
    expect(authoringUi).toContain('className="h-6 w-28 text-right text-xs"');
  });

  it('案件見積でも商品台帳から商品を追加・差し替えできる', () => {
    expect(authoringUi).toContain('data-testid="quote-product-picker-dialog"');
    expect(authoringUi).toContain('商品台帳から選ぶ');
    expect(authoringUi).toContain('商品台帳から追加');
    expect(authoringUi).toContain('<Package className="size-3"');
    expect(authoringUi).toContain('SECTION_PRODUCT_CATEGORY_CODES');
    expect(authoringUi).toContain('(product.baseModelId === null || product.baseModelId === baseModelId)');
    expect(authoringUi).toContain('(product.specCodes.length === 0 || product.specCodes.includes(specCode))');
    expect(authoringUi).toContain('onSelectProduct(pickerSection, pickerTargetKey, product)');
    expect(manualWorkbench).toContain('option_id: product.id');
    expect(manualWorkbench).toContain('image_url: product.imageUrl');
    expect(draftEditor).toContain('option_id: product.id');
    expect(draftEditor).toContain('image_url: product.imageUrl');
    expect(newQuotePage).toContain('store.listOptions()');
    expect(newQuotePage).toContain('store.listCategories()');
    expect(newQuotePage).toContain("option.status === 'published'");
    expect(draftPage).toContain('store.getCatalogBundle(detail.draft.base_model_id)');
    expect(newQuotePage).toContain('products={products}');
    expect(draftPage).toContain('products={products}');
  });

  it('正式金額ロジックをUI側の新しい原価・掛率計算へ置き換えない', () => {
    expect(authoringUi).toContain('販売費・経費・掛率は現在の見積では使用していません');
    expect(authoringUi).toContain('販売費 <strong className="text-slate-400">—</strong>');
    expect(authoringUi).toContain('経費 <strong className="text-slate-400">—</strong>');
    expect(authoringUi).toContain('掛率 <strong className="text-slate-400">—</strong>');
    expect(manualWorkbench).toContain('roundLikePostgres');
    expect(draftEditor).toContain('detail.draft.tax_rate');
  });

  it('案件見積一覧は案件名・顧客名・見積番号・商品モデルで検索する', () => {
    expect(authoringUi).toContain('案件見積一覧');
    expect(authoringUi).toContain('estimate.case_name');
    expect(authoringUi).toContain('estimate.customer_name');
    expect(authoringUi).toContain('estimate.quote_no');
    expect(authoringUi).toContain('estimate.base_model_name');
    expect(authoringUi).toContain('案件名・顧客名・見積番号・商品モデルで検索');
    expect(newQuotePage).toContain('case_name: requestById.get(quote.quote_request_id)?.case_name ?? null');
    expect(draftPage).toContain('case_name: requestById.get(quote.quote_request_id)?.case_name ?? null');
  });

  it('お客様プレビューには内部原価・掛率・粗利列を出さない', () => {
    const start = authoringUi.indexOf('export function CustomerQuotePreview');
    expect(start).toBeGreaterThan(-1);
    const preview = authoringUi.slice(start);
    for (const label of ['会社名', 'お客様名', '住所', 'TEL', '顧客番号', '件名', '見積提出日', '受注契約日', '発行者情報', '発行会社名／代理店名', '担当者', '適格請求書発行事業者登録番号', '支払情報', '支払条件', '振込先', '銀行名', '支店名', '口座種別', '口座番号', '口座名義']) {
      expect(preview).toContain(label);
    }
    for (const label of ['区分', '品名', '数量', '単位', '単価', '金額', '備考', '税抜小計', '値引き・調整額', '消費税', '税込合計']) {
      expect(preview).toContain(label);
    }
    expect(preview).not.toContain('原価</th>');
    expect(preview).not.toContain('原価金額</th>');
    expect(preview).not.toContain('掛率</th>');
    expect(preview).not.toContain('粗利</th>');
    expect(preview).not.toContain('粗利率</th>');
    expect(preview).toContain('正式PDF発行処理は今回の対象外です');
  });

  it('発行者・振込先は固定値をハードコードせず未設定として分離する', () => {
    const start = authoringUi.indexOf('export function CustomerQuotePreview');
    const preview = authoringUi.slice(start);
    for (const label of ['発行会社名／代理店名', '担当者', '適格請求書発行事業者登録番号', '振込先', '銀行名', '支店名', '口座種別', '口座番号', '口座名義']) {
      expect(preview).toContain(label);
    }
    expect(preview).not.toContain('株式会社技術の杜');
    expect(preview).not.toContain('北日本銀行');
    expect(preview).not.toContain('7084800');
  });

  it('プランボード・図面は同じワークスペース内で未接続状態を明示する', () => {
    expect(authoringUi).toContain('見積書');
    expect(authoringUi).toContain('プランボード');
    expect(authoringUi).toContain('図面');
    expect(authoringUi).toContain('type="button" disabled');
  });
});
