import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  addInstallationRow,
  assignDealer,
  ensureAccount,
  issueRevision,
  logout,
  openRevisionEditor,
  requestQuoteAsCustomer,
  resolveUnresolvedPorRows,
  revisionRowNumber,
  revisionTotal,
  signInOrRegister as signIn,
  uniqueEmail,
  yen,
} from './helpers';

test.describe('代理店による確定見積（改訂版）', () => {
  // 代理店アカウントが無いと割り当てができないため、各テストの前に用意しておく
  test.beforeEach(async ({ page }) => {
    await ensureAccount(page, DEALER, '代理店 担当');
  });

  test('割り当て → 案件見積の編集 → 第2版の発行。第1版の金額は変わらない', async ({ page }) => {
    // --- 顧客が概算見積を発行 ---
    const customer = uniqueEmail('rev');
    const { quoteId: firstQuoteId, total: estimate } = await requestQuoteAsCustomer(page, customer, '確定見積のテスト');
    const firstNo = (await page.getByTestId('quote-no').textContent())!.trim();
    await expect(page.getByTestId('quote-revision')).toContainText('第1版・現地確認前');
    await expect(page.getByTestId('quote-respond')).toBeVisible();
    await expect(page.getByTestId('accept-quote')).toBeHidden();
    await expect(page.getByTestId('decline-quote')).toBeVisible();
    expect(yen(await page.getByTestId('quote-total').textContent())).toBe(estimate);
    await logout(page);

    // --- 管理者が代理店を割り当てる ---
    await signIn(page, ADMIN, '/admin', '管理者');
    await assignDealer(page, firstQuoteId);
    await logout(page);

    // --- 代理店が担当案件を開き、案件見積を編集して第2版を発行 ---
    await signIn(page, DEALER, '/admin', '代理店 担当');
    await page.goto('/admin/quotes');
    // 他のテストの案件も並ぶので、対象の見積番号の行だけを見る
    const row = page.getByTestId('dealer-quote-row').filter({ hasText: firstNo });
    await expect(row).toHaveCount(1);
    await row.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`case=${firstQuoteId}`));
    await page.getByTestId('legacy-quote-edit-entry').click();
    await expect(page).toHaveURL(new RegExp(`/admin/quotes/${firstQuoteId}/edit`));

    const form = page.getByTestId('dealer-revision-form');
    await expect(form).toBeVisible();
    // 本体は参照のみ（入力できない）。通常は別途工事（施工金額）だけを編集する
    await expect(form.getByLabel('品名 1', { exact: true })).toBeDisabled();
    await expect(form.getByLabel('売価 1', { exact: true })).toBeDisabled();
    // 現地確認後に決まった別途工事と、お客様への申し送りを入れる
    await addInstallationRow(form, '傾斜地の追加基礎工事', 200_000);
    await page.locator('#dealer_note').fill('搬入路が狭いため小型クレーンを使用します。');

    const preview = await revisionTotal(form);
    expect(preview).toBeGreaterThan(estimate);

    const secondQuoteId = await issueRevision(page, form);
    expect(secondQuoteId).not.toBe(firstQuoteId);
    expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(preview);

    // 第1版は改訂済みで、金額はそのまま
    await page.goto(`/admin/quotes/${firstQuoteId}`);
    await expect(page.getByText('この版は改訂済みです')).toBeVisible();
    expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(estimate);
    await logout(page);

    // --- 顧客側 ---
    await signIn(page, customer, '/mypage', 'テスト 太郎');
    await page.goto(`/mypage/quotes/${secondQuoteId}`);
    await expect(page.getByTestId('quote-revision')).toContainText('第2版・現地条件と施工金額を反映済み');
    await expect(page.getByTestId('dealer-note')).toContainText('小型クレーン');
    await expect(page.getByTestId('quote-table')).toContainText('傾斜地の追加基礎工事');
    // エンドユーザーには本体の明細は出ない（計のみ）
    await expect(page.getByTestId('quote-table')).not.toContainText('金物関係費用');
    await expect(page.getByTestId('quote-table')).toContainText('本体一式');
    expect(yen(await page.getByTestId('quote-total').textContent())).toBe(preview);
    // 第1版も履歴として残っており、金額は当時のまま
    await page.goto(`/mypage/quotes/${firstQuoteId}`);
    expect(yen(await page.getByTestId('quote-total').textContent())).toBe(estimate);
    // PDF は両方の版で取得できる
    for (const id of [firstQuoteId, secondQuoteId]) {
      const pdf = await page.request.get(`/api/quotes/${id}/pdf`);
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await logout(page);
  });

  test('別途見積が未確定のままでは確定見積を発行できず、理由の備考と確認で発行できる（D1 までの暫定）', async ({ page }) => {
    const customer = uniqueEmail('por');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, '別途見積のテスト');
    await logout(page);

    await signIn(page, ADMIN, '/admin', '管理者');
    const form = await openRevisionEditor(page, quoteId);
    const review = form.getByTestId('por-review');
    await expect(review).toBeVisible();
    // 標準で選ばれる照明・別途工事（別途見積）は、0 円のまま未確定の行として示される
    const rows = review.getByTestId('por-review-row');
    const lightingRow = rows.filter({ hasText: '照明器具 ダウンライト一式' });
    const electricRow = rows.filter({ hasText: '電気設備工事' });
    await expect(lightingRow.getByText('未確定', { exact: true })).toBeVisible();
    await expect(electricRow.getByText('未確定', { exact: true })).toBeVisible();
    await expect(review.getByTestId('por-selections')).toContainText('照明器具 ダウンライト一式');
    const issue = form.getByRole('button', { name: /版を発行/ });
    await expect(issue).toBeDisabled();
    await expect(form.getByTestId('por-blockers')).toContainText('別途見積（価格未確定）の明細が');
    const before = await revisionTotal(form);

    // 現地確認で決まった金額を入れる（電気設備工事）。照明は電気設備工事に含める（0 円のまま理由の備考）
    await electricRow.getByTestId('por-review-price').fill('120000');
    await expect(electricRow.getByText('確定', { exact: true })).toBeVisible();
    await lightingRow.getByTestId('por-review-remark').fill('電気設備工事に含む');
    await expect(lightingRow.getByText('確定', { exact: true })).toBeVisible();
    expect(await revisionTotal(form)).toBeGreaterThan(before);
    await expect(form.getByTestId('por-blockers')).toContainText('別途見積（価格未確定）の明細が');

    // 残りの未確定の行にも理由を入れると、明細の理由は消え、お客様が選んだ別途見積の商品の確認だけが残る
    await resolveUnresolvedPorRows(form, '現地確認の結果、今回は対象外（お客様と合意）');
    await expect(form.getByTestId('por-blockers')).not.toContainText('明細が');
    await expect(form.getByTestId('por-blockers')).toContainText('確認にチェック');
    await expect(issue).toBeDisabled();
    await review.getByTestId('por-confirm').check();
    await expect(issue).toBeEnabled();
    await expect(form.getByTestId('por-blockers')).toHaveCount(0);

    const secondQuoteId = await issueRevision(page, form);
    expect(secondQuoteId).not.toBe(quoteId);
    await logout(page);

    // お客様の画面：新しい版に、決めた金額と理由の備考が載る
    await signIn(page, customer, '/mypage', 'テスト 太郎');
    await page.goto(`/mypage/quotes/${secondQuoteId}`);
    await expect(page.getByTestId('quote-table')).toContainText('電気設備工事');
    await expect(page.getByTestId('quote-table')).toContainText('120,000');
    await logout(page);
  });

  test('割り当てられていない代理店は他の見積を開けない', async ({ page }) => {
    const customer = uniqueEmail('other-rev');
    const { quoteId } = await requestQuoteAsCustomer(page, customer, '未割当の見積');
    await logout(page);

    await signIn(page, DEALER, '/admin', '代理店 担当');
    const res = await page.goto(`/admin/quotes/${quoteId}`);
    expect(res?.status()).toBe(404);
    await logout(page);
  });
});

