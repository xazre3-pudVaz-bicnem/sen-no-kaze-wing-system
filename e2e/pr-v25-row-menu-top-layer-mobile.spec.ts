import { expect, test } from '@playwright/test';

const ready=async (page: import('@playwright/test').Page) => {
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
};
test.beforeEach(async ({baseURL}) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Mobile menu suite requires disposable localhost');
  }
});

test('Pixel 7：＋メニューは画面内最前面、枠外の実タッチで閉じて行は不変', async ({page}) => {
  await ready(page);
  const menu=page.locator('tr[data-v25-dnd-row="slot:roof"]').getByTestId('v25-wb-row-insert');
  const panel=menu.getByTestId('v25-wb-menu-panel');
  await menu.locator('summary').tap();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(el=>el.matches(':popover-open'))).toBe(true);
  const p=await panel.boundingBox(),v=page.viewportSize();
  expect(p && v).toBeTruthy();
  expect(p!.x).toBeGreaterThanOrEqual(0);
  expect(p!.x+p!.width).toBeLessThanOrEqual(v!.width+1);
  expect(p!.y).toBeGreaterThanOrEqual(0);
  expect(p!.y+p!.height).toBeLessThanOrEqual(v!.height+1);
  await menu.getByTestId('v25-wb-menu-backdrop').tap({position:{x:5,y:5}});
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('Pixel 7：＋メニューはEscapeで閉じ、再度の項目選択でのみ行を追加',async ({page}) => {
  await ready(page);
  const menu=page.locator('tr[data-v25-dnd-row="slot:roof"]').getByTestId('v25-wb-row-insert');
  const trigger=menu.locator('summary'), panel=menu.getByTestId('v25-wb-menu-panel');
  await trigger.tap();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await trigger.tap();
  await menu.getByTestId('v25-wb-insert-line').tap();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).tap();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('Pixel 7：最下部＋と行⋯も画面から切れず、スクロールで閉じる', async ({page}) => {
  await ready(page);
  const menu=page.locator('tr[data-v25-dnd-row="line:wall-extra-89"]').getByTestId('v25-wb-row-insert');
  await menu.locator('summary').scrollIntoViewIfNeeded();
  await menu.locator('summary').tap();
  const panel=menu.getByTestId('v25-wb-menu-panel');
  await expect(panel).toBeVisible();
  const p=await panel.boundingBox(),v=page.viewportSize();
  expect(p&&v).toBeTruthy();
  expect(p!.y).toBeGreaterThanOrEqual(0);
  expect(p!.y+p!.height).toBeLessThanOrEqual(v!.height+1);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const other=page.locator('tr[data-v25-dnd-row="line:roofLine"]').getByTestId('v25-wb-line-menu');
  await other.locator('summary').scrollIntoViewIfNeeded();
  await other.locator('summary').tap();
  await expect(other.getByTestId('v25-wb-menu-panel')).toBeVisible();
  await page.evaluate(() => window.scrollBy(0,200));
  await expect(other.getByTestId('v25-wb-menu-panel')).toBeHidden();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('Pixel 7：⋯から削除確認を開いても最前面の透明レイヤーが操作を妨げない',async ({page}) => {
  await ready(page);
  const line=page.locator('tr[data-v25-dnd-row="line:roofLine"]');
  const menu=line.getByTestId('v25-wb-line-menu');
  await menu.locator('summary').tap();
  await menu.getByTestId('v25-wb-line-delete').tap();
  const dialog=page.getByRole('dialog',{name:'この明細を削除しますか？'});
  await expect(dialog).toBeVisible();
  await expect(menu.getByTestId('v25-wb-menu-backdrop')).toBeHidden();
  await dialog.getByRole('button',{name:'キャンセル'}).tap();
  await expect(line).toBeVisible();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
