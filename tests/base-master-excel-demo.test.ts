import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/base-masters/demo/page.tsx'),
  'utf8'
);
const listPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/base-masters/page.tsx'),
  'utf8'
);
const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-excel-demo.tsx'),
  'utf8'
);

const matrixKeys = [
  'roofExterior',
  'interior',
  'entranceDoor',
  'sash',
  'bath',
  'kitchen',
  'washbasin',
  'toilet',
  'boiler',
  'entranceStorage',
  'interiorDoor',
  'closet',
  'bed',
  'furnishings',
  'other',
] as const;

function matrixRowBlock(id: string) {
  const start = demo.indexOf(`id: '${id}'`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = demo.indexOf("\n  {\n    id: 'matrix-", start + 1);
  const fallback = demo.indexOf('\n];\n\nconst cloneMatrixRows', start);
  const end = next >= 0 ? next : fallback;
  expect(end).toBeGreaterThan(start);
  return demo.slice(start, end);
}

function expectMatrixRow(
  id: string,
  purpose: string,
  fireSelectable: boolean,
  values: readonly boolean[]
) {
  const block = matrixRowBlock(id);
  expect(block).toContain(`purpose: '${purpose}'`);
  expect(block).toContain(`fireSelectable: ${fireSelectable}`);
  expect(values).toHaveLength(matrixKeys.length);
  matrixKeys.forEach((key, index) => {
    expect(block).toContain(`${key}: ${values[index]}`);
  });
}

describe('本体マスター 画面確認用サンプル', () => {
  it('本体マスター一覧からDB非連動の確認画面を開ける', () => {
    expect(listPage).toContain('/admin/base-masters/demo');
    expect(listPage).toContain('サンプル単独表示');
    expect(page).toContain('BaseMasterExcelDemo');
    expect(page).toContain('変更内容は保存されません');
    expect(page).toContain('DB非連動');
  });

  it('本体マスターは基準原価だけの明細列を表示する', () => {
    expect(demo).toContain('>品名<');
    expect(demo).toContain('>数量<');
    expect(demo).toContain('>単位<');
    expect(demo).toContain('>基準原価単価<');
    expect(demo).toContain('>原価金額<');
    expect(demo).toContain('>備考<');
    expect(demo).not.toContain('>売価<');
    expect(demo).not.toContain('>売価金額<');
    expect(demo).not.toContain('>粗利<');
    expect(demo).not.toContain('販売費率');
    expect(demo).not.toContain('経費率');
    expect(demo).not.toContain('掛率');
  });

  it('構成一覧とRevision状態を確認できる', () => {
    expect(demo).toContain('1. 構成一覧');
    expect(demo).toContain('Published');
    expect(demo).toContain('Draft');
    expect(demo).toContain('過去Revision');
    expect(demo).toContain('行を選択すると、下のBase Master詳細が切り替わります');
  });

  it('Base Master詳細は構造・製造の基準原価と本体図面だけを扱う', () => {
    expect(demo).toContain('2. Base Master詳細');
    expect(demo).toContain('本体基準図面（サンプル枠）');
    expect(demo).toContain('構造図');
    expect(demo).toContain('骨組み図');
    expect(demo).toContain('製造用図面');
    expect(demo).toContain('本体基準寸法図');
    expect(demo).toContain('お客様向け平面図・立面図・完成パースはここに置きません');
    expect(demo).toContain('売価・粗利等はStandard Estimate側');
  });

  it('仕様マトリクスは15 Matrix Itemと確定6行を表示する', () => {
    expect(demo).toContain('3. 仕様マトリクス');
    expect(demo).toContain('6行 × 15 Matrix Item = 90 selectableセル');
    for (const label of [
      '屋根・外壁', '内装', '玄関ドア', 'サッシ', 'UB / シャワー', 'キッチン', '洗面', 'トイレ',
      '給湯器', '玄関収納', '室内建具', 'クローゼット', 'ベッド', '備品', 'その他',
    ]) {
      expect(demo).toContain(`label: '${label}'`);
    }
    expect(demo).toContain("purpose: '水回りBOX'");
    expect(demo).toContain("model: 'Flat'");
    expect(demo).toContain("purpose: '事務所用'");
    expect(demo).not.toContain("purpose: '物置仕様'");
    expect(demo).not.toContain('hotel-single');
  });

  it('90 selectableセルとfire_selectableを確定seedに合わせる', () => {
    expectMatrixRow(
      'matrix-wing-hotel',
      'ホテル仕様',
      true,
      [true, true, true, true, true, false, true, true, true, true, true, false, true, true, true]
    );
    expectMatrixRow(
      'matrix-wing-residence',
      '住居仕様',
      true,
      [true, true, true, true, true, true, true, true, true, true, true, false, true, true, true]
    );
    expectMatrixRow(
      'matrix-wing-office',
      '事務所仕様',
      true,
      [true, true, true, true, true, true, false, true, true, false, false, false, false, true, true]
    );
    expectMatrixRow(
      'matrix-box-hotel',
      'ホテル仕様',
      true,
      [true, true, true, true, true, false, true, true, true, true, true, false, true, true, true]
    );
    expectMatrixRow(
      'matrix-box-water-kit',
      '水回りBOX',
      true,
      [true, true, true, true, true, true, true, true, true, false, false, false, false, false, false]
    );
    expectMatrixRow(
      'matrix-flat-office',
      '事務所用',
      false,
      [true, true, true, true, false, false, false, false, false, false, false, false, false, false, false]
    );
  });

  it('非防火と防火を同時表示し、防火は別のfire_selectableとして扱う', () => {
    expect(demo).toContain('>非防火<');
    expect(demo).toContain('>防火<');
    expect(demo).toContain('非防火：全行利用可');
    expect(demo).toContain('fireSelectable');
    expect(demo).not.toContain('matrixFireSpec');
    expect(demo).toContain("{row.fireSelectable ? '利用可' : '対象外'}");
  });

  it('仕様マトリクスだけをローカルmockで編集・保存・キャンセルできる', () => {
    expect(demo).toContain('画面確認用サンプル。変更はDBへ保存されません。');
    expect(demo).toContain('toggleMatrixItem');
    expect(demo).toContain('toggleFireSelectable');
    expect(demo).toContain('saveMatrixMock');
    expect(demo).toContain('cancelMatrixEdit');
    expect(demo).toContain('>編集<');
    expect(demo).toContain('>保存<');
    expect(demo).toContain('>キャンセル<');
    expect(demo).not.toContain('supabase');
    expect(demo).not.toContain('saveBaseMasterDraftAction');
    expect(demo).not.toContain('publishBaseMasterDraftAction');
  });

  it('Matrix Itemと商品Categoryを混同する説明を使わない', () => {
    expect(demo).toContain('Standard Estimate側で各仕様項目を選択可能とするか');
    expect(demo).toContain('Matrix Itemと商品Categoryは別概念');
    expect(demo).not.toContain('Standard Estimate側の商品カテゴリーを選択できるか');
  });
});
