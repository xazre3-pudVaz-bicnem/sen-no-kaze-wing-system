import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  openFreshSimulator,
  openPicker,
  openProductDetail,
  pickOption,
  register,
  removeButton,
  signInOrRegister,
  uniqueEmail,
  waitForSimulator,
} from './helpers';

// PR #500：商品の取扱終了・シミュレーター表示。
// 標準構成・必須・初期選択・前提商品に関わらず、他の E2E でも使っていない任意の商品で確かめ、テストごとに元へ戻す。
const SUNROOF = { id: '30000000-0000-4000-8000-000000000018', code: 'sunroof', category: 'exterior-parts' };
const HANGER = { id: '30000000-0000-4000-8000-000000000013', code: 'hanger-pipe', category: 'furniture' };

async function openAdmin(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInOrRegister(page, ADMIN_EMAIL, '/admin', '管理者');
  return page;
}

/** 商品詳細の「管理情報」タブ（商品状態・シミュレーター表示の操作はここにある）。操作のたびに画面を読み直すので、開き直す */
async function showAdminTab(admin: Page) {
  await admin.getByTestId('ledger-product-detail-pane').getByRole('tab', { name: '管理情報' }).click();
  await expect(admin.locator('#ledger-handling-status-title')).toBeVisible();
}

async function openLedgerProduct(admin: Page, id: string) {
  await admin.goto(`/admin/ledger?product=${id}`);
  await showAdminTab(admin);
}

/** 商品台帳の操作ボタンを押し、完了のお知らせ（URL）を待ってから管理情報タブを開き直す */
async function ledgerAction(admin: Page, testId: string, done: string) {
  await admin.getByTestId(testId).click();
  await expect(admin).toHaveURL(new RegExp(`lifecycle=${done}`));
  await showAdminTab(admin);
}

/** 取扱を再開し、シミュレーターの表示へ戻す（他の E2E の前提を変えない） */
async function restore(admin: Page, id: string) {
  await openLedgerProduct(admin, id);
  if (await admin.getByTestId('ledger-resume-product').isVisible()) await ledgerAction(admin, 'ledger-resume-product', 'resumed');
  if ((await admin.getByTestId('ledger-toggle-simulator').textContent()) === 'シミュレーターに表示する') {
    await ledgerAction(admin, 'ledger-toggle-simulator', 'simulator_shown');
  }
}

async function closePicker(page: Page) {
  await page.getByTestId('option-picker').getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByTestId('option-picker')).toBeHidden();
}

async function saveCurrentPlan(page: Page) {
  await page.getByTestId('save-button').click();
  await page.getByTestId('save-confirm').click();
  await expect(page.getByTestId('toasts')).toContainText('保存しました');
}

