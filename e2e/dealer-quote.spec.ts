import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  ensureDealerFreeProduct,
  logout,
  requestQuoteAsCustomer,
  signInOrRegister as signIn,
  uniqueEmail,
  yen,
} from './helpers';

test.describe('代理店による確定見積（改訂版）', () => {
  test('割り当て → 別途工事の入力 → 第2版の発行。第1版の金額は変わらない', async ({ page }) => {
    // 代理店のフリー商品を用意しておく
    await ensureDealerFreeProduct(page);
    await logout(page);

    // --- 顧客が概算見積を発行 ---
    const customer = uniqueEmail('rev');
    const { quoteId: firstQuoteId, total: estimate } = await requestQuoteAsCustomer(page, customer, '確定見積のテスト');
    const firstNo = (await page.getByTestId('quote-no').textContent())!.trim();
    await expect(page.getByTestId('quote-revision')).toContainText('第1版・概算見積');
    expect(yen(await page.getByTestId('quote-total').textContent())).toBe(estimate);
    await logout(page);

    // --- 管理者が代理店を割り当てる ---
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto(`/admin/quotes/${firstQuoteId}`);
    await expect(page.getByTestId('assign-dealer-form')).toBeVisible();
    const dealerOption = page.getByTestId('dealer-select').locator('option', { hasText: DEALER });
    await page.getByTestId('dealer-select').selectOption((await dealerOption.getAttribute('value'))!);
    await page.getByTestId('assign-dealer-form').getByRole('button', { name: '割り当てる' }).click();
    await expect(page.getByText('担当代理店を割り当てました')).toBeVisible();
    await logout(page);

    // --- 代理店が別途工事とフリー商品を入力して第2版を発行 ---
    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto('/admin/quotes');
    // 他のテストの見積も並ぶので、対象の見積番号の行だけを見る
    const row = page.getByTestId('dealer-quote-row').filter({ hasText: firstNo });
    await expect(row).toHaveCount(1);
    await row.getByRole('link', { name: '別途工事を入力' }).click();
    await expect(page).toHaveURL(new RegExp(firstQuoteId));

    const form = page.getByTestId('dealer-revision-form');
    await expect(form).toBeVisible();
    // 既存の別途工事（要見積・0円）に金額を入れる
    await form.locator('input[name="items.0.unit_price"]').fill('300000');
    // 追加の別途工事とフリー商品
    await page.getByTestId('add-installation').click();
    const rows = await form.locator('tbody tr').count();
    await form.locator(`input[name="items.${rows - 1}.name"]`).fill('傾斜地の追加基礎工事');
    await form.locator(`input[name="items.${rows - 1}.unit_price"]`).fill('200000');
    await page.getByTestId('add-free-dealer-bed').click();
    await page.locator('#dealer_note').fill('搬入路が狭いため小型クレーンを使用します。');

    const preview = yen(await page.getByTestId('revision-total').textContent());
    expect(preview).toBeGreaterThan(estimate);

    await form.getByRole('button', { name: /第2版として発行する/ }).click();
    await page.waitForURL(/revised=1/);
    const secondQuoteId = page.url().match(/quotes\/([0-9a-f-]{36})/)![1];
    expect(secondQuoteId).not.toBe(firstQuoteId);
    expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(preview);

    // 第1版は改訂済みで、金額はそのまま
    await page.goto(`/admin/quotes/${firstQuoteId}`);
    await expect(page.getByText('この版は改訂済みです')).toBeVisible();
    expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(estimate);
    await logout(page);

    // --- 顧客側 ---
    await signIn(page, customer, '/mypage', 'テスト 太郎');
    await page.goto(`/mypage/quotes/${secondQuoteId}`);
    await expect(page.getByTestId('quote-revision')).toContainText('第2版・確定見積');
    await expect(page.getByTestId('dealer-note')).toContainText('小型クレーン');
    await expect(page.getByTestId('quote-free-products')).toContainText('フリー商品');
    // エンドユーザーには本体の明細は出ない（計のみ）
    await expect(page.getByTestId('quote-table')).not.toContainText('金物関係費用');
    await expect(page.getByTestId('quote-table')).toContainText('本体一式');
    expect(yen(await page.getByTestId('quote-total').textContent())).toBe(preview);
    // 第1版も履歴として残っており、金額は当時のまま
    await page.goto(`/mypage/quotes/${firstQuoteId}`);
    expect(yen(await page.getByTestId('quote-total').textContent())).toBe(estimate);
    // PDF は両方の版で取得できる
    for (const id of [firstQuoteId, secondQuoteId]) {
      const pdf = await page.request.get(`/api/quotes/${id}/pdf`);
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await logout(page);
  });

  test('割り当てられていない代理店は他の見積を開けない', async ({ page }) => {
    const customer = uniqueEmail('other-rev');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, '未割当の見積');
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    const res = await page.goto(`/admin/quotes/${quoteId}`);
    expect(res?.status()).toBe(404);
    await logout(page);
  });
});

