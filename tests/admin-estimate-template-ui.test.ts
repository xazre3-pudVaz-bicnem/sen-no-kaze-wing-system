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
  it('標準見積一覧を統合HTMLに近い構成で表示する', () => {
    expect(listPage).toContain('title="標準見積"');
    expect(listPage).toContain('標準見積一覧');
    expect(listPage).toContain('＋ 新規標準見積を作成');
    expect(listPage).toContain('すべて');
    expect(listPage).toContain('const visibleModels = models;');
    expect(listPage).toContain('見積名を検索');
    expect(listPage).toContain('<Th>見積名</Th>');
    expect(listPage).toContain('<Th>防火</Th>');
    expect(listPage).toContain('<Th right>原価税込</Th>');
    expect(listPage).toContain('<Th right>売価税込</Th>');
    expect(listPage).toContain('<Th right>粗利率</Th>');
    expect(listPage).toContain('<Th>状態</Th>');
    expect(listPage).toContain('旧取込');
    expect(listPage).toContain('新しい標準見積Revision基盤との接続後に表示します');
    expect(listPage).toContain('SAMPLE_ESTIMATE_GROUPS');
    expect(listPage).toContain("name: 'Wing'");
    expect(listPage).toContain("name: 'BOX'");
    expect(listPage).toContain("name: 'Flat'");
    expect(listPage).toContain('cost: 991100, sale: 1487200');
    expect(listPage).toContain('cost: 4978600, sale: 7389800');
    expect(listPage).toContain('cost: 3217500, sale: 5085300');
    expect(listPage).toContain('cost: 1324400, sale: 1732500');
    expect(listPage).toContain('20260901修正分類表見積書(20260923-023847).xlsx');
    expect(listPage).toContain('14見積シートを画面見本として表示しています');
    expect(listPage).toContain('販売費100%・経費15%・掛率150%');
    expect(listPage).toContain('状態はExcelにRevision情報がないため「—」');
    expect(listPage).toContain('/admin/estimate-templates/demo');
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
