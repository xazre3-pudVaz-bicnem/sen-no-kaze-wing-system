import { expect, test, type Page } from '@playwright/test';

const row = (page: Page, kind: 'slot'|'line', key: string) =>
  page.locator(`tr[data-v25-dnd-row="${kind}:${key}"]`);
const menu = (page: Page) => page.getByTestId('v25-wb-menu-panel');
const price = (page: Page) => row(page, 'line', 'roofLine').getByTestId('v25-wb-line-price-input');

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Isolated localhost environment required; never connect to production');
  }
  await page.goto('/v25-e2e-row-sale');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
});

test('PC：商品選定アイコンを維持し、対象カテゴリーの別商品へ変更できる', async ({page}) => {
  const sash = row(page,'slot','sash');
  await expect(sash.getByTestId('v25-wb-slot-product-picker-icon')).toBeVisible();
  await sash.getByTestId('v25-wb-slot-product-picker-icon').click();
  await expect(page.getByTestId('v25-wb-product-picker')).toBeVisible();
  await page.getByTestId('v25-wb-picker-candidate').filter({hasText:'検査用サッシ別商品'}).click();
  await page.getByTestId('v25-wb-picker-apply').click();
  await expect(page.getByTestId('v25-wb-product-picker')).toHaveCount(0);
  await expect(sash).toContainText('検査用サッシ別商品');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(sash).toContainText('検査用サッシ');
  await expect(sash).not.toContainText('検査用サッシ別商品');
});

test('PC：重複した商品メニューを整理し、位置の入口・売価方式・区切り付き削除を保持', async ({page}) => {
  const sash = row(page,'slot','sash');
  const roof = row(page,'slot','roof');
  await expect(sash.getByTestId('v25-wb-slot-position-toggle')).toBeVisible();
  await sash.getByTestId('v25-wb-slot-menu').locator('summary').click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByText('商品台帳から選択',{exact:true})).toHaveCount(0);
  await expect(menu(page).getByTestId('v25-wb-slot-position-menu')).toHaveCount(0);
  await expect(menu(page).getByTestId('v25-wb-slot-delete-separator')).toBeVisible();
  await expect(menu(page).getByTestId('v25-wb-slot-delete')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(roof.getByTestId('v25-wb-slot-position-toggle')).toHaveCount(0);
  await roof.getByTestId('v25-wb-slot-menu').locator('summary').click();
  await expect(menu(page).getByTestId('v25-wb-slot-position-menu')).toBeVisible();
  await menu(page).getByTestId('v25-wb-slot-position-menu').click();
  await expect(page.getByTestId('v25-wb-slot-position-editor')).toBeVisible();
  await page.getByRole('button',{name:'位置設定画面を閉じる'}).click();
  await expect(page.getByTestId('v25-wb-slot-position-editor')).toHaveCount(0);

  await roof.getByTestId('v25-wb-slot-menu').locator('summary').click();
  await menu(page).getByRole('button',{name:'別途見積にする'}).click();
  await expect(roof.getByTestId('v25-wb-slot-price-cell')).toContainText('別途見積');
  await roof.getByTestId('v25-wb-slot-menu').locator('summary').click();
  await expect(menu(page).getByRole('button',{name:'金額を入力する'})).toBeVisible();
  await menu(page).getByRole('button',{name:'金額を入力する'}).click();
  await expect(roof.getByTestId('v25-wb-slot-price-cell').getByRole('textbox',{name:'売価単価'})).toBeVisible();
  // POR→manualで元の価格モードと金額へ戻るため、破棄する変更がない。
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'変更を破棄'})).toBeDisabled();

  const manualMenu=row(page,'line','roofLine').getByTestId('v25-wb-line-menu');
  await manualMenu.locator('summary').click();
  await expect(menu(page).getByRole('button',{name:'工事項目を変更'})).toBeVisible();
  await expect(menu(page).getByRole('button',{name:'金額を入力する'})).toHaveCount(0);
  await expect(menu(page).getByTestId('v25-wb-line-delete-separator')).toBeVisible();
  await expect(menu(page).getByTestId('v25-wb-line-delete')).toBeVisible();
  await page.getByTestId('v25-wb-menu-backdrop').click({position:{x:3,y:3}});
  await expect(menu(page)).toHaveCount(0);
});

test('PC：別途見積から売価を直接入力し、0円・空欄・不正入力・破棄と正式金額を守る', async ({page}) => {
  const manual=row(page,'line','roofLine');
  await expect(price(page)).toHaveValue('');
  await expect(price(page)).toHaveAttribute('placeholder','別途見積');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('未確定');

  await price(page).fill('0');
  await expect(price(page)).toHaveValue('0');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).not.toContainText('未確定');
  await manual.locator('input[aria-label="明細の数量"]').fill('2');
  await price(page).fill('1500');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('3,000');

  await price(page).fill('');
  await expect(price(page)).toHaveValue('');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('売価未入力');
  await page.getByTestId('v25-wb-save').click();
  await expect(page.getByText(/売価単価（税別・経費別、0 円以上の整数）を入力してください/)).toBeVisible();

  await price(page).fill('abc');
  await expect(price(page)).toHaveValue('abc');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('売価未入力');
  await price(page).fill('2500');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('5,000');

  await manual.getByTestId('v25-wb-line-menu').locator('summary').click();
  await menu(page).getByRole('button',{name:'別途見積にする'}).click();
  await expect(price(page)).toHaveValue('');
  await expect(price(page)).toHaveAttribute('placeholder','別途見積');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('未確定');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(price(page)).toHaveValue('');
  await expect(manual.locator('input[aria-label="明細の数量"]')).toHaveValue('1');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
