import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL,
  addInstallationRow,
  issueRevision,
  openRevisionEditor,
  requestQuoteAsCustomer,
  signInOrRegister,
  uniqueEmail,
} from './helpers';
import { createOrganizationViaUi, issueInvitation, joinViaInvitation } from './org-helpers';

// 製造担当の画面（2026-10-15 先方確定：総代理店は製造受付・製造工程・検査・出荷・製造側の記録を更新する）。
// 配下の代理店の案件では、製造担当は直属の総代理店に自動で決まり、総代理店は「製造の進み具合」から案件を開いて製造を進める。
// 営業担当組織の管理者（主担当者でない）は、製造・施工のタブを読み取りだけで見る。

const PDF = Buffer.from(['%PDF-1.4', '% e2e signed contract', '1 0 obj << >> endobj', 'trailer << >>', '%%EOF', ''].join('\n'));

test.describe('製造担当（総代理店）の画面', () => {
  test('代理店が製造依頼を送ると、製造担当の総代理店が案件を開いて受領・製造・検査を記録できる（お客様の情報は出ない）', async ({ browser }) => {
    test.setTimeout(300_000);
    const suffix = `${Date.now()}`.slice(-6);
    const masterName = `E2E製造担当総代理店${suffix}`;
    const dealerName = `E2E製造依頼代理店${suffix}`;
    const masterEmail = uniqueEmail('mf-md-member');
    const dealerEmail = uniqueEmail('mf-d-manager');
    const dealer2Email = uniqueEmail('mf-d-manager2');
    const customerEmail = uniqueEmail('mf-customer');

    // ---------- 本部：総代理店（担当者）と配下の代理店（管理者 2 人）を登録する ----------
    const hqContext = await browser.newContext();
    const hq = await hqContext.newPage();
    await signInOrRegister(hq, ADMIN_EMAIL, '/admin/organizations', '管理者');
    await createOrganizationViaUi(hq, 'master_dealer', masterName);
    const masterInvite = await issueInvitation(hq, masterEmail, '担当者');
    const dealerPath = await createOrganizationViaUi(hq, 'dealer', dealerName, masterName);
    const dealerInvite = await issueInvitation(hq, dealerEmail, '管理者');
    await hq.goto(dealerPath);
    const dealer2Invite = await issueInvitation(hq, dealer2Email, '管理者');
    const { context: masterContext, page: master } = await joinViaInvitation(browser, masterEmail, '製造 担当者', masterInvite);
    const { context: dealerContext, page: dealer } = await joinViaInvitation(browser, dealerEmail, '販売 管理者', dealerInvite);
    const { context: dealer2Context, page: dealer2 } = await joinViaInvitation(browser, dealer2Email, '販売 管理者2', dealer2Invite);

    // ---------- お客様が見積を依頼 → 本部が営業担当組織を決める → 代理店の管理者が自分を主担当者にする ----------
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    const { quoteId } = await requestQuoteAsCustomer(customer, customerEmail, 'E2E製造の案件');
    await hq.goto(`/admin/quotes/${quoteId}?tab=site`);
    await hq.getByTestId('case-sales-organization-select').selectOption({ label: `代理店：${dealerName}` });
    await hq.getByTestId('case-sales-organization-submit').click();
    await expect(hq.getByText('営業担当組織を更新しました。')).toBeVisible();
    await expect(hq.getByTestId('case-manufacturing-organization')).toContainText(masterName);
    await dealer.goto(`/admin/quotes/${quoteId}?tab=site`);
    await dealer.getByTestId('case-primary-staff-select').selectOption({ label: '販売 管理者（管理者）' });
    await dealer.getByTestId('case-primary-staff-submit').click();
    await expect(dealer.getByText('主担当者を更新しました。')).toBeVisible();

    // 製造依頼の前から、製造担当の案件に出る（技術検討のため）
    await master.goto('/admin/manufacturing');
    await expect(master.getByTestId('manufacturing-case-row')).toHaveCount(1);
    await expect(master.getByTestId('manufacturing-case-row')).toContainText('依頼の前');

    // ---------- 確定見積 → お客様が承諾 → 本部が書面の契約を記録する ----------
    const form = await openRevisionEditor(hq, quoteId);
    await addInstallationRow(form, '基礎工事', 250_000);
    const formalId = await issueRevision(hq, form);
    await customer.goto(`/mypage/quotes/${formalId}`);
    await customer.getByTestId('accept-quote').click();
    await customer.waitForURL(/responded=accepted/);

    await hq.goto(`/admin/quotes/${formalId}?tab=documents`);
    const contract = hq.getByTestId('paper-contract-form');
    await contract.locator('input[name="signer_name"]').fill('テスト 太郎');
    await contract.locator('input[name="signer_email"]').fill(customerEmail);
    await contract.locator('input[name="file"]').setInputFiles({ name: 'contract.pdf', mimeType: 'application/pdf', buffer: PDF });
    await contract.getByRole('button', { name: '書面の契約を記録する' }).click();
    await expect(hq.getByText('書面で締結済み')).toBeVisible();

    // ---------- 主担当者が製造依頼を作って送る（送り先は製造担当組織） ----------
    await dealer.goto(`/admin/quotes/${formalId}?tab=production`);
    await dealer.getByTestId('manufacturing-order-form').getByRole('button', { name: '製造依頼を作る' }).click();
    // 作ると、下書きの製造依頼と「送る」ボタンに切り替わる
    const send = dealer.getByRole('button', { name: '総代理店へ製造依頼を送る' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(dealer.getByText('製造依頼を総代理店へ送りました。')).toBeVisible();

    // ---------- 総代理店（担当者）：製造の進み具合 → 製造担当の案件を開く ----------
    await master.goto('/admin/manufacturing');
    const row = master.getByTestId('manufacturing-case-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(dealerName);
    await expect(row).toContainText('依頼済み');
    await row.getByRole('link').first().click();
    await expect(master).toHaveURL(/\/admin\/manufacturing\/[0-9a-f-]{36}$/);
    await expect(master.getByTestId('manufacturing-case-summary')).toContainText(dealerName);
    expect(await master.getByTestId('manufacturing-spec-item').count()).toBeGreaterThan(0);
    const text = await master.locator('main').innerText();
    expect(text).not.toContain('テスト 太郎');
    expect(text).not.toContain('¥');

    // 受領 → 製造を始める → 1 棟目を検査済みにする
    const panel = master.getByTestId('manufacturing-order-panel');
    await master.getByRole('button', { name: '製造依頼を受領する' }).click();
    await expect(panel).toContainText('受領済み');
    await master.getByRole('button', { name: '製造を始める' }).click();
    await expect(panel).toContainText('製造中');
    const units = master.getByTestId('manufacturing-units');
    await units.getByLabel('1棟目の状態').selectOption({ label: '検査済み' });
    await units.getByRole('button', { name: '記録' }).first().click();
    await expect(master.getByText('個体の状態を更新しました。')).toBeVisible();
    await expect(master.getByTestId('manufacturing-units')).toContainText('検査済み');

    // 技術検討を記録できる
    await master.getByText('技術検討を記録する').click();
    const note = master.getByTestId('case-note-form');
    await note.locator('select[name="verdict"]').selectOption('feasible');
    await note.locator('textarea[name="body"]').fill('製造に問題なし');
    await note.getByRole('button', { name: '記録する' }).click();
    await expect(master.getByTestId('manufacturing-tech-review').locator('li')).toContainText('製造に問題なし');

    // ---------- 主担当者の画面にも製造の進み具合が出る ----------
    await dealer.goto(`/admin/quotes/${formalId}?tab=production`);
    await expect(dealer.getByTestId('manufacturing-order-panel')).toContainText('製造中');

    // ---------- 代理店のもう 1 人の管理者（主担当者でない）は、読み取りだけで見られる ----------
    await dealer2.goto(`/admin/quotes/${formalId}?tab=production`);
    await expect(dealer2.getByTestId('manufacturing-order-panel')).toContainText('製造中');
    await expect(dealer2.getByTestId('manufacturing-units')).toContainText('検査済み');
    await expect(dealer2.getByRole('button', { name: '設置まで完了した' })).toHaveCount(0);
    await expect(dealer2.getByText('工程を追加する')).toHaveCount(0);
    await expect(dealer2.getByText('記録を追加する')).toHaveCount(0);

    await Promise.all([hqContext, masterContext, dealerContext, dealer2Context, customerContext].map((c) => c.close()));
  });
});
