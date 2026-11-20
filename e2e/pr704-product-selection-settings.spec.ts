import { devices, expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, DEALER_EMAIL, MASTER_EMAIL, logout, signInOrRegister } from './helpers';

const path = '/admin/categories?tab=matrix';
const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name: name + ' を選択可能にする' });
const currentDraft = (page: Page) => page.evaluate(() => {
  const key = Object.keys(window.sessionStorage).find((item) => item.startsWith('wing:matrix-settings:draft:v1:'));
  return key ? window.sessionStorage.getItem(key) : null;
});

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(baseURL) ||
      process.env.WING_LOCAL_MODE !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PR #704 browser suite must run only on isolated localhost with a local DB');
  }
});

test('本部PC：未保存変更をタブ・カテゴリー詳細編集・リロード・他ページ往復で保持し、破棄できる', async ({ page }) => {
  test.setTimeout(180_000);
  await signInOrRegister(page, ADMIN_EMAIL, path, '本部管理者 テスト');
  await page.goto(path);
  await expect(page.getByTestId('selection-matrix-panel')).toBeVisible();
  await expect(page.getByTestId('matrix-item-row')).toHaveCount(15);
  const kitchen = checkbox(page, 'キッチン');
  await expect(kitchen).not.toBeChecked();
  await kitchen.check();
  await expect(kitchen).toBeChecked();
  await expect.poll(() => currentDraft(page)).not.toBeNull();

  await page.getByRole('tab', { name: /お客様への共通表示/ }).click();
  const detail = page.getByRole('link', { name: '詳細編集' }).first();
  await expect(detail).toBeVisible();
  await detail.click();
  await expect(page).toHaveURL(/\/admin\/categories\?edit=[0-9a-f-]+/);
  await expect(page.getByRole('tab', { name: /お客様への共通表示/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: /仕様別の選択可否/ }).click();
  await expect(kitchen).toBeChecked();
  await page.screenshot({ path: 'e2e/artifacts/pr704-desktop-detail-roundtrip.png', fullPage: false });

  await page.reload();
  await expect(page.getByRole('tab', { name: /お客様への共通表示/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /仕様別の選択可否/ }).click();
  await expect(page.getByTestId('selection-matrix-panel')).toBeVisible();
  await expect(kitchen).toBeChecked();
  await expect(page.getByText('このブラウザタブの未保存変更を復元しました。')).toBeVisible();

  await page.goto('/admin/ledger');
  await page.goto(path);
  await expect(kitchen).toBeChecked();
  await page.getByRole('button', { name: '変更を破棄' }).click();
  await expect(kitchen).not.toBeChecked();
  await expect.poll(() => currentDraft(page)).toBeNull();
  await page.reload();
  await expect(kitchen).not.toBeChecked();
});

test('本部PC：保存成功後は一時保管を消し、古い版を復元しても保存できない', async ({ page }) => {
  test.setTimeout(180_000);
  await signInOrRegister(page, ADMIN_EMAIL, path, '本部管理者 テスト');
  await page.goto(path);
  await expect(page.getByTestId('selection-matrix-panel')).toBeVisible();

  const kitchen = checkbox(page, 'キッチン');
  if (!(await kitchen.isChecked())) {
    await kitchen.check();
  } else {
    await kitchen.uncheck();
  }
  const savedValue = await kitchen.isChecked();
  await page.getByRole('button', { name: 'この仕様を保存' }).click();
  await expect(page.getByText(/保存しました。シミュレーター/)).toBeVisible();
  await expect.poll(() => currentDraft(page)).toBeNull();
  await page.reload();
  await expect(kitchen).toHaveJSProperty('checked', savedValue);

  // Aタブでは未保存のまま。他タブの保存でDBのlock_versionを更新する。
  const bed = checkbox(page, 'ベッド');
  const oldBed = await bed.isChecked();
  await bed.setChecked(!oldBed);
  await expect.poll(() => currentDraft(page)).not.toBeNull();
  const second = await page.context().newPage();
  try {
    await second.goto(path);
    await expect(second.getByTestId('selection-matrix-panel')).toBeVisible();
    const toilet = checkbox(second, 'トイレ');
    const oldToilet = await toilet.isChecked();
    await toilet.setChecked(!oldToilet);
    await second.getByRole('button', { name: 'この仕様を保存' }).click();
    await expect(second.getByText(/保存しました。シミュレーター/)).toBeVisible();
  } finally {
    await second.close();
  }

  await page.reload();
  await expect(bed).toHaveJSProperty('checked', !oldBed);
  await expect(page.getByText(/別の画面でこの仕様が更新されています/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'この仕様を保存' })).toBeDisabled();
  await page.screenshot({ path: 'e2e/artifacts/pr704-desktop-stale-version-blocked.png', fullPage: false });
  await page.getByRole('button', { name: '変更を破棄' }).click();
  await expect.poll(() => currentDraft(page)).toBeNull();
});

test('PCとPixel 7：権限別表示、旧URL、キーボード操作と小画面の2タブ', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInOrRegister(page, MASTER_EMAIL, path, '総代理店 テスト');
  await page.goto(path);
  await expect(page.getByTestId('matrix-item-row')).toHaveCount(15);
  await expect(checkbox(page, 'キッチン')).toBeDisabled();
  await page.getByRole('tab', { name: /お客様への共通表示/ }).click();
  await expect(page.getByRole('link', { name: '詳細編集' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true }).first()).toBeVisible();
  await page.goto('/admin/matrix');
  await expect(page).toHaveURL(/\/mypage\?forbidden=1/);
  await logout(page);

  await signInOrRegister(page, DEALER_EMAIL, path, '代理店 テスト');
  await page.goto(path);
  await expect(checkbox(page, 'キッチン')).toBeDisabled();
  await page.getByRole('tab', { name: /お客様への共通表示/ }).click();
  await expect(page.getByRole('link', { name: '詳細編集' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /をお客様のシミュレーターに表示/ }).first()).toBeDisabled();
  await logout(page);

  await signInOrRegister(page, ADMIN_EMAIL, '/admin/matrix', '本部管理者 テスト');
  await page.goto('/admin/matrix');
  await expect(page).toHaveURL(/\/admin\/categories\?tab=matrix/);
  await expect(page.getByTestId('selection-matrix-panel')).toBeVisible();
  // キーボードからタブへフォーカスし、Enterで表示切替できること。
  const tab = page.getByRole('tab', { name: /お客様への共通表示/ });
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  const mobile = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    const mobilePage = await mobile.newPage();
    await signInOrRegister(mobilePage, ADMIN_EMAIL, path, '本部管理者 テスト');
    await mobilePage.goto(path);
    await expect(mobilePage.getByTestId('selection-matrix-panel')).toBeVisible();
    await expect(mobilePage.getByTestId('matrix-item-row')).toHaveCount(15);
    const tabs = mobilePage.getByRole('tablist', { name: '商品選択設定' });
    await expect(tabs).toBeVisible();
    const bounds = await tabs.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(416);
    await mobilePage.getByRole('tab', { name: /お客様への共通表示/ }).click();
    await expect(mobilePage.getByRole('link', { name: '詳細編集' }).first()).toBeVisible();
    await mobilePage.getByRole('tab', { name: /仕様別の選択可否/ }).click();
    await mobilePage.screenshot({ path: 'e2e/artifacts/pr704-mobile-matrix.png', fullPage: false });
  } finally {
    await mobile.close();
  }
});
