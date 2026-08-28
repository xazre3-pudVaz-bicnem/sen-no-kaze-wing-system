import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Wing-Test1!';

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function fillRegisterForm(page: Page, email: string, name = 'テスト 太郎') {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#full_name').fill(name);
  await page.locator('#phone').fill('090-0000-0000');
  await page.locator('#address').fill('石川県七尾市1-1');
  await page.getByRole('checkbox', { name: /利用規約/ }).check();
  await page.getByRole('button', { name: '会員登録する' }).click();
}

export async function register(page: Page, email: string, next = '/mypage', name = 'テスト 太郎') {
  await page.goto(`/register?next=${encodeURIComponent(next)}`);
  await fillRegisterForm(page, email, name);
  await page.waitForURL((u) => !u.pathname.startsWith('/register'));
}

export async function login(page: Page, email: string, next = '/mypage', password = PASSWORD) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export async function logout(page: Page) {
  await page.goto('/mypage');
  await page.getByTestId('logout-button').click();
  await page.waitForURL((u) => u.pathname === '/');
}

export function yen(text: string | null): number {
  return Number((text ?? '').replace(/[^0-9]/g, ''));
}

export async function readTotal(page: Page): Promise<number> {
  return yen(await page.getByTestId('total-price').textContent());
}

/** dev サーバー特有のノイズ（HMR WebSocket 等）は除外して、アプリ由来のコンソールエラーだけを見る */
export async function expectNoConsoleErrors(page: Page, errors: string[]) {
  const ignorable = errors.filter((e) => !/favicon|Download the React DevTools|net::ERR_ABORTED|_next\/hmr|WebSocket|Fast Refresh/i.test(e));
  expect(ignorable, `console errors:\n${ignorable.join('\n')}`).toEqual([]);
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** シミュレーターを開き、localStorage を空にしてハイドレーション完了まで待つ */
export async function openFreshSimulator(page: Page, slug = 'wing-01') {
  await page.goto(`/simulator/${slug}`);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('simulator')).toHaveAttribute('data-hydrated', 'true');
}

export async function waitForSimulator(page: Page) {
  await expect(page.getByTestId('simulator')).toHaveAttribute('data-hydrated', 'true');
}

/** 標準設備及び仕上げ表のタイルに出ている追加価格（"+¥570,000" → 570000、標準なら 0） */
export async function tilePrice(page: Page, catCode: string): Promise<number> {
  const text = (await page.getByTestId(`equip-${catCode}`).textContent()) ?? '';
  const m = text.match(/\+[^\d]*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

/** 商品選択ポップアップを開く（設備表タイル／平面図ホットスポット／見積書の行のいずれからでも） */
export async function openPicker(page: Page, testId: string) {
  const trigger = page.getByTestId(testId);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.getByTestId('option-picker')).toBeVisible();
  // 1つ選ぶカテゴリーで選択済みのときは選択中の商品だけが出るので、一覧に展開してから操作する
  const expand = page.getByTestId('picker-expand');
  if (await expand.isVisible().catch(() => false)) await expand.click();
}

/** ポップアップで商品を選び直して「変更する」で確定する */
export async function pickOption(page: Page, openTestId: string, codes: string[]) {
  await openPicker(page, openTestId);
  for (const code of codes) await page.getByTestId(`pick-${code}`).click();
  await page.getByTestId('picker-apply').click();
  await expect(page.getByTestId('option-picker')).toBeHidden();
}

/** 見積書（2-1 明細）の行 */
export function quoteLine(page: Page, code: string) {
  return page.getByTestId(`quote-line-${code}`);
}

/** 諸費用 15% ＋ 消費税 10%。税抜請負額は千円未満切捨てのため ±1,100 円の誤差を許容する */
export const EXPENSE_RATE = 0.15;
export function withExpenseAndTax(amount: number): number {
  return amount * (1 + EXPENSE_RATE) * 1.1;
}
export function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1100;
}

export const ADMIN_EMAIL = 'admin@example.com';
export const MASTER_EMAIL = 'master@example.com';
export const DEALER_EMAIL = 'dealer@example.com';

/** 既に登録済みならログイン、未登録なら登録する（ローカルモードは初回登録時に権限が決まる） */
export async function signInOrRegister(page: Page, email: string, next: string, name: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  // 既にログイン済みなら /login から追い出されるので何もしない
  if (!new URL(page.url()).pathname.startsWith('/login')) return;
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  const ok = await page
    .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) await register(page, email, next, name);
}

/** 代理店のフリー商品「代理店オリジナルベッド」を用意する（既にあれば何もしない） */
export async function ensureDealerFreeProduct(page: Page, code = 'dealer-bed', name = '代理店オリジナルベッド', price = 100_000) {
  await signInOrRegister(page, DEALER_EMAIL, '/admin', '代理店 担当');
  await page.goto('/admin/free-products');
  if (await page.getByTestId(`free-product-${code}`).isVisible().catch(() => false)) return;
  await page.getByRole('link', { name: 'フリー商品を追加' }).click();
  await page.getByTestId('option-name').fill(name);
  await page.locator('#code').fill(code);
  await page.getByTestId('option-price').fill(String(price));
  await page.getByTestId('admin-submit').click();
  await expect(page.getByText('保存しました')).toBeVisible();
}

/** 顧客として保存 → 見積依頼までを済ませ、発行された見積 ID を返す */
export async function requestQuoteAsCustomer(page: Page, email: string, configName: string) {
  await register(page, email, '/simulator/wing-01');
  await openFreshSimulator(page);
  const total = await readTotal(page);
  await page.getByTestId('save-button').click();
  await page.getByTestId('config-name-input').fill(configName);
  await page.getByTestId('save-confirm').click();
  await page.waitForURL(/\?c=[0-9a-f-]{36}/);
  const configId = new URL(page.url()).searchParams.get('c')!;
  await page.goto(`/mypage/configurations/${configId}/request-quote`);
  await expect(page.getByTestId('quote-request-form')).toBeVisible();
  await page.getByTestId('submit-quote-request').click();
  await page.waitForURL(/\/mypage\/quotes\/[0-9a-f-]{36}/);
  return { quoteId: page.url().match(/quotes\/([0-9a-f-]{36})/)![1], total, configId };
}

/** 指定のアカウントを（未登録なら作って）用意し、ログアウトした状態に戻す */
export async function ensureAccount(page: Page, email: string, name: string) {
  await signInOrRegister(page, email, '/mypage', name);
  await logout(page);
}
