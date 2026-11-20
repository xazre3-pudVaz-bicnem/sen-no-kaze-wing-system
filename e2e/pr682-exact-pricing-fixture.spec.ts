import { expect, test } from '@playwright/test';

/**
 * Real Chromium with a strictly WING_LOCAL_MODE-only Next fixture route.
 * Fixture values use official computePricing/computeSaleViewPricing functions.
 * Production published revisions, DB and feature switches are untouched.
 */
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR682 fixture may only use an isolated localhost Next server');
  }
});

test('現行価格：正式な税込総額から計算された増額・減額・標準・0円差額をChromiumで表示', async ({ page }) => {
  await page.goto('/local-card-price-fixture');
  const fixture = page.getByTestId('legacy-fixture');
  await expect(fixture).toBeVisible();
  const up = fixture.getByTestId('equip-price-roof');
  const down = fixture.getByTestId('equip-price-toilet');
  await expect(up).toHaveText((await fixture.getByTestId('expected-roof').textContent()) ?? '');
  await expect(down).toHaveText((await fixture.getByTestId('expected-toilet').textContent()) ?? '');
  await expect(up).toHaveAttribute('data-price-tone', 'increase');
  await expect(down).toHaveAttribute('data-price-tone', 'decrease');
  await expect(up).toHaveClass(/text-red-700/);
  await expect(down).toHaveClass(/text-blue-700/);
  expect(await up.evaluate(el => getComputedStyle(el).color))
    .not.toBe(await down.evaluate(el => getComputedStyle(el).color));
  await expect(fixture.getByTestId('equip-price-bed')).toHaveText('基本プランに含む');
  await expect(fixture.getByTestId('equip-price-kitchen')).toHaveText('変更しても差額なし');
  expect(Number(await fixture.getByTestId('legacy-official-total').textContent())).toBeGreaterThan(0);
});

test('v2.5：屋根23.5㎡・位置別サッシの正式税込総額差をChromiumで表示', async ({ page }) => {
  await page.goto('/local-card-price-fixture');
  const fixture = page.getByTestId('v25-fixture');
  await expect(fixture).toBeVisible();
  const roof = fixture.getByTestId('equip-price-roof');
  const sash = fixture.getByTestId('equip-slot-price-window-1');
  await expect(roof).toHaveText((await fixture.getByTestId('expected-v25-roof').textContent()) ?? '');
  await expect(sash).toHaveText((await fixture.getByTestId('expected-v25-sash').textContent()) ?? '');
  await expect(roof).toHaveAttribute('data-price-tone', 'increase');
  await expect(sash).toHaveAttribute('data-price-tone', 'increase');
  expect(Number(await fixture.getByTestId('v25-official-total').textContent())).toBeGreaterThan(317830);
});
