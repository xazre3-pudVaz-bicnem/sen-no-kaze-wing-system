import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/demo/page.tsx'),
  'utf8'
);
const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-excel-demo.tsx'),
  'utf8'
);

describe('見積書作成 Excel風操作確認画面', () => {
  it('DB非連動の操作確認画面として表示する', () => {
    expect(page).toContain('EstimateTemplateExcelDemo');
    expect(page).toContain('2026-09-01修正分類表見積書');
    expect(page).toContain('変更内容は保存されません');
    expect(page).toContain('DB非連動');
    expect(page).not.toContain('getStore');
  });

  it('本体マスターと同じ原価・売価・粗利の列構成を使う', () => {
    expect(demo).toContain('>品名<');
    expect(demo).toContain('>数量<');
    expect(demo).toContain('>単位<');
    expect(demo).toContain('>原価<');
    expect(demo).toContain('>原価金額<');
    expect(demo).toContain('>売価<');
    expect(demo).toContain('>売価金額<');
    expect(demo).toContain('>粗利<');
    expect(demo).toContain('>備考<');
    expect(demo).not.toContain('原価表');
    expect(demo).not.toContain('売価表');
    expect(demo).not.toContain('原価・売価比較');
  });

  it('本体マスターを壊さず、この見積書内の本体明細も編集できる', () => {
    expect(demo).toContain('本体マスター自体は変更せず、この見積書内の明細を編集します。');
    expect(demo).toContain('本体マスターから読込・この見積内で編集可');
    expect(demo).toContain('/admin/base-masters/demo');
    expect(demo).toContain('onClick={() => addFreeRow(section)}');
    expect(demo).not.toContain("const readOnly = section === '本体'");
    expect(demo).not.toContain('本体マスター参照・読取専用');
    expect(demo).not.toContain('本体明細は見積テンプレート側では直接変更しません');
    expect(demo).toContain('内外装工事');
    expect(demo).toContain('オプション');
    expect(demo).toContain('別途');
  });

  it('折り畳み・掛率再計算・別途見積・商品追加を画面内で試せる', () => {
    expect(demo).toContain('売価を再計算');
    expect(demo).toContain('別途見積');
    expect(demo).toContain('商品を追加');
    expect(demo).toContain("row.manualSale ? '手動' : '自動'");
    expect(demo).toContain("isCollapsed ? '+' : '−'");
    expect(demo).toContain('下書き保存');
  });

  it('見積条件と価格設定を分け、技術の杜のExcelと同じ用語で表示する', () => {
    expect(demo).toContain('見積条件');
    expect(demo).toContain('価格設定');
    expect(demo).toContain('販売費');
    expect(demo).toContain('原価側');
    expect(demo).toContain('経費');
    expect(demo).toContain('区分に加算');
    expect(demo).toContain('掛率');
    expect(demo).toContain('原価→売価');
    expect(demo).toContain('売価を再計算');
    expect(demo).toContain('aria-label="経費率"');
    expect(demo).toContain('aria-label="掛率"');
    expect(demo).toContain('選択中');
    expect(demo).not.toContain('売価倍率');
    expect(demo).not.toContain('売価諸費用');
  });

  it('保存操作は本番の最終形だけを表示し、接続前は実行できない', () => {
    expect(demo).toContain('下書き保存');
    expect(demo).toContain('正式保存');
    expect(demo).toContain('Draft接続後に利用できます');
    expect(demo).toContain('Draft→正式Revision接続後に利用できます');
    expect(demo).toContain("{dirty ? '編集中' : '下書き'}");
    expect(demo).not.toContain('編集内容を一時保持');
    expect(demo).not.toContain('一時保持時点に戻す');
    expect(demo).not.toContain('一時保持済み');
    expect(demo).not.toContain('正式保存（接続後）');
    expect(demo).not.toContain('下書きを破棄（接続後）');
    expect(demo).not.toContain('画面内でDraft保存');
    expect(demo).not.toContain('Draftの操作');
  });

  it('表を従来よりコンパクトな横幅で表示する', () => {
    expect(demo).toContain('min-w-[76rem] border-collapse text-sm');
    expect(demo).toContain('min-w-[16rem]');
    expect(demo).not.toContain('min-w-[88rem] border-collapse text-sm');
    expect(demo).not.toContain('min-w-[20rem]');
  });

  it('見積書に編集とプレビューをまとめ、プランボード・図面と3タブにする', () => {
    expect(demo).toContain("type DemoTab = 'estimate' | 'plan' | 'drawing'");
    expect(demo).toContain("useState<DemoTab>('estimate')");
    expect(demo).toContain('aria-label="見積書作成の表示切替"');
    expect(demo).toContain("['estimate', '見積書']");
    expect(demo).toContain("['plan', 'プランボード']");
    expect(demo).toContain("['drawing', '図面']");
    expect(demo).not.toContain("['edit', '編集']");
    expect(demo).toContain('見積書プレビュー');
    expect(demo).toContain('プレビューを閉じる');
    expect(demo).toContain('showEstimatePreview');
    expect(demo).toContain('data-testid="estimate-live-preview"');
    expect(demo).toContain('data-testid="plan-live-preview"');
    expect(demo).toContain('data-testid="drawing-workspace-preview"');
  });

  it('IME変換中のEnterをセル移動に使わない', () => {
    expect(demo).toContain('event.nativeEvent.isComposing');
    expect(demo).toContain('event.keyCode === 229');
    expect(demo).toContain("event.key === 'Tab'");
    expect(demo).toContain("event.key === 'Enter'");
  });
});
