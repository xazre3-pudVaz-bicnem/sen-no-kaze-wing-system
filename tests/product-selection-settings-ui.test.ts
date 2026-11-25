import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('商品選択設定のExcel型1画面・工程A', () => {
  it('2タブを廃止し、仕様別表と共通表示を同じページに配置する', () => {
    const page = read('app/admin/categories/page.tsx');
    expect(page).toContain('id="matrix-settings"');
    expect(page).toContain('id="customer-visibility"');
    expect(page).toContain('<SelectionMatrixPanel');
    expect(page).toContain('<CustomerCategoryVisibilityPanel');
    expect(page).not.toContain('<ProductSelectionSettingsTabs');
    expect(page).not.toContain('key={initialTab}');
    expect(page).toContain("requireStaff('/admin/categories')");
    expect(page).toContain("hasRoleAtLeast(actor.role, 'master_dealer')");
    expect(page).toContain("const canEditMatrix = actor.role === 'admin'");
    const legacy = read('app/admin/matrix/page.tsx');
    expect(legacy).toContain("await requireAdmin('/admin/matrix')");
    expect(legacy).toContain("redirect('/admin/categories?tab=matrix')");
  });

  it('一覧はすべての有効行を表示し、Excel型の動的チェック列（防火＋有効な項目）と検索を備える', () => {
    const matrix = read('components/admin/selection-matrix-panel.tsx');
    expect(matrix).toContain('data-testid="matrix-excel-grid"');
    expect(matrix).toContain('data-testid="matrix-excel-row"');
    expect(matrix).toContain('data-testid="matrix-excel-cell"');
    expect(matrix).toContain('max-h-[70vh] overflow-auto');
    expect(matrix).toContain('sticky top-0');
    expect(matrix).toContain('sticky left-0');
    expect(matrix).toContain('activeItems.map((item) =>');
    expect(matrix).toContain('draft.fire');
    expect(matrix).toContain('modelFilter');
    expect(matrix).toContain('specFilter');
    expect(matrix).toContain('sizeFilter');
    expect(matrix).toContain('showRetired');
    expect(matrix).toContain('showRetired || row.status');
    expect(matrix).toContain('対応 {mapped.length} 件');
    expect(matrix).not.toContain('matrix-item-row');
    expect(matrix).not.toContain('const chooseRow =');
  });

  it('編集権限・行別保存と破棄・停止再開・版番号競合・ドラフト復元を維持する', () => {
    const matrix = read('components/admin/selection-matrix-panel.tsx');
    const categories = read('components/admin/customer-category-visibility-panel.tsx');
    expect(matrix).toContain('expected_lock_version: changes.lockVersion');
    expect(matrix).toContain('setMatrixRowStatusAction');
    expect(matrix).toContain('createMatrixRowAction');
    expect(matrix).toContain('disabled={locked}');
    expect(matrix).toContain('const staleDraft = draft.lockVersion !== row.lock_version');
    expect(matrix).toContain('rows.filter(isDirty).length');
    expect(matrix).toContain('restoreMatrixSettingsDrafts(window.sessionStorage.getItem(draftKey), initialRows)');
    expect(matrix).toContain('window.sessionStorage.setItem(draftKey, serializeMatrixSettingsDrafts({ drafts, selectedId }))');
    expect(matrix).toContain('window.addEventListener');
    expect(matrix).toContain("delete next[row.id]");
    expect(categories).toContain('disabled={pending || !canEdit}');
    expect(categories).toContain('customerCategoryVisibilityFormData');
    expect(categories).toContain('{canEdit && <button');
    expect(categories).toContain('{canEdit && <Link');
    expect(matrix).not.toContain('照明器具を独立'); // 工程BのDB設定を工程Aへ混ぜない
  });

  it('仕様別の選択可否とお客様への共通表示を一括保存にしない', () => {
    const matrix = read('components/admin/selection-matrix-panel.tsx');
    const category = read('components/admin/customer-category-visibility-panel.tsx');
    expect(matrix).toContain('updateMatrixRowAction({');
    expect(matrix).toContain('row_id: row.id');
    expect(matrix).toContain('onClick={() => save(row)}');
    expect(category).toContain('saveCategoryAction({ ok: false }, data)');
    expect(category).toContain('onClick={() => saveVisibility(category, draftVisible(category))}');
    expect(read('app/admin/categories/page.tsx')).toContain('別々に保存します。');
  });
});
