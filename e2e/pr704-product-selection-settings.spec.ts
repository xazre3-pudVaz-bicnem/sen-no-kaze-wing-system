import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN_EMAIL, DEALER_EMAIL, MASTER_EMAIL, logout, signInOrRegister } from './helpers';

const path = '/admin/categories';
const firstRow = (page: Page) => page.getByTestId('matrix-excel-row').first();
const category = (row: Locator, name: string) => row.getByRole('checkbox', { name: new RegExp(name + ' を選択可能にする') });
const currentDraft = (page: Page) => page.evaluate(() => {
  const key = Object.keys(window.sessionStorage).find((item) => item.startsWith('wing:matrix-settings:draft:v1:'));
  return key ? window.sessionStorage.getItem(key) : null;
});
const openCommonDisplay = async (page: Page) => {
  const details = page.locator('#customer-visibility details');
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('summary').click();
  }
  await expect(page.getByRole('region', { name: 'お客様向けカテゴリー表示設定' })).toBeVisible();
};

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(baseURL) ||
      process.env.WING_LOCAL_MODE !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Product selection browser suite must run only on isolated localhost with local test data');
  }
});

test('本部PC：全仕様のExcel表・絞り込み・ドラフトをカテゴリー詳細編集と画面往復で保護', async ({ page }) => {
  test.setTimeout(180_000);
  await signInOrRegister(page, ADMIN_EMAIL, path, '本部管理者 テスト');
  await page.goto(path);
  const grid = page.getByTestId('matrix-excel-grid');
  await expect(grid).toBeVisible();
  await expect(page.getByRole('tablist', { name: '商品選択設定' })).toHaveCount(0);
  await expect(firstRow(page).getByTestId('matrix-excel-cell')).toHaveCount(17);
  const row = firstRow(page);
  const kitchen = category(row, 'キッチン');
  const initial = await kitchen.isChecked();
  await kitchen.setChecked(!initial);
  await expect.poll(() => currentDraft(page)).not.toBeNull();

  await page.locator('#selection-matrix-model').selectOption({ index: 1 });
  await expect(page.getByTestId('matrix-excel-row').first()).toBeVisible();
  await page.locator('#selection-matrix-model').selectOption('all');
  await expect(category(firstRow(page), 'キッチン')).toHaveJSProperty('checked', !initial);
  await openCommonDisplay(page);
  await page.getByRole('link', { name: '詳細編集' }).first().click();
  await expect(page).toHaveURL(/\/admin\/categories\?edit=[0-9a-f-]+/);
  await expect(page.getByTestId('matrix-excel-grid')).toBeVisible();
  await expect(category(firstRow(page), 'キッチン')).toHaveJSProperty('checked', !initial);
  await page.screenshot({ path: 'e2e/artifacts/pr704-desktop-detail-roundtrip.png', fullPage: false });

  await page.reload();
  await expect(category(firstRow(page), 'キッチン')).toHaveJSProperty('checked', !initial);
  await expect(page.getByText('このブラウザタブの未保存変更を復元しました。')).toBeVisible();

  await page.goto('/admin/ledger');
  await page.goto(path);
  await expect(category(firstRow(page), 'キッチン')).toHaveJSProperty('checked', !initial);
  await firstRow(page).getByRole('button', { name: '破棄' }).click();
  await expect(category(firstRow(page), 'キッチン')).toHaveJSProperty('checked', initial);
  await expect.poll(() => currentDraft(page)).toBeNull();
});

