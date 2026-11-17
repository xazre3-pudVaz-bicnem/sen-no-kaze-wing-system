import { expect, test } from '@playwright/test';
import { openFreshSimulator, openPicker, openProductDetail, waitForSimulator } from './helpers';

/**
 * PR #681: Disposable Chromium acceptance. WING_LOCAL_MODE only: no live DB,
 * no login, no quote submissions, no use of an existing browser profile.
 */
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR #681 browser tests require a disposable localhost Next server');
  }
});

test('トイレ：比較案内・二重ラベル解消・詳細から反映・選択中先頭', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  await openPicker(page, 'equip-toilet');
  const modal = page.getByTestId('option-picker');
  await expect(modal.getByTestId('product-choice-guide')).toContainText('洗浄機能');
  const card = modal.getByTestId('product-card-toilet-washlet');
  await expect(card).toBeVisible();
  const baseline = card.getByTestId('product-card-baseline-toilet-washlet');
  if (await baseline.count()) {
    // Both the status badge and its former price line said "基本プランの商品".
    await expect(card.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
    const price = card.getByTestId('product-card-price-toilet-washlet');
    if (await price.count()) await expect(price).not.toHaveText('基本プランの商品');
  }
  const title = card.locator('h3');
  await expect(title).toBeVisible();
  expect(await title.evaluate(el => getComputedStyle(el).overflowWrap)).toBe('anywhere');
  await openProductDetail(page, 'toilet-washlet');
  await expect(modal.getByTestId('product-detail')).toBeVisible();
  await modal.getByTestId('product-detail-apply').click();
  await expect(modal).toBeHidden();
  await openPicker(page, 'equip-toilet');
  const selected = page.getByTestId('product-card-current-toilet-washlet');
  await expect(selected).toBeVisible();
  await expect(page.getByTestId('product-list').locator('li').first())
    .toContainText('トイレ（温水洗浄便座ウォッシュレット）');
});

test('洗面2商品セット：基本プラン・選択中はセットカード単位で判定', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  await openPicker(page, 'equip-washbasin');
  const modal = page.getByTestId('option-picker');
  const setCard = modal.getByTestId('product-card-washbasin-standard-set');
  await expect(setCard).toBeVisible();
  await expect(modal.getByTestId('product-card-washbasin-kb')).toHaveCount(0);
  await expect(modal.getByTestId('product-card-faucet-kb')).toHaveCount(0);
  const baseline = setCard.getByTestId('product-card-baseline-washbasin-standard-set');
  if (await baseline.count()) {
    await expect(setCard.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  }
  await openProductDetail(page, 'washbasin-standard-set');
  await expect(modal.getByTestId('product-detail')).toBeVisible();
  await modal.getByTestId('product-detail-apply').click();
  await expect(modal).toBeHidden();
  await openPicker(page, 'equip-washbasin');
  await expect(page.getByTestId('product-card-current-washbasin-standard-set')).toBeVisible();
});

test('外壁4面：選択・面切替・4面コピー・プラン反映を維持', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  const elevation = page.locator('button[data-testid^="elevation-"]').first();
  await expect(elevation).toBeVisible();
  await elevation.click();
  const dialog = page.getByTestId('exterior-wall-faces-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('exterior-wall-choice-guide')).toContainText('材質・仕上がり');
  await expect(dialog.getByRole('tab')).toHaveCount(4);
  await dialog.getByRole('tab').nth(1).click();
  const wood = dialog.getByTestId('product-card-detail-exterior-wood');
  await expect(wood).toBeVisible();
  await wood.click();
  await expect(dialog.getByTestId('product-card-current-exterior-wood')).toBeVisible();
  await dialog.getByRole('button', { name: 'この内容を4面すべてにコピー' }).click();
  await dialog.getByTestId('exterior-faces-apply').click();
  await expect(dialog).toBeHidden();
  await waitForSimulator(page);
  await expect(page.locator('button[data-testid^="elevation-"]').first()).toContainText('木板');
});

test('位置別商品：テスト用の位置枠があれば表示・選択状態を確認', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  const slots = page.locator('button[data-testid^="equip-slot-"]');
  // The local seed may not contain the published v2.5 position slots; do not
  // treat that situation as completed browser testing.
  test.skip((await slots.count()) === 0, 'Local seed does not expose v2.5 position slots: isolated fixture is required');
  await slots.first().click();
  const dialog = page.getByTestId('option-picker');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('product-list')).toBeVisible();
  const selected = dialog.locator('[data-testid^="product-card-current-"]');
  await expect(selected.first()).toBeVisible();
  await expect(dialog.getByTestId('product-list').locator('li').first())
    .toContainText((await selected.first().locator('..').locator('..').textContent())?.trim().slice(0,8) ?? '');
});
