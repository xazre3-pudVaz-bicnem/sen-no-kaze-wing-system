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
  it('デモ画面をExcel照合版へ切り替える', () => {
    expect(page).toContain('EstimateTemplateExcelDemo');
    expect(page).toContain('2026-09-01修正分類表見積書');
    expect(page).toContain('変更内容は保存されません');
  });

  it('原価・売価・比較の3タブとExcel照合ルールを表示する', () => {
    expect(demo).toContain('原価表');
    expect(demo).toContain('売価表');
    expect(demo).toContain('原価・売価比較');
    expect(demo).toContain('ROUNDDOWN(原価単価×掛率,0)');
    expect(demo).toContain('粗利＝売価税込合計－原価税込合計');
  });

  it('折り畳み・自動手動・別途見積・一括再計算の安全操作を持つ', () => {
    expect(demo).toContain('掛率から売価を再計算');
    expect(demo).toContain('直前の再計算を元に戻す');
    expect(demo).toContain('別途見積にする');
    expect(demo).toContain("row.manualSale ? '手動' : '自動'");
    expect(demo).toContain("isCollapsed ? '+' : '−'");
  });

  it('IME変換中のEnterをセル移動に使わない', () => {
    expect(demo).toContain('event.nativeEvent.isComposing');
    expect(demo).toContain('event.keyCode === 229');
  });
});
