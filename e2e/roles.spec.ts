import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  MASTER_EMAIL as MASTER,
  logout,
  register,
  signInOrRegister as signIn,
  uniqueEmail,
} from './helpers';

const adminNav = (page: Page) => page.getByRole('navigation', { name: '管理メニュー' });

test.describe('権限（顧客 / 代理店 / 総代理店 / 管理者）', () => {
  test('総代理店は商品台帳を編集でき、代理店は商品を登録・編集できない', async ({ page }) => {
    // --- 総代理店: 管理画面の入口は案件管理。商品台帳は編集できるが、本部だけの領域は出ない ---
    await signIn(page, MASTER, '/admin', '総代理店 担当');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('案件管理');
    const nav = adminNav(page);
    for (const name of ['案件管理', '顧客管理', '商品台帳']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    // 見積書管理・管理設定（ユーザー・権限など）は本部のみ
    await expect(nav.getByRole('link', { name: '見積書管理' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '管理設定' })).toHaveCount(0);
    // 台帳の商品を編集できる
    await page.goto('/admin/options');
    const ubLink = page.getByTestId('admin-option-ub-1216').getByRole('link', { name: '詳細・編集' });
    const ubHref = (await ubLink.getAttribute('href'))!;
    await ubLink.click();
    await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
    await expect(page.getByRole('button', { name: '変更内容を確認' })).toBeVisible();
    await logout(page);

    // --- 代理店: 商品は見られるが、登録も編集もできない ---
    await signIn(page, DEALER, '/admin', '代理店 担当');
    const dealerNav = adminNav(page);
    await expect(dealerNav.getByRole('link', { name: '案件管理', exact: true })).toBeVisible();
    await expect(dealerNav.getByRole('link', { name: '見積書管理' })).toHaveCount(0);
    await expect(dealerNav.getByRole('link', { name: '管理設定' })).toHaveCount(0);

    // フリー商品の新規登録は終了（一覧は履歴の確認用に残る）
    await page.goto('/admin/free-products');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('フリー商品');
    await expect(page.getByText('フリー商品の新規登録は終了しました')).toBeVisible();
    await expect(page.getByRole('link', { name: 'フリー商品を追加' })).toHaveCount(0);
    await page.goto('/admin/options/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('フリー商品の新規登録は終了しました');
    await expect(page.getByTestId('admin-submit')).toHaveCount(0);

    // 台帳の商品は閲覧専用（編集フォームを出さない）
    await page.goto(ubHref);
    await expect(page.getByText('この商品は閲覧専用です')).toBeVisible();
    await expect(page.getByRole('button', { name: '変更内容を確認' })).toHaveCount(0);
    await logout(page);
  });

  test('管理者が画面から権限を付与でき、自分自身は変更できない', async ({ page }) => {
    const promoted = uniqueEmail('promote');
    await register(page, promoted, '/mypage', '昇格 太郎');
    // 顧客のうちは管理画面に入れない
    const before = await page.goto('/admin');
    expect(before?.url()).toMatch(/\/mypage\?forbidden=1/);
    await logout(page);

    // 管理者が代理店へ変更する。一覧は通常は担当者だけなので、顧客アカウントを含めて探す
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ユーザー・担当者');
    const row = page.getByTestId(`user-row-${promoted}`);
    await expect(row).toHaveCount(0);
    await page.getByRole('textbox', { name: '氏名・法人・メールで検索' }).fill(promoted);
    await page.getByRole('checkbox', { name: '顧客アカウントを含める' }).check();
    await page.getByRole('button', { name: '絞り込む' }).click();
    await expect(page).toHaveURL(/include_customers=1/);
    await row.getByRole('combobox').selectOption('dealer');
    await row.getByRole('button', { name: '変更' }).click();
    await expect(row.getByText('保存しました')).toBeVisible();

    // 自分自身の行は変更できない
    await page.goto('/admin/customers');
    const selfRow = page.getByTestId(`user-row-${ADMIN}`);
    await expect(selfRow.getByRole('combobox')).toBeDisabled();
    await expect(selfRow.getByRole('button', { name: '変更' })).toBeDisabled();
    await logout(page);

    // 付与された人は代理店として管理画面に入れる（本部だけの領域は出ない）
    await signIn(page, promoted, '/admin', '昇格 太郎');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('案件管理');
    await expect(adminNav(page).getByRole('link', { name: '商品台帳' })).toBeVisible();
    await expect(adminNav(page).getByRole('link', { name: '管理設定' })).toHaveCount(0);
    const settings = await page.goto('/admin/customers');
    expect(settings?.url()).toMatch(/\/mypage\?forbidden=1/);
    await logout(page);
  });

  test('顧客は管理画面に入れない', async ({ page }) => {
    await register(page, `cust-${Date.now()}@example.com`);
    const res = await page.goto('/admin');
    expect(res?.url()).toMatch(/\/mypage\?forbidden=1/);
    const res2 = await page.goto('/admin/free-products');
    expect(res2?.url()).toMatch(/\/mypage\?forbidden=1/);
    await logout(page);
  });
});

test.describe('操作マニュアル', () => {
  test('本部と代理店で内容が切り替わる', async ({ page }) => {
    await signIn(page, MASTER, '/admin', '総代理店 担当');
    await page.goto('/admin/manual');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('総代理店');
    await expect(page.getByRole('heading', { name: '価格・商品の登録' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'フリー商品を登録する' })).toBeHidden();
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto('/admin/manual');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('代理店・工務店');
    await expect(page.getByRole('heading', { name: 'お仕事の流れ' })).toBeVisible();
    // 台帳編集の手順は代理店には出さない
    await expect(page.getByRole('heading', { name: '価格・商品の登録' })).toBeHidden();
    // ヘッダーのアカウントメニューから開ける
    await page.goto('/admin');
    await page.getByLabel('アカウントメニュー').click();
    await page.getByRole('banner').getByRole('link', { name: '操作マニュアル' }).click();
    await expect(page).toHaveURL(/\/admin\/manual$/);
    await logout(page);
  });
});
