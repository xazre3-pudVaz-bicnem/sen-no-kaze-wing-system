import { expect, test, type Page } from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoConsoleErrors,
  fillRegisterForm,
  login,
  logout,
  openFreshSimulator,
  optionPrice,
  readTotal,
  register,
  uniqueEmail,
  waitForSimulator,
} from './helpers';

const UB = 'option-ub-1216';
const UB3 = 'option-ub-3point-1216';
const WASHBASIN = 'option-washbasin-kb';
const TOILET = 'option-toilet-washlet';
const DECK = 'option-wood-deck';
const AIRCON = 'option-aircon';
const KITCHEN = 'option-mini-kitchen';
const BOILER = 'option-gas-boiler-16';
const EXPENSE = 0.15;
/** 税抜請負額は千円未満切捨てのため、差額は ±1,000 円の範囲で一致すればよい */
const near = (a: number, b: number) => Math.abs(a - b) <= 1100;

async function previewSrc(page: Page) {
  return page.getByTestId('preview-stage').getAttribute('data-preview-src');
}

test.describe('顧客フロー', () => {
  test('1-2. トップ → 商品詳細 → シミュレーター開始', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('もうひとつの可能性');
    await page.getByRole('link', { name: '商品詳細を見る' }).first().click();
    await expect(page).toHaveURL(/\/products\/wing-01$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wing');
    await page.getByRole('link', { name: 'この商品で見積を作る' }).first().click();
    await expect(page).toHaveURL(/\/simulator\/wing-01$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('見積シミュレーター');
    // 商品一覧に 3 モデル
    await page.goto('/products');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
    await expectNoConsoleErrors(page, errors);
  });

  test('3-5. お風呂（UB）・複数オプション・選択不可の説明・画像と金額の変化', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openFreshSimulator(page);

    // 初期構成 = 先頭プラン（単身者用）: 3点ユニット選択中
    await expect(page.getByTestId('preset-single')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(UB3).getByRole('radio')).toBeChecked();
    const base = await readTotal(page);
    const ubPrice = await optionPrice(page, UB);
    const ub3Price = await optionPrice(page, UB3);

    // 3点ユニット選択中 → 洗面器（単体）は競合で選べず、理由が表示される
    await page.getByTestId(WASHBASIN).click();
    await expect(page.getByTestId('toasts')).toContainText('洗面器が含まれている');
    await expect(page.getByTestId(WASHBASIN)).toContainText('洗面器が含まれている');
    expect(await readTotal(page)).toBe(base);

    // お風呂（UB1216）に切り替え → 金額が変わる（差額 × 諸費用 1.15 × 税 1.1）
    await page.getByTestId(UB).click();
    await expect(page.getByTestId(UB).getByRole('radio')).toBeChecked();
    await expect(page.getByTestId(UB3).getByRole('radio')).not.toBeChecked();
    expect(near(await readTotal(page), base + (ubPrice - ub3Price) * (1 + EXPENSE) * 1.1)).toBe(true);

    // お風呂の正規画像は未登録 → 水まわりは「未反映」注記付きの近似表示
    await page.getByTestId('view-water').click();
    await expect(page.getByTestId('preview-note')).toContainText('ユニットバス');

    // UB を外すと元に戻る（ラジオは解除可: カテゴリー非必須）
    await page.getByTestId(UB).click();
    await expect(page.getByTestId(UB).getByRole('radio')).not.toBeChecked();
    expect(near(await readTotal(page), base - ub3Price * (1 + EXPENSE) * 1.1)).toBe(true);

    // 複数オプション（トイレ解除・キッチンは選択済み→解除→再選択）
    await page.getByTestId(TOILET).click();
    await expect(page.getByTestId(TOILET).getByRole('checkbox')).not.toBeChecked();
    await page.getByTestId(KITCHEN).click();
    await page.getByTestId(KITCHEN).click();
    await expect(page.getByTestId(KITCHEN).getByRole('checkbox')).toBeChecked();

    // ウッドデッキ: 登録済みの完成画像に切り替わる（外観）
    await page.getByTestId('view-exterior').click();
    expect(await previewSrc(page)).toContain('wing-lakeside.jpg');
    await page.getByTestId(DECK).click();
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-src', /wing-lakeside-deck/);
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    await page.getByTestId(DECK).click();
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-src', /wing-lakeside\.jpg/);

    // エアコン＋キッチン: 室内画像が切り替わる（エアコンを外すと別画像へ）
    await page.getByTestId('view-interior').click();
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-src', /wing-room-kitchen/);
    await page.getByTestId(AIRCON).click();
    await expect(page.getByTestId('preview-stage')).not.toHaveAttribute('data-preview-src', /wing-room-kitchen/);

    // 依存: ガス給湯器はキッチンに必要なため外せない
    await page.getByTestId(BOILER).click();
    await expect(page.getByTestId('toasts')).toContainText('外せません');

    // 見積項目クリック → 商品選択ポップアップ → 変更
    await page.getByTestId('summary-ub').click();
    await expect(page.getByTestId('option-picker')).toBeVisible();
    await page.getByTestId('pick-ub-1216').click();
    await page.getByTestId('picker-apply').click();
    await expect(page.getByTestId(UB).getByRole('radio')).toBeChecked();

    // プラン切替: ホテルUB
    await page.getByTestId('preset-hotel-ub').click();
    await expect(page.getByTestId('option-interior-hotel-wing').getByRole('radio')).toBeChecked();
    await expect(page.getByTestId(UB).getByRole('radio')).toBeChecked();
    await expectNoConsoleErrors(page, errors);
  });

  test('6-10. ログイン前の選択保持 → 保存 → 再ログイン編集 → 複製 → 見積依頼 → PDF', async ({ page, request }) => {
    const email = uniqueEmail('flow');
    await openFreshSimulator(page);

    // お風呂構成にしてから保存 → 未ログインなのでログインへ
    await page.getByTestId(UB).click();
    await page.getByTestId(DECK).click();
    const totalBefore = await readTotal(page);
    await page.getByTestId('save-button').click();
    await expect(page).toHaveURL(/\/login\?next=/);

    // 新規登録 → シミュレーターへ戻り、選択が残ったまま保存ダイアログが開く
    await page.locator('#main').getByRole('link', { name: '新規会員登録' }).click();
    await expect(page).toHaveURL(/\/register/);
    await fillRegisterForm(page, email, '保存 花子');
    await expect(page).toHaveURL(/\/simulator\/wing-01\?resume=1/);
    await waitForSimulator(page);
    await expect(page.getByTestId(UB).getByRole('radio')).toBeChecked();
    await expect(page.getByTestId(DECK).getByRole('checkbox')).toBeChecked();
    expect(await readTotal(page)).toBe(totalBefore);
    await expect(page.getByTestId('config-name-input')).toBeVisible();
    await page.getByTestId('config-name-input').fill('海辺の別荘プラン');
    await page.getByTestId('save-confirm').click();
    await expect(page.getByTestId('toasts')).toContainText('保存しました');
    await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(page.url()).searchParams.get('c')!;

    // ログアウト → 再ログイン → マイページから再編集
    await logout(page);
    await login(page, email);
    await expect(page).toHaveURL(/\/mypage/);
    await expect(page.getByTestId('configuration-card')).toHaveCount(1);
    await expect(page.getByTestId('configuration-card')).toContainText('海辺の別荘プラン');
    await page.getByTestId('edit-link').click();
    await expect(page).toHaveURL(new RegExp(`c=${configId}`));
    await waitForSimulator(page);
    await expect(page.getByTestId(UB).getByRole('radio')).toBeChecked();
    expect(await readTotal(page)).toBe(totalBefore);

    // 複製
    await page.goto('/mypage');
    await page.getByTestId('duplicate-button').first().click();
    await expect(page).toHaveURL(/duplicated=1/);
    await expect(page.getByTestId('configuration-card')).toHaveCount(2);
    await expect(page.getByText('海辺の別荘プラン（コピー）')).toBeVisible();

    // 見積依頼（元の仕様）
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await expect(page.getByTestId('quote-request-form')).toBeVisible();
    await page.locator('#site_address').fill('石川県七尾市 海沿いの傾斜地');
    await page.getByTestId('submit-quote-request').click();
    await expect(page).toHaveURL(/\/mypage\/quotes\/[0-9a-f-]{36}\?requested=1/);
    const quoteNo = (await page.getByTestId('quote-no').textContent())!.trim();
    expect(quoteNo).toMatch(/^Q\d{6}-\d{4}$/);
    const quoteTotal = (await page.getByTestId('quote-total').textContent())!;
    expect(Number(quoteTotal.replace(/[^0-9]/g, ''))).toBe(totalBefore);
    await expect(page.getByText(/顧客番号/)).toBeVisible();
    await expect(page.getByText('本体諸費用')).toBeVisible();
    await expect(page.getByText('別途工事（現地施工）')).toBeVisible();
    const quoteId = page.url().match(/quotes\/([0-9a-f-]{36})/)![1];

    // PDF（同じセッション Cookie で取得）
    const pdf = await page.request.get(`/api/quotes/${quoteId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    const body = await pdf.body();
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(10_000);

    // 見積依頼済みの仕様は編集不可（読み取り専用表示）
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await expect(page.getByText('見積依頼済みのため編集できません')).toBeVisible();

    // マイページに見積履歴
    await page.goto('/mypage');
    await expect(page.getByTestId('quote-row')).toHaveCount(1);
    await expect(page.getByTestId('quote-row')).toContainText(quoteNo);

    // 13. 他人の保存データ・見積は閲覧不可
    await logout(page);
    const other = uniqueEmail('other');
    await register(page, other);
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await expect(page.getByText('閲覧権限がありません')).toBeVisible();
    await expect(page.getByTestId(UB).getByRole('radio')).not.toBeChecked();
    const res = await page.goto(`/mypage/quotes/${quoteId}`);
    expect(res?.status()).toBe(404);
    const pdfOther = await page.request.get(`/api/quotes/${quoteId}/pdf`);
    expect(pdfOther.status()).toBe(404);
    const anon = await request.get(`/api/quotes/${quoteId}/pdf`);
    expect(anon.status()).toBe(401);
    await page.goto('/mypage');
    await expect(page.getByTestId('configuration-card')).toHaveCount(0);
  });

  test('BOX・フラットのシミュレーター（画像未登録でもプラン・金額が動く）', async ({ page }) => {
    await openFreshSimulator(page, 'box');
    await expect(page.getByTestId('preset-hotel-single')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('option-shower-unit-1116').getByRole('radio')).toBeChecked();
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    const t = await readTotal(page);
    expect(t).toBeGreaterThan(1_000_000);
    await openFreshSimulator(page, 'flat');
    await expect(page.getByTestId('option-interior-standard-flat').getByRole('radio')).toBeChecked();
  });

  test('パスワード再設定（ローカルモードは画面にリンク表示）', async ({ page }) => {
    const email = uniqueEmail('reset');
    await register(page, email);
    await logout(page);
    await page.goto('/reset-password');
    await page.locator('#email').fill(email);
    await page.getByRole('button', { name: '再設定メールを送る' }).click();
    await page.getByTestId('dev-reset-link').click();
    await page.locator('#password').fill('Wing-Test2!');
    await page.locator('#password_confirm').fill('Wing-Test2!');
    await page.getByRole('button', { name: 'パスワードを更新する' }).click();
    await expect(page).toHaveURL(/\/mypage\?password=updated/);
  });
});
