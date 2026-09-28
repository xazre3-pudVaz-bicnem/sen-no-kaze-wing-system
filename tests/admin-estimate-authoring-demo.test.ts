import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-excel-demo.tsx'),
  'utf8'
);

describe('技術の杜確認用 見積書作成デモ', () => {
  it('普通の見積書作成として4つの表示を同じワークスペースで切り替える', () => {
    expect(demo).toContain("type DemoTab = 'edit' | 'estimate' | 'plan' | 'drawing'");
    expect(demo).toContain('aria-label="見積書作成の表示切替"');
    expect(demo).toContain("['edit', '編集']");
    expect(demo).toContain("['estimate', '見積書']");
    expect(demo).toContain("['plan', 'プランボード']");
    expect(demo).toContain("['drawing', '図面']");
    expect(demo).toContain('見積書作成 ― Excel操作確認版');
  });

  it('本体マスターを壊さず見積書内の本体明細を編集できる', () => {
    expect(demo).toContain('本体マスター自体は変更せず、この見積書内の明細を編集します。');
    expect(demo).toContain('（本体マスターから読込・この見積内で編集可）');
    expect(demo).toContain('onClick={() => addFreeRow(section)}');
    expect(demo).not.toContain("const readOnly = section === '本体'");
    expect(demo).not.toContain('本体マスター参照・読取専用');
    expect(demo).not.toContain('本体明細は見積テンプレート側では直接変更しません。');
  });

  it('編集した同じrowsと合計を見積書・プランボードへ反映する', () => {
    expect(demo).toContain('data-testid="estimate-live-preview"');
    expect(demo).toContain('data-testid="plan-live-preview"');
    expect(demo).toContain('rows.filter((row) => row.section === section)');
    expect(demo).toContain('{formatYen(totals.saleGrand)}');
    expect(demo).toContain('見積書プレビュー・画面内編集と連動');
    expect(demo).toContain('プランボード・画面内編集と連動');
  });

  it('図面を見積書作成の一部として配置し、正式接続前は実保存しない', () => {
    expect(demo).toContain('data-testid="drawing-workspace-preview"');
    expect(demo).toContain('図面も同じ見積書作成ワークスペースで管理');
    expect(demo).toContain('平面図');
    expect(demo).toContain('立面図');
    expect(demo).toContain('配置図');
    expect(demo).toContain('図面ファイル保存・作図機能・Revisionとの正式な紐付けは後続工程で接続します。');
    expect(demo).toContain('正式保存（接続後）');
  });
});
