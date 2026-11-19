import { expect, test } from '@playwright/test';

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR #691 touch test requires disposable localhost');
  }
});

test('Pixel 7：タッチは左ハンドルのみで開始し、別工事項目へ安全に移動・破棄できる', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/pr691-e2e-row-move');
  const root=page.getByTestId('pr691-local-fixture');
  await expect(root).toBeVisible();

  const source=page.locator('tr[data-v25-dnd-row="slot:roof"]');
  const target=page.locator('tr[data-v25-dnd-row="line:sashLine"]');
  await source.getByTestId('v25-wb-row-drag-handle').scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const grip=await source.getByTestId('v25-wb-row-drag-handle').boundingBox();
  const dest=await target.boundingBox();
  expect(grip && dest).toBeTruthy();
  const x=grip!.x+grip!.width/2;
  const sy=grip!.y+grip!.height/2;
  const ey=dest!.y+dest!.height*0.75;

  // Chrome DevTools Protocolの実タッチイベント。合成DOMイベントではない。
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:sy}]});
  for(let i=1;i<=16;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:sy+(ey-sy)*i/16}]});
  }
  await expect(page.getByTestId('v25-wb-drop-indicator')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  await expect(page.locator('tr[data-v25-dnd-row="line:sashLine"] + tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();

  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.locator('tr[data-work-item="work:roof"] + tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);

  // ドラッグ用以外の入力操作は通常どおり使える。
  const name=page.locator('tr[data-v25-dnd-row="line:sashLine"] input[aria-label="品名"]');
  await name.fill('スマートフォンでも入力可能');
  await expect(name).toHaveValue('スマートフォンでも入力可能');
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
});


test('Pixel 7長い明細：実タッチを画面下端で保持すると画面外までスクロールし、指を離して停止', async ({page}) => {
  test.setTimeout(150_000);
  await page.goto('/pr691-e2e-row-move');
  const source=page.locator('tr[data-v25-dnd-row="slot:roof"]');
  const target=page.locator('tr[data-v25-dnd-row="line:wall-extra-70"]');
  const grip=source.getByTestId('v25-wb-row-drag-handle');
  await grip.scrollIntoViewIfNeeded();
  const box=await grip.boundingBox();
  expect(box).toBeTruthy();
  const x=box!.x+box!.width/2;
  const startY=box!.y+box!.height/2;
  const endY=await page.evaluate(() => window.innerHeight-14);
  const targetBefore=await target.boundingBox();
  expect(targetBefore && targetBefore.y > endY).toBeTruthy();

  const cdp=await page.context().newCDPSession(page);
  const before=await page.evaluate(() => window.scrollY);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:startY}]});
  for(let i=1;i<=16;i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:startY+(endY-startY)*i/16}]});
  }
  const reached=await page.evaluate(() => window.scrollY);
  await expect.poll(async () => page.evaluate(() => window.scrollY),{timeout:15_000})
    .toBeGreaterThan(Math.max(before+160,reached+100));
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect.poll(async () => target.evaluate((el) => {
    const r=el.getBoundingClientRect();
    return r.top>=100 && r.bottom<=window.innerHeight-85;
  }),{timeout:25_000}).toBe(true);

  // 端から少し離して自動スクロールを止めてから目標行の現在座標を測る。
  const safeY=await page.evaluate(() => Math.round(window.innerHeight*.45));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:safeY}]});
  const frozen=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(frozen);
  const destination=await target.boundingBox();
  expect(destination).toBeTruthy();
  await cdp.send('Input.dispatchTouchEvent',{
    type:'touchMove',touchPoints:[{x,y:destination!.y+destination!.height*.80}],
  });
  await expect(target).toHaveClass(/outline-emerald-600/);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('tr[data-v25-dnd-row="line:wall-extra-70"] + tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  const stopped=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(stopped);
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});


test('Pixel 7長い明細：ハンドル以外の実タッチスクロールは通常どおり動作し並び順を変更しない', async ({page}) => {
  test.setTimeout(90_000);
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0,0));
  const before=await page.evaluate(() => window.scrollY);
  const box=await page.evaluate(() => ({x:Math.round(window.innerWidth*.57),startY:window.innerHeight-130}));
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.startY}]});
  for(let i=1;i<=18;i++){
    await cdp.send('Input.dispatchTouchEvent',{
      type:'touchMove',touchPoints:[{x:box.x,y:box.startY-320*i/18}],
    });
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async () => page.evaluate(() => window.scrollY),{timeout:10_000})
    .toBeGreaterThan(before+70);
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});


test('Pixel 7：実touchcancelでキャプチャと自動スクロール停止、変更なし・再ドラッグ可能', async ({page}) => {
  test.setTimeout(150_000);
  await page.goto('/pr691-e2e-row-move');
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
  const source=page.locator('tr[data-v25-dnd-row="slot:roof"]');
  const target=page.locator('tr[data-v25-dnd-row="line:sashLine"]');
  const handle=source.getByTestId('v25-wb-row-drag-handle');
  await handle.scrollIntoViewIfNeeded();
  const grip=await handle.boundingBox();
  expect(grip).toBeTruthy();
  const x=grip!.x+grip!.width/2, sy=grip!.y+grip!.height/2;
  const edge=await page.evaluate(() => window.innerHeight-12);
  await page.evaluate(() => {
    document.addEventListener('pointerdown',(event) => {
      (window as typeof window & { __pr691TouchPointerId?: number }).__pr691TouchPointerId=event.pointerId;
    },{capture:true,once:true});
  });
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:sy}]});
  for(let i=1;i<=16;i++) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:sy+(edge-sy)*i/16}]});
  }
  const hasCapture=() => handle.evaluate((element) => {
    const pid=(window as typeof window & { __pr691TouchPointerId?: number }).__pr691TouchPointerId;
    return pid !== undefined && (element as HTMLButtonElement).hasPointerCapture(pid);
  });
  await expect.poll(hasCapture).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.scrollY),{timeout:15_000}).toBeGreaterThan(300);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await expect.poll(hasCapture).toBe(false);
  await expect(page.getByTestId('v25-wb-drop-indicator')).toHaveCount(0);
  const stopped=await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(stopped);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="work:roof"] + tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();

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
  const nextX=next!.x+next!.width/2, startY=next!.y+next!.height/2;
  const endY=dest!.y+dest!.height*.8;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:nextX,y:startY}]});
  for(let i=1;i<=16;i++) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:nextX,y:startY+(endY-startY)*i/16}]});
  }
  await expect(target).toHaveClass(/outline-emerald-600/);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('tr[data-v25-dnd-row="line:sashLine"] + tr[data-v25-dnd-row="slot:roof"]')).toBeVisible();
  await page.getByRole('button',{name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
