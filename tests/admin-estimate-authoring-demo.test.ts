import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-excel-demo.tsx'),
  'utf8'
);

describe('技術の杜確認用 見積書作成デモ', () => {
  it('見積書・プランボード・図面の3タブで見積作成を進める', () => {
    expect(demo).toContain("type DemoTab = 'estimate' | 'plan' | 'drawing'");
    expect(demo).toContain('aria-label="見積書作成の表示切替"');
    expect(demo).not.toContain("['edit', '編集']");
    expect(demo).toContain("['estimate', '見積書']");
    expect(demo).toContain("['plan', 'プランボード']");
    expect(demo).toContain("['drawing', '図面']");
    expect(demo).toContain('見積書作成');
    expect(demo).toContain('見積書プレビュー');
  });

  it('本体マスターを壊さず見積書内の本体明細を編集できる', () => {
    expect(demo).toContain('本体マスター自体は変更しません。');
    expect(demo).toContain('（本体マスターから読込・この見積内で編集可）');
    expect(demo).toContain('onClick={() => addFreeRow(section)}');
    expect(demo).not.toContain("const readOnly = section === '本体'");
    expect(demo).not.toContain('本体マスター参照・読取専用');
    expect(demo).not.toContain('本体明細は見積テンプレート側では直接変更しません。');
  });

  it('折り畳み時は区分見出しを消し、計の1行だけから再展開できる', () => {
    expect(demo).toContain("data-testid={\`estimate-demo-section-total-\${section}\`}");
    expect(demo).toContain("onClick={isCollapsed ? () => toggleSection(section) : undefined}");
    expect(demo).toContain("{!isCollapsed && (");
    expect(demo).toContain("aria-label={section + 'を展開'}");
    expect(demo).toContain("{section} 計");
    expect(demo).toContain("!isCollapsed && (");
  });

  it('自由入力を残したまま、明細行から既存商品を選んで置換できる', () => {
    expect(demo).toContain('const [pickerTargetRowId, setPickerTargetRowId] = useState<string | null>(null);');
    expect(demo).toContain('openProductPicker(section as Exclude<Section, \'本体\'>, row.id)');
    expect(demo).toContain('既存の商品から選択');
    expect(demo).toContain('⋯');
    expect(demo).toContain("pickerTargetRowId ? '既存の商品から選択' : '商品を追加'");
    expect(demo).toContain("row.id === pickerTargetRowId");
    expect(demo).toContain("source: 'product'");
    expect(demo).toContain("pickerTargetRowId ? 'この商品を選ぶ' : '追加'");
    expect(demo).toContain("name: '新しい自由項目'");
  });

  it('編集した同じrowsと合計を見積書・プランボードへ反映する', () => {
    expect(demo).toContain('data-testid="estimate-live-preview"');
    expect(demo).toContain('data-testid="plan-live-preview"');
    expect(demo).toContain('rows.filter((row) => row.section === section)');
    expect(demo).toContain('{formatDisplayYen(totals.saleGrand)}');
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
    expect(demo).toContain('下書き保存');
    expect(demo).toContain('正式保存');
    expect(demo).toContain('Draft→正式Revision接続後に利用できます');
  });
});
