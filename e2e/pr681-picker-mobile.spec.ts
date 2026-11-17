import { expect, test } from '@playwright/test';
import { openFreshSimulator, openPicker, openProductDetail } from './helpers';

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Mobile PR #681 tests must use an isolated localhost server');
  }
});

test('スマホ：比較ポイント・選択状態・長い商品名とカード幅・詳細と反映', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  await openPicker(page, 'equip-toilet');
  const modal = page.getByTestId('option-picker');
  await expect(modal.getByTestId('product-choice-guide')).toBeVisible();
  const card = modal.getByTestId('product-card-toilet-washlet');
  await expect(card).toBeVisible();

  const bounds = await card.boundingBox();
  const dialogBounds = await modal.boundingBox();
  expect(bounds && dialogBounds).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x - 2);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width + 2);

  const headline = card.locator('h3');
  await expect(headline).toBeVisible();
  expect(await headline.evaluate(el => getComputedStyle(el).overflowWrap)).toBe('anywhere');

  const baseline = card.getByTestId('product-card-baseline-toilet-washlet');
  if (await baseline.count()) {
    await expect(card.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  }

  await openProductDetail(page, 'toilet-washlet');
  await expect(modal.getByTestId('product-detail')).toBeVisible();
  await expect(modal.getByTestId('product-detail-footer')).toBeVisible();
  await modal.getByTestId('product-detail-apply').click();
  await expect(modal).toBeHidden();
  await openPicker(page, 'equip-toilet');
  await expect(page.getByTestId('product-card-current-toilet-washlet')).toBeVisible();
});

test('スマホ：洗面セットのカードと外壁4面切替', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  await openPicker(page, 'equip-washbasin');
  await expect(page.getByTestId('product-card-washbasin-standard-set')).toBeVisible();
  await page.getByTestId('option-picker').getByRole('button', { name: '閉じる' }).click();
  const faceButton = page.locator('button[data-testid^="elevation-"]').first();
  await expect(faceButton).toBeVisible();
  await faceButton.click();
  const faces = page.getByTestId('exterior-wall-faces-dialog');
  await expect(faces).toBeVisible();
  await expect(faces.getByRole('tab')).toHaveCount(4);
  await faces.getByRole('tab').nth(2).click();
  await expect(faces.getByTestId('exterior-wall-choice-guide')).toBeVisible();
  await faces.getByRole('button', { name: 'キャンセル' }).click();
  await expect(faces).toBeHidden();
});

test('スマホ：隔離位置枠の基本プランと選択中を実表示して変更・反映', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/pr681-e2e-picker');
  await expect(page.getByTestId('pr681-local-fixture')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTestId('fixture-open-bedroom-fix').click();
  const dialog = page.getByTestId('option-picker');
  const baselineCard = dialog.getByTestId('product-card-sash-standard');
  await expect(baselineCard.getByTestId('product-card-baseline-sash-standard')).toBeVisible();
  await expect(baselineCard.getByTestId('product-card-current-sash-standard')).toBeVisible();
  await expect(baselineCard.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  await expect(baselineCard.getByTestId('product-card-price-sash-standard')).toHaveCount(0);
  const cardBounds = await baselineCard.boundingBox();
  const dialogBounds = await dialog.boundingBox();
  expect(cardBounds && dialogBounds).toBeTruthy();
  expect(cardBounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x - 2);
  expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width + 2);
  await openProductDetail(page, 'sash-resin');
  await expect(dialog.getByTestId('product-detail')).toBeVisible();
  await dialog.getByTestId('product-detail-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('fixture-current-bedroom-fix')).toContainText('樹脂サッシ');
  await page.getByTestId('fixture-open-bedroom-fix').click();
  await expect(dialog.getByTestId('product-card-current-sash-resin')).toBeVisible();
  await expect(dialog.getByTestId('product-card-baseline-sash-standard')).toBeVisible();
  await expect(dialog.getByTestId('product-list').locator('li').first()).toContainText('樹脂サッシ');
});
