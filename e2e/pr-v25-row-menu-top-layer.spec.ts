import { expect, test, type Page } from '@playwright/test';

const insertMenu = (page: Page) => page.locator('tr[data-v25-dnd-row="slot:roof"]').getByTestId('v25-wb-row-insert');
const lineMenu = (page: Page) => page.locator('tr[data-v25-dnd-row="line:roofLine"]').getByTestId('v25-wb-line-menu');
const panel = (menu: ReturnType<typeof insertMenu>) => menu.getByTestId('v25-wb-menu-panel');
const backdrop = (menu: ReturnType<typeof insertMenu>) => menu.getByTestId('v25-wb-menu-backdrop');
const ready = async (page: Page) => {
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
  await expect(page.locator('tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();
};
test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Menu browser suite requires a disposable localhost server');
  }
});

test('＋メニューはスクロール表の外へ出てTop Layerに表示され、画面端でも収まる', async ({ page }) => {
  await ready(page);
  const menu=insertMenu(page);
  await menu.locator('summary').click();
  await expect(panel(menu)).toBeVisible();
  await expect(backdrop(menu)).toBeVisible();
  expect(await panel(menu).evaluate(el=>el.matches(':popover-open'))).toBe(true);
  const panelBox=await panel(menu).boundingBox();
  const viewport=page.viewportSize();
  expect(panelBox && viewport).toBeTruthy();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x+panelBox!.width).toBeLessThanOrEqual(viewport!.width+1);
  expect(panelBox!.y+panelBox!.height).toBeLessThanOrEqual(viewport!.height+1);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('枠外クリック／タップは閉じるだけで、明細追加も保存も起きない', async ({ page, isMobile }) => {
  await ready(page);
  const menu=insertMenu(page);
  await menu.locator('summary').click();
  await expect(panel(menu)).toBeVisible();
  if (isMobile) await backdrop(menu).tap(); else await backdrop(menu).click({position:{x:5,y:5}});
  await expect(panel(menu)).toBeHidden();
  await expect(menu).not.toHaveAttribute('open','');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator('tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();
});

test('Escapeで閉じ、フォーカスが＋へ戻る。再度開いて項目選択でだけ行を追加', async ({ page }) => {
  await ready(page);
  const menu=insertMenu(page);
  const trigger=menu.locator('summary');
  await trigger.click();
  await expect(panel(menu)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(menu)).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await trigger.click();
  await expect(panel(menu)).toBeVisible();
  await menu.getByTestId('v25-wb-insert-line').click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('行操作メニューも最前面に表示し、枠外とスクロールで閉じる', async ({ page }) => {
  await ready(page);
  const menu=lineMenu(page);
  await menu.locator('summary').click();
  await expect(panel(menu)).toBeVisible();
  expect(await panel(menu).evaluate(el=>el.matches(':popover-open'))).toBe(true);
  await page.mouse.wheel(0,240);
  await expect(panel(menu)).toBeHidden();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await menu.locator('summary').click();
  await expect(panel(menu)).toBeVisible();
  await backdrop(menu).click({position:{x:5,y:5}});
  await expect(panel(menu)).toBeHidden();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('長い明細の最下部から＋メニューを開いても画面内に表示される', async ({ page }) => {
  await ready(page);
  const bottom=page.locator('tr[data-v25-dnd-row="line:wall-extra-89"]');
  const menu=bottom.getByTestId('v25-wb-row-insert');
  await menu.locator('summary').scrollIntoViewIfNeeded();
  await menu.locator('summary').click();
  await expect(panel(menu)).toBeVisible();
  const r=await panel(menu).boundingBox(), v=page.viewportSize();
  expect(r && v).toBeTruthy();
  expect(r!.y).toBeGreaterThanOrEqual(0);
  expect(r!.y+r!.height).toBeLessThanOrEqual(v!.height+1);
  await page.keyboard.press('Escape');
  await expect(panel(menu)).toBeHidden();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
