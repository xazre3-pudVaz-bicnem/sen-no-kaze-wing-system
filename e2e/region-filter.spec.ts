import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL as ADMIN, logout, requestQuoteAsCustomer, signInOrRegister as signIn, uniqueEmail } from './helpers';

/**
 * 管理画面の地域抽出（ブロック → 都道府県 → 市町村）。先方要望 2026-08-28。
 * 顧客の登録住所は helpers の register で「石川県七尾市1-1」（中部）になる。
 */
test.describe('地域で抽出', () => {
  test('見積依頼をブロック・県・市町村で絞り込める', async ({ page }) => {
    const customer = uniqueEmail('region');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, '地域抽出のテスト');
    void quoteId;
    const quoteNo = (await page.getByTestId('quote-no').textContent())!.trim();
    await logout(page);

    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/quotes');
    const row = page.getByTestId('admin-quote-row').filter({ hasText: quoteNo });
    await expect(page.getByTestId('region-filter')).toBeVisible();
    await expect(row).toHaveCount(1);

    // ブロックで絞る：中部 → 見える、関東 → 消える
    await page.getByTestId('filter-block').selectOption('中部');
    await expect(page).toHaveURL(/block=/);
    await expect(row).toHaveCount(1);
    await page.getByTestId('filter-block').selectOption('関東');
    await expect(row).toHaveCount(0);

    // 県まで絞る：石川県 → 見える（ブロックは自動で整合）
    await page.getByTestId('filter-block').selectOption('中部');
    await page.getByTestId('filter-pref').selectOption('石川県');
    await expect(page).toHaveURL(/pref=/);
    await expect(row).toHaveCount(1);

    // 市町村まで絞る：候補に七尾市が出て、選ぶと絞り込まれる
    await page.getByTestId('filter-city').selectOption('七尾市');
    await expect(row).toHaveCount(1);
    await expect(page.getByTestId('filter-count')).toContainText('件');

    // 解除で全件に戻る
    await page.getByTestId('filter-clear').click();
    await expect(page).not.toHaveURL(/pref=/);
    await expect(row).toHaveCount(1);
    await logout(page);
  });
});
