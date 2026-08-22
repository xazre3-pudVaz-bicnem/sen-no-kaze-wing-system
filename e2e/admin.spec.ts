import { expect, test } from '@playwright/test';
import { login, logout, near, openFreshSimulator, pickOption, readTotal, register, uniqueEmail, withExpenseAndTax } from './helpers';

const ADMIN_EMAIL = 'admin@example.com'; // playwright.config の WING_LOCAL_ADMIN_EMAILS
const UB_ID = '30000000-0000-4000-8000-000000000001'; // ユニットバス 1216
const MODEL_ID = '10000000-0000-4000-8000-000000000001';

test.describe('管理者フロー', () => {
  test('11-12. 管理者が価格と画像を変更でき、発行済み見積の金額は変わらない', async ({ page }) => {
    // --- 顧客が見積を発行 ---
    const customer = uniqueEmail('cust');
    await register(page, customer, '/simulator/wing-01');
    await openFreshSimulator(page);
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    const totalBefore = await readTotal(page);
    await page.getByTestId('save-button').click();
    await page.getByTestId('save-confirm').click();
    await expect(page).toHaveURL(/\?c=/);
    const configId = new URL(page.url()).searchParams.get('c')!;
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await page.getByTestId('submit-quote-request').click();
    await expect(page).toHaveURL(/\/mypage\/quotes\//);
    const quoteId = page.url().match(/quotes\/([0-9a-f-]{36})/)![1];
    const quoteTotal = Number((await page.getByTestId('quote-total').textContent())!.replace(/[^0-9]/g, ''));
    expect(quoteTotal).toBe(totalBefore);
    expect((await page.request.get(`/api/quotes/${quoteId}/pdf`)).status()).toBe(200);
    await logout(page);

    // --- 管理者ログイン（初回は登録。WING_LOCAL_ADMIN_EMAILS で admin 権限になる） ---
    await page.goto('/login');
    await page.locator('#email').fill(ADMIN_EMAIL);
    await page.locator('#password').fill('Wing-Test1!');
    await page.getByRole('button', { name: 'ログイン' }).click();
    const loggedIn = await page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!loggedIn) {
      await register(page, ADMIN_EMAIL, '/admin', '管理者');
    }
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ダッシュボード');
    await expect(page.getByText(/プレビュー画像が不足している組み合わせ/)).toBeVisible();

    // 価格変更: ユニットバス +20,000
    await page.goto(`/admin/options/${UB_ID}`);
    await expect(page.getByTestId('option-name')).toHaveValue('ユニットバス 1216（浴槽付）');
    const originalPrice = Number(await page.getByTestId('option-price').inputValue());
    await page.getByTestId('option-price').fill(String(originalPrice + 20_000));
    await page.getByTestId('admin-submit').click();
    await expect(page.getByText('保存しました')).toBeVisible();

    // 画像変更: シャワー＋洗面（未登録の組み合わせ）の水まわり画像を登録 → 不足件数が減る
    await page.goto('/admin/preview-rules');
    const missingBefore = await page.getByTestId('missing-combos').first().locator('li').count();
    await page.goto(`/admin/preview-rules/new?model=${MODEL_ID}&view=water&keys=shower,washbasin`);
    await page.getByTestId('preview-rule-url').fill('/images/interior/washroom.webp');
    await page.locator('#pr-alt').fill('テスト用：シャワー＋洗面器の水まわり');
    await page.getByTestId('admin-submit').click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await page.goto('/admin/preview-rules');
    const missingAfter = await page.getByTestId('missing-combos').first().locator('li').count();
    expect(missingAfter).toBe(missingBefore - 1);

    // 発行済み見積は変わらない（管理画面・PDF）
    await page.goto(`/admin/quotes/${quoteId}`);
    const adminTotal = Number((await page.getByTestId('admin-quote-total').textContent())!.replace(/[^0-9]/g, ''));
    expect(adminTotal).toBe(totalBefore);
    expect((await page.request.get(`/api/quotes/${quoteId}/pdf`)).status()).toBe(200);
    await logout(page);

    // 顧客側: シミュレーターの新規計算には新価格が反映、見積書は旧金額のまま
    await login(page, customer, '/simulator/wing-01');
    await openFreshSimulator(page);
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    // ホテル仕様の標準構成にユニットバスが含まれるため、値上げ分がそのまま概算に乗る
    expect(near(await readTotal(page), totalBefore + withExpenseAndTax(20_000))).toBe(true);
    await page.getByTestId('view-water').click();
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    await page.goto(`/mypage/quotes/${quoteId}`);
    expect(Number((await page.getByTestId('quote-total').textContent())!.replace(/[^0-9]/g, ''))).toBe(totalBefore);

    // 一般ユーザーは管理画面に入れない
    const res = await page.goto('/admin');
    expect(res?.url()).toMatch(/\/mypage\?forbidden=1/);

    // 後始末: 価格を元に戻し、テスト用の画像ルールを削除
    await logout(page);
    await login(page, ADMIN_EMAIL, `/admin/options/${UB_ID}`);
    await page.getByTestId('option-price').fill(String(originalPrice));
    await page.getByTestId('admin-submit').click();
    await expect(page.getByText('保存しました')).toBeVisible();
    page.on('dialog', (d) => d.accept());
    await page.goto('/admin/preview-rules');
    const testCard = page.getByTestId('preview-rule-card').filter({ has: page.locator('img[alt*="テスト用"]') }).first();
    await testCard.getByRole('button', { name: '削除' }).click();
    await expect(page).toHaveURL(/deleted=1/);
  });
});
