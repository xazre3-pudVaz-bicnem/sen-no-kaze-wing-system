import { expect, type Locator, type Page } from '@playwright/test';

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

/** 標準設備及び仕上げ表のタイルに出ている差額（"+¥570,000" → 570000、"-¥60,000" → -60000、標準なら 0） */
export async function tilePrice(page: Page, catCode: string): Promise<number> {
  const label = page.getByTestId(`equip-price-${catCode}`);
  if (!(await label.isVisible())) return 0;
  const text = (await label.textContent()) ?? '';
  const amount = yen(text);
  return /[-−]/.test(text) ? -amount : amount;
}

/** 商品選択ポップアップ（商品一覧）を開く（設備表タイル／見積書の行のいずれからでも） */
export async function openPicker(page: Page, testId: string) {
  const trigger = page.getByTestId(testId);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.getByTestId('option-picker')).toBeVisible();
}

/** 商品一覧のカードから商品詳細を開く */
export async function openProductDetail(page: Page, code: string) {
  await page.getByTestId(`product-card-open-${code}`).click();
  await expect(page.getByTestId('product-detail')).toBeVisible();
}

/** 商品詳細の「選択から外す」（選択中の商品で、外せるときだけ出る） */
export function removeButton(page: Page) {
  return page.getByTestId('product-detail-footer').getByRole('button', { name: '選択から外す' });
}

/**
 * 商品を 1 つずつ選び直す。選択中の商品は「選択から外す」、未選択の商品は「この内容に変更する」で確定する。
 * 確定するとポップアップが閉じるので、商品ごとに開き直す
 */
