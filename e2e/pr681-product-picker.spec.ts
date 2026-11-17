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

test('長い品名・型番・寸法の折り返しと同じ行のカード高さ', async ({ page }) => {
  test.setTimeout(150_000);
  await openFreshSimulator(page);
  await openPicker(page, 'equip-furniture');
  const list = page.getByTestId('product-list');
  const cards = list.locator('li');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const [first, second] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
  expect(first && second).toBeTruthy();
  if (Math.abs(first!.y - second!.y) < 8) {
    expect(Math.abs(first!.height - second!.height)).toBeLessThanOrEqual(3);
  }
  for (const card of await cards.all()) {
    const widthOverflow = await card.evaluate(el => el.scrollWidth - el.clientWidth);
    expect(widthOverflow, 'product card must not overflow horizontally').toBeLessThanOrEqual(2);
    const title = card.locator('h3');
    expect(await title.evaluate(el => getComputedStyle(el).overflowWrap)).toBe('anywhere');
    for (const value of await card.locator('dd').all()) {
      expect(await value.evaluate(el => getComputedStyle(el).overflowWrap)).toBe('anywhere');
    }
  }
});

test('位置別商品：基本・選択中の重複表示なし→変更候補選択→位置ごとにプラン反映', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/__e2e_pr681_picker');
  const fixture = page.getByTestId('pr681-local-fixture');
  await expect(fixture).toBeVisible();
  await expect(fixture.getByRole('alert')).toHaveCount(0);

  // 標準の位置（選択中=基本プラン）を必ず作成して検査する。条件付きskipは禁止。
  await page.getByTestId('fixture-open-bedroom-fix').click();
  const dialog = page.getByTestId('option-picker');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('寝室FIX窓');
  await expect(dialog.getByTestId('product-choice-guide')).toContainText('開閉方式');
  const baseCard = dialog.getByTestId('product-card-sash-standard');
  await expect(baseCard.getByTestId('product-card-baseline-sash-standard')).toBeVisible();
  await expect(baseCard.getByTestId('product-card-current-sash-standard')).toBeVisible();
  await expect(baseCard.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  await expect(baseCard.getByTestId('product-card-price-sash-standard')).toHaveCount(0);
  await expect(dialog.getByTestId('product-list').locator('li').first()).toContainText('サッシ 標準');

  // 基本プランを維持したまま、別商品へ変更→カードの現在選択が先頭へ移動。
  await openProductDetail(page, 'sash-resin');
  await expect(dialog.getByTestId('product-detail')).toBeVisible();
  await dialog.getByTestId('product-detail-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('fixture-current-bedroom-fix')).toContainText('樹脂サッシ');
  await expect(page.getByTestId('fixture-baseline-bedroom-fix')).toContainText('サッシ 標準');
  await page.getByTestId('fixture-open-bedroom-fix').click();
  await expect(dialog.getByTestId('product-card-current-sash-resin')).toBeVisible();
  await expect(dialog.getByTestId('product-card-baseline-sash-standard')).toBeVisible();
  await expect(dialog.getByTestId('product-list').locator('li').first()).toContainText('樹脂サッシ');
  await expect(dialog.getByTestId('product-card-sash-standard').getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dialog).toBeHidden();

  // 別位置は同じ商品カテゴリーでも、基本プランIDが異なることを確認。
  await page.getByTestId('fixture-open-entrance-window').click();
  const otherBase = dialog.getByTestId('product-card-sash-resin');
  await expect(otherBase.getByTestId('product-card-current-sash-resin')).toBeVisible();
  await expect(otherBase.getByTestId('product-card-baseline-sash-resin')).toBeVisible();
  await expect(otherBase.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'キャンセル' }).click();

  // トイレも実際に基本プランの条件を作って重複を確認（skipなし）。
  await page.getByTestId('fixture-open-toilet-room').click();
  const toilet = dialog.getByTestId('product-card-toilet-washlet');
  await expect(toilet.getByTestId('product-card-current-toilet-washlet')).toBeVisible();
  await expect(toilet.getByTestId('product-card-baseline-toilet-washlet')).toBeVisible();
  await expect(toilet.getByText('基本プランの商品', { exact: true })).toHaveCount(1);
  await expect(toilet.getByTestId('product-card-price-toilet-washlet')).toHaveCount(0);
  await openProductDetail(page, 'toilet-washlet');
  await expect(dialog.getByTestId('product-detail-current')).toBeVisible();
  await expect(dialog.getByTestId('product-detail-baseline')).toBeVisible();
  await dialog.getByTestId('product-detail-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('fixture-current-toilet-room')).toContainText('ウォッシュレット');
});
