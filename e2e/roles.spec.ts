import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  MASTER_EMAIL as MASTER,
  ensureDealerFreeProduct,
  logout,
  openFreshSimulator,
  readTotal,
  register,
  signInOrRegister as signIn,
  uniqueEmail,
} from './helpers';

test.describe('権限（顧客 / 代理店 / 総代理店 / 管理者）', () => {
  test('総代理店は商品台帳を編集でき、代理店はフリー商品だけを扱える', async ({ page }) => {
    // --- 総代理店: 台帳の編集メニューが出る ---
    await signIn(page, MASTER, '/admin', '総代理店 担当');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ダッシュボード');
    const nav = page.getByRole('navigation', { name: '管理メニュー' });
    await expect(nav.getByRole('link', { name: 'オプション', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'オプションカテゴリー' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '商品台帳' })).toBeVisible();
    // 顧客一覧・見積は管理者のみ
    await expect(nav.getByRole('link', { name: 'ユーザー・権限' })).toBeHidden();
    // 台帳の商品を開ける
    await page.goto('/admin/options');
    await expect(page.getByTestId('admin-option-ub-1216')).toBeVisible();
    await logout(page);

    // --- 代理店: 台帳は編集できず、フリー商品だけ ---
    await signIn(page, DEALER, '/admin', '代理店 担当');
    const dealerNav = page.getByRole('navigation', { name: '管理メニュー' });
    await expect(dealerNav.getByRole('link', { name: 'フリー商品' })).toBeVisible();
    await expect(dealerNav.getByRole('link', { name: 'オプション', exact: true })).toBeHidden();
    await expect(dealerNav.getByRole('link', { name: 'ベースコンテナ' })).toBeHidden();
    // 見積メニューは代理店にも出るが、中身は自分に割り当てられた見積だけ
    await expect(dealerNav.getByRole('link', { name: '見積依頼・見積書' })).toBeVisible();

    // 追加画面ではフリー商品カテゴリーしか選べない
    await page.goto('/admin/free-products');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('フリー商品');
    await page.getByRole('link', { name: 'フリー商品を追加' }).click();
    const categorySelect = page.locator('#category_id');
    await expect(categorySelect.locator('option')).toHaveCount(1);
    await expect(categorySelect.locator('option')).toHaveText('フリー商品');
    await page.goto('/admin/free-products');

    // 商品を登録する
    await ensureDealerFreeProduct(page);
    await page.goto('/admin/free-products');
    await expect(page.getByTestId('free-product-dealer-bed')).toContainText('代理店オリジナルベッド');
    await logout(page);
  });

  test('登録したフリー商品は見積書の別途工事の下に諸費用なしで載る', async ({ page }) => {
    await ensureDealerFreeProduct(page);
    await logout(page);
    await openFreshSimulator(page);
    const before = await readTotal(page);
    const beforeExpense = Number(
      ((await page.getByTestId('quote-sheet').textContent()) ?? '').match(/オプション諸費用[^¥]*¥([\d,]+)/)?.[1].replace(/,/g, '') ?? '0'
    );

    await page.getByTestId('equip-free-product').scrollIntoViewIfNeeded();
    await page.getByTestId('equip-free-product').click();
    await page.getByTestId('pick-dealer-bed').click();
    await page.getByTestId('picker-apply').click();

    // 別枠で表示され、オプション諸費用は増えない（＝15% が乗らない）
    await expect(page.getByTestId('quote-free-products')).toContainText('フリー商品');
    await expect(page.getByTestId('quote-line-dealer-bed')).toContainText('代理店オリジナルベッド');
    const afterExpense = Number(
      ((await page.getByTestId('quote-sheet').textContent()) ?? '').match(/オプション諸費用[^¥]*¥([\d,]+)/)?.[1].replace(/,/g, '') ?? '0'
    );
    expect(afterExpense).toBe(beforeExpense);
    // 100,000 に税 10% だけが乗る（千円未満切捨てのため ±1,100）
    expect(Math.abs((await readTotal(page)) - (before + 100_000 * 1.1))).toBeLessThanOrEqual(1100);
  });

  test('管理者が画面から権限を付与でき、自分自身は変更できない', async ({ page }) => {
    const promoted = uniqueEmail('promote');
    await register(page, promoted, '/mypage', '昇格 太郎');
    // 顧客のうちは管理画面に入れない
    const before = await page.goto('/admin');
    expect(before?.url()).toMatch(/\/mypage\?forbidden=1/);
    await logout(page);

    // 管理者が代理店へ変更する
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ユーザー・権限');
    const row = page.getByTestId(`user-row-${promoted}`);
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('combobox').selectOption('dealer');
    await row.getByRole('button', { name: '変更' }).click();
    await expect(row.getByText('保存しました')).toBeVisible();

    // 自分自身の行は変更できない
    const selfRow = page.getByTestId(`user-row-${ADMIN}`);
    await expect(selfRow.getByRole('combobox')).toBeDisabled();
    await expect(selfRow.getByRole('button', { name: '変更' })).toBeDisabled();
    await logout(page);

    // 付与された人は代理店として管理画面に入れる
    await signIn(page, promoted, '/admin', '昇格 太郎');
    const nav = page.getByRole('navigation', { name: '管理メニュー' });
    await expect(nav.getByRole('link', { name: 'フリー商品' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'ユーザー・権限' })).toBeHidden();
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

  test('代理店は他社のフリー商品を編集できない', async ({ page }) => {
    // 総代理店が登録した商品（owner なし）は代理店から編集できない
    await signIn(page, MASTER, '/admin', '総代理店 担当');
    await page.goto('/admin/options');
    const ubLink = page.getByTestId('admin-option-ub-1216').getByRole('link', { name: '編集' });
    const href = await ubLink.getAttribute('href');
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto(href!);
    // 画面は開けても保存はサーバー側で拒否される
    await page.getByTestId('admin-submit').click();
    await expect(page.getByText('代理店が登録できるのはフリー商品だけです。')).toBeVisible();
    await logout(page);
  });
});
