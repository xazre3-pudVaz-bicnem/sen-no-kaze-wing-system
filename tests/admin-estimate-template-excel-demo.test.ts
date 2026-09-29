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

  it('本体マスターの編集ルール説明は常時表示せず、見積条件から本体を確認できる', () => {
    expect(demo).not.toContain('本体明細は本体管理元のみ、この見積書内で編集できます。');
    expect(demo).not.toContain('見積内の変更は本体マスターには反映しません。');
    expect(demo).toContain('使用中の本体');
    expect(demo).toContain('本体管理元のみ、この見積内で編集可');
    expect(demo).not.toContain('/admin/base-masters/demo');
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
    expect(demo).toContain("aria-label={section + 'を展開'}");
    expect(demo).toContain("data-testid={`estimate-demo-section-total-${section}`}");
    expect(demo).toContain('商品台帳から選択');
    expect(demo).toContain('⋯');
    expect(demo).toContain('下書きを保存');
  });

  it('見積条件と価格設定を上下2段で分け、技術の杜のExcelと同じ用語で表示する', () => {
    expect(demo).toContain('data-testid="estimate-demo-header-summary"');
    expect(demo).toContain('見積条件');
    expect(demo).toContain('価格設定');
    expect(demo).toContain('divide-y divide-slate-200');
    expect(demo).not.toContain('grid md:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]');
    expect(demo).toContain('適用地域');
    expect(demo).toContain('使用中の本体');
    expect(demo).toContain('販売費');
    expect(demo).toContain('原価側');
    expect(demo).toContain('経費');
    expect(demo).toContain('区分に加算');
    expect(demo).toContain('掛率');
    expect(demo).toContain('原価→売価');
    expect(demo).toContain('売価を再計算');
    expect(demo).toContain('aria-label="経費率"');
    expect(demo).toContain('aria-label="掛率"');
    expect(demo).not.toContain('選択中');
    expect(demo).not.toContain('売価倍率');
    expect(demo).not.toContain('売価諸費用');
  });

  it('保存操作は本番の最終形だけを表示し、接続前は実行できない', () => {
    expect(demo).toContain('下書きを保存');
    expect(demo).toContain('正式保存');
    expect(demo).toContain('Draft接続後に利用できます');
    expect(demo).toContain('Draft→正式Revision接続後に利用できます');
    expect(demo).toContain("{dirty ? (sample ? 'サンプル編集中' : '編集中') : (sample ? 'サンプル' : '下書き')}");
    expect(demo).not.toContain('編集内容を一時保持');
    expect(demo).not.toContain('一時保持時点に戻す');
    expect(demo).not.toContain('一時保持済み');
    expect(demo).not.toContain('正式保存（接続後）');
    expect(demo).not.toContain('下書きを破棄（接続後）');
    expect(demo).not.toContain('画面内でDraft保存');
    expect(demo).not.toContain('Draftの操作');
  });

  it('見積条件と重複する本体マスター案内・セル選択表示を明細上部から外す', () => {
    expect(demo).not.toContain('本体マスターから読み込み済み：');
    expect(demo).not.toContain('本体マスターの操作確認画面を開く');
    expect(demo).not.toContain('セルを選択すると内容を表示します');
    expect(demo).not.toContain('setSelectedCell');
    expect(demo).not.toContain("import Link from 'next/link'");
  });

  it('PC表示では横スクロールに頼らず、金額列と操作列をコンパクトに収める', () => {
    expect(demo).toContain('data-testid="estimate-demo-fit-table"');
    expect(demo).toContain('w-full table-fixed border-collapse text-[11px]');
    expect(demo).toContain('<col className="w-[19%]" />');
    expect(demo).toContain('<col className="w-[11%]" />');
    expect(demo).toContain('<col className="w-[5%]" />');
    expect(demo).toContain('whitespace-nowrap border-r border-slate-200 bg-slate-50');
    expect(demo).not.toContain('max-h-[68vh] overflow-auto');
    expect(demo).not.toContain('min-w-[76rem] border-collapse text-sm');
    expect(demo).not.toContain('w-36 min-w-36');
  });

  it('行操作は三点メニューへまとめ、商品選択・別途見積・削除を開ける', () => {
    expect(demo).toContain('data-testid={`estimate-demo-row-menu-${row.id}`}');
    expect(demo).toContain('aria-label={row.name + \'の操作\'}');
    expect(demo).toContain('⋯');
    expect(demo).toContain('商品台帳から選択');
    expect(demo).toContain("row.priceOnRequest ? '金額入力に戻す' : '別途見積にする'");
    expect(demo).toContain('行を削除');
    expect(demo).not.toContain('title="商品台帳から選択"');
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
  it('品名右側から商品台帳を開き、自由明細も商品へ置き換えられる', () => {
    expect(demo).toContain('title="商品台帳から選ぶ"');
    expect(demo).toContain("openProductPicker(section as Exclude<Section, '本体'>, row.id)");
    expect(demo).toContain("pickerTargetRowId ? '商品台帳から選択' : '商品を追加'");
    expect(demo).toContain('商品台帳の公開済み商品から選び、現在の明細行へ反映します。');
    expect(demo).not.toContain('detailProductId');
    expect(demo).not.toContain('商品詳細を表示');
  });

  it('見積書タブ直下の説明文は表示しない', () => {
    expect(demo).not.toContain('見積書を編集し、同じ内容をプランボード・図面にも反映します。');
  });

  it('親画面から渡された公開済み商品台帳を優先して表示する', () => {
    expect(demo).toContain('products?: EstimateTemplateExcelDemoProduct[]');
    expect(demo).toContain('products && products.length > 0 ? products : DEMO_PRODUCTS');
    expect(demo).toContain('SECTION_PRODUCT_CATEGORY_CODES[pickerSection]');
    expect(demo).toContain('allowedCodes.has(product.categoryCode)');
  });

});
