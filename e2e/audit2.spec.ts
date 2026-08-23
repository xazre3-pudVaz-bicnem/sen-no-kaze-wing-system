import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  ensureAccount,
  logout,
  openFreshSimulator,
  requestQuoteAsCustomer,
  signInOrRegister as signIn,
  uniqueEmail,
} from './helpers';

/** 静的な走査では見えない部分の点検：リンク切れ・詳細画面・noindex・入力エラー時の表示 */
const found: string[] = [];
const note = (s: string) => {
  found.push(s);
  console.log('  ! ' + s);
};

test.describe.configure({ mode: 'serial' });

test.describe('深掘りの点検', () => {
  test('公開ページのリンクがすべて生きている', async ({ page }) => {
    const seeds = ['/', '/products', '/products/wing-01', '/dealers', '/news', '/contact', '/sct', '/privacy', '/terms'];
    const links = new Set<string>();
    for (const s of seeds) {
      await page.goto(s, { waitUntil: 'domcontentloaded' });
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href') ?? ''));
      for (const h of hrefs) {
        if (!h || h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('http')) continue;
        links.add(h.split('#')[0]);
      }
    }
    console.log(`検査するリンク: ${links.size} 本`);
    for (const href of [...links].sort()) {
      const r = await page.request.get(href, { maxRedirects: 0 });
      // 未ログインで会員ページへ行くと 307（ログインへ）は正常
      if (r.status() >= 400) note(`リンク切れ ${href} → HTTP ${r.status()}`);
    }
  });

  test('管理画面の詳細ページが開ける', async ({ page }) => {
    await signIn(page, ADMIN, '/admin', '管理者');

    const openFirst = async (list: string, linkName: string, label: string) => {
      await page.goto(list, { waitUntil: 'domcontentloaded' });
      const link = page.getByRole('link', { name: linkName }).first();
      if (!(await link.isVisible().catch(() => false))) {
        note(`${label}：一覧に「${linkName}」のリンクがない`);
        return;
      }
      const href = await link.getAttribute('href');
      const res = await page.goto(href!, { waitUntil: 'domcontentloaded' });
      if (!res || res.status() >= 400) {
        note(`${label}：${href} が HTTP ${res?.status()}`);
        return;
      }
      const h1 = await page.locator('h1').count();
      if (h1 !== 1) note(`${label}：${href} の h1 が ${h1} 個`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) note(`${label}：${href} に横スクロール ${overflow}px`);
    };

    await openFirst('/admin/models', '編集', 'ベースコンテナ詳細');
    await openFirst('/admin/options', '編集', 'オプション詳細');
    await openFirst('/admin/preview-rules', '編集', 'プレビュー画像詳細');
    await openFirst('/admin/categories', '編集', 'カテゴリー詳細');

    // 新規作成フォーム
    for (const p of ['/admin/models/new', '/admin/options/new', '/admin/preview-rules/new']) {
      const res = await page.goto(p, { waitUntil: 'domcontentloaded' });
      if (!res || res.status() >= 400) note(`新規作成 ${p} が HTTP ${res?.status()}`);
    }
    await logout(page);
  });

  test('マイページ・管理画面が検索避けになっている', async ({ page }) => {
    const email = uniqueEmail('noindex');
    const { quoteId } = await requestQuoteAsCustomer(page, email, 'noindex 点検');
    for (const p of ['/mypage', `/mypage/quotes/${quoteId}`]) {
      await page.goto(p, { waitUntil: 'domcontentloaded' });
      const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
      if (!robots || !/noindex/.test(robots)) note(`${p} に noindex がない（robots=${robots}）`);
    }
    await logout(page);

    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
    if (!robots || !/noindex/.test(robots)) note(`/admin に noindex がない（robots=${robots}）`);
    await logout(page);
  });

  test('入力エラーが画面に出る（フォームの崩れ）', async ({ page }) => {
    // お問い合わせ：空のまま送信
    await page.goto('/contact');
    await page.getByTestId('contact-submit').click();
    const stillOnForm = await page.getByTestId('contact-submit').isVisible();
    if (!stillOnForm) note('お問い合わせ：未入力で送信できてしまう');

    // 会員登録：短いパスワード
    await page.goto('/register');
    await page.locator('#email').fill('bad-email');
    await page.locator('#password').fill('short');
    await page.locator('#full_name').fill('テスト');
    await page.getByRole('button', { name: '会員登録する' }).click();
    await page.waitForTimeout(1200);
    const msg = await page.locator('body').innerText();
    if (!/メールアドレス|パスワード|入力/.test(msg)) note('会員登録：エラー内容が画面に出ていない');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note(`会員登録：エラー表示時に横スクロール ${overflow}px`);
  });

  test('空の状態が崩れない（データがないときの表示）', async ({ page }) => {
    const email = uniqueEmail('empty');
    await page.goto('/register');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('Wing-Test1!');
    await page.locator('#full_name').fill('空 状態');
    await page.locator('#phone').fill('090-0000-0000');
    await page.locator('#address').fill('東京都1-1');
    await page.getByRole('checkbox', { name: /利用規約/ }).check();
    await page.getByRole('button', { name: '会員登録する' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/register'));
    await page.goto('/mypage');
    const text = await page.locator('main').innerText();
    if (!/まだ|ありません/.test(text)) note('マイページ：保存ゼロ件のときの案内がない');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note(`マイページ（空）に横スクロール ${overflow}px`);
    await logout(page);
  });

  test('シミュレーターのポップアップとモバイルメニューが操作できる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    const menu = page.getByLabel('モバイルナビゲーション');
    if (!(await menu.isVisible())) note('モバイルメニューが開かない');
    const menuBox = await menu.boundingBox();
    if (menuBox && menuBox.height < 100) note(`モバイルメニューの高さが ${menuBox.height}px しかない`);
    await page.keyboard.press('Escape');

    await openFreshSimulator(page);
    await page.getByTestId('equip-ub').scrollIntoViewIfNeeded();
    await page.getByTestId('equip-ub').click();
    const dialog = page.getByTestId('option-picker');
    if (!(await dialog.isVisible())) note('SP：商品選択ポップアップが開かない');
    const box = await dialog.boundingBox();
    if (box && box.width > 390) note(`SP：ポップアップが画面幅を超えている（${Math.round(box.width)}px）`);
    const inner = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (inner > 1) note(`SP：ポップアップ表示中に横スクロール ${inner}px`);
    await page.getByRole('button', { name: 'キャンセル' }).click();
  });

  test('代理店の入力フォームが SP でも使える', async ({ page }) => {
    await ensureAccount(page, DEALER, '代理店 担当');
    const customer = uniqueEmail('sp-dealer');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, 'SP 点検');
    await logout(page);

    await signIn(page, ADMIN, '/admin', '管理者');
    await page.goto(`/admin/quotes/${quoteId}`);
    const opt = page.getByTestId('dealer-select').locator('option', { hasText: DEALER });
    await page.getByTestId('dealer-select').selectOption((await opt.getAttribute('value'))!);
    await page.getByTestId('assign-dealer-form').getByRole('button', { name: '割り当てる' }).click();
    await expect(page.getByText('担当代理店を割り当てました')).toBeVisible();
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/quotes/${quoteId}`);
    const form = page.getByTestId('dealer-revision-form');
    if (!(await form.isVisible())) note('SP：代理店の入力フォームが出ない');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note(`SP：代理店の入力画面に横スクロール ${overflow}px`);
    const input = form.locator('input[name="items.0.unit_price"]');
    await input.scrollIntoViewIfNeeded();
    const ib = await input.boundingBox();
    if (ib && ib.width < 40) note(`SP：単価の入力欄が狭すぎる（${Math.round(ib.width)}px）`);
    await logout(page);
  });

  test('会員・見積の詳細ページが SP で崩れない', async ({ page }) => {
    // 準備（保存・見積依頼）は PC 幅で行う。SP は確認だけ
    const email = uniqueEmail('detail');
    const { quoteId, configId } = await requestQuoteAsCustomer(page, email, '詳細点検');
    await logout(page);
    await signIn(page, ADMIN, '/admin', '管理者');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p2 of [`/admin/quotes/${quoteId}`, `/admin/configurations/${configId}`]) {
      const res = await page.goto(p2, { waitUntil: 'domcontentloaded' });
      if (!res || res.status() >= 400) {
        note(`${p2} が HTTP ${res?.status()}`);
        continue;
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) note(`SP：${p2} に横スクロール ${overflow}px`);
      const h1 = await page.locator('h1').count();
      if (h1 !== 1) note(`${p2} の h1 が ${h1} 個`);
    }
    await logout(page);
  });

  test('結果', async () => {
    console.log(found.length ? `\n===== 深掘りの指摘 ${found.length} 件 =====\n${found.map((f) => '- ' + f).join('\n')}\n` : '\n深掘りの指摘なし\n');
    expect(true).toBe(true);
  });
});

