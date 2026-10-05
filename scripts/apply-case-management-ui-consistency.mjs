import fs from 'node:fs';

const pagePath = 'app/admin/quotes/page.tsx';
const workspacePath = 'components/admin/case-workspace.tsx';
const testPath = 'tests/admin-case-management-ui-consistency.test.ts';

function replaceExact(source, before, after, expectedCount = 1) {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} occurrence(s), found ${count}: ${before}`);
  }
  return source.split(before).join(after);
}

let page = fs.readFileSync(pagePath, 'utf8');
page = replaceExact(
  page,
  "if (quote.status === 'accepted') return 'F10/15 契約';",
  "if (quote.status === 'accepted') return 'F9/15 見積承諾';"
);
page = replaceExact(
  page,
  "const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || r.contact.address || '';",
  "const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || '';"
);
page = replaceExact(
  page,
  '地域は設置予定地を優先し、未登録時は顧客住所で判定します。',
  '地域は設置予定地で判定します。未登録案件は地域絞り込みの対象外です。'
);
page = replaceExact(
  page,
  '<div data-testid="case-list-scroll">',
  '<div className="overflow-x-auto" data-testid="case-list-scroll">',
  2
);
page = replaceExact(
  page,
  '<table className="w-full table-fixed text-[0.69rem]">',
  '<table className="w-full min-w-[58rem] table-fixed text-[0.69rem]">',
  2
);
fs.writeFileSync(pagePath, page);

let workspace = fs.readFileSync(workspacePath, 'utf8');
workspace = replaceExact(
  workspace,
  "const currentPhaseLabel = isFormalAccepted\n    ? '契約'",
  "const currentPhaseLabel = isFormalAccepted\n    ? '見積承諾'"
);
workspace = replaceExact(
  workspace,
  "isFormalAccepted\n      ? '契約確認'",
  "isFormalAccepted\n      ? '見積承諾後の確認'"
);
workspace = replaceExact(
  workspace,
  "title: '次にやること：契約内容を確認',",
  "title: '次にやること：契約条件を確認',"
);
fs.writeFileSync(workspacePath, workspace);

const test = `import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');

describe('案件管理UIの業務意味と一覧表示', () => {
  it('formal acceptedを契約成立ではなく見積承諾として表示する', () => {
    expect(page).toContain("if (quote.status === 'accepted') return 'F9/15 見積承諾';");
    expect(page).not.toContain('F10/15 契約');
    expect(workspace).toContain("const currentPhaseLabel = isFormalAccepted\\n    ? '見積承諾'");
    expect(workspace).toContain("isFormalAccepted\\n      ? '見積承諾後の確認'");
    expect(workspace).toContain("title: '次にやること：契約条件を確認',");
    expect(workspace).toContain('正式な契約状態はまだこの画面では確定しません。');
  });

  it('地域絞り込みに顧客住所を代用しない', () => {
    expect(page).toContain("const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || '';");
    expect(page).not.toContain("r.contact.site_address || r.contact.address || ''");
    expect(page).toContain('地域は設置予定地で判定します。未登録案件は地域絞り込みの対象外です。');
  });

  it('6列案件一覧は狭い画面で横スクロールし、sticky headerを維持する', () => {
    expect((page.match(/className=\"overflow-x-auto\" data-testid=\"case-list-scroll\"/g) ?? []).length).toBe(2);
    expect((page.match(/min-w-\[58rem\] table-fixed text-\[0\\.69rem\]/g) ?? []).length).toBe(2);
    expect((page.match(/<thead className=\"sticky top-0 z-10/g) ?? []).length).toBe(2);
  });
});
`;
fs.writeFileSync(testPath, test);
