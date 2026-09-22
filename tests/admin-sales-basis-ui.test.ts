import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const baseList = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/base-masters/page.tsx'), 'utf8');
const baseDetail = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/base-masters/[id]/page.tsx'), 'utf8');
const baseForm = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/base-master-form.tsx'), 'utf8');
const baseRevisionForm = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/base-master-revision-form.tsx'), 'utf8');
const estimateList = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/estimate-templates/page.tsx'), 'utf8');
const estimateDetail = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/estimate-templates/[id]/page.tsx'), 'utf8');
const workbench = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/estimate-template-workbench.tsx'), 'utf8');
const nav = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'), 'utf8');

describe('販売基準の利用者向け表示', () => {
  it('販売基準を本体基準と標準見積の一つのワークスペースとして表示する', () => {
    expect(baseList).toContain('title="販売基準"');
    expect(baseList).toContain('1. 本体基準');
    expect(baseList).toContain('2. 標準見積');
    expect(baseList).toContain('画面上は一つの「販売基準」として扱います');
    expect(baseList).toContain('本体版との正式な紐付け前');
    expect(baseList).toContain('旧標準見積Excelを確認');
    expect(nav).toContain("href: '/admin/base-masters', label: '販売基準'");
    expect(nav).toContain('items: []');
  });

  it('本体マスターでは版・下書き・公開版を平易な日本語で案内する', () => {
    expect(baseList).toContain('<Th>公開版</Th>');
    expect(baseList).toContain('<Th>下書き</Th>');
    expect(baseDetail).toContain('版の履歴');
    expect(baseDetail).toContain('販売基準へ戻る');
    expect(baseRevisionForm).toContain('下書き 第{revision.version}版');
    expect(baseForm).toContain('まず下書きとして作成します');
  });

  it('標準見積を販売基準の一部として案内し、未実装の承認フローを表示しない', () => {
    expect(estimateList).toContain('title="標準見積"');
    expect(estimateList).toContain('販売基準となる標準見積');
    expect(estimateList).toContain('販売基準へ戻る');
    expect(estimateDetail).toContain('販売基準へ戻る');
    expect(workbench).toContain('標準見積上では直接変更しません');
    expect(workbench).not.toContain('本部へ承認申請');
  });
});
