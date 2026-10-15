import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, requestQuoteAsCustomer, signInOrRegister, uniqueEmail } from './helpers';
import { createOrganizationViaUi, issueInvitation, joinViaInvitation } from './org-helpers';

// 総代理店の配下の確認（2026-10-15 先方確定）：総代理店の管理者は、配下の代理店が営業担当の案件の進み具合・仕様・見積の金額と明細を見られる。
// お客様の情報（お名前・設置場所など）は、先方が項目を確認するまで表示しない。

test.describe('総代理店の配下の確認', () => {
  test('総代理店の管理者は配下の代理店の案件と見積の金額を見られ、お客様のお名前・設置場所は表示されない', async ({ browser }) => {
    test.setTimeout(240_000);
    const suffix = `${Date.now()}`.slice(-6);
    const masterName = `E2E配下確認総代理店${suffix}`;
    const dealerName = `E2E配下確認代理店${suffix}`;
    const masterManagerEmail = uniqueEmail('sv-md-manager');
    const masterStaffEmail = uniqueEmail('sv-md-staff');
    const dealerManagerEmail = uniqueEmail('sv-d-manager');
    const siteAddress = `E2E県配下市${suffix}`;

    // ---------- 本部：総代理店（管理者・担当者）と配下の代理店（管理者）を登録する ----------
    const hqContext = await browser.newContext();
    const hq = await hqContext.newPage();
    await signInOrRegister(hq, ADMIN_EMAIL, '/admin/organizations', '管理者');
    const masterPath = await createOrganizationViaUi(hq, 'master_dealer', masterName);
    const masterManagerInvite = await issueInvitation(hq, masterManagerEmail, '管理者');
    await hq.goto(masterPath);
    const masterStaffInvite = await issueInvitation(hq, masterStaffEmail, '担当者');
    await createOrganizationViaUi(hq, 'dealer', dealerName, masterName);
    const dealerManagerInvite = await issueInvitation(hq, dealerManagerEmail, '管理者');

    const { context: masterManagerContext, page: masterManager } = await joinViaInvitation(browser, masterManagerEmail, '総代理店 管理者', masterManagerInvite);
    const { context: masterStaffContext, page: masterStaff } = await joinViaInvitation(browser, masterStaffEmail, '総代理店 担当者', masterStaffInvite);
    const { context: dealerContext, page: dealerManager } = await joinViaInvitation(browser, dealerManagerEmail, '販売 管理者', dealerManagerInvite);

    // ---------- お客様：設置場所を入れて見積を依頼する ----------
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    const { quoteId } = await requestQuoteAsCustomer(customer, uniqueEmail('sv-customer'), 'E2E配下の案件', siteAddress);

    // 営業担当が決まる前は、配下の案件に出ない
    await masterManager.goto('/admin/supervision');
    await expect(masterManager.getByText('配下の代理店が営業担当の案件は、まだありません。')).toBeVisible();

    // ---------- 本部：営業担当組織を配下の代理店にする → 代理店の管理者が自分を主担当者にする ----------
    await hq.goto(`/admin/quotes/${quoteId}?tab=site`);
    const orgs = hq.getByTestId('case-organizations');
    await orgs.getByTestId('case-sales-organization-select').selectOption({ label: `代理店：${dealerName}` });
    await orgs.getByTestId('case-sales-organization-submit').click();
    await expect(hq.getByText('営業担当組織を更新しました。')).toBeVisible();

    await dealerManager.goto(`/admin/quotes/${quoteId}?tab=site`);
    // 管理者は候補に「（管理者）」付きで出る
    await dealerManager.getByTestId('case-primary-staff-select').selectOption({ label: '販売 管理者（管理者）' });
    await dealerManager.getByTestId('case-primary-staff-submit').click();
    await expect(dealerManager.getByText('主担当者を更新しました。')).toBeVisible();

    // ---------- 総代理店の管理者：案件管理の「配下の案件」から一覧と詳細を開く ----------
    await masterManager.goto('/admin/quotes');
    await masterManager.getByTestId('case-flow-links').getByRole('link', { name: '配下の案件' }).click();
    await expect(masterManager).toHaveURL(/\/admin\/supervision$/);
    const row = masterManager.getByTestId('supervised-case-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(dealerName);
    await expect(row).toContainText('販売 管理者');
    await expect(row).toContainText('¥');

    await row.getByRole('link').first().click();
    await expect(masterManager).toHaveURL(/\/admin\/supervision\/[0-9a-f-]{36}$/);
    const summary = masterManager.getByTestId('supervised-case-summary');
    await expect(summary).toContainText(dealerName);
    await expect(summary).toContainText(masterName);
    await expect(summary).toContainText('¥');
    expect(await masterManager.getByTestId('supervised-quote-item').count()).toBeGreaterThan(0);
    const detailText = await masterManager.locator('main').innerText();
    expect(detailText).not.toContain('テスト 太郎');
    expect(detailText).not.toContain(siteAddress);
    const detailPath = new URL(masterManager.url()).pathname;

    // 案件画面（お客様の情報を含む）は開けない
    expect((await masterManager.goto(`/admin/quotes/${quoteId}`))?.status()).toBe(404);

    // ---------- 総代理店の担当者（管理者でない）・代理店には開かない ----------
    await masterStaff.goto('/admin/supervision');
    await expect(masterStaff.getByTestId('supervised-case-row')).toHaveCount(0);
    expect((await masterStaff.goto(detailPath))?.status()).toBe(404);
    expect((await dealerManager.goto('/admin/supervision'))?.status()).toBe(404);

    // ---------- 本部は同じ内容を確認できる ----------
    await hq.goto(detailPath);
    await expect(hq.getByTestId('supervised-case-summary')).toContainText(dealerName);

    await Promise.all([hqContext, masterManagerContext, masterStaffContext, dealerContext, customerContext].map((c) => c.close()));
  });
});