test('本部PC：行別保存・再読込・別タブ更新による競合防止', async ({ page }) => {
  test.setTimeout(180_000);
  await signInOrRegister(page, ADMIN_EMAIL, path, '本部管理者 テスト');
  await page.goto(path);
  const row = firstRow(page);
  const kitchen = category(row, 'キッチン');
  const initial = await kitchen.isChecked();
  await kitchen.setChecked(!initial);
  await row.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/保存しました。シミュレーター/)).toBeVisible();
  await expect.poll(() => currentDraft(page)).toBeNull();
  await page.reload();
  await expect(category(firstRow(page), 'キッチン')).toHaveJSProperty('checked', !initial);

  const bed = category(firstRow(page), 'ベッド');
  const before = await bed.isChecked();
  await bed.setChecked(!before);
  await expect.poll(() => currentDraft(page)).not.toBeNull();
  const second = await page.context().newPage();
  try {
    await second.goto(path);
    const secondRow = firstRow(second);
    await expect(secondRow).toBeVisible();
    const toilet = category(secondRow, 'トイレ');
    await toilet.setChecked(!(await toilet.isChecked()));
    await secondRow.getByRole('button', { name: '保存', exact: true }).click();
    await expect(second.getByText(/保存しました。シミュレーター/)).toBeVisible();
  } finally {
    await second.close();
  }
  await page.reload();
  await expect(category(firstRow(page), 'ベッド')).toHaveJSProperty('checked', !before);
  await expect(page.getByText(/別の画面で仕様が更新されています/)).toBeVisible();
  await expect(firstRow(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'e2e/artifacts/pr704-desktop-stale-version-blocked.png', fullPage: false });
  await firstRow(page).getByRole('button', { name: '破棄' }).click();
  await expect.poll(() => currentDraft(page)).toBeNull();
});

test('PCとPixel 7：権限・旧URL・固定ヘッダー・横スクロール・共通表示', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInOrRegister(page, MASTER_EMAIL, path, '総代理店 テスト');
  await page.goto(path);
  await expect(firstRow(page).getByTestId('matrix-excel-cell')).toHaveCount(17);
  await expect(category(firstRow(page), 'キッチン')).toBeDisabled();
  await openCommonDisplay(page);
  await expect(page.getByRole('link', { name: '詳細編集' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true }).first()).toBeVisible();
  await page.goto('/admin/matrix');
  await expect(page).toHaveURL(/\/mypage\?forbidden=1/);
  await logout(page);

  await signInOrRegister(page, DEALER_EMAIL, path, '代理店 テスト');
  await page.goto(path);
  await expect(category(firstRow(page), 'キッチン')).toBeDisabled();
  await openCommonDisplay(page);
  await expect(page.getByRole('link', { name: '詳細編集' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /をお客様のシミュレーターに表示/ }).first()).toBeDisabled();
  await logout(page);

  await signInOrRegister(page, ADMIN_EMAIL, '/admin/matrix', '本部管理者 テスト');
  await page.goto('/admin/matrix');
  await expect(page).toHaveURL(/\/admin\/categories\?tab=matrix/);
  await expect(page.getByTestId('matrix-excel-grid')).toBeVisible();
  await firstRow(page).getByRole('checkbox', { name: /キッチン を選択可能にする/ }).focus();
  await expect(firstRow(page).getByRole('checkbox', { name: /キッチン を選択可能にする/ })).toBeFocused();

  const mobile = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    const mobilePage = await mobile.newPage();
    await signInOrRegister(mobilePage, ADMIN_EMAIL, path, '本部管理者 テスト');
    await mobilePage.goto(path);
    const scroll = mobilePage.getByTestId('matrix-grid-scroll');
    await expect(scroll).toBeVisible();
    await expect(firstRow(mobilePage).getByTestId('matrix-excel-cell')).toHaveCount(17);
    const bounds = await scroll.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(416);
    const measures = await scroll.evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    expect(measures.scrollWidth).toBeGreaterThan(measures.clientWidth);
    await scroll.evaluate((node) => { node.scrollLeft = 450; });
    await expect(mobilePage.getByTestId('matrix-excel-grid')).toBeVisible();
    await openCommonDisplay(mobilePage);
    await mobilePage.screenshot({ path: 'e2e/artifacts/pr704-mobile-matrix.png', fullPage: false });
  } finally {
    await mobile.close();
  }
});
