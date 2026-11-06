import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, signInOrRegister } from './helpers';

// 登録済み商品の追加画像・メーカー資料PDFの正式保存（PR #563。2026-11-04 の先方回答 C-4 で引き取り）。
// STEP 1 で編集案を作り、STEP 2 で確認してから「この変更を反映」で 1 回にまとめて反映する。
// 画面を開いた後にほかの画面で変わっていたら反映せず、開き直すよう案内する。

const COAT_RACK_ID = '30000000-0000-4000-8000-000000000014'; // コートラック（ほかの E2E で使っていない商品）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from(['%PDF-1.4', '% e2e manufacturer document', '1 0 obj << >> endobj', 'trailer << >>', '%%EOF', ''].join('\n'));

const gallery = (page: Page) => page.getByTestId('registered-option-current-gallery');
const review = (page: Page) => page.getByTestId('registered-option-change-review');
const documentStatus = (page: Page) => page.getByTestId('registered-manufacturer-document-status');

async function openProduct(page: Page) {
  await page.goto(`/admin/options/${COAT_RACK_ID}`);
  await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
}

async function applyReviewed(page: Page) {
  await page.getByRole('button', { name: 'この変更を反映' }).click();
  // 反映すると、最新の登録内容を読み直して編集画面へ戻る
  await expect(review(page)).toHaveCount(0);
  await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
}

test('登録済み商品の追加画像・メーカー資料を確認してからまとめて反映でき、開いた後に変わっていたら反映しない', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInOrRegister(page, ADMIN_EMAIL, `/admin/options/${COAT_RACK_ID}`, '管理者');
  await openProduct(page);
  const startCount = await gallery(page).locator('li').count();

  // ---------- 追加画像 2 枚とメーカー資料を足す ----------
  await page.locator('#registered-new-gallery').setInputFiles([
    { name: 'front.png', mimeType: 'image/png', buffer: PNG },
    { name: 'side.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await page.locator('#registered-pdf-change').selectOption('replace');
  await page.locator('#registered-new-document').setInputFiles({ name: 'catalog.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await expect(review(page)).toContainText('追加画像の追加');
  await expect(review(page)).toContainText('front.png');
  await expect(review(page)).toContainText('side.png');
  await expect(review(page)).toContainText('登録予定：catalog.pdf');
  await applyReviewed(page);
  await expect(gallery(page).locator('li')).toHaveCount(startCount + 2);
  await expect(documentStatus(page)).toHaveAttribute('data-registered', 'true');

  // ---------- 説明の変更・1 枚の削除・資料の解除 ----------
  const items = gallery(page).locator('li');
  await items.nth(startCount).getByRole('textbox').fill('正面から見たところ');
  await items.nth(startCount + 1).getByRole('button', { name: 'この追加画像を削除予定にする' }).click();
  await page.locator('#registered-pdf-change').selectOption('remove');
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await expect(review(page)).toContainText('追加画像の説明・表示順');
  await expect(review(page)).toContainText('正面から見たところ');
  await expect(review(page)).toContainText('追加画像の削除');
  await expect(review(page)).toContainText('解除予定');
  await applyReviewed(page);
  await expect(gallery(page).locator('li')).toHaveCount(startCount + 1);
  await expect(gallery(page)).toContainText('正面から見たところ');
  await expect(documentStatus(page)).toHaveAttribute('data-registered', 'false');

  // ---------- 2 つの画面で同じ商品を開き、先に一方が反映したら、もう一方は反映しない ----------
  const other = await context.newPage();
  await openProduct(other);
  await gallery(page).locator('li').nth(startCount).getByRole('textbox').fill('先に反映した説明');
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await applyReviewed(page);
  await expect(gallery(page)).toContainText('先に反映した説明');

  await gallery(other).locator('li').nth(startCount).getByRole('textbox').fill('後から反映しようとした説明');
  await other.getByRole('button', { name: '変更内容を確認' }).click();
  await other.getByRole('button', { name: 'この変更を反映' }).click();
  await expect(review(other).getByText('画面を開いた後にほかの操作で変わりました')).toBeVisible();
  await openProduct(other);
  await expect(gallery(other)).toContainText('先に反映した説明');
  await expect(gallery(other)).not.toContainText('後から反映しようとした説明');

  // ---------- 変更履歴に残る ----------
  await page.goto('/admin/audit');
  await expect(page.getByText('追加画像・メーカー資料を変更：').first()).toBeVisible();

  await context.close();
});
