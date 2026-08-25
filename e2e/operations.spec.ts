import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  PASSWORD,
  ensureAccount,
  logout,
  openFreshSimulator,
  register,
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

test.describe('マイページと管理画面の導線', () => {
  test('見積を発行した仕様は削除できず、生の DB エラーも出ない', async ({ page }) => {
    const customer = uniqueEmail('nodelete');
    await requestQuoteAsCustomer(page, customer, '削除できない仕様');
    await page.goto('/mypage');

    // 削除ボタンは出さず、理由を表示する
    await expect(page.getByTestId('configuration-card')).toContainText('見積発行済みのため削除できません');
    await expect(page.getByTestId('delete-button')).toBeHidden();
    await logout(page);
  });

  test('見積前の仕様は削除できる', async ({ page }) => {
    const customer = uniqueEmail('candelete');
    await register(page, customer, '/simulator/wing-01');
    await openFreshSimulator(page);
    await page.getByTestId('save-button').click();
    await page.getByTestId('config-name-input').fill('まだ見積していない仕様');
    await page.getByTestId('save-confirm').click();
    await page.waitForURL(/\?c=[0-9a-f-]{36}/);
    await page.goto('/mypage');
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('delete-button').click();
    await page.waitForURL(/deleted=1/);
    await expect(page.getByTestId('configuration-card')).toHaveCount(0);
    await logout(page);
  });

  test('代理店はログイン後に管理画面へ入り、ヘッダーからも戻れる', async ({ page }) => {
    await ensureAccount(page, DEALER, '代理店 担当');
    // 明示的な next を付けずにログインすると管理画面へ
    await page.goto('/login');
    await page.locator('#email').fill(DEALER);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.waitForURL(/\/admin$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ダッシュボード');

    // 公開サイトのヘッダーは「管理画面」になる
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('link', { name: '管理画面' })).toBeVisible();

    // マイページからも戻れる
    await page.goto('/mypage');
    await expect(page.getByTestId('to-admin')).toBeVisible();
    await expect(page.getByText('代理店・工務店としてログインしています')).toBeVisible();
    await logout(page);
  });
});

test.describe('メールから別途工事の入力へ', () => {
  test('通知のリンクを開くと、ログインを経ても入力表まで飛ぶ', async ({ page }) => {
    await ensureAccount(page, DEALER, '代理店 担当');
    const customer = uniqueEmail('maillink');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, 'メール導線のテスト');
    await logout(page);

    // 本部が代理店を割り当てる
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto(`/admin/quotes/${quoteId}`);
    const opt = page.getByTestId('dealer-select').locator('option', { hasText: DEALER });
    await page.getByTestId('dealer-select').selectOption((await opt.getAttribute('value'))!);
    await page.getByTestId('assign-dealer-form').getByRole('button', { name: '割り当てる' }).click();
    await expect(page.getByText('担当代理店を割り当てました')).toBeVisible();
    await logout(page);

    // 代理店の通知に、入力画面へのリンクが入っている
    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto('/admin/notifications');
    const card = page.getByTestId('notification-quote_assigned').first();
    await expect(card).toContainText('別途工事の入力をお願いします');
    const link = card.getByRole('link', { name: '別途工事を入力' });
    const href = await link.getAttribute('href');
    expect(href).toContain(`/admin/quotes/${quoteId}`);
    expect(href).toContain('#quote-editor');
    await logout(page);

    // メールのリンクを未ログインで開く → ログイン後にそのまま入力画面へ戻る
    const res = await page.goto(href!);
    expect(res?.url()).toContain('/login');
    await page.locator('#email').fill(DEALER);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.waitForURL(new RegExp(quoteId));
    await expect(page.getByText('メールからお越しの方へ')).toBeVisible();
    await expect(page.getByTestId('dealer-revision-form')).toBeVisible();
    await logout(page);
  });
});
