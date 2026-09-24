import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const form = fs.readFileSync(path.join(root, 'components/admin/dealer-forms.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const quoteTable = fs.readFileSync(path.join(root, 'components/mypage/quote-table.tsx'), 'utf8');

describe('Admin quote Excel-like editor', () => {
  it('switches the quote between read mode and edit mode in the same place', () => {
    expect(sheet).toContain("const [editing, setEditing] = useState");
    expect(sheet).toContain('data-testid="quote-edit-toggle"');
    expect(sheet).toContain('見積内容を更新');
    expect(sheet).toContain('<QuoteTable');
    expect(sheet).toContain('quote={quote}');
    expect(sheet).toContain('showSelectedImages={false}');
    expect(sheet).toContain('<DealerRevisionForm');
    expect(sheet).toContain('sheetMode');
    expect(sheet).toContain('onCancel={() => setEditing(false)}');
  });

  it('does not render a second standalone revision form below the quote in the case workspace', () => {
    expect(workspace).toContain('<QuoteEstimateSheet');
    expect(workspace).not.toContain('<DealerRevisionForm quote={quote}');
    expect(workspace).toContain('見積書');
  });

  it('keeps the case editor simple and estimate-like', () => {
    expect(form).toContain("data-sheet-mode={sheetMode ? 'true' : undefined}");
    expect(form).toContain('現地確認後に決まる運送・基礎・電気・給排水・設置などの金額を入力します。');
    expect(form).toContain('シミュレーターで確定した内容は通常は確認表示です。');
    expect(form).toContain('sticky top-0 z-10');
    expect(form).toContain('min-w-[52rem] text-sm');
    for (const label of ['品名', '数量', '単位', '売価', '売価金額', '備考']) {
      expect(form).toContain(label);
    }
    expect(form).not.toContain('>原価</th>');
    expect(form).not.toContain('>原価金額</th>');
    expect(form).not.toContain('>粗利</th>');
    expect(form).toContain('【本体価格計】');
    expect(form).toContain('【内外装価格計】');
    expect(form).toContain('【オプション価格計】');
    expect(form).toContain('【別途工事計】');
    expect(form).toContain('合　計（税込）');
  });

  it('keeps the same base grouping and fire-item placement between read and edit modes', () => {
    expect(quoteTable).toContain("const fireItems = allOptionItems.filter((i) => i.name.includes('防火'));");
    expect(quoteTable).toContain('const baseSections: { section: string; items: QuoteItem[] }[] = [];');
    expect(form).toContain("item.kind === 'option' && item.name.includes('防火')");
    expect(form).toContain("section.key === 'base'");
    expect(form).toContain('防火仕様は閲覧時と同じく本体欄に表示');
    expect(form).toContain('showBaseGroupHeading');
    expect(form).toContain('showBaseGroupSubtotal');
  });

  it('keeps quote reference details visible while editing', () => {
    expect(quoteTable).toContain('export function QuoteReferenceDetails');
    expect(sheet).toContain('<QuoteReferenceDetails quote={quote} items={items} showSelectedImages={false} />');
    expect(sheet).toContain('data-testid="quote-estimate-editing"');
  });

  it('keeps non-editable base items visible in the same sheet for dealer editing', () => {
    expect(form).toContain('const lockedItems = sheetMode ? items.filter((i) => !editable(i.kind)) : [];');
    expect(form).toContain('data-testid={`revision-locked-row-${index}`}');
    expect(form).toContain('aria-label="変更不可"');
    expect(form).toContain('<LockKeyhole');
  });

  it('focuses normal editing on site work while preserving confirmed rows', () => {
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
    expect(form).toContain('name={`items.${i}.unit_price`} value={r.unit_price}');
    expect(form).toContain('!element.readOnly');
    expect(form).toContain("isCollapsed ? '+' : '−'");
    expect(form).toContain('data-revision-col="quantity"');
    expect(form).toContain('handleSheetKeyDown');
    expect(form).toContain('明細を編集前に戻す');
  });

  it('keeps advanced product changes explicit and separate from site-work entry', () => {
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
    expect(form).toContain('formatYen(amountOf(r))');
    expect(form).toContain('data-testid="revision-preview"');
    expect(form).toContain('この内容で改訂見積を発行');
    expect(form).toContain('この内容を第{quote.revision + 1}版として発行します。現在の版は履歴として残ります。');
  });

  it('keeps the immutable issued-quote lifecycle wording in edit mode', () => {
    expect(form).toContain('この内容を第{quote.revision + 1}版として発行します。現在の版は履歴として残ります。');
    expect(form).toContain('現在の版は履歴として残ります。');
  });
});
