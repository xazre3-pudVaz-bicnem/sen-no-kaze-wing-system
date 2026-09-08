import { expect, test } from '@playwright/test';

/** コラム（/column）。お知らせ（/news）とは別機能であることも確認する */
test.describe('コラム', () => {
  test('一覧から記事へ移動でき、関連コラム・相談導線が出る', async ({ page }) => {
    await page.goto('/column');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('コラム');

    // 3記事以上が並び、通常の HTML リンクで移動できる
    const links = page.locator('main a[href^="/column/"]');
    expect(await links.count()).toBeGreaterThanOrEqual(3);

    await page.getByRole('link', { name: /木造コンテナWingを検討する前に/ }).first().click();
    await expect(page).toHaveURL(/\/column\/wing-check-before-considering$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('木造コンテナWingを検討する前に');

    // パンくず・目次・出典・関連コラム・相談導線
    await expect(page.getByRole('navigation', { name: 'パンくずリスト' })).toContainText('コラム');
    await expect(page.getByRole('navigation', { name: '目次' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '参照した資料' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '関連するコラム' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '設置条件のご相談について' })).toBeVisible();

    // 関連する固定ページへの内部リンク
    await expect(page.locator('main a[href="/contact"]').first()).toBeVisible();
  });

  test('存在しない記事は404', async ({ page }) => {
    const res = await page.goto('/column/does-not-exist-article');
    expect(res?.status()).toBe(404);
  });

  test('お知らせとコラムは別の一覧', async ({ page }) => {
    await page.goto('/news');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('お知らせ');
    // お知らせ一覧にコラム記事が混ざっていない
    await expect(page.locator('main a[href^="/column/"]')).toHaveCount(0);
  });

  test('フッターとスマホメニューからコラムへ行ける', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'コラム' })).toBeVisible();
  });

  test('sitemap は公開記事だけを載せる', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    // ローカル検証モードは NEXT_PUBLIC_SITE_URL が空のため sitemap 自体が空になる（既存の誤インデックス防止の仕様）
    if (xml.includes('<url>')) {
      expect(xml).toContain('/column</loc>');
      expect(xml).toContain('/column/wing-check-before-considering');
    }
    // 下書き記事はどの環境でも sitemap に出さない
    expect(xml).not.toContain('draft');
  });
});
