import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const listPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/page.tsx'),
  'utf8'
);
const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/new/page.tsx'),
  'utf8'
);
const simulatorPreview = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/standard-estimate-simulator-preview.tsx'),
  'utf8'
);
const quoteSheet = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/quote-sheet.tsx'),
  'utf8'
);
const detailPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/[id]/page.tsx'),
  'utf8'
);
const demoPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/demo/page.tsx'),
  'utf8'
);
const newForm = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/new-estimate-template-form.tsx'),
  'utf8'
);
const workbench = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-workbench.tsx'),
  'utf8'
);
const adminForms = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/forms.tsx'),
  'utf8'
);
const optionNew = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'),
  'utf8'
);
const adminActions = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/admin.ts'),
  'utf8'
);

describe('見積テンプレート管理UI', () => {
  it('シミュレーターで選べる標準見積を同じロジックで一覧表示する', () => {
    expect(listPage).toContain('title="標準見積"');
    expect(listPage).toContain('標準見積一覧');
    expect(listPage).toContain('＋ 新規標準見積を作成');
    expect(listPage).toContain('simulatorEstimateChoices');
    expect(listPage).toContain("model.status === 'published'");
    expect(listPage).toContain('store.getEstimateTemplateBundle');
    expect(listPage).toContain('シミュレーターの「仕様を選ぶ」と同じ候補');
    expect(listPage).toContain('防火仕様はシミュレーターでは標準見積とは別のプルダウン');
    expect(listPage).toContain('シミュレーター候補');
    expect(listPage).toContain('登録済み');
    expect(listPage).toContain('シミュレーターで算出');
    expect(listPage).toContain('未登録候補は現行シミュレーターの従来計算へフォールバックします');
    expect(listPage).not.toContain('SAMPLE_WING_ROWS');
    expect(listPage).not.toContain('添付HTMLに合わせた画面見本');
    expect(listPage).toContain('/admin/estimate-templates/demo');
    expect(listPage).toContain('selected_model');
    expect(listPage).toContain('selected_spec');
    expect(listPage).toContain('#estimate-preview');
    expect(listPage).toContain('StandardEstimateSimulatorPreview');
    expect(listPage).toContain('行を選ぶと下に見積書が表示されます');
    expect(listPage).toContain('min-w-[40rem]');
    expect(listPage).toContain('grid-cols-[minmax(9rem,2fr)_4.25rem_5.75rem_7rem_4.25rem_7.5rem]');
    expect(listPage).not.toContain('min-w-[58rem]');
    expect(listPage).toContain('商品モデル');
    expect(listPage).toContain('見積名');
    expect(listPage).toContain('lg:flex-row lg:items-end lg:gap-5');
    expect(listPage).toContain('h-10 min-h-10 w-full px-3 text-sm');
    expect(listPage).toContain('クリア');
  });

  it('選択した標準見積の下にシミュレーターと同じ見積書とプランボードを表示する', () => {
    expect(simulatorPreview).toContain('computeStandardEstimatePricing');
    expect(simulatorPreview).toContain('computePricing');
    expect(simulatorPreview).toContain('buildEstimateBaselineSelection');
    expect(simulatorPreview).toContain('buildPresetSelection');
    expect(simulatorPreview).toContain('<QuoteSheet');
    expect(simulatorPreview).toContain('<PlanBoard');
    expect(simulatorPreview).toContain('<PreviewStage');
    expect(simulatorPreview).toContain('<ElevationStrip');
    expect(simulatorPreview).toContain('<EquipmentBoard');
    expect(simulatorPreview).toContain('<SimulatorCaseImagesProvider');
    expect(simulatorPreview).toContain('VIEW_KEYS.map');
    expect(simulatorPreview).toContain("image.kind === 'case'");
    expect(simulatorPreview).toContain("image.kind === 'elevation'");
    expect(simulatorPreview).toContain('categoriesInScope');
    expect(simulatorPreview).toContain('baselineVariantIds');
    expect(simulatorPreview).toContain('平面図・完成イメージ・立面図・標準設備及び仕上げ表');
    expect(simulatorPreview).toContain('readOnly');
    expect(simulatorPreview).toContain('シミュレーターの標準状態を基準に、商品変更を画面内で試算できます');
    expect(simulatorPreview).toContain('標準見積を編集');
    expect(simulatorPreview).toContain('シミュレーターで確認');
    expect(simulatorPreview).toContain('<OptionPickerDialog');
    expect(simulatorPreview).toContain('allowStandardEstimateCategoryPick');
    expect(simulatorPreview).toContain('画面内試算');
    expect(simulatorPreview).toContain('試算をリセット');
    expect(simulatorPreview).toContain('explainBlocked');
    expect(simulatorPreview).toContain('toggleOption');
    expect(quoteSheet).toContain('allowStandardEstimateCategoryPick');
    expect(quoteSheet).toContain('商品を変更');
    expect(quoteSheet).toContain("category.code === 'ub' ? 'ユニットバス'");
  });

  it('新規作成画面は基準本体を先に選びExcel形式の明細編集へ進める', () => {
    expect(newForm).toContain('▼');
    expect(newForm).toContain('基準本体');
    expect(newForm).toContain('先に基準本体を選びます。商品モデルと防火仕様は、選んだ本体から自動設定されます。');
    expect(newForm).toContain('商品モデル・仕様・防火仕様から自動入力');
    expect(newForm).toContain('現在の本体マスターでは仕様は別項目のため、ここで選択します。');
    expect(newForm).not.toContain('SPEC_OPTIONS');
    expect(newForm).toContain('space-y-4 p-4 sm:p-5');
    expect(newForm).toContain('max-w-[620px]');
    expect(newForm).toContain('キャンセル');
    expect(newForm).toContain("setStep('edit')");
    expect(newForm).toContain('Excel明細編集へ進む');
    expect(newForm).toContain('初期設定へ戻る');
    expect(newForm).toContain('<EstimateTemplateWorkbench');
    expect(newForm).toContain('new-standard-estimate-preview');
    expect(newForm).toContain('demoMode');
    expect(newForm).toContain('現在は画面確認用です');
    expect(newForm).toContain('編集内容は保存されません。保存・公開機能は準備中です');
    expect(newForm).toContain('将来は設置予定地から自動判定する想定です');
    expect(newForm).toContain('基準本体を選ぶ');
    expect(newForm).toContain('明細を見る');
    expect(newForm).toContain('この本体を選択');
    expect(newForm).toContain('適用地域');
    expect(newForm).not.toContain('この段階ではDBに標準見積・下書き・Revisionを作成しません');
    expect(newPage).toContain('title="標準見積を新規作成"');
    expect(newPage).toContain('label="標準見積一覧へ戻る"');
    expect(newPage).toContain('model.presets.map');
    expect(newPage).toContain('loadPublishedBaseMasters()');
    expect(newPage).toContain('store.listOptions()');
    expect(newPage).toContain('store.listCategories()');
    expect(newPage).toContain("option.status === 'published'");
    expect(adminForms).toContain('仕様（推奨構成）');
    expect(adminForms).toContain('見積テンプレートの「仕様」もここから選ばれます');
  });

  it('操作確認用サンプルは保存せずExcel風の主要操作を試せる', () => {
    expect(demoPage).toContain('操作確認用 Wing ホテルUB 非防火');
    expect(demoPage).toContain('EstimateTemplateExcelDemo');
    expect(demoPage).toContain('2026-09-01修正分類表見積書');
    expect(demoPage).toContain('変更内容は保存されません');
  });

  it('詳細画面に4分類と日本語の版運用を置く', () => {
    expect(detailPage).toContain('本体');
    expect(detailPage).toContain('内外装工事');
    expect(detailPage).toContain('オプション');
    expect(detailPage).toContain('別途');
    expect(detailPage).toContain('新しい下書き版を作る');
    expect(detailPage).toContain('複製して新規作成');
  });

  it('Excel風の連続表から商品追加・商品変更・自由明細を操作できる', () => {
    expect(workbench).toContain('data-testid="estimate-excel-grid"');
    expect(workbench).toContain('標準見積編集 ― Excel形式');
    expect(workbench).toContain('シミュレーター見積書のレイアウトは使用しません');
    expect(workbench).toContain('＋商品');
    expect(workbench).toContain('＋自由明細');
    expect(workbench).toContain('商品マスターから選び直す');
    expect(workbench).toContain("pickerTargetRowId ? '商品を変更' : '商品を追加'");
    expect(workbench).toContain("pickerTargetRowId ? '変更' : '追加'");
    expect(workbench).toContain('標準・変更可');
    expect(workbench).toContain('標準・固定');
    expect(workbench).toContain('任意オプション');
    expect(workbench).toContain('お客様には表示しない');
  });

  it('商品選択は追加先区分に対応するカテゴリーだけを表示する', () => {
    expect(workbench).toContain('SECTION_PRODUCT_CATEGORY_CODES');
    expect(workbench).toContain("'roof'");
    expect(workbench).toContain("'exterior-wall'");
    expect(workbench).toContain("'ub'");
    expect(workbench).toContain("'sitework'");
    expect(workbench).toContain("'free-product'");
    expect(workbench).toContain('allowedCodes.has(product.categoryCode)');
    expect(workbench).toContain('この区分のすべてのカテゴリー');
    expect(workbench).toContain('追加先：{pickerSectionLabel}');
    expect(workbench).toContain('カテゴリー：{pickerCategoryName}');
    expect(workbench).toContain('「{pickerSectionLabel}」に分類したカテゴリーの商品だけを表示しています。');
    expect(detailPage).toContain("categoryCode: categoryMap.get(option.category_id)?.code ?? ''");
    expect(newPage).toContain("categoryCode: categoryMap.get(option.category_id)?.code ?? ''");
  });

  it('商品選択はカテゴリ別の折り畳み一覧でコンパクトに比較できる', () => {
    expect(workbench).toContain('pickerProductGroups');
    expect(workbench).toContain('collapsedPickerCategories');
    expect(workbench).toContain('togglePickerCategory');
    expect(workbench).toContain("group.categoryName + 'を開く'");
    expect(workbench).toContain("group.categoryName + 'を閉じる'");
    expect(workbench).toContain('{group.products.length}件');
    expect(workbench).toContain('divide-y divide-line');
    expect(workbench).toContain('size-12 shrink-0');
    expect(workbench).toContain("product.priceOnRequest ? '別途見積' : formatYen(product.price)");
    expect(workbench).not.toContain('grid gap-3 sm:grid-cols-2');
  });

  it('区分を折り畳むと数量1・単位式・区分計を1行で表示する', () => {
    expect(workbench).toContain("data-testid={'estimate-section-summary-' + key}");
    expect(workbench).toContain('const summaryRemark = hasPriceOnRequest');
    expect(workbench).toContain('expenseText ?? \`\${rowCount}行の明細を集約\`;');
    expect(workbench).toContain('>1</td>');
    expect(workbench).toContain('>式</td>');
    expect(workbench).toContain('{formatYen(totalAmount)}');
    expect(workbench).toContain("aria-label={label + 'の明細を開く'}");
    expect(workbench).toContain("aria-label={label + 'の明細を閉じる'}");
  });

  it('別途見積の商品を含む折り畳み区分は0円ではなく別途見積と表示する', () => {
    expect(workbench).toContain('priceOnRequestSections');
    expect(workbench).toContain("row.saleUnitPrice === 0 && row.remark.trim() === '別途見積'");
    expect(workbench).toContain("const collapsedAmountText = hasPriceOnRequest ? '別途見積' : formatYen(totalAmount);");
    expect(workbench).toContain("hasPriceOnRequest: priceOnRequestSections[section.code]");
    expect(workbench).toContain('※別途見積を含むため合計は確定額ではありません。');
  });

  it('実画面でもExcel風の主要操作性を安全な範囲で使える', () => {
    expect(workbench).toContain('data-testid="estimate-workbench-sticky-summary"');
    expect(workbench).toContain('data-testid="estimate-excel-grid"');
    expect(workbench).toContain('売価表');
    expect(workbench).toContain('原価・売価比較（準備中）');
    expect(workbench).toContain('title="正式原価の接続後に利用できます"');
    expect(workbench).toContain('cursor-not-allowed');
    expect(workbench).toContain('品名');
    expect(workbench).toContain('原価金額');
    expect(workbench).toContain('売価金額');
    expect(workbench).toContain('黄色＝入力');
    expect(workbench).toContain('グレー＝参照・自動表示');
    expect(workbench).toContain('未保存の変更あり');
    expect(workbench).toContain('画面内の変更あり');
    expect(workbench).toContain('初期状態');
    expect(workbench).toContain('編集前と同じ');
    expect(workbench).toContain('編集前に戻す');
    expect(workbench).toContain("collapsedSections.has('base')");
    expect(workbench).toContain('toggleSection(key)');
    expect(workbench).toContain("collapsed ? '+' : '−'");
    expect(workbench).toContain('data-estimate-grid-col="quantity"');
    expect(workbench).toContain('handleGridKeyDown');
    expect(workbench).toContain('event.nativeEvent.isComposing');
    expect(workbench).toContain('event.keyCode === 229');
    expect(workbench).toContain("event.key !== 'Enter'");
    expect(workbench).toContain('Shift+Enter＝上へ');
    expect(workbench).toContain('税込合計');
    expect(workbench).toContain('sticky left-0 z-10');
    expect(workbench).toContain('sticky left-[2.75rem] z-10');
    expect(workbench).toContain('sticky left-[5rem] z-10');
    expect(workbench).toContain('sticky left-[5rem] top-0 z-40');
    expect(workbench).toContain('colSpan={visibleColumnCount - 3}');
    expect(workbench).toContain('販売費');
    expect(workbench).toContain('経費');
    expect(workbench).toContain('掛率');
    expect(workbench).toContain('粗利率');
    expect(workbench).toContain('値引き等調整額');
    expect(workbench).toContain('salesExpenseRate');
    expect(workbench).toContain('expenseRate');
    expect(workbench).toContain('markupRate');
    expect(workbench).toContain('localAdjustment');
    expect(workbench).toContain('画面内設定。明細金額への反映は正式原価接続後です');
    expect(workbench).toContain('販売費・経費・掛率は画面内で調整できます。正式計算・保存・公開は準備中です');
    expect(workbench).toContain('min-w-[66rem] w-full border-collapse text-xs');
    expect(workbench).toContain('className="h-7');
    expect(workbench).toContain('className="flex size-6');
    expect(workbench).not.toContain("row.groupLabel || '商品'");
  });

  it('見積テンプレートから商品登録へ移動し、公開後に戻って追加できる', () => {
    expect(workbench).toContain('/admin/options/new?return_to=');
    expect(optionNew).toContain('見積テンプレートの商品追加から移動しています');
    expect(optionNew).toContain('returnTo={returnTo}');
    expect(adminActions).toContain("const returnTo = safeAdminReturnTo(formData.get('return_to'))");
    expect(adminActions).toContain("redirect('/admin/options/' + createdId + '?' + params.toString())");
    expect(adminActions).toContain("returnUrl.searchParams.set('created_option', id)");
    expect(adminActions).toContain("url.pathname.startsWith('/admin/')");
  });
});
