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
  });

  it('構成一覧とRevision状態を確認できる', () => {
    expect(demo).toContain('1. 構成一覧');
    expect(demo).toContain('Published');
    expect(demo).toContain('Draft');
    expect(demo).toContain('過去Revision');
    expect(demo).toContain('行を選択すると、下のBase Master詳細が切り替わります');
  });

  it('Base Master詳細は構造・製造の基準原価だけを扱う', () => {
    expect(demo).toContain('2. Base Master詳細');
    expect(demo).toContain('本体基準図面（サンプル枠）');
    expect(demo).toContain('構造図');
    expect(demo).toContain('骨組み図');
    expect(demo).toContain('本体基準寸法図');
    expect(demo).toContain('売価・粗利等はStandard Estimate側');
  });

  it('仕様マトリクスは防火を別条件として切り替える', () => {
    expect(demo).toContain('3. 仕様マトリクス');
    expect(demo).toContain('防火条件');
    expect(demo).toContain("setMatrixFireSpec(fireSpec)");
    expect(demo).toContain('屋根・外壁');
    expect(demo).toContain('内装');
    expect(demo).toContain('玄関ドア');
    expect(demo).toContain('サッシ');
    expect(demo).toContain('UB');
    expect(demo).toContain('キッチン');
    expect(demo).toContain('洗面');
    expect(demo).toContain('トイレ');
    expect(demo).toContain('収納');
    expect(demo).toContain('ベッド');
    expect(demo).toContain('備品');
  });

  it('画面確認用サンプルでは保存・公開・Revision操作を行わない', () => {
    expect(demo).toContain('画面確認用サンプル');
    expect(demo).toContain('DBへの保存・公開・Revision操作は行いません');
    expect(demo).toContain('表示のみ・操作未接続');
    expect(demo).not.toContain('下書きを保存');
    expect(demo).not.toContain('この内容で公開');
    expect(demo).not.toContain('工事区分を追加');
  });
});
