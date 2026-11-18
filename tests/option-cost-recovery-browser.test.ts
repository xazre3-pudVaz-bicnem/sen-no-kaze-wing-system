import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { FlashMessages } from '@/components/admin/ui';

// 任意のローカルChromiumで確認する。未指定のCIではブラウザの導入を要求しない。
it.skipIf(!process.env.WING_TEST_CHROMIUM)('隔離Chromiumで警告と復旧リンクを表示する', async () => {
  const browser = await chromium.launch({ executablePath: process.env.WING_TEST_CHROMIUM, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const markup = renderToStaticMarkup(createElement(FlashMessages, {
      sp: { cost_warning: '商品は保存しましたが、原価の Version を記録できませんでした。' },
    }));
    await page.setContent(markup);
    const link = page.getByRole('link', { name: '原価 Version の取り込み画面を開く' });
    expect(await link.isVisible()).toBe(true);
    expect(await link.getAttribute('href')).toBe('/admin/options/cost-import');
  } finally {
    await browser.close();
  }
}, 30000);
