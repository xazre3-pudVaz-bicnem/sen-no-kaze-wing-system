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
    expect(sheet).toContain('＋新しい見積書');
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
    expect(workspace).toContain('正式見積書');
  });

  it('keeps the edit table visually aligned with the read-only quote table', () => {
    expect(form).toContain("data-sheet-mode={sheetMode ? 'true' : undefined}");
    expect(form).toContain('表示中の見積書と同じ並びのまま、セルを直接編集できます。');
    expect(form).toContain('Tabキーで次のセルへ移動します。');
    expect(form).toContain('sticky top-0 z-10');
    expect(form).toContain('min-w-[44rem] text-sm');
    for (const label of ['項目', '数量', '単位', '単価', '金額', '備考']) {
      expect(form).toContain(label);
    }
    expect(form).toContain('【本体価格計】');
    expect(form).toContain('【内外装価格計】');
    expect(form).toContain('【オプション価格計】');
    expect(form).toContain('【別途工事計】');
    expect(form).toContain('合　計（税込）');
    expect(form).toContain('onFocus={(event) => event.currentTarget.select()}');
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

  it('keeps existing row actions, product picker, live totals and next-revision issuance', () => {
    expect(form).toContain('data-testid="open-catalog-picker"');
    expect(form).toContain('data-testid="add-installation"');
    expect(form).toContain('data-testid="add-interior-exterior"');
    expect(form).toContain('data-testid="add-option"');
    expect(form).toContain('data-testid="add-free"');
    expect(form).toContain('insertByKind');
    expect(form).toContain('changeKind');
    expect(form).toContain('formatYen(amountOf(r))');
    expect(form).toContain('data-testid="revision-preview"');
    expect(form).toContain('第${quote.revision + 1}版として発行する');
  });

  it('keeps the immutable issued-quote lifecycle wording in edit mode', () => {
    expect(form).toContain('現在の版は履歴として残ります。');
    expect(form).toContain('発行すると現在の版は上書きされず、履歴として残ります。');
  });
});
