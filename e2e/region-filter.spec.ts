import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL as ADMIN, logout, requestQuoteAsCustomer, signInOrRegister as signIn, uniqueEmail } from './helpers';

/**
 * 管理画面の地域抽出。先方要望 2026-08-28。
 * - 案件一覧（/admin/quotes）：設置予定地の都道府県 → 市区町村（「詳細条件」の中）
 * - 保存済み仕様（/admin/configurations）：ブロック → 都道府県 → 市町村。設置予定地が未登録なら顧客住所で判定する
 *   （会員登録では住所を聞かない（#577〜#582）ため、この試験ではプロフィールに「石川県七尾市1-1」＝中部を入れる）
 */
test.describe('地域で抽出', () => {
  test('案件一覧は県・市区町村で、保存済み仕様はブロック・県・市町村で絞り込める', async ({ page }) => {
    const customer = uniqueEmail('region');
    const configName = `地域抽出のテスト ${Date.now()}`;
    await requestQuoteAsCustomer(page, customer, configName, '石川県七尾市 海沿いの高台');
    const quoteNo = (await page.getByTestId('quote-no').textContent())!.trim();
    // 保存済み仕様の地域は、設置予定地が未登録なら会員の住所で判定する。会員登録では住所を聞かないので、プロフィールに入れる
    await page.goto('/mypage/profile');
    await page.locator('#address').fill('石川県七尾市1-1');
    await page.getByRole('button', { name: '保存する' }).click();
    await page.waitForURL(/\/mypage\?profile=updated/);
    await logout(page);

    // ---- 案件一覧：設置予定地で絞る ----
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/quotes');
    const row = page.getByTestId('admin-quote-row').filter({ hasText: quoteNo });
    await expect(row).toHaveCount(1);
    const pref = page.locator('select[name="pref"]');
    const city = page.locator('select[name="city"]');
    const apply = page.getByRole('button', { name: '絞り込む' });

    // 県で絞る：石川県 → 見える、東京都 → 消える
    await page.getByText('詳細条件').click();
    await pref.selectOption('石川県');
    await apply.click();
    await expect(page).toHaveURL(/pref=/);
    await expect(row).toHaveCount(1);
    await pref.selectOption('東京都');
    await apply.click();
    await expect(row).toHaveCount(0);

    // 市区町村まで絞る：候補に七尾市が出て、選ぶと絞り込まれる
    await pref.selectOption('石川県');
    await apply.click();
    await expect(row).toHaveCount(1);
    await city.selectOption('七尾市');
    await apply.click();
    await expect(page).toHaveURL(/city=/);
    await expect(row).toHaveCount(1);

    // 解除で全件に戻る
    await page.getByRole('link', { name: '条件を解除' }).click();
    await expect(page).not.toHaveURL(/pref=/);
    await expect(row).toHaveCount(1);

    // ---- 保存済み仕様：ブロック → 県 → 市町村 ----
    await page.goto('/admin/configurations');
    await expect(page.getByTestId('region-filter')).toBeVisible();
    const saved = page.getByRole('row').filter({ hasText: configName });
    await expect(saved).toHaveCount(1);

    // ブロックで絞る：中部 → 見える、関東 → 消える
    await page.getByTestId('filter-block').selectOption('中部');
    await expect(page).toHaveURL(/block=/);
    await expect(saved).toHaveCount(1);
    await page.getByTestId('filter-block').selectOption('関東');
    await expect(saved).toHaveCount(0);

    // 県・市町村まで絞る（ブロックは自動で整合）
    await page.getByTestId('filter-block').selectOption('中部');
    await page.getByTestId('filter-pref').selectOption('石川県');
    await expect(page).toHaveURL(/pref=/);
    await expect(saved).toHaveCount(1);
    await page.getByTestId('filter-city').selectOption('七尾市');
    await expect(saved).toHaveCount(1);
    await expect(page.getByTestId('filter-count')).toContainText('件');

    // 解除で全件に戻る
    await page.getByTestId('filter-clear').click();
    await expect(page).not.toHaveURL(/pref=/);
    await expect(saved).toHaveCount(1);
    await logout(page);
  });
});
