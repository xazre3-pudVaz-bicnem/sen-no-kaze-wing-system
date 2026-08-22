import { expect, test } from '@playwright/test';
import { collectConsoleErrors, expectNoConsoleErrors, readTotal, waitForSimulator } from './helpers';

test.describe('スマートフォン', () => {
  test('14. スマホで閲覧・操作できる（画像 → オプション → 金額 → 見積依頼の縦並び）', async ({ page }) => {
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

    // 縦並びの順序: プレビュー → オプション → 金額
    const stage = page.getByTestId('preview-stage');
    const options = page.getByRole('heading', { name: 'オプションを選ぶ' });
    const total = page.getByTestId('total-price');
    const y = async (l: typeof stage) => (await l.boundingBox())!.y;
    expect(await y(stage)).toBeLessThan(await y(options));
    await options.scrollIntoViewIfNeeded();
    expect(await y(options)).toBeLessThan(await y(total));

    // 横スクロールが発生しない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // タップで選択 → 固定フッターの金額が変わる
    const before = await readTotal(page);
    await page.getByTestId('option-wood-deck').scrollIntoViewIfNeeded();
    await page.getByTestId('option-wood-deck').click();
    // ウッドデッキ 450,000 × 諸費用 1.15 × 税 1.1（千円未満切捨てのため ±1,100 円）
    expect(Math.abs((await readTotal(page)) - (before + 450_000 * 1.15 * 1.1))).toBeLessThanOrEqual(1100);
    await expect(page.getByText('概算合計（税込）').last()).toBeVisible();

    // 未ログインで見積依頼 → ログインへ
    await page.getByRole('button', { name: '見積依頼' }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await expectNoConsoleErrors(page, errors);
  });
});
