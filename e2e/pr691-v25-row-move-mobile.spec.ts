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
