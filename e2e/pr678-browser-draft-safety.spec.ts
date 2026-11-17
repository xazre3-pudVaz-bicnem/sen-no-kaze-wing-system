import { expect, test, type Page } from '@playwright/test';
import { openFreshSimulator, openPicker, openProductDetail, waitForSimulator } from './helpers';

/**
 * PR #678: real Chromium acceptance on Playwright's disposable local-mode store.
 *
 * NO LOGIN / QUOTE / DB SAVE actions. This suite refuses any non-local server.
 * Browser contexts are test-only and never use someone's existing Chrome profile.
 */
const LEGACY = 'wing:sim:wing-01';
const WORK_PREFIX = 'wing:sim:work:wing-01:';

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('PR #678 browser safety tests require a disposable localhost Next server');
  }
});

async function readOld(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), LEGACY);
}

async function workCopy(page: Page) {
  const id = new URL(page.url()).searchParams.get('draft');
  expect(id, 'edited work must have a draft ID in the URL').toMatch(/^[0-9a-f-]{36}$/);
  const stored = await page.evaluate(({ prefix, id }) =>
    window.localStorage.getItem(prefix + id), { prefix: WORK_PREFIX, id });
  expect(stored, 'edited work must exist under its own localStorage key').not.toBeNull();
  return { id: id!, raw: stored! };
}

async function seedLegacyFromEditableSample(page: Page) {
  await openFreshSimulator(page);
  await page.getByTestId('site-prefecture-select').selectOption('石川県');
  await expect(page).toHaveURL(/draft=[0-9a-f-]{36}/);
  const { raw } = await workCopy(page);
  // Use only catalog-valid test data created by the local simulator. Make the
  // legacy copy the newest resume candidate, including older work copies.
  const original = await page.evaluate(({ legacy, raw }) => {
    const sample = JSON.parse(raw) as Record<string, unknown>;
    sample.savedAt = Date.now() + 100_000;
    const data = JSON.stringify(sample);
    window.localStorage.setItem(legacy, data);
    return data;
  }, { legacy: LEGACY, raw });
  return original;
}

test('旧下書きは新規・仕様指定で不変、明示再開→商品変更直後の再読込でも保持', async ({ page }) => {
  test.setTimeout(150_000);
  const original = await seedLegacyFromEditableSample(page);

  // New means standard. Merely opening the simulator may not write any keys.
  await page.goto('/simulator/wing-01');
  await waitForSimulator(page);
  await expect(page.getByTestId('site-prefecture-select')).not.toHaveValue('石川県');
  await expect(page.getByTestId('previous-draft-banner')).toBeVisible();
  expect(await readOld(page)).toBe(original);

  await page.getByTestId('resume-previous-draft').click();
  await waitForSimulator(page);
  await expect(page.getByTestId('site-prefecture-select')).toHaveValue('石川県');
  await expect(page.getByTestId('restored-draft-notice')).toBeVisible();
  expect(await readOld(page)).toBe(original);

  // Editing creates a new ID and does not modify the legacy source.
  await page.getByTestId('site-municipality-select').selectOption('七尾市');
  await expect(page).toHaveURL(/draft=[0-9a-f-]{36}/);
  const firstCopy = await workCopy(page);
  expect(firstCopy.raw).toContain('七尾市');
  expect(await readOld(page)).toBe(original);

  await page.reload();
  await waitForSimulator(page);
  await expect(page.getByTestId('site-municipality-select')).toHaveValue('七尾市');

  // Deliberately reload immediately after a product click; no artificial wait
  // for the save effect is allowed between the click and reload.
  await openPicker(page, 'equip-exterior-parts');
  await openProductDetail(page, 'wood-deck');
  await page.getByTestId('product-detail-apply').click();
  await page.reload();
  await waitForSimulator(page);
  await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');
  expect(await readOld(page)).toBe(original);

  const afterProduct = await workCopy(page);
  expect(afterProduct.raw).toContain('七尾市');

  await page.goto('/simulator/wing-01?spec=hotel');
  await waitForSimulator(page);
  await expect(page.getByTestId('site-prefecture-select')).not.toHaveValue('石川県');
  expect(await readOld(page)).toBe(original);
});

test('複製タブで別々に編集しても、再開元と互いの下書きを上書きしない', async ({ page, context }) => {
  test.setTimeout(150_000);
  const original = await seedLegacyFromEditableSample(page);
  const sourceUrl = page.url();
  const sourceDraft = await workCopy(page);

  const tabA = await context.newPage();
  const tabB = await context.newPage();
  try {
    await tabA.goto(sourceUrl);
    await tabB.goto(sourceUrl);
    await waitForSimulator(tabA);
    await waitForSimulator(tabB);
    await expect(tabA.getByTestId('site-prefecture-select')).toHaveValue('石川県');
    await expect(tabB.getByTestId('site-prefecture-select')).toHaveValue('石川県');

    await tabA.getByTestId('site-municipality-select').selectOption('輪島市');
    await tabB.getByTestId('site-municipality-select').selectOption('珠洲市');
    const copyA = await workCopy(tabA);
    const copyB = await workCopy(tabB);
    expect(copyA.id).not.toBe(sourceDraft.id);
    expect(copyB.id).not.toBe(sourceDraft.id);
    expect(copyA.id).not.toBe(copyB.id);
    expect(copyA.raw).toContain('輪島市');
    expect(copyB.raw).toContain('珠洲市');

    await tabA.reload();
    await tabB.reload();
    await waitForSimulator(tabA);
    await waitForSimulator(tabB);
    await expect(tabA.getByTestId('site-municipality-select')).toHaveValue('輪島市');
    await expect(tabB.getByTestId('site-municipality-select')).toHaveValue('珠洲市');

    const sourceAfter = await page.evaluate((key) => window.localStorage.getItem(key), WORK_PREFIX + sourceDraft.id);
    expect(sourceAfter).toBe(sourceDraft.raw);
    expect(await readOld(page)).toBe(original);
  } finally {
    await tabA.close();
    await tabB.close();
  }
});
