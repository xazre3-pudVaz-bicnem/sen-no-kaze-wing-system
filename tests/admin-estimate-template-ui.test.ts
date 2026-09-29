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
const detailTabs = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-detail-tabs.tsx'),
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

describe('見積書作成・管理UI', () => {
  it('トップを一覧ではなくExcel編集ワークスペースとして表示する', () => {
    expect(listPage).toContain('title="見積書作成・管理"');
    expect(listPage).not.toContain('開いたらすぐ明細を編集できる');
    expect(listPage).not.toContain('見積書を開いたらすぐ、Excelに近い明細編集から作業を始めます。');
    expect(listPage).toContain('＋ 新しい見積書を作成');
    expect(listPage).toContain('見積書一覧（{totalCount}件）');
    expect(listPage).toContain('シミュレーターで選択できる標準見積と、作成済み見積書をここで確認します。');
    expect(listPage).toContain("active ? '表示中' : '開く'");
    expect(listPage).toContain('更新 {formatUpdatedAt(template.updated_at)}');
    expect(listPage).not.toContain('見積書を選ぶ');
    expect(listPage).toContain('編集中の見積書');
    expect(listPage).toContain('<EstimateTemplateWorkbench');
    expect(listPage).toContain('<EstimateTemplateDetailTabs');
    expect(listPage).toContain('<StandardEstimateSimulatorPreview');
    expect(listPage).toContain('selectedTemplate');
    expect(listPage).toContain("templates.find((template) => template.id === sp.estimate)");
    expect(listPage).toContain('returnPath={workspaceReturnPath}');
    expect(listPage).not.toContain('標準見積一覧');
    expect(listPage).not.toContain('登録済み');
  });

  it('見積書が未登録でも空画面ではなく作成画面を直接表示する', () => {
    expect(listPage).toContain('if (!selectedTemplate)');
    expect(listPage).toContain('<EstimateTemplateExcelDemo key={selectedSample?.id ?? \'new-estimate-demo\'} sampleId={selectedSample?.id} />');
    expect(listPage).toContain('正式な見積書データが未登録のため、作成画面を直接表示しています。');
    expect(listPage).not.toContain('見積書がまだありません');
    expect(listPage).toContain('products={demoProducts}');
    expect(listPage).toContain("option.status === 'published'");
    expect(listPage).toContain('categoryCode: categoryMap.get(option.category_id)?.code');
  });

  it('見積書一覧・新規作成・シミュレーター標準指定の入口を編集画面上部に置く', () => {
    expect(listPage).toContain('見積書一覧');
    expect(listPage).toContain('見積書一覧（{totalCount}件）');
    expect(listPage).toContain('シミュレーター標準');
    expect(listPage).toContain('シミュレーターの選択対象');
    expect(listPage).toContain('標準に指定された正式見積書だけを、見積シミュレーターの選択肢に表示します。');
    expect(listPage).toContain('初期表示を決める設定ではありません。');
    expect(listPage).toContain('作成済み見積書');
    expect(listPage).toContain('画面確認用サンプル');
    expect(listPage).toContain('sampleEstimateHref');
    expect(listPage).toContain('selectedSampleId={selectedSample?.id}');
    expect(listPage).toContain('<SavedEstimateMenu');
    expect(listPage).toContain('aria-current={active ? \'page\' : undefined}');
    expect(listPage).toContain('複製');
    expect(listPage).toContain('シミュレーター標準に設定');
    expect(listPage).toContain('正式な複製保存の接続後に利用できます');
    expect(listPage).toContain('シミュレーターの選択対象となる標準指定の接続後に利用できます');
  });

  it('編集・見積書・プランボードを同じ見積書ワークスペースで切り替える', () => {
    expect(detailTabs).toContain("type DetailTab = 'edit' | 'estimate' | 'plan'");
    expect(detailTabs).toContain('aria-label="見積書の表示切替"');
    expect(detailTabs).toContain('編集');
    expect(detailTabs).toContain('見積書');
    expect(detailTabs).toContain('プランボード');
    expect(simulatorPreview).toContain("sampleMode ? '動作確認サンプル' : '選択中の見積書'");
    expect(simulatorPreview).toContain('見積書を編集');
    expect(simulatorPreview).toContain('この見積書を作成');
    expect(simulatorPreview).toContain('aria-label="見積書の確認内容"');
    expect(simulatorPreview).toContain('見積書とプランボードを確認できます');
    expect(simulatorPreview).toContain('<QuoteSheet');
    expect(simulatorPreview).toContain('<PlanBoard');
  });

  it('新規作成画面は前段の設定画面を挟まず直接明細編集を表示する', () => {
    expect(newForm).toContain('data-testid="new-estimate-conditions"');
    expect(newForm).toContain('本体・仕様・適用地域をここで設定し、そのまま下の明細を編集できます。');
    expect(newForm).toContain('使用する本体');
    expect(newForm).toContain('本体が未選択です');
    expect(newForm).toContain('本体を選ぶ');
    expect(newForm).toContain('本体管理元：');
    expect(newForm).toContain('商品モデル');
    expect(newForm).toContain('仕様');
    expect(newForm).toContain('防火仕様');
    expect(newForm).toContain('適用地域');
    expect(newForm).toContain('見積書名');
    expect(newForm).toContain('本体を変更・明細確認');
    expect(newForm).toContain('<EstimateTemplateWorkbench');
    expect(newForm).toContain('new-standard-estimate-preview');
    expect(newForm).toContain('demoMode');
    expect(newForm).not.toContain('StepIndicator');
    expect(newForm).not.toContain("setStep('edit')");
    expect(newForm).not.toContain('明細編集へ進む');
    expect(newForm).not.toContain('本体・条件設定へ戻る');
    expect(newForm).toContain('現在は画面確認用です');
    expect(newForm).toContain('編集内容は保存されません。保存・公開機能は準備中です');
    expect(newForm).toContain('サンプルを表示');
    expect(newForm).toContain('openSampleEditor');
    expect(newForm).toContain("setCustomName('Wing ホテル仕様（画面確認用）')");
    expect(newForm).toContain('initialLines={samplePreview ? SAMPLE_EDIT_LINES : []}');
    expect(newForm).toContain('baseLines={selectedBaseMaster?.lines ?? []}');
    expect(newForm).toContain('baseTotal={selectedBaseMaster?.total ?? 0}');
    expect(newForm).toContain("window.confirm('本体を変更すると、現在表示中の本体明細は選択した本体の内容に置き換わります。変更しますか？')");
    expect(newForm).toContain('この本体を使う');
    expect(newPage).toContain('title="見積書を新規作成"');
    expect(newPage).toContain('label="見積書作成・管理へ戻る"');
    expect(newPage).toContain('本体・仕様・適用地域を画面上部で設定し、そのまま明細を編集できます。');
    expect(newPage).toContain('estimateTemplatesFor(model).map');
    expect(newPage).toContain('loadPublishedBaseMasters()');
    expect(newPage).toContain('BASE_BREAKDOWN_ITEMS');
    expect(newPage).toContain("BASE_BREAKDOWN_TOTALS['wing-01:hotel']");
    expect(newPage).toContain("model.slug === 'wing-01'");
    expect(newPage).toContain("line.model_slug === 'wing-01' && line.spec_code === 'hotel'");
    expect(newPage).toContain('sampleBaseMaster={sampleBaseMaster}');
    expect(newPage).toContain('initialTarget={initialTarget}');
    expect(newPage).toContain("sp.fire === 'fire' || sp.fire === 'non_fire'");
    expect(newForm).toContain('initialTarget?: InitialEstimateTarget | null');
    expect(newForm).toContain('作成対象：');
    expect(newForm).toContain('availableBaseMasters');
    expect(newForm).toContain('initialTarget.specCode');
    expect(newForm).toContain('作成対象の商品モデル・防火仕様に一致する公開中の本体がありません。');
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
    expect(detailPage).toContain('EstimateTemplateDetailTabs');
    expect(detailPage).toContain('StandardEstimateSimulatorPreview');
    expect(detailPage).toContain('store.getCatalogBundle(template.base_model_id)');
    expect(detailPage).toContain('initialContentTab="estimate"');
    expect(detailPage).toContain('initialContentTab="plan"');
    expect(detailPage).toContain('showContentTabs={false}');
    expect(detailPage).toContain('showEditLink={false}');
    expect(detailPage).toContain('previewOnly');
    expect(detailTabs).toContain("type DetailTab = 'edit' | 'estimate' | 'plan'");
    expect(detailTabs).toContain('見積書の表示切替');
    expect(detailTabs).toContain('編集');
    expect(detailTabs).toContain('見積書');
    expect(detailTabs).toContain('プランボード');
    expect(detailTabs).toContain("tab === 'edit' ? 'block' : 'hidden'");
    expect(detailTabs).toContain('未保存変更は');
    expect(simulatorPreview).toContain('initialContentTab?: ContentTab');
    expect(simulatorPreview).toContain('showContentTabs?: boolean');
    expect(simulatorPreview).toContain('showEditLink?: boolean');
    expect(simulatorPreview).toContain('previewOnly?: boolean');
    expect(simulatorPreview).toContain('readOnly={previewOnly}');
    expect(simulatorPreview).toContain('allowStandardEstimateCategoryPick={!previewOnly}');
    expect(simulatorPreview).toContain('変更は「編集」タブで行います');
  });

  it('Excel風の連続表から商品追加・商品変更・自由明細を操作できる', () => {
    expect(workbench).toContain('data-testid="estimate-excel-grid"');
    expect(workbench).toContain('見積書編集');
    expect(workbench).toContain('bg-amber-50/35 px-3 py-1.5');
    expect(workbench).not.toContain('シミュレーター見積書のレイアウトは使用しません');
    expect(workbench).toContain('＋商品');
    expect(workbench).toContain('＋自由明細');
    expect(workbench).toContain('商品台帳から選ぶ');
    expect(workbench).toContain("pickerTargetRowId ? '商品台帳から選択' : '商品を追加'");
    expect(workbench).toContain("pickerTargetRowId ? '変更' : '追加'");
    expect(workbench).toContain('標準・変更可');
    expect(workbench).toContain('標準・固定');
    expect(workbench).toContain('任意オプション');
    expect(workbench).toContain('お客様には表示しない');
  });


  it('品名右側から商品台帳を開き、現在行の商品を置き換えられる', () => {
    expect(workbench).toContain('title="商品台帳から選ぶ"');
    expect(workbench).toContain("openProductPicker(row.section, row.id)");
    expect(workbench).toContain("pickerTargetRowId ? '商品台帳から選択' : '商品を追加'");
    expect(workbench).toContain('商品台帳の公開済み商品から選び、選択した明細行へ反映します。');
    expect(workbench).toContain('row.remark ||');
    expect(workbench).not.toContain('detailProductId');
    expect(workbench).not.toContain('商品詳細を表示');
  });

  it('商品選択は追加先区分に対応するカテゴリーだけを表示する', () => {
    expect(workbench).toContain('SECTION_PRODUCT_CATEGORY_CODES');
    expect(workbench).toContain("'roof'");
    expect(workbench).toContain("'exterior-wall'");
    expect(workbench).toContain("'ub'");
    expect(workbench).toContain("'sitework'");
    expect(workbench).toContain("'free-product'");
    expect(workbench).toContain('allowedCodes.has(product.categoryCode)');
    expect(workbench).toContain('すべてのカテゴリー');
    expect(workbench).not.toContain('この区分のすべてのカテゴリー');
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
    expect(workbench).toContain('flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden');
    expect(workbench).toContain('shrink-0 space-y-3 border-b border-line px-5 py-4');
    expect(workbench).toContain('min-h-0 flex-1 overflow-y-auto p-5 pt-4');
    expect(workbench).toContain('flex items-center gap-3 px-3 py-2');
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

  it('本体明細は管理元のみ案件内編集可とし、管理元判定接続前は参照専用にする', () => {
    expect(workbench).toContain('本体管理元のみ案件内編集可・管理元判定接続前は参照専用');
    expect(workbench).toContain('本体明細は管理元のみ案件内編集可。現在は管理元判定未接続のため参照専用です。');
    expect(workbench).toContain('管理元以外は本体明細を変更できません。');
    expect(workbench).toContain('editable: false');
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
    expect(workbench).toContain('グレー＝参照');
    expect(workbench).toContain('未保存の変更あり');
    expect(workbench).toContain('画面内の変更あり');
    expect(workbench).toContain('初期状態');
    expect(workbench).toContain("demoMode ? '元に戻す' : '編集前に戻す'");
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
    expect(workbench).toContain('Shift+Enter↑');
    expect(workbench).toContain('税込合計');
    expect(workbench).toContain('sticky left-0 z-10');
    expect(workbench).toContain('sticky left-[2.75rem] z-10');
    expect(workbench).toContain('sticky left-[5rem] z-10');
    expect(workbench).toContain('sticky left-[5rem] top-0 z-40');
    expect(workbench).toContain('w-[16rem] min-w-[16rem] max-w-[16rem]');
    expect(workbench).not.toContain('min-w-[20rem]');
    expect(workbench).toContain('colSpan={visibleColumnCount - 3}');
    expect(workbench).toContain('販売費');
    expect(workbench).toContain('経費');
    expect(workbench).toContain('掛率');
    expect(workbench).toContain('粗利率');
    expect(workbench).toContain('aria-label="値引き等調整額"');
    expect(workbench).toContain('salesExpenseRate');
    expect(workbench).toContain('expenseRate');
    expect(workbench).toContain('markupRate');
    expect(workbench).toContain('localAdjustment');
    expect(workbench).toContain('正式計算は未接続');
    expect(workbench).toContain('販売費・経費・掛率は画面内で調整できます。正式計算・保存・公開は準備中です');
    expect(workbench).toContain('min-w-[62rem] w-full border-collapse text-xs');
    expect(workbench).toContain('min-w-[82rem] w-full border-collapse text-xs');
    expect(workbench).toContain('className="h-6 min-h-6');
    expect(workbench).toContain('w-14 px-1 text-right text-xs');
    expect(workbench).toContain('w-20 px-1 text-right text-xs');
    expect(workbench).toContain('className="flex size-5');
    expect(workbench).not.toContain("row.groupLabel || '商品'");
  });

  it('見積テンプレートから商品登録へ移動し、公開後に戻って追加できる', () => {
    expect(workbench).toContain('/admin/options/new?return_to=');
    expect(optionNew).toContain('見積テンプレートの商品追加から移動しています');
    expect(optionNew).toContain('returnTo={returnTo}');
    expect(adminActions).toContain("const returnTo = safeAdminReturnTo(formData.get('return_to'))");
    expect(adminActions).toContain("redirect('/admin/options/' + createdId + '?' + params.toString())");
    expect(adminActions).not.toContain("params.toString() + '#product-main-media'");
    expect(adminActions).toContain("returnUrl.searchParams.set('created_option', id)");
    expect(adminActions).toContain("url.pathname.startsWith('/admin/')");
  });
});
