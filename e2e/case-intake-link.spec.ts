import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL,
  logout,
  requestQuoteAsCustomer,
  signInOrRegister,
  uniqueEmail,
  yen,
} from './helpers';

/**
 * ⑥ 見積依頼 → 本部案件管理の連動確認。
 * ローカルE2Eだけで実施し、本番DBと発行済み正式見積には触れない。
 */
test('Web見積依頼が案件一覧に1件現れ、同じ案件の見積とプランを開ける', async ({ page }) => {
  const customer = uniqueEmail('case-intake');
  const siteAddress = '石川県七尾市本府中町1-1';
  const { quoteId, total } = await requestQuoteAsCustomer(
    page,
    customer,
    'Web見積から案件管理への連動確認',
    siteAddress
  );
  const quoteNo = (await page.getByTestId('quote-no').textContent())!.trim();
  expect(quoteNo).toMatch(/^Q\d{6}-\d{4}$/);
  expect(yen(await page.getByTestId('quote-total').textContent())).toBe(total);
  await logout(page);

  // 本部の案件一覧では、同じ見積番号に対応する案件が1件だけ存在する。
  await signInOrRegister(page, ADMIN_EMAIL, '/admin/quotes', '管理者');
  await page.goto('/admin/quotes?q=' + encodeURIComponent(quoteNo));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('案件管理');
  const rows = page.getByTestId('admin-quote-row');
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText(quoteNo);
  await expect(row).toContainText('テスト 太郎');
  await expect(row).toContainText(siteAddress);
  await expect(row).toContainText(total.toLocaleString('ja-JP'));
  await expect(row).toContainText('未割当');

  // 一覧から選ぶと、依頼された見積の案件ワークスペースが開く。
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp('case=' + quoteId));
  await expect(page.getByTestId('case-workspace')).toBeVisible();
  await expect(page.getByTestId('case-structure-summary')).toContainText('未割当');
  await expect(page.getByTestId('case-issued-estimate-history')).toContainText(quoteNo);
  await expect(page.getByTestId('case-issued-estimate-history')).toContainText('概算見積');
  expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(total);

  // 案件プランのタブは同じ見積を引き継ぐ。別案件に切り替わらない。
  await page.goto('/admin/quotes?case=' + quoteId + '&tab=plan');
  await expect(page.getByTestId('case-workspace')).toBeVisible();
  await expect(page.getByTestId('case-tab-plan')).toBeVisible();
  await expect(page.getByTestId('case-workspace-header')).toContainText('Web見積から案件管理への連動確認');
});
