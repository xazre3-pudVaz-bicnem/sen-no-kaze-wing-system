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
    expect(simulatorPreview).toContain('シミュレーターの標準状態と同じ選択内容');
    expect(simulatorPreview).toContain('標準見積を編集');
    expect(simulatorPreview).toContain('シミュレーターで確認');
  });

  it('新規作成画面は選択項目と参照本体を分かりやすくする', () => {
    expect(newForm).toContain('▼');
    expect(newForm).toContain('基準となる本体');
    expect(newForm).toContain('商品モデル・仕様・防火仕様から自動入力');
    expect(newForm).toContain('商品モデルに登録されている仕様を表示します');
    expect(newForm).not.toContain('SPEC_OPTIONS');
    expect(newForm).toContain('max-w-[700px]');
    expect(newForm).toContain('max-w-[600px]');
    expect(newForm).toContain('キャンセル');
    expect(newPage).toContain('model.presets.map');
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

  it('商品追加と自由項目追加、お客様選択設定を確認できる', () => {
    expect(workbench).toContain('＋ 商品から追加');
    expect(workbench).toContain('＋ 自由項目を追加');
    expect(workbench).toContain('標準・変更可');
    expect(workbench).toContain('標準・固定');
    expect(workbench).toContain('任意オプション');
    expect(workbench).toContain('お客様には表示しない');
  });

  it('見積テンプレートから商品登録へ移動して戻れる', () => {
    expect(workbench).toContain('/admin/options/new?return_to=');
    expect(optionNew).toContain('見積テンプレートの商品追加から移動しています');
    expect(optionNew).toContain('returnTo={returnTo}');
    expect(adminActions).toContain("returnUrl.searchParams.set('created_option', createdId)");
    expect(adminActions).toContain("returnUrl.pathname.startsWith('/admin/')");
  });
});
