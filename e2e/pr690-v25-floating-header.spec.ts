import { expect, test, devices, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const FIXTURE = '/pr690-local-floating';
const GRID = '[data-testid="v25-excel-grid-scroll"]';
const FLOAT = '[data-testid="v25-page-floating-column-header"]';

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Floating header visual acceptance is permitted on disposable localhost only');
  }
});

async function scrollPastNativeHeader(page: Page) {
  await page.evaluate(() => {
    const source = document.querySelector('[data-testid="v25-workbench-grid"] thead');
    if (!source) throw new Error('Actual v2.5 thead missing');
    window.scrollBy(0, source.getBoundingClientRect().bottom + 130);
  });
  await expect(page.locator(FLOAT)).toBeVisible();
}

async function getBounds(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="v25-excel-grid-scroll"]')!;
    const source = grid.querySelector('thead')!;
    const save = document.querySelector('[data-testid="v25-wb-save-area"]')!;
    return {
      gridBottom: grid.getBoundingClientRect().bottom,
      nativeBottom: source.getBoundingClientRect().bottom,
      saveTop: save.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      documentScroll: document.documentElement.scrollHeight,
    };
  });
}

async function assertMatchingHeader(page: Page) {
  const metrics = await page.evaluate(() => {
    const original = document.querySelector('[data-testid="v25-workbench-grid"] thead')!;
    const mirror = document.querySelector('[data-testid="v25-page-floating-column-header"] thead')!;
    const sourceCells = Array.from(original.querySelectorAll('th'));
    const mirroredCells = Array.from(mirror.querySelectorAll('th'));
    return {
      count: sourceCells.length,
      mirroredCount: mirroredCells.length,
      source: sourceCells.map((c) => ({ key: c.dataset.v25Column, width: c.getBoundingClientRect().width, background: getComputedStyle(c).backgroundColor, color: getComputedStyle(c).color, size: parseFloat(getComputedStyle(c).fontSize), height: c.getBoundingClientRect().height })),
      mirror: mirroredCells.map((c) => ({ key: c.dataset.v25Column, width: c.getBoundingClientRect().width, background: getComputedStyle(c).backgroundColor, color: getComputedStyle(c).color, size: parseFloat(getComputedStyle(c).fontSize), height: c.getBoundingClientRect().height })),
    };
  });
  expect(metrics.count).toBeGreaterThan(5);
  expect(metrics.mirroredCount).toBe(metrics.count);
  for (let index = 0; index < metrics.count; index++) {
    const src = metrics.source[index];
    const mirror = metrics.mirror[index];
    expect(mirror.key).toBe(src.key);
    expect(Math.abs(mirror.width - src.width)).toBeLessThanOrEqual(2);
    // Modern Chromium may report Tailwind colors in Lab/OKLCH rather than rgb.
    // Verify the intended classes and exact native/floating computed-color parity.
    expect(src.background).not.toBe('transparent');
    expect(mirror.background).toBe(src.background);
    expect(mirror.color).toBe(src.color);
    expect(src.size).toBeGreaterThanOrEqual(12);
    expect(mirror.size).toBe(src.size);
    expect(src.height).toBeGreaterThanOrEqual(32);
    expect(src.height).toBeLessThanOrEqual(36);
  }
}

test('PC｜ページ縦スクロールで固定・保存欄が見えても維持・表終端で解除', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto(FIXTURE);
  await expect(page.locator('[data-testid="v25-workbench-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="v25-wb-save-area"]')).toHaveCount(1);
  await expect(page.locator(FLOAT)).toHaveCount(1);
  await expect(page.locator(FLOAT)).toBeHidden();
  await scrollPastNativeHeader(page);
  await assertMatchingHeader(page);
  await mkdir('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/pr690-pc-floating.png', fullPage: false });

  // Former failure: save controls become visible below the fold, long before the table ends.
  await page.evaluate(() => {
    const save = document.querySelector('[data-testid="v25-wb-save-area"]')!;
    window.scrollBy(0, save.getBoundingClientRect().top - window.innerHeight + 70);
  });
  const nearEnd = await getBounds(page);
  console.log('[PR690 SAVE AREA]', JSON.stringify(nearEnd));
  expect(nearEnd.saveTop).toBeLessThan(nearEnd.viewportHeight);
  expect(nearEnd.nativeBottom).toBeLessThanOrEqual(0);
  expect(nearEnd.gridBottom).toBeGreaterThan(35);
  await expect(page.locator(FLOAT)).toBeVisible();
  await assertMatchingHeader(page);
  await page.screenshot({ path: 'e2e/artifacts/pr690-pc-save-approaching.png', fullPage: false });

  await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="v25-excel-grid-scroll"]')!;
    window.scrollBy(0, grid.getBoundingClientRect().bottom + 85);
  });
  await expect(page.locator(FLOAT)).toBeHidden();
  const beyond = await getBounds(page);
  console.log('[PR690 AFTER TABLE]', JSON.stringify(beyond));
  expect(beyond.gridBottom).toBeLessThan(0);
  await page.screenshot({ path: 'e2e/artifacts/pr690-pc-after-table.png', fullPage: false });
});

