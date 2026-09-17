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

describe('本体マスター Excel風操作確認画面', () => {
  it('本体マスター一覧からDB非連動の確認画面を開ける', () => {
    expect(listPage).toContain('/admin/base-masters/demo');
    expect(listPage).toContain('操作確認用サンプル');
    expect(page).toContain('BaseMasterExcelDemo');
    expect(page).toContain('変更内容は保存されません');
    expect(page).toContain('DB非連動');
  });

  it('見積テンプレートと同じ列構成を使う', () => {
    expect(demo).toContain('>品名<');
    expect(demo).toContain('>数量<');
    expect(demo).toContain('>単位<');
    expect(demo).toContain('>原価<');
    expect(demo).toContain('>原価金額<');
    expect(demo).toContain('>売価<');
    expect(demo).toContain('>売価金額<');
    expect(demo).toContain('>粗利<');
    expect(demo).toContain('>備考<');
  });

  it('画面内だけで行・区分編集、折り畳み、保存時点への復帰を試せる', () => {
    expect(demo).toContain('工事区分を追加');
    expect(demo).toContain('＋明細');
    expect(demo).toContain('保存時点に戻す');
    expect(demo).toContain('画面内でDraft保存');
    expect(demo).toContain("isCollapsed ? '+' : '−'");
    expect(demo).toContain('UI確認版のため、公開・破棄は実行しません');
  });

  it('Excel風キーボード操作とIMEガードを持つ', () => {
    expect(demo).toContain('event.nativeEvent.isComposing');
    expect(demo).toContain('event.keyCode === 229');
    expect(demo).toContain("event.key === 'Tab'");
    expect(demo).toContain("event.key === 'Enter'");
  });
});
