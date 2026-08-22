import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  ensureAccount,
  logout,
  requestQuoteAsCustomer,
  signInOrRegister as signIn,
  uniqueEmail,
  yen,
} from './helpers';

test.describe('運用機能（通知・承諾・変更履歴）', () => {
  // 代理店アカウントが無いと割り当てができないため、各テストの前に用意しておく
  test.beforeEach(async ({ page }) => {
    await ensureAccount(page, DEALER, '代理店 担当');
  });

  test('見積依頼・代理店割当・確定見積・承諾が関係者へ通知される', async ({ page }) => {
    const customer = uniqueEmail('notify');
    const { quoteId, total } = await requestQuoteAsCustomer(page, customer, '通知のテスト');
    await logout(page);

    // 本部に見積依頼の通知が届く
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/notifications');
    await expect(page.getByTestId('notification-quote_requested').first()).toBeVisible();
    // ダッシュボードにも未読件数が出る
    await page.goto('/admin');
    await expect(page.getByText('未読のお知らせ')).toBeVisible();

    // 代理店を割り当てる → 代理店に通知
    await page.goto(`/admin/quotes/${quoteId}`);
    const dealerOption = page.getByTestId('dealer-select').locator('option', { hasText: DEALER });
    await page.getByTestId('dealer-select').selectOption((await dealerOption.getAttribute('value'))!);
    await page.getByTestId('assign-dealer-form').getByRole('button', { name: '割り当てる' }).click();
    await expect(page.getByText('担当代理店を割り当てました')).toBeVisible();
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto('/admin/notifications');
    await expect(page.getByTestId('notification-quote_assigned').first()).toBeVisible();

    // 確定見積を発行 → 顧客に通知
    await page.goto(`/admin/quotes/${quoteId}`);
    await page.getByTestId('dealer-revision-form').locator('input[name="items.0.unit_price"]').fill('250000');
    await page.getByTestId('dealer-revision-form').getByRole('button', { name: /第2版として発行する/ }).click();
    await page.waitForURL(/revised=1/);
    const secondId = page.url().match(/quotes\/([0-9a-f-]{36})/)![1];
    await logout(page);

    // 顧客が承諾 → 本部と代理店へ通知
    await signIn(page, customer, '/mypage', 'テスト 太郎');
    await page.goto(`/mypage/quotes/${secondId}`);
    await expect(page.getByTestId('quote-respond')).toBeVisible();
    const finalTotal = yen(await page.getByTestId('quote-total').textContent());
    expect(finalTotal).toBeGreaterThan(total);
    await page.getByTestId('accept-quote').click();
    await page.waitForURL(/responded=accepted/);
    await expect(page.getByText('この見積で進めるご回答をいただきました')).toBeVisible();
    // 回答後はボタンが消える
    await expect(page.getByTestId('quote-respond')).toBeHidden();
    await logout(page);

    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/notifications');
    await expect(page.getByTestId('notification-quote_accepted').first()).toBeVisible();
    // すべて既読にできる
    await page.getByTestId('mark-all-read').click();
    await page.waitForURL(/read=1/);
    await expect(page.getByTestId('mark-all-read')).toBeHidden();
    await logout(page);
  });

  test('改訂済みの版には回答できない', async ({ page }) => {
    const customer = uniqueEmail('superseded');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, '改訂前の版');
    await logout(page);

    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto(`/admin/quotes/${quoteId}`);
    await page.getByTestId('dealer-revision-form').locator('input[name="items.0.unit_price"]').fill('100000');
    await page.getByTestId('dealer-revision-form').getByRole('button', { name: /第2版として発行する/ }).click();
    await page.waitForURL(/revised=1/);
    await logout(page);

    await signIn(page, customer, '/mypage', 'テスト 太郎');
    await page.goto(`/mypage/quotes/${quoteId}`);
    await expect(page.getByText('この版は代理店の確定見積に置き換わっています')).toBeVisible();
    await expect(page.getByTestId('quote-respond')).toBeHidden();
    await logout(page);
  });

  test('価格と権限の変更が変更履歴に残る', async ({ page }) => {
    await signIn(page, ADMIN, '/admin', '管理者');

    // 価格を変更する
    await page.goto('/admin/options');
    await page.getByTestId('admin-option-wood-deck').getByRole('link', { name: '編集' }).click();
    const price = page.getByTestId('option-price');
    const before = Number(await price.inputValue());
    await price.fill(String(before + 10_000));
    await page.getByTestId('admin-submit').click();
    await expect(page.getByText('保存しました')).toBeVisible();

    // 権限を変更する（代理店を総代理店へ一時的に上げる）
    await page.goto('/admin/customers');
    const dealerRow = page.getByTestId(`user-row-${DEALER}`);
    await dealerRow.scrollIntoViewIfNeeded();
    await dealerRow.getByRole('combobox').selectOption('master_dealer');
    await dealerRow.getByRole('button', { name: '変更' }).click();
    await expect(dealerRow.getByText('保存しました')).toBeVisible();

    // 履歴に両方が出る
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('変更履歴');
    await expect(page.getByTestId('audit-price').first()).toContainText('ウッドデッキ');
    await expect(page.getByTestId('audit-role').first()).toBeVisible();

    // 後始末：価格と権限を戻す
    await page.goto('/admin/options');
    await page.getByTestId('admin-option-wood-deck').getByRole('link', { name: '編集' }).click();
    await page.getByTestId('option-price').fill(String(before));
    await page.getByTestId('admin-submit').click();
    await page.goto('/admin/customers');
    const back = page.getByTestId(`user-row-${DEALER}`);
    await back.scrollIntoViewIfNeeded();
    await back.getByRole('combobox').selectOption('dealer');
    await back.getByRole('button', { name: '変更' }).click();
    await expect(back.getByText('保存しました')).toBeVisible();
    await logout(page);
  });
});
