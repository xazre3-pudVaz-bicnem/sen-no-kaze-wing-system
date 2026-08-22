import { expect, test } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors, near, pickOption, readTotal, waitForSimulator, withExpenseAndTax } from './helpers';

const DECK_PRICE = 450_000;

test.describe('スマートフォン', () => {
  test('14. スマホで閲覧・操作できる（図面 → 設備表 → 御見積書の縦並び）', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // モバイルメニュー
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.getByLabel('モバイルナビゲーション').getByRole('link', { name: '見積シミュレーションを始める' }).click();
    await expect(page).toHaveURL(/\/simulator\/wing-01/);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await waitForSimulator(page);

    // 縦並びの順序: 平面図 → 標準設備及び仕上げ表 → 御見積書
    const plan = page.getByTestId('plan-board');
    const equipment = page.getByTestId('equipment-board');
    const quote = page.getByTestId('quote-sheet');
    const y = async (l: typeof plan) => {
      await l.scrollIntoViewIfNeeded();
      return (await l.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
    };
    const [yPlan, yEquipment, yQuote] = [await y(plan), await y(equipment), await y(quote)];
    expect(yPlan).toBeLessThan(yEquipment);
    expect(yEquipment).toBeLessThan(yQuote);

    // 横スクロールが発生しない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // タップで選択 → 固定フッターの金額が変わる
    const before = await readTotal(page);
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    expect(near(await readTotal(page), before + withExpenseAndTax(DECK_PRICE))).toBe(true);
    await expect(page.getByText('概算合計（税込）').last()).toBeVisible();

    // 未ログインで見積依頼 → ログインへ
    await page.getByRole('button', { name: '見積依頼' }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await expectNoConsoleErrors(page, errors);
  });
});