test.describe('案件見積の直接編集（エクセル表）', () => {
  test('本体は参照のみ。内外装・オプションは「見積内容を変更」に切り替えたときだけ編集できる', async ({ page }) => {
    const customer = uniqueEmail('grid');
    const { quoteId, total } = await requestQuoteAsCustomer(page, customer, '見積内容の変更のテスト');
    await logout(page);

    // --- 本部：お客様が選んだオプションの単価を直して第2版を出す ---
    await signIn(page, ADMIN, '/admin', '管理者');
    const form = await openRevisionEditor(page, quoteId);
    // 本体は本部でも参照のみ（正式な本体の選択は別の工程で扱う）
    await expect(form.getByLabel('品名 1', { exact: true })).toBeDisabled();
    await expect(form.getByLabel('売価 1', { exact: true })).toBeDisabled();

    // 通常入力のあいだは、お客様が選んだ内外装・オプションは変えられない
    const aircon = await revisionRowNumber(form, 'エアコン');
    const airconPrice = form.getByLabel(`売価 ${aircon}`, { exact: true });
    const airconRemark = form.getByLabel(`備考 ${aircon}`, { exact: true });
    await expect(airconPrice).toBeDisabled();
    // 明細を足せるのも別途だけ（区分は 本体 → 内外装工事 → オプション → 別途 の順に並ぶ）
    const addRow = form.getByRole('button', { name: '＋自由明細' });
    await expect(addRow.nth(2)).toBeDisabled();
    await expect(addRow.nth(3)).toBeEnabled();

    // 「見積内容を変更」に切り替えると、内外装・オプションも単価・備考を直せて、明細を足せる
    await page.getByTestId('toggle-scope-change').click();
    await expect(form).toContainText('Webでお客様が選択した内容を変更します');
    await expect(addRow.nth(2)).toBeEnabled();
    await expect(airconPrice).toBeEnabled();
    await airconPrice.fill(String(Number(await airconPrice.inputValue()) + 30_000));
    await airconRemark.fill('本部調整');

    const preview = await revisionTotal(form);
    expect(preview).toBeGreaterThan(total);

    await issueRevision(page, form);
    expect(yen(await page.getByTestId('admin-quote-total').textContent())).toBe(preview);
    // 備考が見積書に残る。管理画面では本体の明細（サッシ等）が見える
    await expect(page.getByTestId('quote-table')).toContainText('本部調整');
    await expect(page.getByTestId('quote-table')).toContainText('サッシ木製建具工事');
    await logout(page);
  });
});
