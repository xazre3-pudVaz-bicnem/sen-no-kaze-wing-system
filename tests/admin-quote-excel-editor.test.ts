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

  it('uses a separate simple structure for normal case editing', () => {
    expect(form).toContain('data-testid="revision-simple-editor"');
    expect(form).toContain('data-testid="confirmed-estimate-summary"');
    expect(form).toContain('確定済みの見積内容');
    expect(form).toContain('シミュレーター・前版で決まっている内容です。通常の現地工事入力では変更しません。');
    expect(form).toContain('data-testid="site-work-editor"');
    expect(form).toContain('data-testid="site-work-table"');
    expect(form).toContain('必要な項目だけ追加し、数量・売価・備考を入力します。');
    expect(form).toContain('data-testid="revision-change-preview"');
    expect(form).toContain('今回の変更');
    expect(form).toContain('{scopeChangeMode ? (');
    expect(form).toContain('data-testid="revision-sheet-scroll"');
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

  it('links the normal editor to the existing site-condition reference without inventing completion state', () => {
    expect(workspace).toContain("siteHref={tabHref('site')}");
    expect(sheet).toContain('siteHref={siteHref}');
    expect(form).toContain('data-testid="site-work-reference"');
    expect(form).toContain('現地確認の正式な完了状態はまだ保存されません。');
    expect(form).toContain('現地条件を見る');
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

  it('preserves confirmed rows while normal editing only exposes site-work inputs', () => {
    expect(form).toContain("const siteworkRows = rows");
    expect(form).toContain(".filter(({ row }) => row.kind === 'installation')");
    expect(form).toContain(".filter(({ row }) => row.kind !== 'installation')");
    expect(form).toContain('simple-hidden-');
    expect(form).toContain('name={`items.${index}.unit_price`} value={row.unit_price}');
    expect(form).toContain("const COMMON_SITEWORK_ITEMS = ['運搬費', '基礎工事', '電気工事', '給排水工事', '設置工事']");
    expect(form).toContain("exists ? '入力あり' : '未追加'");
    expect(form).toContain('0円');
    expect(form).not.toContain("exists ? '確定' :");
  });

  it('shows a pre-issue change preview without making it the revision source of truth', () => {
    expect(form).toContain('const changePreview: { key: string; label: string; delta: number | null }[] = [];');
    expect(form).toContain('source_id: i.id');
    expect(form).toContain('source_id: null');
    expect(form).toContain('を削除');
    expect(form).toContain('を変更');
    expect(form).toContain('を追加');
    expect(form).toContain('お客様への申し送りを変更');
    expect(form).toContain('第{quote.revision + 1}版を発行する前の確認用です。');
  });

  it('keeps product and specification changes behind an explicit detail mode', () => {
    expect(form).toContain('data-testid="toggle-scope-change"');
    expect(form).toContain('見積内容を変更');
    expect(form).toContain('data-testid="scope-change-actions"');
    expect(form).toContain('通常入力に戻す');
    expect(form).toContain('商品・仕様変更');
    expect(form).toContain('data-testid="open-catalog-picker"');
    expect(form).toContain('data-testid="add-interior-exterior"');
    expect(form).toContain('data-testid="add-option"');
    expect(form).toContain('data-testid="add-free"');
    expect(form).toContain('data-testid="add-installation-detail"');
  });

  it('keeps the immutable issued-quote lifecycle wording in edit mode', () => {
    expect(form).toContain('この内容を第{quote.revision + 1}版として発行します。現在の版は履歴として残ります。');
    expect(form).toContain('現在の版は履歴として残ります。');
  });
});
