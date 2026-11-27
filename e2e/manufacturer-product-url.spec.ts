import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, signInOrRegister } from './helpers';

// メーカー公式商品ページURL（PR #535。2026-11-04 の先方回答 C-4 で引き取り）。
// 登録済み商品の変更確認で URL の変更前後とお客様表示のリンクを確かめてから反映し、空にすると外れる。
// 反映できたら商品台帳へ戻る（main の #632）ので、確かめるたびに商品の編集画面を開き直す。

const UB_ID = '30000000-0000-4000-8000-000000000001'; // ユニットバス 1216
const EDIT_PATH = `/admin/options/${UB_ID}`;

/** 「この変更を反映」→ 商品台帳へ戻り、変えた商品が示される → 編集画面を開き直す（保存された値を読み直す） */
async function reflectAndReopen(page: Page) {
  await page.getByRole('button', { name: 'この変更を反映' }).click();
  await page.waitForURL((url) => url.pathname === '/admin/ledger' && url.searchParams.get('updated_option') === UB_ID);
  await expect(page.getByText('商品を更新しました。')).toBeVisible();
  await page.goto(EDIT_PATH);
  await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
}

test('登録済み商品にメーカー公式商品ページURLを登録すると、確認画面のお客様表示にリンクが出て、空にすると外れる', async ({ page }) => {
  await signInOrRegister(page, ADMIN_EMAIL, EDIT_PATH, '管理者');
  await page.goto(EDIT_PATH);
  await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
  const field = page.locator('#registered-manufacturer-product-url');
  const review = page.getByTestId('registered-option-change-review');
  const url = 'https://www.example.com/products/unit-bath-1216?color=white';

  // 途中で落ちた回の残りがあっても、同じ前提（空）から始める
  if ((await field.inputValue()) !== '') {
    await field.fill('');
    await page.getByRole('button', { name: '変更内容を確認' }).click();
    await reflectAndReopen(page);
  }
  await expect(field).toHaveValue('');

  // http の URL は、保存と同じ決まりで STEP 1 のうちに止める（確認画面へ進まない）
  await field.fill('http://www.example.com/products/unit-bath-1216');
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await expect(page.getByText('https://から始まるメーカー公式商品ページURL（空白・ログイン情報を含まない）を入力してください')).toBeVisible();
  await expect(review).toHaveCount(0);

  // https の URL：確認画面に変更前後と、お客様表示のリンク（別タブ・参照元を渡さない）が出る
  await field.fill(url);
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await expect(review).toContainText('メーカー公式商品ページURL');
  await expect(review).toContainText(url);
  const link = review.getByTestId('manufacturer-product-link').getByRole('link');
  await expect(link).toHaveAttribute('href', url);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // 反映すると商品台帳へ戻る。開き直しても残る
  await reflectAndReopen(page);
  await expect(field).toHaveValue(url);

  // 空にすると外れる（お客様表示にリンクを出さない）
  await field.fill('');
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await expect(review).toContainText('メーカー公式商品ページURL');
  await expect(review.getByTestId('manufacturer-product-link')).toHaveCount(0);
  // 開き直して、保存された値が空（NULL）になったことを確かめる（入力欄に入れた値だけを見ない）
  await reflectAndReopen(page);
  await expect(field).toHaveValue('');

  // 日本語のパスは %エンコードした形で保存する（DB の ASCII の決まりに合わせる）
  await field.fill('https://www.example.co.jp/商品/ユニットバス');
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await reflectAndReopen(page);
  await expect(field).toHaveValue('https://www.example.co.jp/%E5%95%86%E5%93%81/%E3%83%A6%E3%83%8B%E3%83%83%E3%83%88%E3%83%90%E3%82%B9');

  // 後の試験のため空に戻す
  await field.fill('');
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await reflectAndReopen(page);
  await expect(field).toHaveValue('');
});
