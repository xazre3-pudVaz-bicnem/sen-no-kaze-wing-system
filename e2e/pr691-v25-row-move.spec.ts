import { expect, test, type Page } from '@playwright/test';

const id = (kind: 'slot' | 'line', key: string) => `tr[data-v25-dnd-row="${kind}:${key}"]`;
const row = (page: Page, kind: 'slot' | 'line', key: string) => page.locator(id(kind,key));
const ready = async (page: Page) => {
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
  await expect(row(page,'slot','roof')).toBeVisible();
};
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR #691 browser suite requires an isolated localhost Next server');
  }
});

test('PC：↑↓で工事項目を越え、自動更新・未保存・変更を破棄', async ({ page }) => {
  await ready(page);
  const roofHeading = page.locator('tr[data-work-item="work:roof"]');
  const sashHeading = page.locator('tr[data-work-item="work:sash_wood"]');
  await expect(sashHeading.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-v25-dnd-row','slot:sash');
  await expect(roofHeading.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-v25-dnd-row','slot:roof');

  // サッシ工事項目の末尾にある手入力を、↓で屋根工事の先頭へ移動。
  const sashLine=row(page,'line','sashLine');
  await expect(sashLine.getByTestId('v25-wb-row-down')).toBeEnabled();
  await sashLine.getByTestId('v25-wb-row-down').click();
  await expect(roofHeading.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-v25-dnd-row','line:sashLine');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await expect(page.getByTestId('v25-wb-save')).toBeEnabled();

  // 保存前に破棄すると、工事項目と元の順序が同時に復元される。
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(sashHeading.locator('xpath=following-sibling::tr[2]')).toHaveAttribute('data-v25-dnd-row','line:sashLine');
  await expect(roofHeading.locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-v25-dnd-row','slot:roof');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('PC：ドラッグで別工事項目に移動し、明示的な移動先を表示', async ({ page }) => {
  await ready(page);
  const origin=row(page,'slot','roof').getByTestId('v25-wb-row-drag-handle');
  const destination=row(page,'line','sashLine');
  await origin.scrollIntoViewIfNeeded();
  await destination.scrollIntoViewIfNeeded();
  const grip=await origin.boundingBox(), dest=await destination.boundingBox();
  expect(grip && dest).toBeTruthy();
  const start={x:grip!.x+grip!.width/2,y:grip!.y+grip!.height/2};
  const end={x:grip!.x+grip!.width/2,y:dest!.y+dest!.height*0.75};
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:12});
  await expect(page.getByTestId('v25-wb-drop-indicator')).toBeVisible();
  await expect(destination).toHaveClass(/outline-emerald-600/);
  await page.mouse.up();
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  await expect(page.locator(id('line','sashLine')+' + '+id('slot','roof'))).toBeVisible();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.locator('tr[data-work-item="work:roof"] + '+id('slot','roof'))).toBeVisible();
});

test('PC：入力欄の操作とドラッグを分離。右端…内の削除は確認付き', async ({ page }) => {
  await ready(page);
  const line=row(page,'line','roofLine');
  await expect(line.getByTestId('v25-wb-manual-move-up')).toHaveCount(0);
  await expect(line.getByTestId('v25-wb-manual-move-down')).toHaveCount(0);
  await line.locator('input[aria-label="品名"]').fill('入力欄を編集');
  await expect(line.locator('input[aria-label="品名"]')).toHaveValue('入力欄を編集');
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  const menu=line.getByTestId('v25-wb-line-menu');
  await menu.locator('summary').click();
  const del=menu.getByTestId('v25-wb-line-delete');
  await expect(del).toBeVisible();
  await del.click();
  const dialog=page.getByRole('dialog',{name:'この明細を削除しますか？'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'キャンセル'}).click();
  await expect(line).toBeVisible();
  await del.click();
  await dialog.getByRole('button',{name:'削除する'}).click();
  await expect(line).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
});

test('PC：別大区分へのドラッグ・ハンドルのタップは何も変更しない', async ({ page }) => {
  await ready(page);
  const grip=row(page,'slot','sash').getByTestId('v25-wb-row-drag-handle');
  const site=row(page,'slot','site');
  await grip.scrollIntoViewIfNeeded();
  await site.scrollIntoViewIfNeeded();
  const a=await grip.boundingBox(),b=await site.boundingBox();
  expect(a && b).toBeTruthy();
  await grip.click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await page.mouse.move(a!.x+8,a!.y+a!.height/2);
  await page.mouse.down();
  await page.mouse.move(a!.x+8,b!.y+b!.height/2,{steps:15});
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="work:sash_wood"] + '+id('slot','sash'))).toBeVisible();
});
