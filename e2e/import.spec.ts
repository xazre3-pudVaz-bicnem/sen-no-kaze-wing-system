import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL as ADMIN, DEALER_EMAIL as DEALER, ensureAccount, logout, signInOrRegister as signIn } from './helpers';

const MASTER = path.join(process.cwd(), 'public', 'Wing_product_master_v1_5.xlsx');
const IMAGES = path.join(process.cwd(), 'public', 'images.zip');

test.describe('商品の一括登録', () => {
  test('Excel と画像 ZIP から商品・選択項目をまとめて登録できる', async ({ page }) => {
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/import');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('商品の一括登録');

    // 1. 内容を確認する
    await page.getByTestId('import-sheet').setInputFiles(MASTER);
    await page.getByTestId('import-images').setInputFiles(IMAGES);
    await page.getByTestId('import-preview').click();

    const preview = page.getByTestId('import-preview-result');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toContainText('商品 7 件');
    await expect(preview).toContainText('選択肢 42 件');
    // 一覧に商品と選べる項目が出る
    await expect(preview).toContainText('ハウステック NJB1216');
    await expect(preview).toContainText('壁プラン');
    // 価格未設定は「別途見積」と分かる
    await expect(preview).toContainText('別途見積');
    // 取り込めなかった点は警告として見せる
    await expect(preview).toContainText('確認してほしい点');

    // 2. 登録する
    await page.getByTestId('import-apply').click();
    const applied = page.getByTestId('import-applied');
    await expect(applied).toBeVisible({ timeout: 60_000 });
    await expect(applied).toContainText('登録しました');

    // 3. 台帳に反映されている
    await page.goto('/admin/options');
    await expect(page.getByTestId('admin-option-bath-ht-njb1216')).toContainText('ハウステック NJB1216');
    await logout(page);
  });

  test('もう一度同じファイルを取り込んでも商品は増えない', async ({ page }) => {
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/options');
    const before = await page.getByTestId(/^admin-option-/).count();

    await page.goto('/admin/import');
    await page.getByTestId('import-sheet').setInputFiles(MASTER);
    await page.getByTestId('import-preview').click();
    await expect(page.getByTestId('import-preview-result')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-applied')).toBeVisible({ timeout: 60_000 });
    // 2 回目はすべて更新になる
    await expect(page.getByTestId('import-applied')).toContainText('新規 0 件');

    await page.goto('/admin/options');
    expect(await page.getByTestId(/^admin-option-/).count()).toBe(before);
    await logout(page);
  });

  test('代理店は一括登録を使えない', async ({ page }) => {
    await ensureAccount(page, DEALER, '代理店 担当');
    await signIn(page, DEALER, '/admin', '代理店 担当');
    await expect(page.getByRole('navigation', { name: '管理メニュー' }).getByRole('link', { name: '商品の一括登録' })).toBeHidden();
    const res = await page.goto('/admin/import');
    expect(res?.url()).toMatch(/\/mypage\?forbidden=1/);
    await logout(page);
  });
});
