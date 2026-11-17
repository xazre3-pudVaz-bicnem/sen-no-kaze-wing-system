import { expect, test } from '@playwright/test';

/** Pixel 7 Chromium in CI local-mode, no remote DB. */
test('スマートフォンでも候補一覧・詳細・商品カードの税込差額が一致', async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) throw new Error('localhost only');
  await page.goto('/local-card-price-fixture');
  const fixture = page.getByTestId('integrated-candidate-fixture');
  await fixture.getByTestId('equip-toilet').click();
  const picker = page.getByTestId('option-picker');
  const up = picker.getByTestId('product-card-price-toilet-up');
  await expect(up).toHaveText('＋98,670円（税込）');
  await expect(up).toHaveAttribute('data-price-tone', 'increase');
  await picker.getByTestId('product-card-open-toilet-up').click();
  await expect(picker.getByTestId('product-detail-total-delta')).toContainText('＋98,670円（税込）');
  await picker.getByTestId('product-detail-apply').click();
  const board = fixture.getByTestId('equip-price-toilet');
  await board.scrollIntoViewIfNeeded();
  await expect(board).toHaveText('＋98,670円（税込）');
  await expect(fixture.getByTestId('integrated-official-total')).toHaveText('7038629');
  await page.screenshot({ path: 'test-results/integrated-picker-mobile.png', fullPage: true });
});
