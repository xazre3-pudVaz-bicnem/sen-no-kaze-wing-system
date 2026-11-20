import { devices, expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL, DEALER_EMAIL, MASTER_EMAIL, logout, openFreshSimulator,
  pickOption, register, signInOrRegister, uniqueEmail,
} from './helpers';

/**
 * 一時ローカルDB専用。認証後の既存商品台帳→保存プラン絞り込みと、
 * 代理店/総代理店の詳細閲覧不可・本部管理者の詳細閲覧可を確認する。
 * 本番DBや発行済み見積には接続しない。
 */
test('PC・スマートフォン｜保存プランへの導線と本部管理者限定の詳細閲覧', async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(baseURL) ||
      process.env.WING_LOCAL_MODE !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('PR #703 e2e is allowed only on isolated localhost with no production DB');
  }

  const savedName = `商品利用プラン検証-${Date.now()}`;
  await register(page, uniqueEmail('pr703-config'), '/simulator/wing-01');
  await openFreshSimulator(page);
  await page.getByTestId('site-prefecture-select').selectOption('石川県');
  await page.getByTestId('site-municipality-select').selectOption('七尾市');
  await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
  await page.getByTestId('save-button').click();
  await page.getByTestId('config-name-input').fill(savedName);
  await page.getByTestId('save-confirm').click();
  await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);
  const configId = new URL(page.url()).searchParams.get('c')!;
  await logout(page);

  // 総代理店：商品台帳の件数リンクから該当1件に遷移できるが、
  // 詳細リンクは表示しない。直接URLにアクセスしても既存requireAdminで拒否。
  await signInOrRegister(page, MASTER_EMAIL, '/admin/ledger', '総代理店 テスト');
  await page.goto('/admin/ledger');
  await page.getByRole('button', {name:'検索'}).click();
  await page.getByPlaceholder('商品名・メーカー・シリーズ・型番で検索').fill('ウッドデッキ');
  const desktopLink=page.locator('[data-testid="ledger-configuration-usage-link"]:visible');
  await expect(desktopLink).toHaveCount(1);
  await expect(desktopLink).toContainText('保存プラン 1件');
  const href=(await desktopLink.getAttribute('href'))!;
  expect(href).toMatch(/^\/admin\/configurations\?option_id=[0-9a-f-]{36}$/);
  await desktopLink.click();
  await expect(page).toHaveURL(new RegExp('\\/admin\\/configurations\\?option_id='));
  await expect(page.getByTestId('configuration-option-filter')).toContainText('保存プラン 1件');
  // 同じ商品IDを2回指定しても「フィルタなし」に戻さず0件を表示する。
  const duplicatedOptionId = new URL(href, 'http://localhost').searchParams.get('option_id')!;
  await page.goto(href + '&option_id=' + duplicatedOptionId);
  await expect(page.getByTestId('configuration-option-filter')).toContainText('商品IDが正しくありません');
  await expect(page.getByRole('row').filter({ hasText: savedName })).toHaveCount(0);
  await page.goto(href);
  await expect(page.getByTestId('configuration-option-filter')).toContainText('保存プラン 1件');
  const row=page.getByRole('row').filter({hasText:savedName});
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('configuration-detail-access-note')).toBeVisible();
  await expect(row.getByTestId('configuration-detail-admin-only')).toHaveText('本部管理者のみ');
  await expect(row.getByRole('link',{name:'確認'})).toHaveCount(0);

  await page.getByTestId('filter-block').selectOption('関東');
  await expect(row).toHaveCount(0);
  await page.getByTestId('filter-block').selectOption('中部');
  await expect(row).toHaveCount(1);

  await page.screenshot({path:'e2e/artifacts/pr703-desktop-master-filtered.png',fullPage:false});
  await page.getByRole('link',{name:'商品台帳へ戻る'}).click();
  await expect(page).toHaveURL(/\/admin\/ledger\?product=/);
  await page.goto(`/admin/configurations/${configId}`);
  await expect(page).toHaveURL(/\/mypage\?forbidden=1/);
  await logout(page);

  // 代理店：一覧を表示できる一方、詳細リンクは同様に表示されない。
  await signInOrRegister(page, DEALER_EMAIL, href, '代理店 テスト');
  await page.goto(href);
  await expect(page.getByRole('row').filter({hasText:savedName})).toHaveCount(1);
  await expect(page.getByTestId('configuration-detail-admin-only')).toBeVisible();
  await expect(page.getByRole('link',{name:'確認'})).toHaveCount(0);
  await logout(page);

  // 本部管理者：同一商品を絞り込み、従来の詳細へ進める。
  await signInOrRegister(page, ADMIN_EMAIL, href, '本部管理者 テスト');
  await page.goto(href);
  const adminRow=page.getByRole('row').filter({hasText:savedName});
  await expect(adminRow).toHaveCount(1);
  await expect(page.getByTestId('configuration-detail-access-note')).toHaveCount(0);
  await adminRow.getByRole('link',{name:'確認'}).click();
  await expect(page).toHaveURL(new RegExp(`/admin/configurations/${configId}$`));
  await expect(page.getByRole('heading',{name:savedName})).toBeVisible();
  await page.screenshot({path:'e2e/artifacts/pr703-desktop-admin-detail.png',fullPage:false});

  // スマートフォン：カード内の使用数リンクは商品詳細オーバーレイを
  // 誤って開かず、商品で絞り込んだ保存プランへ移動する。
  const mobile=await browser.newContext({...devices['Pixel 7']});
  try {
    const mobilePage=await mobile.newPage();
    await signInOrRegister(mobilePage, MASTER_EMAIL, '/admin/ledger','総代理店 テスト');
    await mobilePage.goto('/admin/ledger');
    await mobilePage.getByRole('button',{name:'検索'}).click();
    await mobilePage.getByPlaceholder('商品名・メーカー・シリーズ・型番で検索').fill('ウッドデッキ');
    const mobileLink=mobilePage.locator('[data-testid="ledger-configuration-usage-link"]:visible');
    await expect(mobileLink).toHaveCount(1);
    await mobileLink.click();
    await expect(mobilePage).toHaveURL(/\/admin\/configurations\?option_id=/);
    await expect(mobilePage.getByRole('row').filter({hasText:savedName})).toHaveCount(1);
    await expect(mobilePage.getByTestId('configuration-detail-access-note')).toBeVisible();
    await mobilePage.screenshot({path:'e2e/artifacts/pr703-mobile-master-filtered.png',fullPage:false});
  } finally {
    await mobile.close();
  }
});
