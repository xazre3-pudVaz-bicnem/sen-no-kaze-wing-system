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

describe('見積テンプレート Excel風操作確認画面', () => {
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

  it('本体は参照専用、その他は編集用として分ける', () => {
    expect(demo).toContain('本体マスター参照・読取専用');
    expect(demo).toContain('本体明細は見積テンプレート側では直接変更しません');
    expect(demo).toContain('/admin/base-masters/demo');
    expect(demo).toContain('内外装工事');
    expect(demo).toContain('オプション');
    expect(demo).toContain('別途');
  });

  it('商品名セルから商品変更でき、新規商品追加とは区別する', () => {
    expect(demo).toContain('商品を選択・変更');
    expect(demo).toContain('replaceRowId');
    expect(demo).toContain('setReplaceRowId(row.id)');
    expect(demo).toContain("replaceRowId ? '商品を変更' : '商品を追加'");
    expect(demo).toContain("replaceRowId ? 'この商品に変更' : '追加'");
    expect(demo).toContain('＋商品');
    expect(demo).toContain('chooseProduct');
  });

  it('折り畳み・掛率再計算・Undo・別途見積を画面内で試せる', () => {
    expect(demo).toContain('掛率から売価を再計算');
    expect(demo).toContain('直前の再計算を元に戻す');
    expect(demo).toContain('setUndoRows(cloneRows(rows))');
    expect(demo).toContain('previousSale');
    expect(demo).toContain('previousManualSale');
    expect(demo).toContain("row.manualSale ? '手動' : '自動'");
    expect(demo).toContain("isCollapsed ? '+' : '−'");
    expect(demo).toContain("isCollapsed ? '1' : ''");
    expect(demo).toContain("isCollapsed ? '式' : ''");
    expect(demo).toContain('画面内でDraft保存');
  });

  it('IME変換中のEnterをセル移動に使わない', () => {
    expect(demo).toContain('event.nativeEvent.isComposing');
    expect(demo).toContain('event.keyCode === 229');
    expect(demo).toContain("event.key === 'Tab'");
    expect(demo).toContain("event.key === 'Enter'");
  });
});
