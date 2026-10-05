import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');

describe('案件管理UIの業務意味と一覧表示', () => {
  it('formal acceptedを契約成立ではなく見積承諾として表示する', () => {
    expect(page).toContain("if (quote.status === 'accepted') return 'F9/15 見積承諾';");
    expect(page).not.toContain('F10/15 契約');
    expect(workspace).toContain("const currentPhaseLabel = isFormalAccepted\n    ? '見積承諾'");
    expect(workspace).toContain("isFormalAccepted\n      ? '見積承諾後の確認'");
    expect(workspace).toContain("title: '次にやること：契約条件を確認',");
    expect(workspace).toContain('正式な契約状態はまだこの画面では確定しません。');
  });

  it('地域絞り込みに顧客住所を代用しない', () => {
    expect(page).toContain("const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || '';");
    expect(page).not.toContain("r.contact.site_address || r.contact.address || ''");
    expect(page).toContain('地域は設置予定地で判定します。未登録案件は地域絞り込みの対象外です。');
  });

  it('6列案件一覧は狭い画面で横スクロールし、sticky headerを維持する', () => {
    expect((page.match(/className="overflow-x-auto" data-testid="case-list-scroll"/g) ?? []).length).toBe(2);
    expect((page.match(/min-w-\[58rem\] table-fixed text-\[0\.69rem\]/g) ?? []).length).toBe(2);
    expect((page.match(/<thead className="sticky top-0 z-10/g) ?? []).length).toBe(2);
  });
});
