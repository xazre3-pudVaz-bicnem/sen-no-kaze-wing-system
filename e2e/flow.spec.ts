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
  pickOption,
  quoteLine,
  readTotal,
  register,
  tilePrice,
  uniqueEmail,
  waitForSimulator,
  withExpenseAndTax,
} from './helpers';

const DECK_PRICE = 450_000;

async function previewSrc(page: Page) {
  return page.getByTestId('preview-stage').getAttribute('data-preview-src');
}

test.describe('顧客フロー', () => {
  test('1-2. トップ → 商品詳細 → シミュレーター開始', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wing');
    // 先方サイトと同じセクション構成
    for (const t of ['コンセプト動画', 'Wing 開発の原点', '木造コンテナについて', '活用アイディア', '費用・比較', '導入のご相談', 'プロジェクトの参加', 'よくあるご質問', 'お知らせ']) {
      await expect(page.getByRole('heading', { name: t })).toBeVisible();
    }
    // TOP に会員様ログインの導線がある
    await expect(page.getByTestId('hero-login')).toContainText('会員様ログイン');
    await page.getByRole('link', { name: '商品詳細を見る' }).first().click();
    await expect(page).toHaveURL(/\/products\/wing-01$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wing');
    await page.getByRole('link', { name: 'この商品で見積を作る' }).first().click();
    await expect(page).toHaveURL(/\/simulator\/wing-01$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Wing');
    // 商品一覧に 3 モデル
    await page.goto('/products');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
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

    // ── 変更方法①: 標準設備表の UB をクリック → ポップアップ
    await openPicker(page, 'equip-ub');
    await expect(page.getByRole('heading', { name: '浴室（ユニットバス）を選ぶ' })).toBeVisible();
    // 洗面器（単体）を選択中なので 3点ユニットは選べず、理由が出る
    await expect(page.getByTestId('pick-ub-3point-1216')).toBeDisabled();
    await expect(page.getByTestId('pick-ub-3point-1216')).toContainText('洗面器が含まれている');
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByTestId('option-picker')).toBeHidden();
    expect(await readTotal(page)).toBe(base);

    // 洗面器と混合水栓を外す（依存関係があっても両方外れる）
    await expect(quoteLine(page, 'washbasin-kb')).toBeVisible();
    await pickOption(page, 'equip-washbasin', ['washbasin-kb', 'faucet-kb']);
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
    await page.getByTestId('pick-gas-boiler-16').click();
    await page.getByTestId('picker-apply').click();
    await expect(page.getByTestId('toasts')).toContainText('外せません');
    await expect(quoteLine(page, 'gas-boiler-16')).toBeVisible();

    // ── 変更方法③: 御見積書の明細をクリック → ポップアップでエアコンを外す
    await page.getByTestId('view-interior').click();
    expect(await previewSrc(page)).toContain('wing-room-aircon');
    await pickOption(page, 'quote-line-aircon', ['aircon']);
    await expect(quoteLine(page, 'aircon')).toBeHidden();
    await expect(page.getByTestId('preview-stage')).not.toHaveAttribute('data-preview-src', /wing-room-aircon/);

    // ── 変更方法②: 立面図クリック → 外壁の選択。ウッドデッキで外観画像が切り替わる
    await openPicker(page, 'elevation-正面（南）');
    await expect(page.getByRole('heading', { name: '外壁を選ぶ' })).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await page.getByTestId('view-exterior').click();
    expect(await previewSrc(page)).toContain('wing-lakeside.jpg');
    const beforeDeck = await readTotal(page);
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-src', /wing-lakeside-deck/);
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    expect(near(await readTotal(page), beforeDeck + withExpenseAndTax(DECK_PRICE))).toBe(true);

    // 別途工事の注記と代理店導線
    await expect(page.getByTestId('quote-sheet')).toContainText('現地の代理店、工務店にお問合せ下さい');
    await expect(page.getByTestId('dealers-link')).toBeVisible();

    // 仕様タブ: 住宅仕様に切り替えると標準構成と平面図が入れ替わる
    await page.getByTestId('preset-residence').click();
    await expect(page.getByTestId('preset-residence')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-kitchen')).toContainText('ミニキッチン');
    await expect(page.getByTestId('plan-image')).toHaveAttribute('data-plan-src', /wing-residence/);
    await expectNoConsoleErrors(page, errors);
  });

  test('注文範囲: 本体のみ → 本体＋設備 → フル装備で選べる項目と金額が変わる', async ({ page }) => {
    await openFreshSimulator(page);
    // 既定はフル装備
    await expect(page.getByTestId('finish-level-full')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-ub')).toBeVisible();
    await expect(page.getByTestId('equip-floor')).toBeVisible();
    const fullTotal = await readTotal(page);

    // 本体のみ: 内装・造作・設備が消え、外壁・断熱だけが残る
    // （サッシは本体の内訳に含めるため、防火は注文範囲の下の別枠のため、どちらもタイルに出ない）
    await page.getByTestId('finish-level-shell').click();
    await expect(page.getByTestId('finish-level-shell')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-sash')).toBeHidden();
    await expect(page.getByTestId('equip-insulation')).toBeVisible();
    await expect(page.getByTestId('equip-exterior-wall')).toBeVisible();
    await expect(page.getByTestId('equip-ub')).toBeHidden();
    await expect(page.getByTestId('equip-floor')).toBeHidden();
    await expect(page.getByTestId('equip-carpentry')).toBeHidden();
    await expect(quoteLine(page, 'ub-1216')).toBeHidden();
    await expect(quoteLine(page, 'carpentry-full-wing')).toBeHidden();
    await expect(page.getByTestId('quote-scope')).toContainText('本体のみ');
    const shellTotal = await readTotal(page);
    expect(shellTotal).toBeLessThan(fullTotal);

    // 本体＋設備: 設備は選べるが内装・造作は出ない
    await page.getByTestId('finish-level-equipment').click();
    await expect(page.getByTestId('equip-ub')).toBeVisible();
    await expect(page.getByTestId('equip-floor')).toBeHidden();
    await expect(page.getByTestId('equip-carpentry')).toBeHidden();
    const equipTotal = await readTotal(page);
    expect(equipTotal).toBeGreaterThan(shellTotal);
    expect(equipTotal).toBeLessThan(fullTotal);

    // フル装備へ戻すと内装・造作が復活し、金額も戻る
    await page.getByTestId('finish-level-full').click();
    await expect(page.getByTestId('equip-floor')).toBeVisible();
    await expect(quoteLine(page, 'carpentry-full-wing')).toBeVisible();
    expect(await readTotal(page)).toBe(fullTotal);
  });

  test('本体のみの構成を保存して見積依頼できる', async ({ page }) => {
    const email = uniqueEmail('shell');
    await register(page, email, '/simulator/wing-01');
    await openFreshSimulator(page);
    await page.getByTestId('finish-level-shell').click();
    const total = await readTotal(page);
    await page.getByTestId('save-button').click();
    await page.getByTestId('config-name-input').fill('DIY用スケルトン');
    await page.getByTestId('save-confirm').click();
    await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);
    const configId = new URL(page.url()).searchParams.get('c')!;

    // 開き直しても本体のみのまま
    await page.goto(`/simulator/wing-01?c=${configId}`);
    await waitForSimulator(page);
    await expect(page.getByTestId('finish-level-shell')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-ub')).toBeHidden();
    expect(await readTotal(page)).toBe(total);

    // 見積依頼まで通り、見積書にも注文範囲が出る
    await page.goto(`/mypage/configurations/${configId}/request-quote`);
    await page.getByTestId('submit-quote-request').click();
    await expect(page).toHaveURL(/\/mypage\/quotes\//);
    await expect(page.getByTestId('quote-scope')).toContainText('本体のみ');
    expect(Number((await page.getByTestId('quote-total').textContent())!.replace(/[^0-9]/g, ''))).toBe(total);
  });
  test('防火仕様は注文範囲の下の別枠で選べ、別途見積として見積書に載る', async ({ page }) => {
    await openFreshSimulator(page);
    const picker = page.getByTestId('fireproof-picker');
    // 標準＝非防火
    await expect(picker.getByTestId('fireproof-fire-standard')).toHaveAttribute('aria-pressed', 'true');
    await picker.getByTestId('fireproof-fire-proof').click();
    await expect(picker.getByTestId('fireproof-fire-proof')).toHaveAttribute('aria-pressed', 'true');
    await expect(picker).toContainText('本部が本体明細を確認');
    // 見積書には「別途見積」の行として入る（金額セルは行側にある）
    await expect(quoteLine(page, 'fire-proof')).toContainText('防火仕様（防火構造）');
    await expect(page.locator('tr', { has: quoteLine(page, 'fire-proof') })).toContainText('別途見積');
  });

  test('代理店紹介ページから問い合わせできる', async ({ page }) => {
    await openFreshSimulator(page);
    await page.getByTestId('dealers-link').click();
    await expect(page).toHaveURL(/\/dealers$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('代理店');
    await expect(page.getByTestId('contact-form')).toBeVisible();
  });

  test('6-10. ログイン前の選択保持 → 保存 → 再ログイン編集 → 複製 → 見積依頼 → PDF', async ({ page, request }) => {
    const email = uniqueEmail('flow');
    await openFreshSimulator(page);

    // ウッドデッキを足してから保存 → 未ログインなのでログインへ
    await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
    const totalBefore = await readTotal(page);
    await page.getByTestId('save-button').click();
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
    await openFreshSimulator(page, 'box');
    await expect(page.getByTestId('preset-hotel')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-ub')).toContainText('シャワーユニット 1116');
    await expect(page.getByTestId('preview-stage')).toHaveAttribute('data-preview-kind', 'exact');
    expect(await readTotal(page)).toBeGreaterThan(1_000_000);

    await openFreshSimulator(page, 'flat');
    await expect(page.getByTestId('preset-office')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('equip-wall-ceiling')).toContainText('内装工事一式（標準）');
    expect(await readTotal(page)).toBeGreaterThan(1_000_000);
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

    // 浴室のポップアップに、先方マスターの商品（メーカー・サイズ・参考価格つき）が並ぶ
    await openPicker(page, 'equip-ub');
    const njb = page.getByTestId('pick-bath-ht-njb1216');
    await expect(njb).toContainText('ハウステック');
    await expect(njb).toContainText('1216');
    await expect(njb).toContainText('メーカー参考価格');
    await njb.click();

    // 選ぶと、その商品の選択項目（壁プラン・壁色・照明…）が出る
    const variants = page.getByTestId('variant-picker');
    await expect(variants).toBeVisible();
    await expect(page.getByTestId('variant-group-wall-color')).toBeVisible();
    // 標準の選択肢が最初から選ばれている
    await expect(page.getByTestId('variant-picker').getByRole('button', { pressed: true }).first()).toBeVisible();

    // 壁色を変えて確定する
    await page.getByTestId('variant-oak-greige').click();
    await expect(page.getByTestId('variant-oak-greige')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('picker-apply').click();
    await expect(page.getByTestId('option-picker')).toBeHidden();

    // 見積書の明細に、選んだ仕様が出る
    const line = quoteLine(page, 'bath-ht-njb1216');
    await expect(line).toBeVisible();
    await expect(line).toContainText('壁色：オークグレージュ');

    // 開き直しても選択が残る
    await openPicker(page, 'equip-ub');
    await expect(page.getByTestId('variant-oak-greige')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'キャンセル' }).click();
  });

  test('固定の選択項目は変更できない', async ({ page }) => {
    await openFreshSimulator(page);
    await openPicker(page, 'equip-washbasin');
    await page.getByTestId('pick-wash-pana-mline-w600').click();
    // エムラインの扉色はメーカー設定がホワイトのみ
    const door = page.getByTestId('variant-group-door-color');
    await expect(door).toContainText('この商品では変更できません');
    await expect(door.getByRole('button').first()).toBeDisabled();
    await page.getByRole('button', { name: 'キャンセル' }).click();
  });
});

test.describe('サッシの扱い（2026-08-28 打合せ）', () => {
  test('サッシはお客様に選ばせず、本体の内訳に含めて表示する', async ({ page }) => {
    await openFreshSimulator(page);
    // 設備一覧に出ない（フル装備でも本体のみでも）
    await expect(page.getByTestId('equip-sash')).toBeHidden();
    await page.getByTestId('finish-level-shell').click();
    await expect(page.getByTestId('equip-sash')).toBeHidden();
    // 本体の内訳（分類表見積書）は御見積書に常時展開され、サッシ工事の行と台数が出る
    const breakdown = page.getByTestId('base-breakdown');
    await expect(breakdown).toContainText('サッシ木製建具工事');
    await expect(breakdown).toContainText('・サッシ 玄関ドア');
  });
});
