import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({page,baseURL}) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Only isolated localhost test server is allowed');
  }
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
});
const source = (page:Page) => page.locator('tr[data-v25-dnd-row="slot:roof"]');
const insert = (page:Page) => source(page).getByTestId('v25-wb-row-insert');
const panel = (page:Page) => page.getByTestId('v25-wb-menu-panel');

test('PC：＋メニューはbody Portalで表のセルより上に表示し、枠外・Escapeで無変更のまま閉じる',async ({page})=>{
  const menu=insert(page);
  await menu.locator('summary').click();
  await expect(panel(page)).toBeVisible();
  expect(await panel(page).evaluate(el=>el.parentElement===document.body || el.parentElement?.parentElement===document.body)).toBe(true);
  const uncovered=await panel(page).evaluate(el=>{
    const rect=el.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+Math.min(18,rect.height/2));
    return hit===el || Boolean(hit&&el.contains(hit));
  });
  expect(uncovered).toBe(true);
  await page.getByTestId('v25-wb-menu-backdrop').click({position:{x:3,y:3}});
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);

  await menu.locator('summary').click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(menu.locator('summary')).toBeFocused();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('PC：行直下への追加だけで明細が増え、スクロールで未操作メニューが閉じる',async ({page})=>{
  const menu=insert(page);
  await menu.locator('summary').click();
  await expect(panel(page)).toBeVisible();
  // Trigger the same captured scroll event fired by page/table scrolling.
  // A synthetic event is used here because the viewport may have been auto-scrolled
  // by the Playwright click before the test reaches this step.
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await menu.locator('summary').click();
  await panel(page).getByTestId('v25-wb-insert-line').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('PC：下端と右端でもメニューを画面内に配置し、行操作の選択・削除確認を保持',async ({page})=>{
  const menu=page.locator('tr[data-v25-dnd-row="line:wall-extra-75"]').getByTestId('v25-wb-row-insert');
  await menu.locator('summary').scrollIntoViewIfNeeded();
  await menu.locator('summary').click();
  await expect(panel(page)).toBeVisible();
  const bounds=await panel(page).boundingBox();
  const size=page.viewportSize();
  expect(bounds&&size).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(size!.width+1);
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(size!.height+1);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);

  const lineMenu=page.locator('tr[data-v25-dnd-row="line:roofLine"]').getByTestId('v25-wb-line-menu');
  await lineMenu.locator('summary').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByTestId('v25-wb-line-delete').click();
  await expect(page.getByRole('dialog',{name:'この明細を削除しますか？'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'この明細を削除しますか？'})).toHaveCount(0);
  await expect(page.locator('tr[data-v25-dnd-row="line:roofLine"]')).toBeVisible();
  await page.getByTestId('v25-wb-menu-backdrop').click({position:{x:3,y:3}});
  await expect(panel(page)).toHaveCount(0);
});

