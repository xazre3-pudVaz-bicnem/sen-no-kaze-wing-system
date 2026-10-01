import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const actions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');
const casePage = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const quoteManagement = fs.readFileSync(path.join(root, 'app/admin/quote-management/page.tsx'), 'utf8');
const newQuotePage = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');
const draftPage = fs.readFileSync(path.join(root, 'app/admin/quotes/drafts/[id]/page.tsx'), 'utf8');
const workbench = fs.readFileSync(path.join(root, 'components/admin/manual-quote-workbench.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const controls = fs.readFileSync(path.join(root, 'components/admin/case-admin-controls.tsx'), 'utf8');
const authoringUi = fs.readFileSync(path.join(root, 'components/admin/quote-authoring-ui.tsx'), 'utf8');

describe('実案件E2E後の見積UI導線', () => {
  it('正式保存後は案件管理の該当案件・見積タブへ戻す', () => {
    expect(actions).toContain('/admin/quotes?case=${encodeURIComponent(quoteId)}&tab=estimate&');
    expect(actions).toContain('#case-workspace');
  });

  it('案件見積の作成・編集入口は案件管理へ寄せ、登録後も案件管理へ合流する', () => {
    expect(casePage).toContain('/admin/quotes/new?return_to=%2Fadmin%2Fquotes');
    expect(quoteManagement).toContain('案件管理を開く');
    expect(quoteManagement).not.toContain('/admin/quotes/new?return_to=%2Fadmin%2Fquote-management');
    expect(newQuotePage).toContain("sp.return_to === '/admin/quote-management'");
    expect(workbench).not.toContain('name="return_to" value={returnTo}');
    expect(actions).toContain("redirect('/admin/quotes')");
    expect(draftPage).toContain("sp.return_to === '/admin/quote-management'");
    expect(draftPage).toContain('href={returnHref}');
    expect(draftPage).toContain('const returnCase = sp.return_case?.trim()');
    expect(draftPage).toContain('const returnRequest = sp.return_request?.trim()');
  });

  it('担当選択CTAは案件設定の担当者UIを直接開く', () => {
    expect(workspace).toContain("buildInlineTabHref(quote.id, 'estimate', listSearchParams, false, 'dealer')");
    expect(workspace).toContain("href: isAdmin ? dealerSettingsHref : '#case-workspace'");
    expect(workspace).toContain("<CaseAdminControls defaultOpen={settings === 'dealer'}>");
    expect(controls).toContain('detailsRef.current.open = true');
    expect(controls).toContain('id="case-admin-controls"');
  });

  it('商品台帳の0円登録価格と別途見積・未表示を区別する', () => {
    expect(authoringUi).toContain('登録価格：0円');
    expect(authoringUi).not.toContain('0円＝0円として計上');
    expect(authoringUi).toContain('別途見積＝合計に含めない');
    expect(authoringUi).toContain('—＝この画面では表示なし');
    expect(authoringUi).toContain("product.priceOnRequest ? '別途見積' : formatYen(product.price)");
    expect(authoringUi).not.toContain('原価正本はQuote Draftへ未接続');
    expect(authoringUi).not.toContain('Quote Draftの正式金額ロジックは変更していません');
    expect(workbench).not.toContain('保存連携準備中');
  });
});
