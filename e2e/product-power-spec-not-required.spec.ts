import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, signInOrRegister } from './helpers';

// 2026-10-16 の先方判断：空調商品の電源仕様は専用の必須項目にしない（#510 の corrective）。
// 電源仕様は既存の商品仕様欄（空調の「能力クラス・電源」）に書き、未入力でも STEP2 への移動と登録を妨げない。
const AIRCON_CATEGORY_ID = '20000000-0000-4000-8000-000000000011';

test.describe('空調商品の電源仕様', () => {
  test('専用の電源仕様欄は出ず、電源仕様を入れなくても STEP1 → STEP2 → 登録まで進める', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin/options/new', '管理者');
    await page.goto('/admin/options/new');
    await page.getByRole('combobox', { name: 'カテゴリー', exact: true }).selectOption(AIRCON_CATEGORY_ID);
    await page.getByTestId('option-name').fill(`E2E 空調（電源仕様なし）${Date.now()}`);
    await page.getByRole('button', { name: '次へ：画像・資料' }).click();
    await page.waitForURL(/\/admin\/options\/[0-9a-f-]{36}/);
    const optionId = page.url().match(/options\/([0-9a-f-]{36})/)![1];

    // STEP1：電源仕様の専用欄は無い。電源は既存の「能力クラス・電源」に書ける
    await expect(page.getByTestId('product-power-spec-field')).toHaveCount(0);
    await expect(page.getByLabel('能力クラス・電源')).toBeVisible();
    await page.getByRole('button', { name: 'URLで画像を指定' }).click();
    await page.locator('#product-main-media input[name="image_url"]').fill('/images/equipment/aircon.png');
    await page.getByTestId('option-price').fill('120000');

    // STEP2 へ進める（電源仕様が未入力でも STEP1 へ戻されない）
    await page.getByRole('button', { name: /登録内容確認/ }).first().click();
    await page.waitForURL(/step=preview/);
    await expect(page.getByText('電源仕様を入力してください')).toHaveCount(0);

    // 登録できる
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'この内容で登録' }).click();
    await expect(page.getByText('商品を登録しました。')).toBeVisible();

    // 後始末：ほかの E2E のシミュレーターの候補を変えないよう、取扱終了にしておく
    await page.goto(`/admin/ledger?product=${optionId}`);
    await page.getByTestId('ledger-product-detail-pane').getByRole('tab', { name: '管理情報' }).click();
    await page.getByTestId('ledger-retire-product').click();
    await expect(page).toHaveURL(/lifecycle=retired/);
  });
});
