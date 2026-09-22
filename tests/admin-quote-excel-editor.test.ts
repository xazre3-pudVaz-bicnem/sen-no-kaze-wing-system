import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const form = fs.readFileSync(path.join(root, 'components/admin/dealer-forms.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');

describe('Admin quote Excel-like editor', () => {
  it('switches the quote between read mode and edit mode in the same place', () => {
    expect(sheet).toContain("const [editing, setEditing] = useState");
    expect(sheet).toContain('data-testid="quote-edit-toggle"');
    expect(sheet).toContain('見積を編集');
    expect(sheet).toContain('<QuoteTable quote={quote}');
    expect(sheet).toContain('<DealerRevisionForm');
    expect(sheet).toContain('sheetMode');
    expect(sheet).toContain('onCancel={() => setEditing(false)}');
  });

  it('does not render a second standalone revision form below the quote in the case workspace', () => {
    expect(workspace).toContain('<QuoteEstimateSheet');
    expect(workspace).not.toContain('<DealerRevisionForm quote={quote}');
    expect(workspace).toContain('正式見積書');
  });

  it('uses compact spreadsheet-like cells with native Tab navigation', () => {
    expect(form).toContain("data-sheet-mode={sheetMode ? 'true' : undefined}");
    expect(form).toContain('Tabキーで次の入力セルへ移動できます。');
    expect(form).toContain('sticky top-0 z-10');
    expect(form).toContain('border-collapse text-xs');
    expect(form).toContain('onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}');
    expect(form).toContain('>{i + 1}</td>');
    expect(form).toContain('{KIND_LABELS[r.kind]}');
  });

  it('keeps non-editable base items visible in the same sheet for dealer editing', () => {
    expect(form).toContain('const lockedItems = sheetMode ? items.filter((i) => !editable(i.kind)) : [];');
    expect(form).toContain('本体・固定項目（変更不可）');
    expect(form).toContain('data-testid={`revision-locked-row-${index}`}');
    expect(form).toContain('<LockKeyhole');
  });

  it('keeps existing row actions, product picker, live totals and next-revision issuance', () => {
    expect(form).toContain('data-testid="open-catalog-picker"');
    expect(form).toContain('data-testid="add-installation"');
    expect(form).toContain('data-testid="add-interior-exterior"');
    expect(form).toContain('data-testid="add-option"');
    expect(form).toContain('data-testid="add-free"');
    expect(form).toContain('lastSameKind');
    expect(form).toContain('formatYen(amountOf(r))');
    expect(form).toContain('data-testid="revision-preview"');
    expect(form).toContain('第${quote.revision + 1}版として発行する');
  });

  it('keeps the immutable issued-quote lifecycle wording in edit mode', () => {
    expect(form).toContain('現在の版は履歴として残ります。');
    expect(form).toContain('発行すると現在の版は上書きされず、履歴として残ります。');
  });
});
