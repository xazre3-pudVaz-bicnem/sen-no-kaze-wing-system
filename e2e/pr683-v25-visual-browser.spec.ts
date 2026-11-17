import { expect, test, devices, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const FIXTURE = '/pr683-local-visual';
const cardSelector = '[data-testid="v25-selector-entry"]';
const SELECTOR = '[data-testid="standard-estimate-selector"]';

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Only disposable localhost is allowed for PR #683 visual acceptance');
  }
});

async function expand(page: Page) {
  const button = page.getByTestId('standard-estimate-selector-toggle');
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('standard-estimate-selector')).toBeVisible();
  await expect(page.locator(cardSelector)).toHaveCount(10);
}

async function assertNoOverlap(page: Page) {
  const rects = await page.locator(cardSelector).evaluateAll((cards) => cards.map((card) => {
    const bounds = card.getBoundingClientRect();
    const sections = Array.from(card.children).map((el) => el.getBoundingClientRect());
    const price = card.querySelector('[data-testid="v25-selector-published-total"]')?.getBoundingClientRect();
    return {
      cardWidth: bounds.width,
      cardRight: bounds.right,
      cardLeft: bounds.left,
      titleToPriceGap: sections[1]?.top - sections[0]?.bottom,
      priceToRevisionGap: sections[2]?.top - sections[1]?.bottom,
      priceWidth: price?.width ?? 0,
      priceRight: price?.right ?? 0,
    };
  }));
  for (const card of rects) {
    expect(card.cardWidth).toBeGreaterThan(245);
    expect(card.titleToPriceGap).toBeGreaterThanOrEqual(-1);
    expect(card.priceToRevisionGap).toBeGreaterThanOrEqual(-1);
    expect(card.priceRight).toBeLessThanOrEqual(card.cardRight + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    .toBe(true);
}

async function countGridColumns(page: Page) {
  return page.locator('[data-testid="v25-selector-grid"]').first().evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  );
}

test('PC｜10仕様の高さ・3列・公開価格と6件の別途見積・折り畳みと未保存キャンセル', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(FIXTURE);
  const toggle = page.getByTestId('standard-estimate-selector-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expand(page);

  expect(await countGridColumns(page)).toBe(3);
  await assertNoOverlap(page);
  await expect(page.locator(SELECTOR).locator('[data-testid="v25-selector-product"]')).toHaveCount(3);
  await expect(page.locator(cardSelector).filter({ hasText: '＋別途見積' })).toHaveCount(6);
  await expect(page.getByTestId('v25-selector-por-note'))
    .toContainText('上記価格に含まれません');
  const first = page.locator(cardSelector).first();
  await expect(first).toContainText('¥6,939,959');
  await expect(first).toContainText('公開 第2版');
  await expect(first).toContainText('下書き 第3版');

  const height = await page.locator(SELECTOR).evaluate((el) => el.getBoundingClientRect().height);
  const toggleBox = await toggle.boundingBox();
  const sheetBox = await page.getByTestId('pr683-fake-estimate-sheet').boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  const topToSheet = sheetBox!.y - toggleBox!.y;
  console.log('[PR683 PC]', JSON.stringify({ selectorHeightPx: height, toggleToMockSheetPx: topToSheet, viewport: '1440x900' }));
  expect(height).toBeLessThan(800);
  expect(topToSheet).toBeLessThan(1050);

  await mkdir('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/pr683-pc-1440.png', fullPage: true });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('v25-selected-spec-summary')).toBeVisible();
  await expand(page);

  await page.getByTestId('pr683-set-dirty').click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  const before = page.url();
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('保存していない変更');
    await dialog.dismiss();
  });
  await page.locator(cardSelector).nth(1).click();
  expect(page.url()).toBe(before);
  await expect(first).toHaveAttribute('aria-current', 'page');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator(cardSelector).nth(1).click();
  // The actual card targets the admin page, which correctly requires login.
  // Verify the chosen master survives the redirect without attempting login.
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next'))
    .toBe('/admin/estimate-templates?master=pr683-spec-1');

  // Test selected-state rendering independently on this disposable fixture.
  // This is NOT an authenticated admin navigation acceptance test.
  await page.goto(FIXTURE + '?master=pr683-spec-1');
  await expand(page);
  await expect(page.locator(cardSelector).nth(1)).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 820, height: 1024 });
  await expand(page);
  expect(await countGridColumns(page)).toBe(2);
  await assertNoOverlap(page);
  console.log('[PR683 TABLET]', JSON.stringify({ viewport: '820x1024', columns: 2 }));
});

test('スマートフォン｜1列・価格と版情報の重なりなし・全10仕様・6件の別途見積', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  try {
    await page.goto(FIXTURE);
    await expand(page);
    expect(await countGridColumns(page)).toBe(1);
    await assertNoOverlap(page);
    await expect(page.locator(cardSelector)).toHaveCount(10);
    await expect(page.locator(cardSelector).filter({ hasText: '＋別途見積' })).toHaveCount(6);
    await expect(page.getByTestId('v25-selector-por-note')).toBeVisible();

    const prices = await page.locator('[data-testid="v25-selector-published-total"]').allTextContents();
    expect(prices.map((value) => value.trim())).toEqual([
      '¥6,939,959', '¥5,571,173', '¥4,051,965', '¥4,112,807', '¥3,006,983',
      '¥3,075,293', '¥2,679,597', '¥2,679,597', '¥2,672,610', '¥1,903,674',
    ]);

    const height = await page.locator(SELECTOR).evaluate((el) => el.getBoundingClientRect().height);
    console.log('[PR683 MOBILE]', JSON.stringify({
      selectorHeightPx: height, viewportWidth: await page.evaluate(() => window.innerWidth),
      fullPageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
    }));
    await mkdir('e2e/artifacts', { recursive: true });
    await page.screenshot({ path: 'e2e/artifacts/pr683-mobile-pixel7.png', fullPage: true });

    await page.getByTestId('standard-estimate-selector-toggle').click();
    await expect(page.getByTestId('standard-estimate-selector-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('v25-selected-spec-summary')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
