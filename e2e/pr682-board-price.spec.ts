import { expect, test } from '@playwright/test';
import { openFreshSimulator, openPicker, openProductDetail, readTotal } from './helpers';

/**
 * PR #682: real Chromium desktop, disposable local-mode server only.
 * NO production DB connection, login, saved quote or price switch.
 * The seeded legacy hotel plan includes mandatory price-on-request installation
 * items. As a result exact changed-card deltas must fail closed, not be invented.
 */
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR #682 E2E only accepts an isolated localhost server');
  }
});

test('Wing現行価格：標準商品・未確定金額と選択操作、見積総額の更新', async ({ page }) => {
  await openFreshSimulator(page);
  const standard = page.getByTestId('equip-toilet');
  await expect(standard).toBeVisible();
  await expect(standard.getByTestId('equip-price-toilet')).toHaveText('基本プランに含む');
  await expect(page.getByTestId('equipment-price-impact-note')).toContainText('単純合計できない');

  const before = await readTotal(page);
  await openPicker(page, 'equip-exterior-parts');
  await openProductDetail(page, 'wood-deck');
  await page.getByTestId('product-detail-apply').click();
  await expect(page.getByTestId('option-picker')).toBeHidden();
  await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');
  await expect(page.getByTestId('equip-price-exterior-parts')).toHaveText('金額確認中');
  await expect(page.getByTestId('equip-price-exterior-parts')).toHaveAttribute('data-price-tone', 'neutral');
  expect(await readTotal(page)).toBeGreaterThan(before);
  await expect(standard.getByTestId('equip-price-toilet')).toHaveText('基本プランに含む');
  // Price-on-request elsewhere in the quote prevents certifying a changed card's amount.
  await expect(page.getByTestId('quote-sheet')).toBeVisible();
  // 画面受入用の証跡。外部DBのないlocalhost専用テストでのみ保存。
  await page.screenshot({ path: 'test-results/pr682-desktop-equipment-board.png', fullPage: true });
});

test('外壁4面：1面だけ変更しても選択操作と総額を保ち、別途見積があれば数値を確定しない', async ({ page }) => {
  await openFreshSimulator(page);
  const before = await readTotal(page);
  const tile = page.getByTestId('equip-exterior-wall');
  await expect(tile).toBeVisible();
  await expect(tile.getByTestId('equip-price-exterior-wall')).toHaveText('基本プランに含む');

  await tile.click();
  const picker = page.getByTestId('exterior-wall-faces-dialog');
  await expect(picker).toBeVisible();
  await picker.getByTestId('exterior-face-tab-front').click();
  await picker.getByTestId('product-card-open-exterior-wood').click();
  await picker.getByTestId('exterior-faces-apply').click();
  await expect(picker).toBeHidden();
  await expect(tile).toContainText('木板下見板張り');
  await expect(tile.getByTestId('equip-price-exterior-wall')).toHaveText('金額確認中');
  expect(await readTotal(page)).toBeGreaterThan(before);
});

test('別途見積候補：金額未確定を0円や税込増額と誤表示しない', async ({ page }) => {
  await openFreshSimulator(page);
  await openPicker(page, 'equip-exterior-parts');
  await openProductDetail(page, 'sunroof');
  await page.getByTestId('product-detail-apply').click();
  await expect(page.getByTestId('option-picker')).toBeHidden();
  await expect(page.getByTestId('equip-price-exterior-parts')).toHaveText('金額確認中');
  await expect(page.getByTestId('equip-price-exterior-parts')).not.toContainText('円（税込）');
});
