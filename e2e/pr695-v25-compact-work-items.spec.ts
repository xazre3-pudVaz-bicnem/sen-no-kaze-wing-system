import { expect, test, devices, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Current-spec regression against a disposable localhost fixture; never connects to production DB.
const fixture = '/pr691-e2e-row-move';
const row = (kind: 'slot' | 'line', key: string) =>
  `tr[data-v25-dnd-row="${kind}:${key}"]`;

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Compact work-item screenshot testing requires disposable localhost only');
  }
});

async function openWorkbench(page: Page) {
  await page.goto(fixture);
  await expect(page.getByTestId('pr691-local-fixture')).toBeVisible();
  await expect(page.locator(row('slot','sash'))).toBeVisible();
  await expect(page.getByTestId('v25-work-item-heading').first()).toBeVisible();
}

async function assertVisibleStructure(page: Page) {
  await expect(page.locator('tr[data-work-item="work:sash_wood"]')).toContainText('1. サッシ・木製建具工事');
  await expect(page.locator('tr[data-work-item="work:roof"]')).toContainText('2. 屋根工事');
  const slots = page.locator('tr[data-testid="v25-wb-slot"]');
  await expect(slots).toHaveCount(4);
  // Product rows have no duplicated labels; their section heading remains intact.
  await expect(page.getByTestId('v25-wb-slot-work-item-label')).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-slot-work-item')).toHaveCount(0);
  const sash = page.locator(row('slot', 'sash'));
  await expect(sash).toContainText('検査用サッシ');
  await expect(sash.locator('input[aria-label="数量"]')).toHaveValue('1');
  await expect(sash.getByTestId('v25-wb-slot-product-picker-icon')).toBeVisible();
  await expect(sash.getByTestId('v25-wb-slot-sale-amount')).not.toBeEmpty();
  // Existing manual-line change entry is in a closed action menu (no extra row label).
  await expect(page.locator(row('line','sashLine')).getByTestId('v25-wb-line-menu')).toHaveCount(1);
}

test('PC｜現在仕様の工事項目見出し・重複表示防止・Portal操作', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width: 1060, height: 760});
  await openWorkbench(page);
  await assertVisibleStructure(page);
  await mkdir('e2e/artifacts', { recursive: true });
  await page.screenshot({
    path: 'e2e/artifacts/pr695-current-pc.png',
    fullPage:false,
  });

  // 見出しの編集で配下の商品・手入力行をまとめて変更する。保存は行わない。
  const manual = page.locator(row('line','sashLine'));
  await expect(manual.getByTestId('v25-wb-line-menu')).toHaveCount(1);
  await page.locator('tr[data-work-item="work:sash_wood"]').getByTestId('v25-wb-edit-work-group').click();
  const dialog = page.getByTestId('v25-wb-work-group-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('v25-wb-work-group-input').fill('1. 建具（現場加工）');
  await dialog.getByTestId('v25-wb-work-group-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  const renamed = page.locator('tr[data-work-item="manual:1. 建具（現場加工）"]');
  await expect(renamed).toContainText('1. 建具（現場加工）');
  await expect.poll(() => manual.evaluate((el) => {
    let candidate = el.previousElementSibling;
    while (candidate && !candidate.matches('[data-testid="v25-work-item-heading"]')) {
      candidate = candidate.previousElementSibling;
    }
    return candidate?.textContent?.trim() ?? '';
  })).toContain('1. 建具（現場加工）');
  await expect(page.locator(row('slot','sash'))).toBeVisible();
  await page.getByRole('button', {name:'変更を破棄'}).click();
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await expect(page.locator(row('line','sashLine'))).toBeVisible();

  // Existing cost column toggle and horizontal/floating header remain intact.
  await page.setViewportSize({width:760,height:760});
  const grid = page.getByTestId('v25-excel-grid-scroll');
  await page.getByTestId('v25-grid-column-menu').locator('summary').click();
  await page.getByTestId('v25-wb-show-cost').uncheck();
  await expect(grid.locator('thead th')).toHaveCount(7);
  await page.getByTestId('v25-wb-show-cost').check();
  await expect(grid.locator('thead th')).toHaveCount(10);
  await page.evaluate(() => {
    const h=document.querySelector('[data-testid="v25-wb-column-header"]');
    if (!h) throw new Error('Missing native header');
    window.scrollTo({top:window.scrollY+h.getBoundingClientRect().bottom+130,behavior:'instant'});
  });
  const floating=page.getByTestId('v25-page-floating-column-header');
  await expect(floating).toBeVisible();
  await grid.evaluate((el) => {el.scrollLeft=128;el.dispatchEvent(new Event('scroll'));});
  await expect.poll(() => floating.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  const pos=await page.evaluate(() => {
    const a=document.querySelector('[data-testid="v25-excel-grid-scroll"]')!;
    const b=document.querySelector('[data-testid="v25-page-floating-column-header"]')!;
    return [a.scrollLeft,b.scrollLeft];
  });
  expect(Math.abs(pos[0]-pos[1])).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('v25-wb-slot-work-item')).toHaveCount(0);
});

test('PC｜工事項目の追加・重複防止・変更破棄', async ({ page }) => {
  await page.setViewportSize({ width: 1060, height: 760 });
  await openWorkbench(page);
  await page.getByTestId('v25-wb-add-work-group-interior_exterior').click();
  const dialog = page.getByTestId('v25-wb-work-group-dialog');
  await expect(dialog).toBeVisible();
  const name = dialog.getByTestId('v25-wb-work-group-input');
  await name.fill('2. 屋根工事');
  await expect(dialog.getByTestId('v25-wb-work-group-error')).toContainText('すでに');
  await expect(dialog.getByTestId('v25-wb-work-group-confirm')).toBeDisabled();
  await name.fill('5. 造作工事');
  await dialog.getByTestId('v25-wb-work-group-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="manual:5. 造作工事"]')).toBeVisible();
  const added = page.locator('tr[data-v25-dnd-row^="line:line-new-"]');
  await expect(added).toHaveCount(1);
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button', { name: '変更を破棄' }).click();
  await expect(added).toHaveCount(0);
  await expect(page.locator('tr[data-work-item="manual:5. 造作工事"]')).toHaveCount(0);
});

test('スマートフォン｜現在仕様の重複表示防止と固定見出しの横同期', async ({ browser }) => {
  test.setTimeout(120_000);
  const context=await browser.newContext({...devices['Pixel 7']});
  const page=await context.newPage();
  try {
    await openWorkbench(page);
    await assertVisibleStructure(page);
    await page.locator(row('slot','sash')).scrollIntoViewIfNeeded();
    await mkdir('e2e/artifacts',{recursive:true});
    await page.screenshot({
      path:'e2e/artifacts/pr695-current-mobile.png',
      fullPage:false,
    });
    await page.evaluate(() => {
      const head=document.querySelector('[data-testid="v25-wb-column-header"]');
      if (!head) throw new Error('Missing header');
      window.scrollTo({top:window.scrollY+head.getBoundingClientRect().bottom+140,behavior:'instant'});
    });
    const float=page.getByTestId('v25-page-floating-column-header');
    await expect(float).toBeVisible();
    const grid=page.getByTestId('v25-excel-grid-scroll');
    await grid.evaluate((el)=>{el.scrollLeft=165;el.dispatchEvent(new Event('scroll'));});
    await expect.poll(()=>float.evaluate((el)=>el.scrollLeft)).toBeGreaterThan(100);
    await expect(page.getByTestId('v25-wb-slot-work-item-label')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
