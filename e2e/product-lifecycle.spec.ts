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
  fillQuoteRequestContact,
} from './helpers';

// PR #500：商品の取扱終了（2026-10-19 の先方回答で「販売停止」と呼ぶ）・シミュレーター表示。20261016112000：廃番・受付停止。
// 標準構成・必須・初期選択・前提商品に関わらず、他の E2E でも使っていない任意の商品で確かめ、テストごとに元へ戻す。
const SUNROOF = { id: '30000000-0000-4000-8000-000000000018', code: 'sunroof', category: 'exterior-parts' };
const HANGER = { id: '30000000-0000-4000-8000-000000000013', code: 'hanger-pipe', category: 'furniture' };
// Wing のホテル仕様の標準構成（本体の仕様）に入っていて、必須・初期選択・前提商品ではない商品（受付停止の確認に使う）
const SMART_KEY = { id: '30000000-0000-4000-8000-000000000011', code: 'smart-key', name: 'スマートキー' };

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

/** 販売を再開する（仕様・供給・価格の確認のチェックが必要） */
async function resumeSales(admin: Page) {
  await admin.getByTestId('ledger-resume-confirm').check();
  await ledgerAction(admin, 'ledger-resume-product', 'resumed');
}

/** 廃番なら取り消し、販売を再開し、シミュレーターの表示へ戻す（他の E2E の前提を変えない） */
async function restore(admin: Page, id: string) {
  await openLedgerProduct(admin, id);
  if (await admin.getByTestId('ledger-restore-product').isVisible()) {
    await admin.getByTestId('ledger-restore-reason').fill('E2E の後始末');
    await ledgerAction(admin, 'ledger-restore-product', 'restored');
  }
  if (await admin.getByTestId('ledger-resume-product').isVisible()) await resumeSales(admin);
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

test.describe('商品の販売停止・廃番・シミュレーター表示', () => {
  test.afterEach(async ({ browser }) => {
    const admin = await openAdmin(browser);
    await restore(admin, SUNROOF.id);
    await restore(admin, HANGER.id);
    await restore(admin, SMART_KEY.id);
    await admin.context().close();
  });

  test('販売停止・非表示の商品は保存済みの選択として残り、新しくは選べない。販売停止が残る間は見積を依頼できない', async ({ page, browser }) => {
    // --- お客様：任意の商品を 2 つ入れて保存 ---
    await register(page, uniqueEmail('lifecycle'), '/simulator/wing-01');
    await openFreshSimulator(page);
    await pickOption(page, 'equip-exterior-parts', [SUNROOF.code]);
    await pickOption(page, 'equip-furniture', [HANGER.code]);
    await page.getByTestId('save-button').click();
    await page.getByTestId('config-name-input').fill('販売停止の確認プラン');
    await page.getByTestId('save-confirm').click();
    await page.waitForURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(page.url()).searchParams.get('c')!;

    // --- 本部：サンルーフを販売停止、ハンガーパイプをシミュレーターに表示しない（商品台帳から） ---
    const admin = await openAdmin(browser);
    await openLedgerProduct(admin, SUNROOF.id);
    await ledgerAction(admin, 'ledger-retire-product', 'retired');
    await expect(admin.getByText('販売を停止しました。')).toBeVisible();
    await expect(admin.getByTestId('ledger-resume-product')).toBeVisible();

    await openLedgerProduct(admin, HANGER.id);
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveText('シミュレーターに表示しない');
    await ledgerAction(admin, 'ledger-toggle-simulator', 'simulator_hidden');
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveText('シミュレーターに表示する');
    await admin.context().close();

    // --- お客様：保存済みのプランには残る ---
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await waitForSimulator(page);
    await expect(page.getByTestId(`equip-retained-${SUNROOF.category}`)).toHaveText('販売停止の商品（保存済みの選択）');
    await expect(page.getByTestId(`equip-retained-${HANGER.category}`)).toHaveText('新しくは選べない商品（保存済みの選択）');

    // 販売停止が残ったままでは見積を依頼できない
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await fillQuoteRequestContact(page);
    await page.getByTestId('submit-quote-request').click();
    await expect(page.getByTestId('quote-request-form')).toContainText('販売停止中のため、この内容では見積を依頼できません');
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
    await fillQuoteRequestContact(page);
    await page.getByTestId('submit-quote-request').click();
    await page.waitForURL(/\/mypage\/quotes\/[0-9a-f-]{36}/);

    // 依頼済み（Draft 以外）のプランも、保存済みの選択のまま表示する。後から販売停止にしても同じ（既定の商品へ置き換えない）
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await waitForSimulator(page);
    await expect(page.getByTestId(`equip-retained-${HANGER.category}`)).toHaveText('新しくは選べない商品（保存済みの選択）');
    const adminAfter = await openAdmin(browser);
    await openLedgerProduct(adminAfter, HANGER.id);
    await ledgerAction(adminAfter, 'ledger-retire-product', 'retired');
    await adminAfter.context().close();
    await page.reload();
    await waitForSimulator(page);
    await expect(page.getByTestId(`equip-retained-${HANGER.category}`)).toHaveText('販売停止の商品（保存済みの選択）');

    // 新しいプランでは、販売停止・非表示の商品はどちらも候補に出ない
    await openFreshSimulator(page);
    await openPicker(page, 'equip-exterior-parts');
    await expect(page.getByTestId(`product-card-open-${SUNROOF.code}`)).toHaveCount(0);
    await closePicker(page);
    await openPicker(page, 'equip-furniture');
    await expect(page.getByTestId(`product-card-open-${HANGER.code}`)).toHaveCount(0);
    await closePicker(page);
  });

  test('販売を再開すると、シミュレーター表示の設定は以前の値のまま戻る（再開には仕様・供給・価格の確認が必要）', async ({ browser }) => {
    const admin = await openAdmin(browser);
    await openLedgerProduct(admin, HANGER.id);
    await ledgerAction(admin, 'ledger-toggle-simulator', 'simulator_hidden');
    await ledgerAction(admin, 'ledger-retire-product', 'retired');
    // 販売停止中はシミュレーター表示を変えられない
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveCount(0);
    await expect(admin.getByText('販売停止・廃番の間はシミュレーターに表示されません。')).toBeVisible();

    // 確認のチェックが無いと、再開のボタンを押しても送らない（ブラウザの必須入力）
    await admin.getByTestId('ledger-resume-product').click();
    await expect(admin).not.toHaveURL(/lifecycle=resumed/);
    await resumeSales(admin);
    await expect(admin.getByText('販売を再開しました。')).toBeVisible();
    await expect(admin.getByTestId('ledger-toggle-simulator')).toHaveText('シミュレーターに表示する');
    await admin.context().close();
  });

  test('廃番にすると販売を再開できず、本部の管理者が理由をつけて取り消すと販売停止に戻る', async ({ browser }) => {
    const admin = await openAdmin(browser);
    await openLedgerProduct(admin, HANGER.id);
    // 販売中の商品には廃番の操作を出さない（先に販売停止）
    await expect(admin.getByTestId('ledger-discontinue-product')).toHaveCount(0);
    await ledgerAction(admin, 'ledger-retire-product', 'retired');

    await admin.getByTestId('ledger-discontinue-reason').fill('メーカーの生産終了');
    await ledgerAction(admin, 'ledger-discontinue-product', 'discontinued');
    await expect(admin.getByText('廃番にしました。')).toBeVisible();
    await expect(admin.getByText('廃番の商品は販売を再開できません。')).toBeVisible();
    await expect(admin.getByTestId('ledger-resume-product')).toHaveCount(0);

    await admin.getByTestId('ledger-restore-reason').fill('誤って廃番にした');
    await ledgerAction(admin, 'ledger-restore-product', 'restored');
    await expect(admin.getByText('廃番を取り消しました。販売停止に戻っています')).toBeVisible();
    // 取り消しても販売は再開しない（販売停止のまま）
    await expect(admin.getByTestId('ledger-resume-product')).toBeVisible();
    await resumeSales(admin);
    await admin.context().close();
  });

  test('標準構成の商品を販売停止にすると、その仕様は新しい受付を止め、別の商品に自動で替えない', async ({ page, browser }) => {
    // --- お客様：ホテル仕様（スマートキーが標準構成）のプランを保存 ---
    await register(page, uniqueEmail('acceptance'), '/simulator/wing-01');
    await openFreshSimulator(page);
    await expect(page.getByTestId('spec-acceptance-stopped')).toHaveCount(0);
    await page.getByTestId('save-button').click();
    await page.getByTestId('config-name-input').fill('受付停止の確認プラン');
    await page.getByTestId('save-confirm').click();
    await page.waitForURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(page.url()).searchParams.get('c')!;

    // --- 本部：標準構成のスマートキーを販売停止（使用中でも止められる） ---
    const admin = await openAdmin(browser);
    await openLedgerProduct(admin, SMART_KEY.id);
    await ledgerAction(admin, 'ledger-retire-product', 'retired');
    await expect(admin.getByText('標準構成で使っている仕様は新しい受付を止めます。')).toBeVisible();

    // --- お客様：シミュレーターで受付停止を案内し、見積依頼の画面では依頼の入力を出さない ---
    await openFreshSimulator(page);
    await expect(page.getByTestId('spec-acceptance-stopped')).toContainText(SMART_KEY.name);
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await expect(page.getByTestId('request-acceptance-stopped')).toContainText(SMART_KEY.name);
    await expect(page.getByTestId('quote-request-form')).toHaveCount(0);

    // --- 本部：販売を再開すると、受付も再開する ---
    await resumeSales(admin);
    await admin.context().close();
    await page.reload();
    await expect(page.getByTestId('request-acceptance-stopped')).toHaveCount(0);
    await expect(page.getByTestId('quote-request-form')).toBeVisible();
  });
});
