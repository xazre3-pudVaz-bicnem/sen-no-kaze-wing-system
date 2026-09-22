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

describe('販売基準の利用者向け表示', () => {
  it('本体マスターでは版・下書き・公開版を平易な日本語で案内する', () => {
    expect(baseList).toContain('版管理');
    expect(baseList).toContain('<Th>公開版</Th>');
    expect(baseList).toContain('<Th>下書き</Th>');
    expect(baseDetail).toContain('版の履歴');
    expect(baseRevisionForm).toContain('下書き 第{revision.version}版');
    expect(baseForm).toContain('まず下書きとして作成します');
  });

  it('標準見積を販売基準として案内し、未実装の承認フローを表示しない', () => {
    expect(estimateList).toContain('title="標準見積"');
    expect(estimateList).toContain('販売基準となる標準見積');
    expect(estimateDetail).toContain('標準見積一覧へ戻る');
    expect(workbench).toContain('標準見積上では直接変更しません');
    expect(workbench).not.toContain('本部へ承認申請');
  });
});
