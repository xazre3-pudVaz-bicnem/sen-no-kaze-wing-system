import { expect, test, type Page } from '@playwright/test';

// 標準見積 v2.5 の手入力明細の原価単価（2026-11-20 の先方の依頼）。PC。隔離した検査用ページだけを操作する（本番・正式な DB に触れない）
const row = (page: Page, key: string) => page.locator(`tr[data-v25-dnd-row="line:${key}"]`);

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Isolated localhost environment required; never connect to production');
  }
  await page.goto('/v25-e2e-line-cost');
  await expect(page.getByTestId('v25-line-cost-local-fixture')).toBeVisible();
});

test('PC：原価単価を入れると原価金額・粗利を出し、売価は変わらない。空は原価未設定、0 は 0 円', async ({ page }) => {
  const saved = row(page, 'costLine');
  await expect(saved.getByTestId('v25-wb-line-cost-input')).toHaveValue('6000');
  await expect(saved.getByTestId('v25-wb-line-cost-amount')).toHaveText('¥12,000');
  await expect(saved.getByTestId('v25-wb-line-gross')).toHaveText('¥6,000');

  const target = row(page, 'noCostLine');
  const cost = target.getByTestId('v25-wb-line-cost-input');
  await expect(cost).toHaveAttribute('placeholder', '未入力');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toContainText('原価未設定');
  await expect(target.getByTestId('v25-wb-line-gross')).toHaveText('—');
  await expect(page.getByTestId('v25-amount-breakdown-line-cost-missing')).toContainText('1 行');
  const saleAmount = await target.getByTestId('v25-wb-line-sale-amount').textContent();
  const subtotal = await page.getByTestId('v25-wb-subtotal').textContent();

  await cost.fill('600');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toHaveText('¥600');
  await expect(target.getByTestId('v25-wb-line-gross')).toHaveText('¥400');
  await expect(target.getByTestId('v25-wb-line-sale-amount')).toHaveText(saleAmount ?? '');
  await expect(page.getByTestId('v25-wb-subtotal')).toHaveText(subtotal ?? '');
  await expect(page.getByTestId('v25-amount-breakdown-line-cost-missing')).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();

  await cost.fill('0');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toHaveText('¥0');
  await expect(target.getByTestId('v25-wb-line-gross')).toHaveText('¥1,000');

  await cost.fill('1500');
  await expect(target.getByTestId('v25-wb-line-gross')).toHaveText('-¥500');

  await cost.fill('');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toContainText('原価未設定');
  await expect(target.getByTestId('v25-wb-line-gross')).toHaveText('—');

  // 数量を変えると原価金額も計算し直す（trunc(1.5 × 333) = 499）
  await cost.fill('333');
  await target.getByLabel('明細の数量').fill('1.5');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toHaveText('¥499');

  await page.getByRole('button', { name: '変更を破棄' }).click();
  await expect(cost).toHaveValue('');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toContainText('原価未設定');
});

test('PC：Excel と同じく Tab で単位 → 原価単価 → 売価単価、Enter で次の手入力明細の原価単価へ移る', async ({ page }) => {
  const first = row(page, 'costLine');
  await first.getByLabel('単位').click();
  await page.keyboard.press('Tab');
  await expect(first.getByTestId('v25-wb-line-cost-input')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first.getByTestId('v25-wb-line-price-input')).toBeFocused();
  await first.getByTestId('v25-wb-line-cost-input').click();
  await page.keyboard.press('Enter');
  await expect(row(page, 'noCostLine').getByTestId('v25-wb-line-cost-input')).toBeFocused();
});

test('PC：別途見積の行は原価の欄が無い。売価を入れて金額確定にすると原価単価を入力できる', async ({ page }) => {
  const por = row(page, 'porLine');
  await expect(por.getByTestId('v25-wb-line-cost-input')).toHaveCount(0);
  await expect(por.getByTestId('v25-wb-line-cost-cell')).toHaveText('—');
  await por.getByTestId('v25-wb-line-price-input').fill('8000');
  const cost = por.getByTestId('v25-wb-line-cost-input');
  await expect(cost).toBeVisible();
  await expect(por.getByTestId('v25-wb-line-cost-amount')).toContainText('原価未設定');
  await cost.fill('5000');
  await expect(por.getByTestId('v25-wb-line-gross')).toHaveText('¥3,000');
});
