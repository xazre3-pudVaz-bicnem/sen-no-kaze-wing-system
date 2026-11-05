import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, requestQuoteAsCustomer, signInOrRegister, uniqueEmail } from './helpers';
import { createOrganizationViaUi, issueInvitation, joinViaInvitation } from './org-helpers';

// 案件の営業担当組織・主担当者・製造担当組織（2026-10-15 先方確定）：
// 営業担当組織の管理者が主担当者を決め、担当者は自分の担当案件だけを扱う。製造担当は営業担当の所属総代理店（自動）。

test.describe('案件の営業担当組織と主担当者', () => {
  test('本部が営業担当組織を決め、管理者が主担当者を決めると、担当者だけが案件を開ける（付け替えると前の担当者は開けない）', async ({ browser }) => {
    test.setTimeout(240_000);
    const suffix = `${Date.now()}`.slice(-6);
    const masterName = `E2E製造総代理店${suffix}`;
    const dealerName = `E2E販売代理店${suffix}`;
    const managerEmail = uniqueEmail('case-org-manager');
    const staffAEmail = uniqueEmail('case-org-staff-a');
    const staffBEmail = uniqueEmail('case-org-staff-b');

    // ---------- 本部：総代理店と代理店を登録し、代理店の管理者・担当者 2 人を招待する ----------
    const hqContext = await browser.newContext();
    const hq = await hqContext.newPage();
    await signInOrRegister(hq, ADMIN_EMAIL, '/admin/organizations', '管理者');
    await createOrganizationViaUi(hq, 'master_dealer', masterName);
    const dealerPath = await createOrganizationViaUi(hq, 'dealer', dealerName, masterName);
    const managerInvite = await issueInvitation(hq, managerEmail, '管理者');
    await hq.goto(dealerPath);
    const staffAInvite = await issueInvitation(hq, staffAEmail, '担当者');
    await hq.goto(dealerPath);
    const staffBInvite = await issueInvitation(hq, staffBEmail, '担当者');

    const { context: managerContext, page: manager } = await joinViaInvitation(browser, managerEmail, '販売 管理者', managerInvite);
    const { context: staffAContext, page: staffA } = await joinViaInvitation(browser, staffAEmail, '販売 担当A', staffAInvite);
    const { context: staffBContext, page: staffB } = await joinViaInvitation(browser, staffBEmail, '販売 担当B', staffBInvite);

    // ---------- お客様：見積を依頼する ----------
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    const { quoteId } = await requestQuoteAsCustomer(customer, uniqueEmail('case-org-customer'), 'E2E組織の案件');
    const casePath = `/admin/quotes/${quoteId}`;

    // 営業担当が決まる前は、代理店の管理者も案件を開けない
    expect((await manager.goto(casePath))?.status()).toBe(404);

    // ---------- 本部：営業担当組織を決める → 製造担当は代理店の直属の総代理店（自動） ----------
    await hq.goto(`${casePath}?tab=site`);
    const orgs = hq.getByTestId('case-organizations');
    await expect(orgs.getByTestId('case-sales-organization')).toContainText('本部が受付中');
    await orgs.getByTestId('case-sales-organization-select').selectOption({ label: `代理店：${dealerName}` });
    await orgs.getByTestId('case-sales-organization-submit').click();
    await expect(hq.getByText('営業担当組織を更新しました。')).toBeVisible();
    await expect(hq.getByTestId('case-sales-organization')).toContainText(dealerName);
    await expect(hq.getByTestId('case-manufacturing-organization')).toContainText(masterName);
    await expect(hq.getByTestId('case-manufacturing-organization')).toContainText('自動');

    // ---------- 代理店の管理者：自社の案件を開き、主担当者を決める ----------
    expect((await manager.goto(`${casePath}?tab=site`))?.status()).toBe(200);
    await expect(manager.getByTestId('case-primary-staff')).toContainText('未設定');
    // 主担当者を決める前は、担当者は案件を開けない
    expect((await staffA.goto(casePath))?.status()).toBe(404);

    await manager.getByTestId('case-primary-staff-select').selectOption({ label: '販売 担当A' });
    await manager.getByTestId('case-primary-staff-submit').click();
    await expect(manager.getByText('主担当者を更新しました。')).toBeVisible();
    await expect(manager.getByTestId('case-primary-staff')).toContainText('販売 担当A');

    // 主担当者（担当A）は開けて、ほかの担当者（担当B）は開けない
    expect((await staffA.goto(casePath))?.status()).toBe(200);
    expect((await staffB.goto(casePath))?.status()).toBe(404);
    // 担当者には主担当者を決める欄が出ない
    await staffA.goto(`${casePath}?tab=site`);
    await expect(staffA.getByTestId('case-primary-staff')).toContainText('販売 担当A');
    await expect(staffA.getByTestId('case-primary-staff-select')).toHaveCount(0);

    // ---------- 担当を付け替える → 前の担当者は開けなくなる ----------
    await manager.goto(`${casePath}?tab=site`);
    await manager.getByTestId('case-primary-staff-select').selectOption({ label: '販売 担当B' });
    await manager.getByTestId('case-primary-staff-submit').click();
    await expect(manager.getByText('主担当者を更新しました。')).toBeVisible();
    expect((await staffA.goto(casePath))?.status()).toBe(404);
    expect((await staffB.goto(casePath))?.status()).toBe(200);

    await Promise.all([hqContext, managerContext, staffAContext, staffBContext, customerContext].map((c) => c.close()));
  });
});
