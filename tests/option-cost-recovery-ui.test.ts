import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlashMessages } from '@/components/admin/ui';

describe('原価記録失敗の案内', () => {
  it('保存成功後の警告と、対象確認を促す復旧画面へのリンクを表示する', () => {
    const html = renderToStaticMarkup(createElement(FlashMessages, { sp: {cost_warning:'商品は保存しましたが、原価の Version を記録できませんでした。'} }));
    expect(html).toContain('商品は保存しましたが、原価の Version を記録できませんでした。');
    expect(html).toContain('対象と金額を確認し、必要な項目だけを選んでください。');
    expect(html).toContain('href="/admin/options/cost-import"');
  });
  it('警告がなければ復旧リンクを表示しない', () => {
    expect(renderToStaticMarkup(createElement(FlashMessages, { sp: {saved:'1'} }))).not.toContain('/admin/options/cost-import');
  });
});
