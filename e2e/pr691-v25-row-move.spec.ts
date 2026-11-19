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


test('PC長い明細：端でドラッグを保持すると画面外の工事項目まで自動スクロールし、途中で勝手に確定しない', async ({ page }) => {
  test.setTimeout(150_000);
  await ready(page);
  const source=row(page,'slot','roof');
  const target=row(page,'line','wall-extra-65');
  const handle=source.getByTestId('v25-wb-row-drag-handle');
  await handle.scrollIntoViewIfNeeded();
  const grip=await handle.boundingBox();
  expect(grip).toBeTruthy();
  const x=grip!.x+grip!.width/2;
  const y=grip!.y+grip!.height/2;
  const before=await page.evaluate(() => window.scrollY);
  const edge=await page.evaluate(() => window.innerHeight-12);
  const targetBefore=await target.boundingBox();
  expect(targetBefore && targetBefore.y > edge).toBeTruthy();

  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,edge,{steps:18});
  // ポインターが静止してもrequestAnimationFrameでスクロールし続ける。
  const reached=await page.evaluate(() => window.scrollY);
  await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout:15_000 })
    .toBeGreaterThan(Math.max(before+180,reached+100));
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);

  await expect.poll(async () => {
    return target.evaluate((el) => {
      const r=el.getBoundingClientRect();
      return r.top >= 90 && r.bottom <= window.innerHeight-85;
    });
  },{timeout:25_000}).toBe(true);
  const destination=await target.boundingBox();
  expect(destination).toBeTruthy();
  await page.mouse.move(x,destination!.y+destination!.height*.55,{steps:7});
  await expect(page.getByTestId('v25-wb-drop-indicator')).toBeVisible();
  const highlightedBeforeDrop=await page.locator('tr[data-v25-dnd-row].outline-emerald-600').evaluateAll(
    (els) => els.map(el => ({ id:(el as HTMLElement).dataset.v25DndRow, y:el.getBoundingClientRect().y }))
  );
  console.log('LONG_DRAG_BEFORE_DROP', JSON.stringify(highlightedBeforeDrop));
  await page.mouse.up();
  console.log('LONG_DRAG_AFTER_DROP', JSON.stringify(await source.evaluate(el => ({prior:(el.previousElementSibling as HTMLElement)?.dataset.v25DndRow,next:(el.nextElementSibling as HTMLElement)?.dataset.v25DndRow,group:(el.previousElementSibling?.closest('tr[data-work-item]') as HTMLElement)?.dataset.workItem}))));

  await expect(page.locator(id('line','wall-extra-65')+' + '+id('slot','roof'))).toBeVisible();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  const afterDrop=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(afterDrop);
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="work:roof"] + '+id('slot','roof'))).toBeVisible();
});

test('PC長い明細：端スクロール中のEscキャンセル、通常スクロール・タップは並び順を変えない', async ({page}) => {
  test.setTimeout(120_000);
  await ready(page);
  const handle=row(page,'slot','roof').getByTestId('v25-wb-row-drag-handle');
  await handle.scrollIntoViewIfNeeded();
  const box=await handle.boundingBox();
  expect(box).toBeTruthy();
  const x=box!.x+box!.width/2, y=box!.y+box!.height/2;
  const edge=await page.evaluate(() => window.innerHeight-10);
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,edge,{steps:12});
  await expect.poll(async () => page.evaluate(() => window.scrollY),{timeout:15_000}).toBeGreaterThan(300);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  const cancelledAt=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(cancelledAt);
  await page.mouse.up();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await page.mouse.move(x,edge);
  const stationary=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(stationary);
  // 通常のページwheelは妨げない。
  await page.mouse.wheel(0,250);
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(stationary);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
