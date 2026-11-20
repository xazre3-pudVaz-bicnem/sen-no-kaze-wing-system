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
  // Portal描画された項目は元行のDOM子ではない。表示中のパネルから特定する。
  const del=page.getByTestId('v25-wb-menu-panel').getByTestId('v25-wb-line-delete');
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
  // 移動先を確定する前に端から離す。画面端でスクロール中に座標を測ると行がずれる。
  const safeY=await page.evaluate(() => Math.round(window.innerHeight*.45));
  await page.mouse.move(x,safeY,{steps:3});
  const frozen=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(frozen);
  const destination=await target.boundingBox();
  expect(destination).toBeTruthy();
  await page.mouse.move(x,destination!.y+destination!.height*.80,{steps:2});
  await expect(target).toHaveClass(/outline-emerald-600/);
  await page.mouse.up();
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


test('PC長い明細：画面上端から逆方向へ自動スクロールし、別工事項目の指定行の直前へ移動', async ({page}) => {
  test.setTimeout(150_000);
  await ready(page);
  const source=row(page,'line','wall-extra-75');
  const target=row(page,'line','sashLine');
  const grip=source.getByTestId('v25-wb-row-drag-handle');
  await grip.scrollIntoViewIfNeeded();
  const box=await grip.boundingBox();
  expect(box).toBeTruthy();
  const before=await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);
  const targetBefore=await target.boundingBox();
  expect(targetBefore && targetBefore.y < 0).toBeTruthy();

  const x=box!.x+box!.width/2,y=box!.y+box!.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,10,{steps:15});
  const reached=await page.evaluate(() => window.scrollY);
  await expect.poll(async () => page.evaluate(() => window.scrollY),{timeout:15_000})
    .toBeLessThan(Math.min(before-180,reached-100));
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);

  await expect.poll(async () => target.evaluate((el) => {
    const r=el.getBoundingClientRect();
    return r.top>=90 && r.bottom<=window.innerHeight-85;
  }),{timeout:25_000}).toBe(true);
  const safeY=await page.evaluate(() => Math.round(window.innerHeight*.52));
  await page.mouse.move(x,safeY,{steps:3});
  const frozen=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(frozen);

  const dest=await target.boundingBox();
  expect(dest).toBeTruthy();
  await page.mouse.move(x,dest!.y+dest!.height*.2,{steps:2});
  await expect(target).toHaveClass(/outline-emerald-600/);
  await page.mouse.up();
  await expect(page.locator(id('line','wall-extra-75')+' + '+id('line','sashLine'))).toBeVisible();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});


test('PC：Escape時にポインターキャプチャと自動スクロールを解放し、同じ行を再ドラッグできる', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  const source=row(page,'slot','roof');
  const handle=source.getByTestId('v25-wb-row-drag-handle');
  const target=row(page,'line','sashLine');
  await handle.scrollIntoViewIfNeeded();
  const grip=await handle.boundingBox();
  expect(grip).toBeTruthy();
  const x=grip!.x+grip!.width/2, y=grip!.y+grip!.height/2;
  const edge=await page.evaluate(() => window.innerHeight-12);
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      (window as typeof window & { __pr691PointerId?: number }).__pr691PointerId=event.pointerId;
    }, { capture:true, once:true });
  });

  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,edge,{steps:15});
  const hasCapture=() => handle.evaluate((element) => {
    const pid=(window as typeof window & { __pr691PointerId?: number }).__pr691PointerId;
    return pid !== undefined && (element as HTMLButtonElement).hasPointerCapture(pid);
  });
  await expect.poll(hasCapture).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.scrollY),{timeout:15_000}).toBeGreaterThan(300);
  await page.keyboard.press('Escape');
  await expect.poll(hasCapture).toBe(false);
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  const stopped=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(stopped);
  await page.mouse.up();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="work:roof"] + '+id('slot','roof'))).toBeVisible();

  // The same handle must remain usable after Escape.
  // Cancellation occurred after long auto-scroll; restore a stable viewport
  // before measuring both rows for the next drag (avoid stale/offscreen coordinates).
  await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  await expect(handle).toBeInViewport();
  await expect(target).toBeInViewport();
  const next=await handle.boundingBox(), dest=await target.boundingBox();
  expect(next && dest).toBeTruthy();
  const nextX=next!.x+next!.width/2;
  await page.mouse.move(nextX,next!.y+next!.height/2);
  await page.mouse.down();
  await page.mouse.move(nextX,dest!.y+dest!.height*.8,{steps:12});
  await expect(target).toHaveClass(/outline-emerald-600/);
  await page.mouse.up();
  await expect(page.locator(id('line','sashLine')+' + '+id('slot','roof'))).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});

test('PC：pointercancelでキャプチャを解放し、工事項目・順序・未保存状態を変更しない', async ({ page }) => {
  await ready(page);
  const handle=row(page,'slot','roof').getByTestId('v25-wb-row-drag-handle');
  const target=row(page,'line','sashLine');
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const grip=await handle.boundingBox(), dest=await target.boundingBox();
  expect(grip && dest).toBeTruthy();
  const x=grip!.x+grip!.width/2;
  await page.evaluate(() => {
    document.addEventListener('pointerdown',(event) => {
      (window as typeof window & { __pr691PointerId?: number }).__pr691PointerId=event.pointerId;
    }, {capture:true,once:true});
  });
  await page.mouse.move(x,grip!.y+grip!.height/2);
  await page.mouse.down();
  await page.mouse.move(x,dest!.y+dest!.height*.8,{steps:12});
  await expect(page.getByTestId('v25-wb-drop-indicator')).toBeVisible();
  await handle.evaluate((element) => {
    const pid=(window as typeof window & { __pr691PointerId?: number }).__pr691PointerId;
    if (pid === undefined) throw new Error('Missing captured pointer id');
    if (!(element as HTMLButtonElement).hasPointerCapture(pid)) throw new Error('Pointer not captured before cancel');
    element.dispatchEvent(new PointerEvent('pointercancel', { bubbles:true, pointerId:pid, pointerType:'mouse', isPrimary:true }));
    if ((element as HTMLButtonElement).hasPointerCapture(pid)) throw new Error('Pointer still captured after cancel');
  });
  await page.mouse.up();
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="work:roof"] + '+id('slot','roof'))).toBeVisible();
  await expect(page.locator('tr[data-work-item="work:sash_wood"] + '+id('slot','sash'))).toBeVisible();

  // A subsequent genuine drag still works.
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const again=await handle.boundingBox(), destination=await target.boundingBox();
  expect(again && destination).toBeTruthy();
  const againX=again!.x+again!.width/2;
  await page.mouse.move(againX,again!.y+again!.height/2);
  await page.mouse.down();
  await page.mouse.move(againX,destination!.y+destination!.height*.8,{steps:12});
  await page.mouse.up();
  await expect(page.locator(id('line','sashLine')+' + '+id('slot','roof'))).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
});
