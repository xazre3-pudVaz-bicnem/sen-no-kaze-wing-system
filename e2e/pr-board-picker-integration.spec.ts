import { expect, test } from '@playwright/test';

/** Published v2.5 sale snapshot, synthetic option IDs, isolated localhost only. */
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Integrated picker browser fixture requires an isolated localhost');
  }
});

test('候補商品・詳細・適用後カードの正式税込差額が一致（＋98,670円／−136,620円）', async ({ page }) => {
  await page.goto('/local-card-price-fixture');
  const fixture = page.getByTestId('integrated-candidate-fixture');
  await expect(fixture).toBeVisible();
  await expect(fixture.getByTestId('integrated-official-total')).toHaveText('6939959');
  const board = fixture.getByTestId('equip-price-toilet');
  await expect(board).toHaveText('基本プランに含む');

  await fixture.getByTestId('equip-toilet').click();
  const picker = page.getByTestId('option-picker');
  await expect(picker.getByTestId('product-card-price-toilet-up')).toHaveText('＋98,670円（税込）');
  await expect(picker.getByTestId('product-card-price-toilet-down')).toHaveText('−136,620円（税込）');
  await expect(picker.getByTestId('product-card-price-toilet-up')).toHaveAttribute('data-price-tone', 'increase');
  await expect(picker.getByTestId('product-card-price-toilet-down')).toHaveAttribute('data-price-tone', 'decrease');
  await expect(picker.getByTestId('product-card-price-toilet-up')).toHaveClass(/text-red-700/);
  await expect(picker.getByTestId('product-card-price-toilet-down')).toHaveClass(/text-blue-700/);
  // Baseline has only a badge, no duplicate price text.
  await expect(picker.getByTestId('product-card-baseline-toilet-standard')).toBeVisible();
  await expect(picker.getByTestId('product-card-price-toilet-standard')).toHaveCount(0);

  await picker.getByTestId('product-card-open-toilet-up').click();
  const footer = picker.getByTestId('product-detail-total-delta');
  await expect(footer).toContainText('＋98,670円（税込）');
  await expect(footer.locator('[data-price-tone]')).toHaveAttribute('data-price-tone', 'increase');
  await picker.getByTestId('product-detail-apply').click();
  await expect(picker).toBeHidden();
  await expect(fixture.getByTestId('integrated-official-total')).toHaveText('7038629');
  await expect(board).toHaveText('＋98,670円（税込）');
  await expect(board).toHaveAttribute('data-price-tone', 'increase');

  await fixture.getByTestId('equip-toilet').click();
  await expect(picker.getByTestId('product-card-price-toilet-down')).toHaveText('−136,620円（税込）');
  await picker.getByTestId('product-card-open-toilet-down').click();
  await expect(footer).toContainText('−136,620円（税込）');
  await picker.getByTestId('product-detail-apply').click();
  await expect(fixture.getByTestId('integrated-official-total')).toHaveText('6803339');
  await expect(board).toHaveText('−136,620円（税込）');
  await expect(board).toHaveAttribute('data-price-tone', 'decrease');
  await page.screenshot({ path: 'test-results/integrated-picker-desktop.png', fullPage: true });
});
