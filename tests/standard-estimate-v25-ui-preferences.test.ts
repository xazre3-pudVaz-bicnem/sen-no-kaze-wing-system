import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  V25_GRID_COLUMNS,
  V25_GRID_STORAGE_KEY,
  V25ColumnDisplayMenu,
  v25DefaultGridPrefs,
  v25SanitizeGridPrefs,
  v25GridVisible,
  v25GridWidth,
} from '@/components/admin/v25-grid-preferences';
import { v25StepPercent } from '@/lib/domain/standard-estimate-v25-rate-step';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('標準見積v2.5 比率スピナー（画面操作のみ）', () => {
  it('小数2桁を維持したまま1%ずつ増減し、0%未満にはしない', () => {
    expect(v25StepPercent('15', 1)).toBe('16');
    expect(v25StepPercent('15.25', 1)).toBe('16.25');
    expect(v25StepPercent('15.25', -1)).toBe('14.25');
    expect(v25StepPercent('0.25', -1)).toBe('0');
    expect(v25StepPercent('0', -1)).toBe('0');
    expect(v25StepPercent('150', 1)).toBe('151');
    expect(v25StepPercent('1.05', -1)).toBe('0.05');
  });
  it('入力途中の空欄や範囲外の精度を勝手に書き換えない', () => {
    expect(v25StepPercent('', 1)).toBe('');
    expect(v25StepPercent('15.', 1)).toBe('15.');
    expect(v25StepPercent('15.123', 1)).toBe('15.123');
    expect(v25StepPercent('-1', 1)).toBe('-1');
  });
  it('設定は既存の%→率変換だけを使い、キーボードと▲▼で同じ操作を呼ぶ', () => {
    const src = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(src).toContain('stepRate(key, event.key ===');
    expect(src).toContain('stepRate(key, 1)');
    expect(src).toContain('stepRate(key, -1)');
    expect(src).toContain('percentToRate(value)');
    expect(src).toContain('data-testid="v25-wb-compact-settings"');
    expect(src).toContain('v25-wb-adjustment-reason');
    expect(src).toContain('inputMode="decimal"');
    expect(src).toContain('if (event.nativeEvent.isComposing');
  });
});

describe('標準見積v2.5 列表示と幅のブラウザー設定', () => {
  it('初期値は#667の圧縮幅で10列、固定列5件を必ず表示', () => {
    const prefs = v25DefaultGridPrefs();
    expect(V25_GRID_COLUMNS).toHaveLength(10);
    expect(V25_GRID_COLUMNS.filter((c) => c.locked).map((c) => c.id)).toEqual(['name', 'quantity', 'unit', 'sale_amount', 'actions']);
    expect(v25GridWidth(prefs)).toBe(1092);
    expect(Math.ceil(v25GridWidth(prefs) / 16) * 16).toBe(1104);
    expect(V25_GRID_COLUMNS.every((c) => prefs.visible[c.id])).toBe(true);
    expect(V25_GRID_STORAGE_KEY).toContain('v25');
  });
  it('保存値の破損や固定列の非表示操作を無害化する', () => {
    const prefs = v25SanitizeGridPrefs({
      visible: { name: false, quantity: false, cost_unit: false, note: false, actions: false, unknown: true },
      widths: { name: -999, quantity: 123.456, cost_unit: 100000, actions: 30, gross: '999' },
    });
    expect(v25GridVisible(prefs, 'name')).toBe(true);
    expect(v25GridVisible(prefs, 'quantity')).toBe(true);
    expect(v25GridVisible(prefs, 'actions')).toBe(true);
    expect(v25GridVisible(prefs, 'cost_unit')).toBe(false);
    expect(v25GridVisible(prefs, 'note')).toBe(false);
    expect(prefs.widths.name).toBe(180);
    expect(prefs.widths.quantity).toBe(123);
    expect(prefs.widths.cost_unit).toBe(640);
    expect(prefs.widths.actions).toBe(64);
    expect(prefs.widths.gross).toBe(92);
    expect(v25SanitizeGridPrefs(null)).toEqual(v25DefaultGridPrefs());
  });
  it('旧「原価を表示」を列メニュー内へ統合し、個別切替・全表示・初期値復元を備える', () => {
    const html = renderToStaticMarkup(createElement(V25ColumnDisplayMenu, {
      prefs: v25DefaultGridPrefs(),
      setVisible: () => undefined,
      setCostVisible: () => undefined,
      showAll: () => undefined,
      reset: () => undefined,
    }));
    expect(html).toContain('data-testid="v25-grid-column-menu"');
    expect(html).toContain('原価を表示');
    expect(html).toContain('すべて表示');
    expect(html).toContain('初期状態に戻す');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(11);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(5);
    expect(html).toContain('data-testid="v25-grid-visible-sale_unit"');
  });
  it('保存するのはブラウザー設定だけで、Revision/見積payloadを変えない', () => {
    const prefs = read('components/admin/v25-grid-preferences.tsx');
    const src = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(prefs).toContain('window.localStorage.getItem(V25_GRID_STORAGE_KEY)');
    expect(prefs).toContain('window.localStorage.setItem(V25_GRID_STORAGE_KEY');
    expect(prefs).toContain('if (!hydrated) return;');
    expect(src).toContain('const columnCount = displayedColumns.length;');
    expect(src).toContain('colSpan={beforeSaleAmount}');
    expect(src).toContain('colSpan={afterSaleAmount}');
    expect(src).toContain('headerLayoutKey');
    expect(src).toContain('sourceHead.cloneNode(true)');
    expect(src).toContain('overlay.scrollLeft = grid.scrollLeft');
    expect(src).toContain('style={{ minWidth:');
    expect(src).toContain('onResizeStart={columnPrefs.startResize}');
    expect(src).toContain('onAutoWidth={autoWidth}');
    expect(src).toContain('sticky right-0');
    expect(src).toContain('payload: buildV25SavePayload(state)');
    expect(src).not.toContain('buildV25SavePayload(columnPrefs');
  });
});
