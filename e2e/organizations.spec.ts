import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, register, signInOrRegister, uniqueEmail } from './helpers';

// 代理店・総代理店の組織とアカウント（2026-10-15 先方確定）：
// 本部が組織と最初の管理者を登録 → その組織の管理者が担当者を追加。管理者が 0 人になる変更はできない。

/** 招待を発行して、招待のリンク（サイト内のパス）を返す。E2E はメールを送らないため、画面に出るリンクを使う */
async function issueInvitation(page: Page, email: string, role: '管理者' | '担当者'): Promise<string> {
  const form = page.getByTestId('organization-invite-form');
  await form.locator('#invite-email').fill(email);
  await form.locator('#invite-role').selectOption({ label: role });
  await form.getByTestId('organization-invite-submit').click();
  const link = form.getByTestId('organization-invite-url');
  await expect(link).toBeVisible();
  const url = (await link.innerText()).trim();
  const path = url.startsWith('http') ? new URL(url).pathname : url;
  expect(path).toMatch(/^\/invite\/[0-9a-f]{64}$/);
  return path;
}

test.describe('代理店・総代理店の組織とアカウント', () => {
  test('本部が組織を登録して管理者を招待し、管理者が担当者を追加して外せる', async ({ browser }) => {
    const suffix = `${Date.now()}`.slice(-6);
    const masterName = `E2E総代理店${suffix}`;
    const dealerName = `E2E代理店${suffix}`;
    const managerEmail = uniqueEmail('org-manager');
    const staffEmail = uniqueEmail('org-staff');

    // ---------- 本部：総代理店と、その配下の代理店を登録する ----------
    const hqContext = await browser.newContext();
    const hq = await hqContext.newPage();
    await signInOrRegister(hq, ADMIN_EMAIL, '/admin/organizations', '管理者');
    await hq.goto('/admin/organizations');
    const create = hq.getByTestId('organization-create-form');
    await create.locator('#org-type').selectOption('master_dealer');
    await create.locator('#org-name').fill(masterName);
    await create.getByTestId('organization-create-submit').click();
    await expect(hq.getByText('組織を登録しました')).toBeVisible();
    await expect(hq.getByRole('heading', { name: masterName })).toBeVisible();

    await hq.goto('/admin/organizations');
    await create.locator('#org-type').selectOption('dealer');
    await create.locator('#org-name').fill(dealerName);
    await create.locator('#org-parent').selectOption({ label: masterName });
    await create.getByTestId('organization-create-submit').click();
    await expect(hq.getByRole('heading', { name: dealerName })).toBeVisible();
    await expect(hq.getByText(`直属の総代理店：${masterName}`)).toBeVisible();
    await expect(hq.getByText('管理者がいません')).toBeVisible();
    const dealerPath = new URL(hq.url()).pathname;

    // 一覧では、代理店の直属の総代理店と「管理者 0」が分かる
    await hq.goto('/admin/organizations');
    const dealerRow = hq.getByTestId('organization-row').filter({ hasText: dealerName });
    await expect(dealerRow).toContainText(masterName);
    await expect(dealerRow).toContainText('0（招待してください）');

    // 最初の管理者を招待する
    await hq.goto(dealerPath);
    const managerInvite = await issueInvitation(hq, managerEmail, '管理者');

    // ---------- 招待された人：会員登録 → 招待のリンクから参加 → 代理店の管理者 ----------
    const managerContext = await browser.newContext();
    const manager = await managerContext.newPage();
    await register(manager, managerEmail, '/mypage', '代理店 管理者');
    await manager.goto(managerInvite);
    await expect(manager.getByTestId('invitation-card')).toContainText(dealerName);
    await expect(manager.getByTestId('invitation-card')).toContainText('管理者');
    await manager.getByTestId('invitation-accept').click();
    await expect(manager.getByText(`${dealerName}に参加しました`)).toBeVisible();
    await expect(manager).toHaveURL(new RegExp(`${dealerPath}`));

    // 同じリンクはもう使えない
    await manager.goto(managerInvite);
    await expect(manager.getByTestId('invitation-card')).toContainText('この招待はすでに使われています');

    // 管理者は担当者を招待できる
    await manager.goto(dealerPath);
    const staffInvite = await issueInvitation(manager, staffEmail, '担当者');

    // 最後の管理者は担当者にできない
    const myRow = manager.getByTestId('organization-member-row').filter({ hasText: '（自分）' });
    await myRow.getByRole('combobox').selectOption('editor');
    await myRow.getByRole('button', { name: '役割を変える' }).click();
    await expect(manager.getByText('管理者が 1 人もいなくなるため、この変更はできません')).toBeVisible();

    // 招待されたメールアドレスと違う人は、そのリンクで参加できない
    await manager.goto(staffInvite);
    await manager.getByTestId('invitation-accept').click();
    await expect(manager.getByText('招待されたメールアドレスでログインしてください')).toBeVisible();

    // ---------- 担当者：会員登録 → 参加。招待・役割の変更の操作は出ない ----------
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    await register(staff, staffEmail, '/mypage', '代理店 担当者');
    await staff.goto(staffInvite);
    await staff.getByTestId('invitation-accept').click();
    await expect(staff.getByText(`${dealerName}に参加しました`)).toBeVisible();
    await expect(staff.getByTestId('organization-member-row')).toHaveCount(2);
    await expect(staff.getByTestId('organization-invite-form')).toHaveCount(0);
    await expect(staff.getByRole('button', { name: '役割を変える' })).toHaveCount(0);
    await expect(staff.getByText('担当者の追加・役割の変更は、この組織の管理者が行います')).toBeVisible();

    // ---------- 管理者が担当者の所属を外す → 担当者は管理画面に入れなくなる ----------
    await manager.goto(dealerPath);
    const staffRow = manager.getByTestId('organization-member-row').filter({ hasText: '代理店 担当者' });
    await staffRow.locator('summary', { hasText: '所属を外す' }).click();
    await staffRow.getByTestId('organization-member-deactivate').click();
    await expect(manager.getByText('所属を外しました')).toBeVisible();

    await staff.goto('/admin');
    await expect(staff).toHaveURL(/\/mypage\?forbidden=1/);

    // 本部の一覧には、代理店の管理者が 1 人いる
    await hq.goto('/admin/organizations');
    await expect(hq.getByTestId('organization-row').filter({ hasText: dealerName })).not.toContainText('招待してください');

    await Promise.all([hqContext.close(), managerContext.close(), staffContext.close()]);
  });
});
