import { expect, test, type Page } from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoConsoleErrors,
  fillRegisterForm,
  login,
  logout,
  near,
  openFreshSimulator,
  openPicker,
  openProductDetail,
  pickOption,
  quoteLine,
  readTotal,
  register,
  removeButton,
  tilePrice,
  uniqueEmail,
  waitForSimulator,
  withExpenseAndTax,
} from './helpers';

const DECK_PRICE = 450_000;

async function previewSrc(page: Page) {
  return page.getByTestId('preview-stage').getAttribute('data-preview-src');
}

/** 仕様を「本体のみ」にして保存 → 開き直し → 見積依頼まで */
async function saveBaseOnlyAndRequestQuote(page: Page, slug: string) {
  await register(page, uniqueEmail('shell'), `/simulator/${slug}`);
  await openFreshSimulator(page, slug);
  await page.getByTestId('preset-base').click();
  await expect(page.getByTestId('preset-base')).toHaveAttribute('aria-pressed', 'true');
  const total = await readTotal(page);
  await page.getByTestId('save-button').click();
  await page.getByTestId('config-name-input').fill('DIY用スケルトン');
  await page.getByTestId('save-confirm').click();
  await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);
  const configId = new URL(page.url()).searchParams.get('c')!;

  // 開き直しても本体のみのまま
  await page.goto(`/simulator/${slug}?c=${configId}`);
  await waitForSimulator(page);
  await expect(page.getByTestId('preset-base')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('equip-ub')).toBeHidden();
  expect(await readTotal(page)).toBe(total);

  // 見積依頼まで通り、見積書の金額はシミュレーターの概算と同じ
  await page.goto(`/mypage/configurations/${configId}/request-quote`);
  await page.getByTestId('submit-quote-request').click();
  await expect(page).toHaveURL(/\/mypage\/quotes\//);
  await expect(page.getByTestId('quote-table')).toContainText('【本体価格計】');
  expect(Number((await page.getByTestId('quote-total').textContent())!.replace(/[^0-9]/g, ''))).toBe(total);
  await logout(page);
}

