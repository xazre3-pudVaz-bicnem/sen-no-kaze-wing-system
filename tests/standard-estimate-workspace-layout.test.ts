import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandardEstimateWorkspaceLayout } from '@/components/admin/standard-estimate-workspace-layout';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('標準見積：広い編集領域と一覧切り替え', () => {
  it('初期状態では一覧を閉じ、選択中の仕様と一覧表示操作を残す', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateWorkspaceLayout, {
      selectedName: 'Wing ホテル仕様・非防火',
      sidebar: createElement('nav', { 'aria-label': '標準見積の一覧' }, '一覧サンプル'),
    }, createElement('main', null, '編集サンプル')));
    expect(html).toContain('data-testid="standard-estimate-workspace-layout"');
    expect(html).toContain('data-testid="standard-estimate-selector-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('仕様一覧を開く');
    expect(html).toContain('選択中：Wing ホテル仕様・非防火');
    expect(html).toContain('id="standard-estimate-selector-panel" class="hidden"');
    expect(html).toContain('編集サンプル');
  });

  it('他の管理画面の幅を変えず、標準見積だけ広い画面を使う', () => {
    const page = source('app/admin/estimate-templates/page.tsx');
    const adminPage = source('components/admin/ui.tsx');
    const workbench = source('components/admin/standard-estimate-v25-workbench.tsx');
    expect(page).toContain('StandardEstimateWorkspaceLayout');
    expect(page).toContain('actions={headerActions} wide');
    expect(page).not.toContain('lg:max-h-[78vh] lg:overflow-y-auto');
    expect(adminPage).toContain('wide = false');
    expect(workbench).toContain('overflow-x-auto rounded-b-md');
    expect(workbench).not.toContain('max-h-[70vh]');
  });
});