export async function pickOption(page: Page, openTestId: string, codes: string[]) {
  for (const code of codes) {
    await openPicker(page, openTestId);
    await openProductDetail(page, code);
    const remove = removeButton(page);
    if (await remove.isVisible()) await remove.click();
    else await page.getByTestId('product-detail-apply').click();
    await expect(page.getByTestId('option-picker')).toBeHidden();
  }
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

/** 顧客として保存 → 見積依頼までを済ませ、発行された見積 ID を返す（siteAddress を渡すと設置予定地に入れる） */
export async function requestQuoteAsCustomer(page: Page, email: string, configName: string, siteAddress?: string) {
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
  if (siteAddress) await page.locator('#site_address').fill(siteAddress);
  await page.getByTestId('submit-quote-request').click();
  await page.waitForURL(/\/mypage\/quotes\/[0-9a-f-]{36}/);
  return { quoteId: page.url().match(/quotes\/([0-9a-f-]{36})/)![1], total, configId };
}

/**
 * 登録済みの商品の価格を変える（編集 → 変更内容を確認 → この変更を反映）。
 * 商品の編集画面を開いた状態で呼ぶ
 */
export async function applyRegisteredOptionPrice(page: Page, price: number) {
  await page.locator('#registered-price').fill(String(price));
  await page.getByRole('button', { name: '変更内容を確認' }).click();
  await expect(page.getByTestId('registered-option-change-review')).toContainText('商品価格（税別）');
  await page.getByRole('button', { name: 'この変更を反映' }).click();
  // 反映が済むと、最新の登録内容を読み直して編集画面へ戻る
  await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
  await expect(page.locator('#registered-price')).toHaveValue(String(price));
}

/** 本部として案件を開き、担当代理店を割り当てる（「次にやること」の「担当代理店を選ぶ」から） */
export async function assignDealer(page: Page, quoteId: string, dealerEmail = DEALER_EMAIL) {
  await page.goto(`/admin/quotes/${quoteId}`);
  await page.getByTestId('case-next-action-link').click();
  const form = page.getByTestId('assign-dealer-form');
  const select = form.getByTestId('dealer-select');
  const option = select.locator('option', { hasText: dealerEmail });
  await select.selectOption((await option.getAttribute('value'))!);
  await form.getByRole('button', { name: '割り当てる' }).click();
  // 割り当てると案件概要の「担当」に入り、変更はその横の「変更」から行う形になる
  await expect(page.getByTestId('case-dealer-change')).toBeVisible();
}

/** 案件の「見積を編集」から、次の版の編集画面（エクセル形式の表）を開く */
export async function openRevisionEditor(page: Page, quoteId: string): Promise<Locator> {
  await page.goto(`/admin/quotes/${quoteId}`);
  await page.getByTestId('legacy-quote-edit-entry').click();
  await expect(page).toHaveURL(new RegExp(`/admin/quotes/${quoteId}/edit`));
  const form = page.getByTestId('dealer-revision-form');
  await expect(form).toBeVisible();
  return form;
}

/** 編集画面の表で、品名からその行の番号（# 列）を調べる */
export async function revisionRowNumber(form: Locator, name: string): Promise<number> {
  const index = await form
    .locator('input[data-quote-grid-col="name"]')
    .evaluateAll((els, n) => els.findIndex((el) => (el as HTMLInputElement).value.includes(n)), name);
  expect(index, `見積の表に「${name}」の行がありません`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

/** 編集画面で別途工事（現地確認後に決まる施工金額）の行を足す。「別途」は表の最後の区分 */
export async function addInstallationRow(form: Locator, name: string, unitPrice: number) {
  await form.getByRole('button', { name: '＋自由明細' }).last().click();
  await form.locator('input[data-quote-grid-col="name"]').last().fill(name);
  await form.locator('input[data-quote-grid-col="sale"]').last().fill(String(unitPrice));
}

/** 編集画面の「編集中」の合計（税込） */
export async function revisionTotal(form: Locator): Promise<number> {
  const text = (await form.getByTestId('revision-sticky-summary').textContent()) ?? '';
  return yen(text.match(/編集中\s*([^差]+)/)?.[1] ?? '');
}

/**
 * 金額未確定の確認（正式見積の発行前に必要。D1 までの暫定）：未確定の行は「0円確定」を選んで理由を入れ、
 * お客様が選んだ別途見積の商品の確認にチェックを入れる。初期データでは照明（別途見積）が標準で選ばれている
 */
export async function confirmPorBeforeIssue(form: Locator, reason = '現地確認の結果、ほかの明細に含む') {
  const review = form.getByTestId('por-review');
  if ((await review.count()) === 0) return;
  await resolveUnresolvedPorRows(form, reason);
  const confirm = review.getByTestId('por-confirm');
  if ((await confirm.count()) > 0 && !(await confirm.isChecked())) await confirm.check();
}

/**
 * 金額未確定の確認の欄で、未確定の行すべての扱いを選ぶ（既定は「0円確定」で理由を入れる。「対象外」はメモ）。
 * 備考の自由記述では解消しない（2026-10-22 の確定事項 A-2-1）
 */
export async function resolveUnresolvedPorRows(form: Locator, reason: string, state: 'zero_confirmed' | 'excluded' = 'zero_confirmed') {
  const rows = form.getByTestId('por-review').locator('[data-testid="por-review-row"][data-line-state="unresolved"]');
  // 扱いを選ぶと行の状態が変わり、一覧から外れる（選び終えるまで先頭の行を処理する）
  for (let guard = 0; guard < 50 && (await rows.count()) > 0; guard += 1) {
    const row = rows.first();
    if ((await row.getByTestId('por-review-state').count()) === 0) return;
    await row.getByTestId('por-review-state').selectOption(state);
    const resolvedRow = form.getByTestId('por-review').locator(`[data-testid="por-review-row"][data-line-state="${state}"]`).last();
    await resolvedRow.getByTestId('por-review-reason').fill(reason);
  }
}

/** 編集中の内容を次の版として発行し、新しい版の見積 ID を返す（発行後は案件の画面へ戻る） */
export async function issueRevision(page: Page, form: Locator): Promise<string> {
  await confirmPorBeforeIssue(form);
  await form.getByRole('button', { name: /版を発行/ }).click();
  await page.waitForURL(/revised=1/);
  return new URL(page.url()).searchParams.get('case')!;
}

/** 指定のアカウントを（未登録なら作って）用意し、ログアウトした状態に戻す */
export async function ensureAccount(page: Page, email: string, name: string) {
  await signInOrRegister(page, email, '/mypage', name);
  await logout(page);
}
