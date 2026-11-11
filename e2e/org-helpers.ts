import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { register } from './helpers';

/** 本部：組織を登録し、組織の画面のパスを返す（管理設定 →「組織・代理店」） */
export async function createOrganizationViaUi(
  page: Page,
  type: 'master_dealer' | 'dealer',
  name: string,
  parentName?: string
): Promise<string> {
  await page.goto('/admin/organizations');
  const form = page.getByTestId('organization-create-form');
  await form.locator('#org-type').selectOption(type);
  await form.locator('#org-name').fill(name);
  if (type === 'dealer' && parentName) await form.locator('#org-parent').selectOption({ label: parentName });
  await form.getByTestId('organization-create-submit').click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** 招待を発行して、招待のリンク（サイト内のパス）を返す。E2E はメールを送らないため、画面に出るリンクを使う */
export async function issueInvitation(page: Page, email: string, role: '管理者' | '担当者'): Promise<string> {
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

/** 新しい会員として登録し、招待のリンクから組織に参加する（別のブラウザ文脈で） */
export async function joinViaInvitation(
  browser: Browser,
  email: string,
  fullName: string,
  invitePath: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await register(page, email, '/mypage', fullName);
  await page.goto(invitePath);
  await page.getByTestId('invitation-accept').click();
  await expect(page.getByText('に参加しました')).toBeVisible();
  return { context, page };
}
