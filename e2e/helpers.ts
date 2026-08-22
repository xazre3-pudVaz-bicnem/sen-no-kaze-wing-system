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

/** オプションカードに表示されている追加価格（"+¥580,000" → 580000、標準なら 0） */
export async function optionPrice(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  const m = text.match(/\+¥([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}
