import { expect, test } from '@playwright/test';

test.beforeEach(async ({page,baseURL})=>{
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) throw new Error('localhost only');
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
});
const source=(page:import('@playwright/test').Page)=>page.locator('tr[data-v25-dnd-row="slot:roof"]');
const insert=(page:import('@playwright/test').Page)=>source(page).getByTestId('v25-wb-row-insert');
const panel=(page:import('@playwright/test').Page)=>page.getByTestId('v25-wb-menu-panel');

test('スマートフォン：＋の開閉・外側タップ・項目選択で表示が切れない',async ({page})=>{
  const menu=insert(page);
  await menu.locator('summary').click();
  await expect(panel(page)).toBeVisible();
  const bounds=await panel(page).boundingBox(),size=page.viewportSize();
  expect(bounds&&size).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(size!.width+1);
  await page.getByTestId('v25-wb-menu-backdrop').tap({force:true});
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await menu.locator('summary').click();
  await panel(page).getByTestId('v25-wb-insert-line').tap();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
});
