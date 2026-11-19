import { expect, test } from '@playwright/test';

test.beforeEach(async ({page,baseURL}) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Only disposable localhost test server allowed');
  }
  await page.goto('/v25-e2e-row-sale');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
});

test('Pixel 7：別途見積セルから0円・売価直接入力、メニュー・枠外タップ・Escape・削除確認',async ({page})=>{
  const manual=page.locator('tr[data-v25-dnd-row="line:roofLine"]');
  const input=manual.getByTestId('v25-wb-line-price-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('placeholder','別途見積');
  await input.tap();
  await input.fill('0');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).not.toContainText('未確定');
  await input.fill('3000');
  await expect(manual.getByTestId('v25-wb-line-sale-amount')).toContainText('3,000');
  const actions=manual.getByTestId('v25-wb-line-menu');
  await actions.locator('summary').tap();
  const panel=page.getByTestId('v25-wb-menu-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:'金額を入力する'})).toHaveCount(0);
  await expect(panel.getByTestId('v25-wb-line-delete-separator')).toBeVisible();
  await page.getByTestId('v25-wb-menu-backdrop').tap({force:true});
  await expect(panel).toHaveCount(0);
  await actions.locator('summary').tap();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await actions.locator('summary').tap();
  await panel.getByTestId('v25-wb-line-delete').tap();
  const dialog=page.getByRole('dialog',{name:'この明細を削除しますか？'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'キャンセル'}).tap();
  await expect(manual).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).tap();
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
