import { devices, expect, test, type Page } from '@playwright/test';
import { MASTER_EMAIL, signInOrRegister } from './helpers';

/**
 * WING_LOCAL_MODE 専用。本番DBへ接続せず、実際の商品台帳のPC/スマホUIで
 * React PortalのEnter/Space伝播とモーダルのフォーカスを検証する。
 * 対象はローカルseedの任意商品「ウッドデッキ」。
 */
async function searchWoodDeck(page: Page) {
  await page.goto('/admin/ledger');
  await page.getByRole('button', { name: '検索' }).click();
  await page.getByPlaceholder('商品名・メーカー・シリーズ・型番で検索').fill('ウッドデッキ');
}

async function openMenu(page: Page, mobile = false) {
  const owner = mobile
    ? page.getByTestId('ledger-mobile-option-wood-deck')
    : page.locator('[data-testid="ledger-table-view"] tbody tr:visible').filter({ hasText: 'ウッドデッキ' });
  await expect(owner).toHaveCount(1);
  const trigger = owner.getByLabel('ウッドデッキのその他の操作');
  await trigger.click();
  return { owner, trigger };
}

test('PCとスマホ｜販売停止・再開のEnter/Spaceと削除Dialogのフォーカス回帰', async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(baseURL) ||
      process.env.WING_LOCAL_MODE !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('PR #702 browser verification is allowed only on isolated localhost');
  }

  await signInOrRegister(page, MASTER_EMAIL, '/admin/ledger', '総代理店 テスト');
  await searchWoodDeck(page);
  const first = await openMenu(page);
  const row = first.owner;
  await expect(row).toHaveAttribute('aria-selected', 'false');
  await row.getByTestId('ledger-row-lifecycle-action').click();
  const retire = page.getByRole('dialog', { name: '販売を停止しますか' });
  await expect(retire).toBeVisible();
  const retireCancel = retire.getByRole('button', { name: 'キャンセル' });
  const retireConfirm = retire.getByRole('button', { name: '販売を停止する' });
  await expect(retireCancel).toBeFocused();

  // Tab/Shift+Tabはダイアログ内を循環し、背後の<tr>で詳細を開かない。
  await page.keyboard.press('Shift+Tab');
  await expect(retireConfirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(retireCancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(retireConfirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(retireCancel).toBeFocused();
  await expect(row).toHaveAttribute('aria-selected', 'false');
  await page.screenshot({ path: 'e2e/artifacts/pr702-desktop-retire-dialog.png', fullPage: false });

  // Escapeで閉じて「…」にフォーカス復帰。商品詳細は開かない。
  await page.keyboard.press('Escape');
  await expect(retire).toHaveCount(0);
  await expect(first.trigger).toBeFocused();
  await expect(row).toHaveAttribute('aria-selected', 'false');

  // 背景クリックも閉じてフォーカス復帰。
  const second = await openMenu(page);
  await second.owner.getByTestId('ledger-row-lifecycle-action').click();
  await expect(retire).toBeVisible();
  await page.locator('.fixed.inset-0.z-\\[100\\]').click({ position: { x: 3, y: 3 } });
  await expect(retire).toHaveCount(0);
  await expect(second.trigger).toBeFocused();
  await expect(row).toHaveAttribute('aria-selected', 'false');

  // Enterで確認実行。ローカルDBのみ更新し、既存の正式Server Actionを通す。
  const third = await openMenu(page);
  await third.owner.getByTestId('ledger-row-lifecycle-action').click();
  await retireConfirm.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/lifecycle=retired/);

  // 再開時のcheckboxでSpaceが<tr>へ漏れない（チェックと送信を阻害しない）。
  await searchWoodDeck(page);
  const stopped = await openMenu(page);
  await stopped.owner.getByTestId('ledger-row-lifecycle-action').click();
  const resume = page.getByRole('dialog', { name: '販売を再開しますか' });
  await expect(resume).toBeVisible();
  const resumeCancel = resume.getByRole('button', { name: 'キャンセル' });
  const resumeConfirm = resume.getByRole('button', { name: '販売を再開する' });
  const confirm = resume.getByRole('checkbox', { name: '仕様・供給・価格を確認しました' });
  await expect(resumeCancel).toBeFocused();
  await resumeConfirm.focus();
  await page.keyboard.press('Enter');
  await expect(resume).toBeVisible(); // checkbox required: 未チェックでは確定しない
  await expect(confirm).not.toBeChecked();
  await confirm.focus();
  await page.keyboard.press('Space');
  await expect(confirm).toBeChecked();
  await expect(stopped.owner).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Shift+Tab');
  await expect(resumeConfirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.screenshot({ path: 'e2e/artifacts/pr702-desktop-resume-dialog.png', fullPage: false });
  await resumeConfirm.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/lifecycle=resumed/);

  // 既存の削除ダイアログでもEnter/Spaceで行が開かず、Escape・キャンセル・Tab循環が働く。
  await searchWoodDeck(page);
  const fourth = await openMenu(page);
  await fourth.owner.getByRole('button', { name: 'この商品を削除（未使用のみ）' }).click();
  const deleting = page.getByRole('dialog', { name: '登録済み商品を削除しますか' });
  await expect(deleting).toBeVisible();
  const deleteCancel = deleting.getByRole('button', { name: 'キャンセル' });
  const deleteConfirm = deleting.getByRole('button', { name: '削除する' });
  await expect(deleteCancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(deleteConfirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(deleteCancel).toBeFocused();
  await page.keyboard.press('Enter'); // キャンセルのみ。商品データを削除しない
  await expect(deleting).toHaveCount(0);
  await expect(fourth.trigger).toBeFocused();
  await expect(fourth.owner).toHaveAttribute('aria-selected', 'false');
  await fourth.owner.getByLabel('ウッドデッキのその他の操作').click();
  await fourth.owner.getByRole('button', { name: 'この商品を削除（未使用のみ）' }).click();
  await expect(deleting).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deleting).toHaveCount(0);
  await expect(fourth.trigger).toBeFocused();

  // Pixel 7相当のカードでもReact Portalの操作を検証。
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    const mobile = await context.newPage();
    await signInOrRegister(mobile, MASTER_EMAIL, '/admin/ledger', '総代理店 テスト');
    await searchWoodDeck(mobile);
    const m = await openMenu(mobile, true);
    await m.owner.getByTestId('ledger-row-lifecycle-action').click();
    const mobileRetire = mobile.getByRole('dialog', { name: '販売を停止しますか' });
    await expect(mobileRetire).toBeVisible();
    await expect(mobileRetire.getByRole('button', { name: 'キャンセル' })).toBeFocused();
    await mobile.screenshot({ path: 'e2e/artifacts/pr702-mobile-retire-dialog.png', fullPage: false });
    await mobile.keyboard.press('Escape');
    await expect(mobileRetire).toHaveCount(0);
    await expect(m.trigger).toBeFocused();
    await expect(mobile.getByTestId('ledger-product-detail-pane')).toHaveCount(0);
    const m2 = await openMenu(mobile, true);
    await m2.owner.getByRole('button', { name: 'この商品を削除（未使用のみ）' }).click();
    const mobileDelete = mobile.getByRole('dialog', { name: '登録済み商品を削除しますか' });
    await expect(mobileDelete).toBeVisible();
    await mobile.keyboard.press('Escape');
    await expect(mobileDelete).toHaveCount(0);
    await expect(m2.trigger).toBeFocused();
  } finally {
    await context.close();
  }
});
