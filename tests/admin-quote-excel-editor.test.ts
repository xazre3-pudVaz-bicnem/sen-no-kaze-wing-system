import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const form = fs.readFileSync(path.join(root, 'components/admin/dealer-forms.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const editPage = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/edit/page.tsx'), 'utf8');
const quoteDraftEditor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const quoteDraftPage = fs.readFileSync(path.join(root, 'app/admin/quotes/drafts/[id]/page.tsx'), 'utf8');
const quoteTable = fs.readFileSync(path.join(root, 'components/mypage/quote-table.tsx'), 'utf8');
const catalogPicker = fs.readFileSync(path.join(root, 'components/admin/catalog-picker.tsx'), 'utf8');

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

  it('uses a compact Excel-style comparison grid for case revisions', () => {
    expect(form).toContain("data-sheet-mode={sheetMode ? 'true' : undefined}");
    expect(form).toContain('第${quote.revision + 1}版 見積編集');
    expect(form).toContain('<QuoteInternalRateStrip showPlannedDefaults />');
    expect(form).toContain('min-w-[68rem] border-collapse text-[10px]');
    for (const label of ['品名', '数量', '単位', '原価', '原価金額', '売価', '売価金額', '粗利', '備考']) {
      expect(form).toContain(label);
    }
    expect(form).toContain('原価合計');
    expect(form).toContain('売価明細合計');
    expect(form).toContain('経費');
    expect(form).toContain('調整額（千円未満切捨て）');
    expect(form).toContain('消費税');
    expect(form).toContain('見積金額（税込）');
    expect(form).toContain('粗利率');
    expect(form).toContain('未算定');
    expect(form).toContain('【本体価格計】');
    expect(form).toContain('【内外装価格計】');
    expect(form).toContain('【オプション価格計】');
    expect(form).toContain('【別途工事計】');
  });

  it('keeps unavailable cost and gross-profit values explicitly uncalculated', () => {
    expect(form).toContain('bg-slate-50 px-1 py-1 text-right text-slate-400">—</td>');
    expect(form).toContain('bg-slate-50 px-1 py-1 text-right text-slate-400">未算定</td>');
    expect(form).not.toContain('粗利 0');
    expect(form).not.toContain('粗利率 0%');
  });

  it('keeps the same base grouping and fire-item placement between read and edit modes', () => {
    expect(quoteTable).toContain("const fireItems = allOptionItems.filter((i) => i.name.includes('防火'));");
    expect(quoteTable).toContain('const baseSections: { section: string; items: QuoteItem[] }[] = [];');
    expect(form).toContain("item.kind === 'option' && item.name.includes('防火')");
    expect(form).toContain("section.key === 'base'");
    expect(form).toContain('防火仕様を含む');
    expect(form).toContain('showBaseGroupHeading');
    expect(form).toContain('showBaseGroupSubtotal');
  });

  it('keeps non-editable base items visible while dealer revisions are edited', () => {
    expect(form).toContain('const lockedItems = sheetMode ? items.filter((i) => !editable(i.kind)) : [];');
    expect(form).toContain('data-testid={`revision-locked-row-${index}`}');
    expect(form).toContain('aria-label="変更不可"');
    expect(form).toContain('<LockKeyhole');
  });

  it('focuses normal editing on installation rows while preserving confirmed rows', () => {
    expect(form).toContain('data-testid="revision-sticky-summary"');
    expect(form).toContain('未保存の変更あり');
    expect(form).toContain('編集前と同じ');
    expect(form).toContain('前版');
    expect(form).toContain('編集中');
    expect(form).toContain('差額');
    expect(form).toContain("new Set<string>(['base', 'interior', 'option', 'free'])");
    expect(form).toContain("const rowEditable = section.key === 'sitework' || scopeChangeMode");
    expect(form).toContain('readOnly={!rowEditable}');
    expect(form).toContain('disabled={!rowEditable}');
    expect(form).toContain('現地確認後に入力');
    expect(form).toContain('確定済み・確認のみ');
    expect(form).toContain('isCollapsed && editableRows.map');
    expect(form).toContain('data-revision-col="quantity"');
    expect(form).toContain('handleSheetKeyDown');
    expect(form).toContain('明細を編集前に戻す');
  });

  it('keeps advanced product changes explicit and separate from normal site-work entry', () => {
    expect(form).toContain('data-testid="add-installation"');
    expect(form).toContain('現地工事を追加');
    expect(form).toContain('data-testid="toggle-scope-change"');
    expect(form).toContain("scopeChangeMode ? '通常入力に戻す' : '見積内容を変更'");
    expect(form).toContain('data-testid="scope-change-actions"');
    expect(form).toContain('商品・仕様変更');
    expect(form).toContain('data-testid="open-catalog-picker"');
    expect(form).toContain('data-testid="add-interior-exterior"');
    expect(form).toContain('data-testid="add-option"');
    expect(form).toContain('data-testid="add-free"');
    expect(form).toContain('insertByKind');
    expect(form).toContain('changeKind');
  });

  it('reuses the case Quote preview and keeps issuance controls together', () => {
    expect(form).toContain('<CustomerQuotePreview');
    expect(form).toContain("showPreview ? 'プレビューを閉じる' : 'プレビュー'");
    expect(form).toContain('この既存Web案件の改訂は、途中の下書き保存にはまだ対応していません。');
    expect(form).toContain('label={`この内容で第${quote.revision + 1}版を発行`}');
    expect(form).toContain('現在の第{quote.revision}版は履歴として残ります。');
  });

  it('lets an editable estimate row choose an existing catalog product', () => {
    expect(form).toContain('const [pickerTargetKey, setPickerTargetKey] = useState<string | null>(null);');
    expect(form).toContain('data-testid={`select-catalog-row-${i}`}');
    expect(form).toContain('商品から選ぶ');
    expect(form).toContain('applyCatalogItemToRow');
    expect(form).toContain("mode={pickerTargetRow ? 'replace' : 'add'}");
    expect(form).toContain('unit_price: item.price_on_request ? 0 : item.price');
    expect(catalogPicker).toContain("mode?: 'add' | 'replace'");
  });

  it('uses the same planned rate strip and version-aware issue wording for persisted Quote Drafts', () => {
    expect(quoteDraftEditor).toContain('<QuoteInternalRateStrip showPlannedDefaults />');
    expect(quoteDraftEditor).toContain('targetRevision = 1');
    expect(quoteDraftEditor).toContain('const formalRevisionLabel = `第${targetRevision}版`;');
    expect(quoteDraftEditor).toContain('この内容で第${targetRevision}版を発行');
    expect(quoteDraftPage).toContain('第{targetRevision}版 見積下書き');
    expect(quoteDraftPage).toContain('現在の発行済み見積：第{parentQuoteDetail.quote.revision}版');
  });
});
