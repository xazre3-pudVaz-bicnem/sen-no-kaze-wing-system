import { expect, test, devices, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const FIXTURE = '/pr683-local-visual';
const CARD = '[data-testid="v25-selector-entry"]';
const SELECTOR = '[data-testid="standard-estimate-selector"]';
const GROUP = '[data-testid="v25-selector-product"]';

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Only disposable localhost is allowed for PR #683 visual acceptance');
  }
});

async function expand(page: Page) {
  const toggle = page.getByTestId('standard-estimate-selector-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(SELECTOR)).toBeVisible();
  await expect(page.locator(CARD)).toHaveCount(10);
}

async function assertCompactLayout(page: Page) {
  const panel = page.locator('#standard-estimate-selector-panel');
  const nav = page.locator(SELECTOR);
  const width = await nav.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(400);
  expect(width).toBeGreaterThan(260);
  const panelWidth = await panel.evaluate((el) => el.getBoundingClientRect().width);
  expect(panelWidth).toBeLessThanOrEqual(380.5);
  const open = page.locator(GROUP + '[open]');
  await expect(open).toHaveCount(1);
  const visible = page.locator(CARD + ':visible');
  expect(await visible.count()).toBeGreaterThan(0);
  const boxes = await visible.evaluateAll((cards) => cards.map((card) => {
    const rect = card.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, right: rect.right };
  }));
  expect(boxes[0].width).toBeGreaterThan(245);
  for (let index = 1; index < boxes.length; index++) {
    expect(Math.abs(boxes[index].x - boxes[0].x)).toBeLessThan(1);
    expect(boxes[index].y).toBeGreaterThan(boxes[index - 1].y);
  }
  const list = open.getByTestId('v25-selector-list');
  const listHeight = await list.evaluate((el) => el.getBoundingClientRect().height);
  expect(listHeight).toBeLessThanOrEqual(355);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  const summary = page.getByTestId('v25-selected-spec-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('現在の仕様：');
  const summaryTextSize = await summary.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(summaryTextSize).toBeGreaterThanOrEqual(14);
}

test('PC｜380px・1列・選択中グループ展開・版と価格・未保存の取消', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(FIXTURE);
  const toggle = page.getByTestId('standard-estimate-selector-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('v25-selected-spec-summary')).toBeVisible();
  await expand(page);

  await assertCompactLayout(page);
  const groups = page.locator(GROUP);
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAttribute('open', '');
  await expect(groups.nth(1)).not.toHaveAttribute('open');
  await expect(groups.nth(2)).not.toHaveAttribute('open');
  await expect(page.locator(CARD + ':visible')).toHaveCount(6);
  await expect(page.locator(CARD).filter({ hasText: '＋別途見積' })).toHaveCount(6);
  await expect(page.getByTestId('v25-selector-por-note')).toContainText('上記価格に含まれません');
  const first = page.locator(CARD).first();
  await expect(first).toContainText('¥6,939,959');
  await expect(first).toContainText('公開 第2版');
  await expect(first).toContainText('下書き 第3版');

  const navHeight = await page.locator(SELECTOR).evaluate((el) => el.getBoundingClientRect().height);
  const toggleBox = await toggle.boundingBox();
  const sheetBox = await page.getByTestId('pr683-fake-estimate-sheet').boundingBox();
  const distance = sheetBox!.y - toggleBox!.y;
  console.log('[PR683 PC COMPACT]', JSON.stringify({ navWidth: 380, selectorHeightPx: navHeight, toggleToMockSheetPx: distance }));
  expect(navHeight).toBeLessThan(620);
  expect(distance).toBeLessThan(850);

  await mkdir('e2e/artifacts', { recursive: true });
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: 'e2e/artifacts/pr683-pc-1440.png', fullPage: true });

  // The accordion keeps at most one product group expanded.
  await groups.nth(1).locator('summary').click();
  await expect(groups.nth(1)).toHaveAttribute('open', '');
  await expect(groups.nth(0)).not.toHaveAttribute('open');
  await expect(page.locator(CARD + ':visible')).toHaveCount(3);
  await assertCompactLayout(page);
  await page.screenshot({ path: 'e2e/artifacts/pr683-pc-box-expanded.png', fullPage: true });

  await groups.nth(0).locator('summary').click();
  await expect(groups.nth(0)).toHaveAttribute('open', '');
  await expect(groups.nth(1)).not.toHaveAttribute('open');

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
  await page.locator(CARD).nth(1).click();
  expect(page.url()).toBe(before);
  await expect(first).toHaveAttribute('aria-current', 'page');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator(CARD).nth(1).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next'))
    .toBe('/admin/estimate-templates?master=pr683-spec-1');

  await page.goto(FIXTURE + '?master=pr683-spec-6');
  await expand(page);
  await expect(groups.nth(1)).toHaveAttribute('open', '');
  await expect(groups.nth(0)).not.toHaveAttribute('open');
  await expect(page.locator(CARD).nth(6)).toHaveAttribute('aria-current', 'page');
});

test('スマートフォン｜1列・横はみ出しなし・選択状態と価格の維持', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  try {
    await page.goto(FIXTURE);
    await expand(page);
    await assertCompactLayout(page);
    await expect(page.locator(CARD)).toHaveCount(10);
    await expect(page.locator(CARD + ':visible')).toHaveCount(6);
    const prices = await page.getByTestId('v25-selector-published-total').allTextContents();
    expect(prices.map((value) => value.trim())).toEqual([
      '¥6,939,959', '¥5,571,173', '¥4,051,965', '¥4,112,807', '¥3,006,983',
      '¥3,075,293', '¥2,679,597', '¥2,679,597', '¥2,672,610', '¥1,903,674',
    ]);
    const height = await page.locator(SELECTOR).evaluate((el) => el.getBoundingClientRect().height);
    console.log('[PR683 MOBILE COMPACT]', JSON.stringify({
      selectorHeightPx: height,
      viewportWidth: await page.evaluate(() => window.innerWidth),
      pageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
    }));
    expect(height).toBeLessThan(620);
    await mkdir('e2e/artifacts', { recursive: true });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: 'e2e/artifacts/pr683-mobile-pixel7.png', fullPage: true });

    await page.getByTestId('standard-estimate-selector-toggle').click();
    await expect(page.getByTestId('standard-estimate-selector-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('v25-selected-spec-summary')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