test('PC狭幅｜横スクロール同期・原価ON/OFF・列幅変更・デザイン一致', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 760, height: 760 });
  await page.goto(FIXTURE);
  await scrollPastNativeHeader(page);
  const grid = page.locator(GRID);
  const floating = page.locator(FLOAT);
  await expect(grid.locator('th')).toHaveCount(10);
  await assertMatchingHeader(page);

  await grid.evaluate((el) => { el.scrollLeft = 145; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(async () => floating.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  const scrolls = await page.evaluate(() => {
    const original = document.querySelector('[data-testid="v25-excel-grid-scroll"]') as HTMLElement;
    const fixed = document.querySelector('[data-testid="v25-page-floating-column-header"]') as HTMLElement;
    const originalQty = original.querySelector('[data-v25-column="quantity"]')!.getBoundingClientRect().x;
    const fixedQty = fixed.querySelector('[data-v25-column="quantity"]')!.getBoundingClientRect().x;
    return { originalScroll: original.scrollLeft, fixedScroll: fixed.scrollLeft, originalQty, fixedQty };
  });
  console.log('[PR690 HORIZONTAL]', JSON.stringify(scrolls));
  expect(Math.abs(scrolls.originalScroll - scrolls.fixedScroll)).toBeLessThanOrEqual(1);
  expect(Math.abs(scrolls.originalQty - scrolls.fixedQty)).toBeLessThanOrEqual(2);

  // Change column width using the actual keyboard-accessible resize handle.
  const nameHandle = grid.getByTestId('v25-grid-resize-name');
  const widthBefore = await grid.locator('th[data-v25-column="name"]').evaluate((c) => c.getBoundingClientRect().width);
  await nameHandle.focus();
  await nameHandle.press('ArrowRight');
  await expect.poll(async () => grid.locator('th[data-v25-column="name"]').evaluate((c) => c.getBoundingClientRect().width))
    .toBeGreaterThan(widthBefore);
  await expect(floating).toBeVisible();
  await assertMatchingHeader(page);

  // The cost switch is UI-only; the actual column list and floating header must update together.
  await page.getByTestId('v25-grid-column-menu').locator('summary').click();
  await page.getByTestId('v25-wb-show-cost').uncheck();
  await expect(grid.locator('th')).toHaveCount(7);
  await expect(floating).toBeVisible();
  await assertMatchingHeader(page);
  await page.screenshot({ path: 'e2e/artifacts/pr690-pc-cost-off.png', fullPage: false });

  await page.getByTestId('v25-wb-show-cost').check();
  await expect(grid.locator('th')).toHaveCount(10);
  await expect(floating).toBeVisible();
  await assertMatchingHeader(page);
  await page.screenshot({ path: 'e2e/artifacts/pr690-pc-cost-on.png', fullPage: false });
});

test('スマートフォン｜ページ縦スクロールの見出し追従と横スクロール同期', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  try {
    await page.goto(FIXTURE);
    await scrollPastNativeHeader(page);
    await assertMatchingHeader(page);
    const grid = page.locator(GRID);
    await grid.evaluate((el) => { el.scrollLeft = 220; el.dispatchEvent(new Event('scroll')); });
    await expect.poll(async () => page.locator(FLOAT).evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await expect(page.locator(FLOAT)).toBeVisible();
    await mkdir('e2e/artifacts', { recursive: true });
    await page.screenshot({ path: 'e2e/artifacts/pr690-mobile-floating.png', fullPage: false });
  } finally {
    await context.close();
  }
});
