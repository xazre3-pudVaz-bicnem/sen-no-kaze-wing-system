import { expect, test } from '@playwright/test';
import { openFreshSimulator, openPicker, openProductDetail, readTotal } from './helpers';

/** Real Pixel 7 Chromium emulation; external DBs and origins are forbidden. */
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR #682 mobile E2E requires an isolated localhost server');
  }
});

test('スマートフォン：基本プラン・価格確認中・レスポンシブカードと商品選択', async ({ page }) => {
  await openFreshSimulator(page);
  await expect(page.getByTestId('equipment-board')).toBeVisible();
  const standard = page.getByTestId('equip-toilet');
  await standard.scrollIntoViewIfNeeded();
  await expect(standard.getByTestId('equip-price-toilet')).toHaveText('基本プランに含む');
  const image = standard.locator('span.relative').first();
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  expect(box?.width).toBeGreaterThan(60);
  expect(box?.width).toBeLessThan(250);

  const before = await readTotal(page);
  await openPicker(page, 'equip-exterior-parts');
  await openProductDetail(page, 'wood-deck');
  await page.getByTestId('product-detail-apply').click();
  await expect(page.getByTestId('option-picker')).toBeHidden();
  await expect(page.getByTestId('equip-price-exterior-parts')).toHaveText('金額確認中');
  expect(await readTotal(page)).toBeGreaterThan(before);
  await expect(page.getByTestId('equipment-price-impact-note')).toBeVisible();
  // Pixel 7 相当の実ブラウザ画像をlocalhost隔離試験の証跡として残す。
  await page.screenshot({ path: 'test-results/pr682-mobile-equipment-board.png', fullPage: true });
});
