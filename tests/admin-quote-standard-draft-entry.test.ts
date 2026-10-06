import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/quote-management/page.tsx'), 'utf8');
const review = fs.readFileSync(path.join(root, 'components/admin/case-estimate-review.tsx'), 'utf8');

function standardDraftButtonBlock() {
  const marker = 'data-testid="case-estimate-standard-draft-button"';
  const markerIndex = page.indexOf(marker);
  if (markerIndex < 0) throw new Error('standard draft preparation button not found');
  const start = page.lastIndexOf('<button', markerIndex);
  const end = page.indexOf('</button>', markerIndex);
  if (start < 0 || end < 0) throw new Error('standard draft preparation button markup is incomplete');
  return page.slice(start, end + '</button>'.length);
}

describe('案件見積から標準案を作る準備中入口', () => {
  it('本部adminだけに表示する既存role判定を使う', () => {
    expect(page).toContain("const actor = await requireAdmin('/admin/quote-management');");
    expect(page).toContain("const showStandardDraftPreparation = actor.role === 'admin';");
    expect(page).toContain('showStandardDraftPreparation &&');

    const canShow = (role: string) => role === 'admin';
    expect(canShow('admin')).toBe(true);
    expect(canShow('master_dealer')).toBe(false);
    expect(canShow('dealer')).toBe(false);
    expect(canShow('customer')).toBe(false);
  });

  it('発行済みQuote Revisionの見積書タブだけに準備中入口を出す', () => {
    expect(page).toContain("selectedRow.selection.kind === 'quote'");
    expect(page).toContain("(!sp.detail_tab || sp.detail_tab === 'estimate')");
    expect(page).toContain('この見積から標準案を作る');
    expect(page).toContain('準備中');
  });

  it('ボタンはdisabledで実行経路を一切持たない', () => {
    const button = standardDraftButtonBlock();
    expect(button).toContain('type="button"');
    expect(button).toContain('disabled');
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toContain('href=');
    expect(button).not.toContain('action=');
    expect(button).not.toContain('formAction=');
    expect(button).not.toContain('onClick=');
    expect(button).not.toContain('/api/');
    expect(button).not.toContain('.rpc(');
  });

  it('既存の案件見積選択・案件管理・PDF確認導線を維持する', () => {
    expect(page).toContain('<CaseEstimateReview');
    expect(page).toContain('<CaseEstimateSelectableRow');
    expect(review).toContain('案件管理で開く');
    expect(review).toContain('/api/quotes/${quote.id}/pdf');
    expect(review).toContain('発行済み見積は確認専用です');
  });
});