test.describe('商品の取扱終了・シミュレーター表示', () => {
  test.afterEach(async ({ browser }) => {
    const admin = await openAdmin(browser);
    await restore(admin, SUNROOF.id);
    await restore(admin, HANGER.id);
    await admin.context().close();
  });

  test('取扱終了・非表示の商品は保存済みの選択として残り、新しくは選べない。取扱終了が残る間は見積を依頼できない', async ({ page, browser }) => {
    // --- お客様：任意の商品を 2 つ入れて保存 ---
    await register(page, uniqueEmail('lifecycle'), '/simulator/wing-01');
    await openFreshSimulator(page);
    await pickOption(page, 'equip-exterior-parts', [SUNROOF.code]);
    await pickOption(page, 'equip-furniture', [HANGER.code]);
    await page.getByTestId('save-button').click();
    await page.getByTestId('config-name-input').fill('取扱終了の確認プラン');
    await page.getByTestId('save-confirm').click();
    await page.waitForURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(page.url()).searchParams.get('c')!;

    // --- 本部：サンルーフを取扱終了、ハンガーパイプをシミュレーターに表示しない（商品台帳から） ---
    const admin = await openAdmin(browser);
    await openLedgerProduct(admin, SUNROOF.id);
    await ledgerAction(admin, 'ledger-retire-product', 'retired');
    await expect(admin.getByText('取扱を終了しました。')).toBeVisible();
    await expect(admin.getByTestId('ledger-resume-product')).toBeVisible();

    await openLedgerProduct(admin, HANGER.id);
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveText('シミュレーターに表示しない');
    await ledgerAction(admin, 'ledger-toggle-simulator', 'simulator_hidden');
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveText('シミュレーターに表示する');
    await admin.context().close();

    // --- お客様：保存済みのプランには残る ---
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await waitForSimulator(page);
    await expect(page.getByTestId(`equip-retained-${SUNROOF.category}`)).toHaveText('取扱終了の商品（保存済みの選択）');
    await expect(page.getByTestId(`equip-retained-${HANGER.category}`)).toHaveText('新しくは選べない商品（保存済みの選択）');

    // 取扱終了が残ったままでは見積を依頼できない
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await page.getByTestId('submit-quote-request').click();
    await expect(page.getByTestId('quote-request-form')).toContainText('取扱終了のため、この内容では見積を依頼できません');
    await expect(page).toHaveURL(/\/request-quote/);

    // 外すことはでき、外した後は候補から消える（足し直せない）
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await waitForSimulator(page);
    await openPicker(page, 'equip-exterior-parts');
    await openProductDetail(page, SUNROOF.code);
    await removeButton(page).click();
    await expect(page.getByTestId('option-picker')).toBeHidden();
    await expect(page.getByTestId(`equip-retained-${SUNROOF.category}`)).toHaveCount(0);
    await openPicker(page, 'equip-exterior-parts');
    await expect(page.getByTestId(`product-card-open-${SUNROOF.code}`)).toHaveCount(0);
    await closePicker(page);
    // 非表示の商品は、選ばれている間は候補に出る
    await openPicker(page, 'equip-furniture');
    await expect(page.getByTestId(`product-card-open-${HANGER.code}`)).toBeVisible();
    await closePicker(page);
    await saveCurrentPlan(page);

    // シミュレーター非表示の商品だけなら見積を依頼できる（見積不可ではない）
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await page.getByTestId('submit-quote-request').click();
    await page.waitForURL(/\/mypage\/quotes\/[0-9a-f-]{36}/);

    // 依頼済み（Draft 以外）のプランも、保存済みの選択のまま表示する。後から取扱終了にしても同じ（既定の商品へ置き換えない）
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await waitForSimulator(page);
    await expect(page.getByTestId(`equip-retained-${HANGER.category}`)).toHaveText('新しくは選べない商品（保存済みの選択）');
    const adminAfter = await openAdmin(browser);
    await openLedgerProduct(adminAfter, HANGER.id);
    await ledgerAction(adminAfter, 'ledger-retire-product', 'retired');
    await adminAfter.context().close();
    await page.reload();
    await waitForSimulator(page);
    await expect(page.getByTestId(`equip-retained-${HANGER.category}`)).toHaveText('取扱終了の商品（保存済みの選択）');

    // 新しいプランでは、取扱終了・非表示の商品はどちらも候補に出ない
    await openFreshSimulator(page);
    await openPicker(page, 'equip-exterior-parts');
    await expect(page.getByTestId(`product-card-open-${SUNROOF.code}`)).toHaveCount(0);
    await closePicker(page);
    await openPicker(page, 'equip-furniture');
    await expect(page.getByTestId(`product-card-open-${HANGER.code}`)).toHaveCount(0);
    await closePicker(page);
  });

  test('取扱を再開すると、シミュレーター表示の設定は以前の値のまま戻る', async ({ browser }) => {
    const admin = await openAdmin(browser);
    await openLedgerProduct(admin, HANGER.id);
    await ledgerAction(admin, 'ledger-toggle-simulator', 'simulator_hidden');
    await ledgerAction(admin, 'ledger-retire-product', 'retired');
    // 取扱終了中はシミュレーター表示を変えられない
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveCount(0);
    await expect(admin.getByText('取扱終了中はシミュレーターに表示されません。')).toBeVisible();

    await ledgerAction(admin, 'ledger-resume-product', 'resumed');
    await expect(admin.getByText('取扱を再開しました。')).toBeVisible();
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveText('シミュレーターに表示する');
    await admin.context().close();
  });
});