test.describe('本部の見積編集（エクセル表）', () => {
  test('本部は本体の行も編集でき、代理店は別途工事だけ', async ({ page }) => {
    const customer = uniqueEmail('grid');
    const { quoteId, total } = await requestQuoteAsCustomer(page, customer, '本体編集のテスト');
    await logout(page);

    // --- 本部：本体の単価を直して第2版を出す ---
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto(`/admin/quotes/${quoteId}`);
    const form = page.getByTestId('dealer-revision-form');
    await expect(form).toBeVisible();
    // 区分を選べる＝本体まで編集できる
    await expect(page.getByTestId('add-base')).toBeVisible();
    await expect(page.getByTestId('add-option')).toBeVisible();

    // 1 行目は本体の内訳の先頭行（分類表見積書）。単価を 0 円にして、単位と備考も入れる
    const first = form.locator('tbody tr').first();
    await expect(first.getByRole('combobox')).toHaveValue('base');
    await first.locator('input[name="items.0.unit_price"]').fill('0');
    await first.locator('input[name="items.0.unit"]').fill('式');
    await first.locator('input[name="items.0.remark"]').fill('本部調整');

    const preview = yen(await page.getByTestId('revision-total').textContent());
    expect(preview).toBeLessThan(total);

    await form.getByRole('button', { name: /第2版として発行する/ }).click();
    await page.waitForURL(/revised=1/);
    expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(preview);
    // 単位と備考が見積書に残る。管理画面では本体の明細（サッシ等）が見える
    await expect(page.getByTestId('quote-table')).toContainText('本部調整');
    await expect(page.getByTestId('quote-table')).toContainText('サッシ木製建具工事');
    await logout(page);

    // --- 代理店：本体の行は出ない ---
    await ensureDealerFreeProduct(page);
    await logout(page);
    const c2 = uniqueEmail('grid-dealer');
    const { quoteId: q2 } = await requestQuoteAsCustomer(page, c2, '代理店の範囲');
    await logout(page);
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto(`/admin/quotes/${q2}`);
    const opt = page.getByTestId('dealer-select').locator('option', { hasText: DEALER });
    await page.getByTestId('dealer-select').selectOption((await opt.getAttribute('value'))!);
    await page.getByTestId('assign-dealer-form').getByRole('button', { name: '割り当てる' }).click();
    await expect(page.getByText('担当代理店を割り当てました')).toBeVisible();
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto(`/admin/quotes/${q2}`);
    await expect(page.getByTestId('dealer-revision-form')).toBeVisible();
    await expect(page.getByTestId('add-base')).toBeHidden();
    await expect(page.getByTestId('add-option')).toBeHidden();
    // 区分は固定表示（選べない）
    await expect(page.getByTestId('dealer-revision-form').locator('tbody tr').first().getByRole('combobox')).toHaveCount(0);
    await logout(page);
  });
});
