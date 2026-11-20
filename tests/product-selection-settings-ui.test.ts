import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductSelectionSettingsTabs } from '@/components/admin/product-selection-settings-tabs';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('商品選択設定の2タブUI', () => {
  it('PCとスマホ共通のタブを表示し、カテゴリータブを初期選択する', () => {
    const html = renderToStaticMarkup(createElement(ProductSelectionSettingsTabs, {
      initialTab: 'categories',
      matrix: createElement('p', null, 'matrix content'),
      categories: createElement('p', null, 'category content'),
    }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('仕様別の選択可否');
    expect(html).toContain('お客様への共通表示');
    expect(html).toContain('id="settings-tab-categories" role="tab" aria-selected="true"');
    expect(html).toContain('id="settings-panel-matrix" role="tabpanel" aria-labelledby="settings-tab-matrix" hidden=""');
  });

  it('旧マトリクスURLから入る場合は仕様タブを初期選択する', () => {
    const html = renderToStaticMarkup(createElement(ProductSelectionSettingsTabs, {
      initialTab: 'matrix',
      matrix: createElement('p', null, 'matrix content'),
      categories: createElement('p', null, 'category content'),
    }));
    expect(html).toContain('id="settings-tab-matrix" role="tab" aria-selected="true"');
    expect(html).toContain('id="settings-panel-categories" role="tabpanel" aria-labelledby="settings-tab-categories" hidden=""');
    const legacy = read('app/admin/matrix/page.tsx');
    expect(legacy).toContain("await requireAdmin('/admin/matrix')");
    expect(legacy).toContain("redirect('/admin/categories?tab=matrix')");
  });

  it('保存ActionとDB構造を変更せず、権限に応じて編集操作を隠す', () => {
    const page = read('app/admin/categories/page.tsx');
    const matrix = read('components/admin/selection-matrix-panel.tsx');
    const categories = read('components/admin/customer-category-visibility-panel.tsx');
    expect(page).toContain("requireStaff('/admin/categories')");
    expect(page).toContain("hasRoleAtLeast(actor.role, 'master_dealer')");
    expect(page).toContain("const canEditMatrix = actor.role === 'admin'");
    expect(page).toContain('categoryItems={matrix.categoryItems}');
    expect(matrix).toContain('expected_lock_version: row.lock_version');
    expect(matrix).toContain('{canEdit && (');
    expect(categories).toContain('disabled={pending || !canEdit}');
    expect(categories).toContain('{canEdit && <button');
    expect(categories).toContain('{canEdit && <Link');
  });

  it('クライアント内の詳細編集・戻る操作で未保存ドラフトを黙って破棄しない', () => {
    const page = read('app/admin/categories/page.tsx');
    const tabs = read('components/admin/product-selection-settings-tabs.tsx');
    const matrix = read('components/admin/selection-matrix-panel.tsx');
    expect(page).not.toContain('key={initialTab}');
    expect(tabs).toContain('useEffect(() => setTab(initialTab), [initialTab])');
    expect(matrix).toContain('restoreMatrixSettingsDrafts(window.sessionStorage.getItem(draftKey), initialRows)');
    expect(matrix).toContain('window.sessionStorage.setItem(draftKey, serializeMatrixSettingsDrafts({ drafts, selectedId }))');
    expect(matrix).toContain('expected_lock_version: changes.lockVersion');
    expect(matrix).toContain('staleDraft');
  });
});
