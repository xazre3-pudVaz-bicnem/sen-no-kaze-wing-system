import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, openFreshSimulator, register, signInOrRegister, uniqueEmail } from './helpers';
import { createOrganizationViaUi, issueInvitation, joinViaInvitation } from './org-helpers';

// お客様が代理店を選ぶ（2026-10-15 先方確定）：見積依頼の「相談したい代理店」で、組織に所属する代理店の紹介ページを選ぶと、
// その組織が営業担当になり、組織の管理者が主担当者を決める。製造担当は直属の総代理店（自動）。

test.describe('お客様が代理店を選ぶ', () => {
  test('組織の代理店の紹介ページを選んで見積を依頼すると、その組織が営業担当になり管理者に届く', async ({ browser }) => {
    test.setTimeout(240_000);
    const suffix = `${Date.now()}`.slice(-6);
    const masterName = `E2E選択総代理店${suffix}`;
    const dealerName = `E2E選択代理店${suffix}`;
    const displayName = `E2E選べる代理店${suffix}`;
    const managerEmail = uniqueEmail('sel-d-manager');

    // ---------- 本部：総代理店と代理店（管理者）を登録する ----------
    const hqContext = await browser.newContext();
    const hq = await hqContext.newPage();
    await signInOrRegister(hq, ADMIN_EMAIL, '/admin/organizations', '管理者');
    await createOrganizationViaUi(hq, 'master_dealer', masterName);
    await createOrganizationViaUi(hq, 'dealer', dealerName, masterName);
    const invite = await issueInvitation(hq, managerEmail, '管理者');
    const { context: managerContext, page: manager } = await joinViaInvitation(browser, managerEmail, '選択 管理者', invite);

    // ---------- 代理店の管理者が紹介ページを書き、本部が公開する ----------
    await manager.goto('/admin/dealers');
    await expect(manager).toHaveURL(/\/admin\/dealers\/[0-9a-f-]{36}$/);
    const dealerProfilePath = new URL(manager.url()).pathname;
    const profileForm = manager.getByTestId('dealer-profile-form');
    await profileForm.locator('#display_name').fill(displayName);
    await profileForm.getByRole('button', { name: /保存/ }).click();
    await expect(manager.getByText(/保存しました/)).toBeVisible();
    await hq.goto(dealerProfilePath);
    await hq.getByTestId('dealer-publish-panel').getByRole('button', { name: '公開する' }).click();
    await expect(hq.getByText('紹介ページを公開しました。')).toBeVisible();

    // ---------- お客様：見積依頼で、その代理店を選ぶ ----------
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    await register(customer, uniqueEmail('sel-customer'), '/simulator/wing-01');
    await openFreshSimulator(customer);
    await customer.getByTestId('save-button').click();
    await customer.getByTestId('config-name-input').fill('E2E代理店を選ぶ案件');
    await customer.getByTestId('save-confirm').click();
    await customer.waitForURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(customer.url()).searchParams.get('c')!;
    await customer.goto(`/mypage/configurations/${configId}/request-quote`);
    await customer.locator('#preferred_dealer_id').selectOption({ label: displayName });
    await customer.getByTestId('submit-quote-request').click();
    await customer.waitForURL(/\/mypage\/quotes\/[0-9a-f-]{36}/);
    const quoteId = customer.url().match(/quotes\/([0-9a-f-]{36})/)![1];

    // ---------- 代理店の管理者：案件が届き、営業担当が自社・製造担当が直属の総代理店になっている ----------
    await manager.goto('/admin/notifications');
    await expect(manager.getByTestId('notification-case_sales_assigned').first()).toBeVisible();
    expect((await manager.goto(`/admin/quotes/${quoteId}?tab=site`))?.status()).toBe(200);
    const orgs = manager.getByTestId('case-organizations');
    await expect(orgs.getByTestId('case-sales-organization')).toContainText(dealerName);
    await expect(orgs.getByTestId('case-manufacturing-organization')).toContainText(masterName);
    // 主担当者の欄は、組織の欄の下（ページ全体から探す）
    await manager.getByTestId('case-primary-staff-select').selectOption({ label: '選択 管理者（管理者）' });
    await manager.getByTestId('case-primary-staff-submit').click();
    await expect(manager.getByText('主担当者を更新しました。')).toBeVisible();

    await Promise.all([hqContext, managerContext, customerContext].map((c) => c.close()));
  });
});