test.describe('顧客フロー', () => {
  test('1-2. トップ → 商品詳細 → シミュレーター開始', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('木造コンテナ');
    // セクション構成（Ver5。「不陸調整」は「傾斜地対応」に表記が変わった）
    for (const t of [
      'コンセプト動画',
      '傾斜地対応折畳み式木造コンテナの特徴',
      'Wing 開発の原点',
      '折畳み木造コンテナ',
      '傾斜地対応折畳み式木造コンテナの商品説明',
      '傾斜地対応折畳み式木造コンテナの組合せプラン',
      '見積シミュレーション',
      '代理店様募集',
      'よくあるご質問',
      'お知らせ',
    ]) {
      await expect(page.getByRole('heading', { name: t })).toBeVisible();
    }
    // 会員様ログインの導線（ヘッダーの金ボタン。2026-09-02 先方モックでヒーローから移動）
    await expect(page.getByTestId('hero-login')).toContainText('会員様ログイン');
    // 見積シミュレーション欄の「Wingで見積」から直接シミュレーターへ
    await page.locator('#estimate').getByRole('link', { name: /Wingで見積/ }).click();
    await expect(page).toHaveURL(/\/simulator\/wing-01$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wing');
    // 商品一覧に 3 モデル、商品詳細からも見積を開始できる
    await page.goto('/products');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
    await page.goto('/products/wing-01');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wing');
    await page.getByRole('link', { name: 'この商品で見積を作る' }).first().click();
    await expect(page).toHaveURL(/\/simulator\/wing-01$/);
    await expectNoConsoleErrors(page, errors);
  });

  test('3-5. 変更方法（設備表・立面図・見積書）・選択ルール・画像と金額の変化', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openFreshSimulator(page);

    // 初期構成 = 先頭の仕様（ホテル仕様）。平面図・立面図・標準設備表・御見積書が同時に出る
    await expect(page.getByTestId('preset-hotel')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ホテル仕様');
    await expect(page.getByTestId('plan-image')).toHaveAttribute('data-plan-src', /wing-hotel/);
    // 平面図のクリック領域は外してある（設備の変更は設備表・立面図・見積書から）
    await expect(page.getByTestId('plan-board').getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('elevation-正面（南）')).toBeVisible();
    await expect(page.getByTestId('equip-ub')).toContainText('ユニットバス 1216');
    await expect(page.getByTestId('quote-sheet')).toContainText('本体価格');
    const base = await readTotal(page);

    // ── 変更方法①: 標準設備表の UB をクリック → 商品一覧のポップアップ
    await openPicker(page, 'equip-ub');
    await expect(page.locator('#picker-title')).toHaveText('ユニットバスを選ぶ');
    // 洗面器（単体）を選択中なので 3点ユニットは選べず、理由が出る
    await expect(page.getByTestId('product-card-open-ub-3point-1216')).toBeDisabled();
    await expect(page.getByTestId('product-card-ub-3point-1216')).toContainText('洗面器が含まれている');
    await page.getByTestId('option-picker').getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('option-picker')).toBeHidden();
    expect(await readTotal(page)).toBe(base);

    // 標準洗面セット（洗面器＋混合水栓）を外す（依存関係があっても両方外れる）
    await expect(quoteLine(page, 'washbasin-kb')).toBeVisible();
    await pickOption(page, 'equip-washbasin', ['washbasin-standard-set']);
    await expect(quoteLine(page, 'washbasin-kb')).toBeHidden();
    await expect(quoteLine(page, 'faucet-kb')).toBeHidden();
    await expect(page.getByTestId('equip-washbasin')).toContainText('選択なし');
    const afterWashbasin = await readTotal(page);
    expect(afterWashbasin).toBeLessThan(base);

    // 3点ユニットへ切替（競合が解消されたので選べる）→ 金額が差額分だけ動く
    const ubBefore = await tilePrice(page, 'ub');
    await pickOption(page, 'equip-ub', ['ub-3point-1216']);
    const ubAfter = await tilePrice(page, 'ub');
    await expect(page.getByTestId('equip-ub')).toContainText('3点ユニットバス');
    expect(near(await readTotal(page), afterWashbasin + withExpenseAndTax(ubAfter - ubBefore))).toBe(true);

    // 水まわりの完成画像が 3点ユニットの写真に切り替わる（完全一致）
    await page.getByTestId('view-water').click();
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-src', /unit-bath-3point/);
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');

    // 依存: ガス給湯器はユニットバスに必要なため外せない
    await openPicker(page, 'equip-boiler');
    await openProductDetail(page, 'gas-boiler-16');
    await removeButton(page).click();
    await expect(page.getByTestId('toasts')).toContainText('外せません');
    await expect(quoteLine(page, 'gas-boiler-16')).toBeVisible();

    // ── 変更方法③: 御見積書の明細をクリック → ポップアップでエアコンを外す
    await page.getByTestId('view-interior').click();
    expect(await previewSrc(page)).toContain('wing-room-aircon');
    await pickOption(page, 'quote-line-aircon', ['aircon']);
    await expect(quoteLine(page, 'aircon')).toBeHidden();
    await expect(page.getByTestId('preview-stage')).not.toHaveAttribute('data-preview-src', /wing-room-aircon/);

    // ── 変更方法②: 立面図クリック → 面別の外壁選択ダイアログ。ウッドデッキで外観画像が切り替わる
    await page.getByTestId('elevation-正面（南）').click();
    await expect(page.getByTestId('exterior-wall-faces-dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: '外壁を4面ごとに選ぶ' })).toBeVisible();
    await page.getByTestId('exterior-wall-faces-dialog').getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('exterior-wall-faces-dialog')).toBeHidden();
    await page.getByTestId('view-exterior').click();
    expect(await previewSrc(page)).toContain('wing-lakeside.jpg');
    const beforeDeck = await readTotal(page);
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-src', /wing-lakeside-deck/);
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    expect(near(await readTotal(page), beforeDeck + withExpenseAndTax(DECK_PRICE))).toBe(true);

    // 別途工事の注記と代理店導線
    await expect(page.getByTestId('quote-sheet')).toContainText('現地の代理店・工務店へお問い合わせください');
    await expect(page.getByTestId('dealers-link')).toBeVisible();

    // 仕様タブ: 住宅仕様に切り替えると標準構成と平面図が入れ替わる
    await page.getByTestId('preset-residence').click();
    await expect(page.getByTestId('preset-residence')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-kitchen')).toContainText('ミニキッチン');
    await expect(page.getByTestId('plan-image')).toHaveAttribute('data-plan-src', /wing-residence/);
    await expectNoConsoleErrors(page, errors);
  });

  test('仕様「本体のみ」: 設備・内装が外れて金額が下がり、ホテル仕様へ戻すと元に戻る', async ({ page }) => {
    await openFreshSimulator(page);
    // 既定はホテル仕様（設備・内装まで入った標準見積）
    await expect(page.getByTestId('preset-hotel')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-ub')).toBeVisible();
    await expect(page.getByTestId('equip-floor')).toBeVisible();
    await expect(quoteLine(page, 'carpentry-full-wing')).toBeVisible();
    const hotelTotal = await readTotal(page);

    // 本体のみ: 屋根・外壁・玄関ドアだけが残り、内装・造作・設備は消える
    // （サッシは本体の内訳に含めるため、防火は上部の別枠のため、どちらもタイルに出ない）
    await page.getByTestId('preset-base').click();
    await expect(page.getByTestId('preset-base')).toHaveAttribute('aria-pressed', 'true');
    for (const code of ['roof', 'exterior-wall', 'entrance-door']) {
      await expect(page.getByTestId(`equip-${code}`)).toBeVisible();
    }
    for (const code of ['sash', 'ub', 'washbasin', 'floor', 'carpentry']) {
      await expect(page.getByTestId(`equip-${code}`)).toBeHidden();
    }
    await expect(quoteLine(page, 'ub-1216')).toBeHidden();
    await expect(quoteLine(page, 'carpentry-full-wing')).toBeHidden();
    await expect(page.getByTestId('quote-scope')).toContainText('本体のみ');
    expect(await readTotal(page)).toBeLessThan(hotelTotal);

    // ホテル仕様へ戻すと内装・造作・設備が復活し、金額も戻る
    await page.getByTestId('preset-hotel').click();
    await expect(page.getByTestId('equip-floor')).toBeVisible();
    await expect(quoteLine(page, 'carpentry-full-wing')).toBeVisible();
    expect(await readTotal(page)).toBe(hotelTotal);
  });

  test('本体のみの構成を保存して見積依頼できる（BOX）', async ({ page }) => {
    await saveBaseOnlyAndRequestQuote(page, 'box');
  });

  // Wing の本体のみは、床・壁・天井の断熱が必須なのに、本体のみでは壁・天井の断熱商品を選べないため保存できない
  // （本番の validate_configuration_items も同じ判定）。本体のみに断熱を含めるかの先方確認と、
  // 必須判定の是正が済んだら fixme を外す
  test.fixme('本体のみの構成を保存して見積依頼できる（Wing）', async ({ page }) => {
    await saveBaseOnlyAndRequestQuote(page, 'wing-01');
  });
  test('防火仕様は上部の選択で切り替え、金額は別途見積（本部が確認）の案内が出る', async ({ page }) => {
    await openFreshSimulator(page);
    const select = page.getByTestId('fireproof-select');
    const notice = page.getByText('本部が本体明細を確認のうえ確定します');
    // 標準＝非防火
    await expect(select.locator('option:checked')).toHaveText('非防火');
    await expect(notice).toBeHidden();
    const before = await readTotal(page);

    await select.selectOption({ label: '防火構造' });
    await expect(select.locator('option:checked')).toHaveText('防火構造');
    await expect(notice).toBeVisible();
    // 選び直しで入れ替わるだけなので「解除できません」とは出ない
    await expect(page.getByText('解除できません')).toHaveCount(0);
    // 金額は場所の条件で変わるため、概算の見積書には行を出さない（本部が本体明細を確認して確定する）
    await expect(quoteLine(page, 'fire-proof')).toHaveCount(0);
    expect(await readTotal(page)).toBe(before);

    // 非防火へ戻せる
    await select.selectOption({ label: '非防火' });
    await expect(select.locator('option:checked')).toHaveText('非防火');
    await expect(notice).toBeHidden();
    await expect(page.getByText('解除できません')).toHaveCount(0);
  });

  test('代理店紹介ページから問い合わせできる', async ({ page }) => {
    await openFreshSimulator(page);
    await page.getByTestId('dealers-link').click();
    await expect(page).toHaveURL(/\/dealers$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('代理店');
    await expect(page.getByTestId('contact-form')).toBeVisible();
  });

  test('2-1. 未ログインで一時保存し、別の端末（別のブラウザ）で URL から続きを開ける', async ({ page, browser }) => {
    await openFreshSimulator(page);
    await page.getByTestId('site-prefecture-select').selectOption('石川県');
    const total = await readTotal(page);
    const equipment = (await page.getByTestId('equip-exterior-parts').textContent()) ?? '';
    await page.getByTestId('save-button').click();
    await page.getByTestId('guest-save-temporary').click();
    const url = await page.getByTestId('guest-plan-url').inputValue();
    expect(url).toMatch(/\/simulator\/wing-01\?plan=[A-Za-z0-9_-]{32}$/);

    // 別の端末：ログインしていない・この端末の選択（localStorage）も無い
    const other = await browser.newContext();
    try {
      const phone = await other.newPage();
      await phone.goto(url);
      await waitForSimulator(phone);
      await expect(phone.getByTestId('guest-plan-notice')).toBeVisible();
      await expect(phone.getByTestId('site-prefecture-select')).toHaveValue('石川県');
      await expect(phone.getByTestId('equip-exterior-parts')).toHaveText(equipment);
      expect(await readTotal(phone)).toBe(total);
      // 鍵が違う・期限切れの URL は開けない
      await phone.goto(url.replace(/plan=.*/, 'plan=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
      await waitForSimulator(phone);
      await expect(phone.getByText('一時保存の URL が見つからないか')).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('3-1. 保存したプランに土地の情報を入力でき、見積依頼の画面に引き継がれる（土地あり → 土地なしに変えて依頼）', async ({ page }) => {
    const customer = uniqueEmail('land');
    await register(page, customer, '/simulator/wing-01');
    await openFreshSimulator(page);
    await page.getByTestId('save-button').click();
    await page.getByTestId('config-name-input').fill('土地を入力するプラン');
    await page.getByTestId('save-confirm').click();
    await page.waitForURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(page.url()).searchParams.get('c')!;

    // マイページの保存プランから「設置予定地・土地」へ。土地あり → 設置予定地を入力
    await page.goto('/mypage');
    await page.getByTestId('land-link').click();
    await expect(page).toHaveURL(new RegExp(`/mypage/configurations/${configId}/land`));
    await page.getByTestId('land-status-owned').check();
    await page.locator('#land-address').fill('石川県七尾市○○1-2');
    await page.locator('#land-area').fill('200');
    await page.locator('#land-road').selectOption('wide');
    await page.getByTestId('site-profile-save').click();
    await expect(page.getByText('設置予定地・土地の情報を保存しました')).toBeVisible();

    // 見積依頼の画面に引き継がれる。土地なしに変え、希望地域・予算を入れて依頼する
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await expect(page.locator('#site_address')).toHaveValue('石川県七尾市○○1-2');
    await expect(page.getByTestId('land-status-owned')).toBeChecked();
    await page.getByTestId('land-status-none').check();
    await page.locator('#request-land-desired-area').fill('能登の海沿い');
    await page.locator('#request-land-budget').selectOption('3m_5m');
    await page.getByTestId('submit-quote-request').click();
    await page.waitForURL(/\/mypage\/quotes\/[0-9a-f-]{36}/);

    // 依頼の後も、本人は土地の情報を見て変えられる（土地なし：住所・面積は残らない）
    await page.goto(`/mypage/configurations/${configId}/land`);
    await expect(page.getByTestId('land-status-none')).toBeChecked();
    await expect(page.locator('#land-desired-area')).toHaveValue('能登の海沿い');
    await logout(page);
  });

  test('6-10. ログイン前の選択保持 → 保存 → 再ログイン編集 → 複製 → 見積依頼 → PDF', async ({ page, request }) => {
    const email = uniqueEmail('flow');
    await openFreshSimulator(page);

    // ウッドデッキを足してから保存 → 未ログインなので保存の方法を選び、マイページに保存（ログイン）へ
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    const totalBefore = await readTotal(page);
    await page.getByTestId('save-button').click();
    await page.getByTestId('guest-save-login').click();
    await expect(page).toHaveURL(/\/login\?next=/);

    // 新規登録 → シミュレーターへ戻り、選択が残ったまま保存ダイアログが開く
    await page.locator('#main').getByRole('link', { name: '新規会員登録' }).click();
    await expect(page).toHaveURL(/\/register/);
    await fillRegisterForm(page, email, '保存 花子');
    await expect(page).toHaveURL(/\/simulator\/wing-01\?resume=1/);
    await waitForSimulator(page);
    await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');
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
    await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');
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
    // 表示例（エクセル形式）：区分見出し・小計行・別途工事の注記
    const quoteTable = page.getByTestId('quote-table');
    for (const label of ['本体価格', '【本体価格計】', 'オプション価格', '【オプション価格計】', '別途工事', '【別途工事計】', '運送費']) {
      await expect(quoteTable).toContainText(label);
    }
    await expect(quoteTable).toContainText('現地の代理店、工務店にお問合せ下さい');
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
    await expect(page.getByTestId('equip-exterior-parts')).not.toContainText('ウッドデッキ');
    const res = await page.goto(`/mypage/quotes/${quoteId}`);
    expect(res?.status()).toBe(404);
    const pdfOther = await page.request.get(`/api/quotes/${quoteId}/pdf`);
    expect(pdfOther.status()).toBe(404);
    const anon = await request.get(`/api/quotes/${quoteId}/pdf`);
    expect(anon.status()).toBe(401);
    await page.goto('/mypage');
    await expect(page.getByTestId('configuration-card')).toHaveCount(0);
  });

  test('BOX・フラットのシミュレーター（仕様・金額が動く）', async ({ page }) => {
    // BOX の既定はホテル・単身者用
    await openFreshSimulator(page, 'box');
    await expect(page.getByTestId('preset-hotel-single')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-ub')).toContainText('シャワーユニット 1116');
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    const boxTotal = await readTotal(page);
    expect(boxTotal).toBeGreaterThan(1_000_000);
    // 本体のみにすると設備が外れて金額が下がる
    await page.getByTestId('preset-base').click();
    await expect(page.getByTestId('equip-ub')).toBeHidden();
    expect(await readTotal(page)).toBeLessThan(boxTotal);

    // フラットの既定は事務所・店舗用
    await openFreshSimulator(page, 'flat');
    await expect(page.getByTestId('preset-office')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-wall-ceiling')).toContainText('内装工事一式（標準）');
    const flatTotal = await readTotal(page);
    expect(flatTotal).toBeGreaterThan(1_000_000);
    await page.getByTestId('preset-base').click();
    await expect(page.getByTestId('equip-wall-ceiling')).toBeHidden();
    expect(await readTotal(page)).toBeLessThan(flatTotal);
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

test.describe('公開ページ（先方サイト構成）', () => {
  test('お知らせ一覧・詳細・特商法・プライバシーが表示される', async ({ page }) => {
    await page.goto('/news');
    await expect(page.getByRole('heading', { name: 'お知らせ' })).toBeVisible();
    const first = page.locator('main a[href^="/news/"]').first();
    const href = await first.getAttribute('href');
    await first.click();
    await expect(page).toHaveURL(new RegExp(href!));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/sct');
    await expect(page.getByRole('heading', { name: '特定商取引法に基づく表記' })).toBeVisible();
    await expect(page.getByText('二級建築士事務所 千葉県知事登録 第2-2206-7434号')).toBeVisible();
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'プライバシーポリシー' })).toBeVisible();
  });

  test('お問い合わせフォームを送信でき、管理画面に表示される', async ({ page }) => {
    await page.goto('/contact');
    await page.locator('#full_name').fill('問合 太郎');
    await page.locator('#email').fill('toiawase@example.com');
    await page.locator('#phone').fill('090-3333-4444');
    await page.locator('#topic').selectOption('土地活用について');
    await page.locator('#message').fill('傾斜地の遊休地があります。宿泊事業を検討しています。');
    await page.getByRole('checkbox', { name: /プライバシーポリシー/ }).check();
    await page.getByTestId('contact-submit').click();
    await expect(page.getByText('お問い合わせを受け付けました')).toBeVisible();

    // 管理者で確認
    await page.goto('/login');
    await page.locator('#email').fill('admin@example.com');
    await page.locator('#password').fill('Wing-Test1!');
    await page.getByRole('button', { name: 'ログイン' }).click();
    const ok = await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10_000 }).then(() => true).catch(() => false);
    if (!ok) await register(page, 'admin@example.com', '/admin', '管理者');
    await page.goto('/admin/contacts');
    await expect(page.getByTestId('contact-row').first()).toContainText('問合 太郎');
    await expect(page.getByTestId('contact-row').first()).toContainText('土地活用について');
  });
});

test.describe('ネットショップ型の商品選び', () => {
  test('商品を選ぶと色や仕様を選べ、見積書にも残る', async ({ page }) => {
    await openFreshSimulator(page);

    // 浴室のポップアップに、先方マスターの商品（メーカー・サイズつき）が並ぶ
    await openPicker(page, 'equip-ub');
    const njb = page.getByTestId('product-card-bath-ht-njb1216');
    await expect(njb).toContainText('ハウステック');
    await expect(njb).toContainText('1216');
    await openProductDetail(page, 'bath-ht-njb1216');

    // 商品詳細に、その商品の選択項目（壁プラン・照明…）が出る
    await expect(page.getByTestId('variant-picker')).toBeVisible();
    await expect(page.getByTestId('variant-group-wall-plan')).toBeVisible();
    // 標準の選択肢が最初から選ばれている
    await expect(page.getByTestId('variant-full-white')).toHaveAttribute('aria-pressed', 'true');
    // 壁プランが標準（全面ホワイト）のあいだ、壁色は表示されない（先方指示 2026-08-29）
    await expect(page.getByTestId('variant-group-wall-color')).toBeHidden();

    // アクセントを選ぶと壁色が現れる → 壁色を変えて確定する
    await page.getByTestId('variant-accent').click();
    await expect(page.getByTestId('variant-group-wall-color')).toBeVisible();
    await page.getByTestId('variant-oak-greige').click();
    await expect(page.getByTestId('variant-oak-greige')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('product-detail-apply').click();
    await expect(page.getByTestId('option-picker')).toBeHidden();

    // 見積書の明細に、選んだ仕様が出る
    const line = quoteLine(page, 'bath-ht-njb1216');
    await expect(line).toBeVisible();
    await expect(line).toContainText('壁色：オークグレージュ');

    // 開き直しても選択が残る
    await openPicker(page, 'equip-ub');
    await expect(page.getByTestId('product-card-bath-ht-njb1216')).toContainText('選択中');
    await openProductDetail(page, 'bath-ht-njb1216');
    await expect(page.getByTestId('variant-oak-greige')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('option-picker')).toBeHidden();
  });

  test('固定の選択項目は変更できず、標準仕様として表示される', async ({ page }) => {
    await openFreshSimulator(page);
    await openPicker(page, 'equip-washbasin');
    await openProductDetail(page, 'wash-pana-mline-w600');
    // エムラインの扉色（ホワイト）と水栓はメーカー設定で固定。選ぶボタンは出さず「標準仕様」として表示する
    const detail = page.getByTestId('product-detail');
    await expect(detail).toContainText('標準仕様');
    await expect(detail).toContainText('扉色');
    await expect(detail).toContainText('ホワイト');
    await expect(detail).toContainText('シングルレバーシャワー');
    await expect(page.getByTestId('variant-group-door-color')).toHaveCount(0);
    await expect(page.getByTestId('variant-group-faucet')).toHaveCount(0);
    // 選べる項目（ミラー）は選択肢として出る
    await expect(page.getByTestId('variant-group-mirror')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('option-picker')).toBeHidden();
  });
});

test.describe('商品選択ポップアップ', () => {
  test('外壁は4面ダイアログで選び、外構部品は商品詳細から追加・解除できる', async ({ page }) => {
    await openFreshSimulator(page);

    // 外壁：タイルをクリックすると4面選択ダイアログが開き、現在の外壁が選択中で表示される（2026-08-30 PR#20）
    await page.getByTestId('equip-exterior-wall').click();
    const faces = page.getByTestId('exterior-wall-faces-dialog');
    await expect(faces).toBeVisible();
    await expect(faces.getByTestId('product-card-exterior-galnote')).toContainText('選択中');
    await faces.getByTestId('product-card-open-exterior-wood').click();
    await expect(faces.getByTestId('product-card-exterior-wood')).toContainText('選択中');
    await faces.getByTestId('exterior-faces-apply').click();
    await expect(faces).toBeHidden();
    // 正面の面別カード（equip-exterior-wall）に反映される
    await expect(page.getByTestId('equip-exterior-wall')).toContainText('木板下見板張り');

    // 複数選択（外構部品）：一覧 → 商品詳細 →「この内容に変更する」で追加
    await openPicker(page, 'equip-exterior-parts');
    await expect(page.getByTestId('product-card-wood-deck')).not.toContainText('選択中');
    await openProductDetail(page, 'wood-deck');
    await page.getByTestId('product-detail-apply').click();
    await expect(page.getByTestId('option-picker')).toBeHidden();
    await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');

    // もう一度開くと「選択中」になっていて、商品詳細の「選択から外す」で外せる
    await openPicker(page, 'equip-exterior-parts');
    await expect(page.getByTestId('product-card-wood-deck')).toContainText('選択中');
    await openProductDetail(page, 'wood-deck');
    await expect(page.getByTestId('product-detail')).toContainText('現在選択中');
    await removeButton(page).click();
    await expect(page.getByTestId('option-picker')).toBeHidden();
    await expect(page.getByTestId('equip-exterior-parts')).not.toContainText('ウッドデッキ');
  });
});

test.describe('サッシの扱い（2026-08-28 打合せ）', () => {
  test('サッシはお客様に選ばせず、本体の内訳に含めて表示する', async ({ page }) => {
    await openFreshSimulator(page);
    // 設備一覧に出ない（ホテル仕様でも本体のみでも）
    await expect(page.getByTestId('equip-sash')).toBeHidden();
    await page.getByTestId('preset-base').click();
    await expect(page.getByTestId('preset-base')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-sash')).toBeHidden();
    // 本体の明細はエンドユーザーには出さない（計のみ）。サッシ等の明細は本部・代理店の管理画面で見る
    const breakdown = page.getByTestId('base-breakdown');
    await expect(breakdown).toContainText('本体一式');
    await expect(breakdown).toContainText('【本体価格計】');
    await expect(breakdown).not.toContainText('金物関係費用');
    await expect(breakdown).not.toContainText('サッシ木製建具工事');
  });
});
