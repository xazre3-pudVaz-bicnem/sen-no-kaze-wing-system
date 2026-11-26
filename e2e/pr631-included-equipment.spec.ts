import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, signInOrRegister } from './helpers';

// P4（#631）：浴室（ub）の商品に「この商品に含まれる設備」（トイレ・洗面）を登録・変更する。
// 使い捨てのローカル検証モード（WING_LOCAL_MODE）のストアだけで動かし、テストごとに元へ戻す。
// 設備包含は商品ごとの事実だけで、シミュレーター・金額はまだ使わない（P5 で使う）。
const UB_CATEGORY_ID = '20000000-0000-4000-8000-000000000006';
const SHOWER_TOILET_UNIT_ID = '30000000-0000-4000-8000-000000000004';

async function openInclusion(page: Page) {
  const details = page.getByTestId('included-equipment-categories');
  await expect(details).toBeVisible();
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.getByTestId('included-equipment-categories-summary').click();
  }
  await expect(page.getByTestId('included-equipment-categories-choices')).toBeVisible();
}

/** 登録済みの商品の含まれる設備を空に戻す（途中で落ちた回の残りがあっても、流し直しで同じ前提から始める） */
async function clearPublishedInclusion(page: Page) {
  const summary = page.getByTestId('included-equipment-categories-summary');
  await expect(summary).toContainText(/設定中 \d+件/);
  if ((await summary.textContent())?.includes('設定中 0件')) return;
  const editor = page.getByTestId('included-equipment-editor');
  await openInclusion(page);
  for (const label of ['トイレ', '洗面']) {
    const box = editor.getByRole('checkbox', { name: label });
    if (await box.isChecked()) await box.uncheck();
  }
  await editor.getByRole('button', { name: '設備設定の変更内容を確認' }).click();
  await page.getByTestId('included-equipment-change-review').getByRole('button', { name: '設備包含設定だけを保存' }).click();
  await expect(editor).toContainText('設備包含設定：保存済み');
  await page.reload();
  await expect(summary).toContainText('設定中 0件');
}

test.describe('P4（#631）：浴室の商品に含まれる設備（ローカルストア専用）', () => {
  test('登録済みの浴室の商品：変更を確かめてから設備だけを保存し、開き直しても残る', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin', '管理者');
    await page.goto('/admin/options/' + SHOWER_TOILET_UNIT_ID);
    const editor = page.getByTestId('included-equipment-editor');
    await expect(editor).toContainText('設備包含設定：保存済み');
    await clearPublishedInclusion(page);

    await openInclusion(page);
    await editor.getByRole('checkbox', { name: 'トイレ' }).check();
    await expect(editor).toContainText('設備包含設定：未保存');
    await editor.getByRole('button', { name: '設備設定の変更内容を確認' }).click();
    const review = page.getByTestId('included-equipment-change-review');
    await expect(review).toContainText('変更前：なし');
    await expect(review).toContainText('変更後：トイレ');
    await review.getByRole('button', { name: '設備包含設定だけを保存' }).click();
    await expect(editor).toContainText('設備包含設定：保存済み');

    await page.reload();
    const summary = page.getByTestId('included-equipment-categories-summary');
    await expect(summary).toContainText('設定中 1件');
    await expect(summary).toContainText('トイレ');

    // 元へ戻す（他の E2E の前提を変えない）
    await clearPublishedInclusion(page);
  });

  test('新しい浴室の商品：STEP 1 で設備を保存し、STEP 2 の保存済みの設備を確かめて登録できる', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin/options/new', '管理者');
    const name = 'P4 E2E 浴室 ' + Date.now().toString(36) + Math.floor(Math.random() * 10000);
    await page.goto('/admin/options/new');
    await page.getByRole('combobox', { name: 'カテゴリー', exact: true }).selectOption(UB_CATEGORY_ID);
    await page.getByTestId('option-name').fill(name);
    await page.getByRole('button', { name: '次へ：画像・資料' }).click();
    await page.waitForURL(/\/admin\/options\/[0-9a-f-]{36}.*step=info/);
    const optionId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(page.getByTestId('option-registration-info')).toBeVisible();

    // STEP 1：設備だけを保存する（商品情報とは別に保存する）
    const editor = page.getByTestId('included-equipment-editor');
    await openInclusion(page);
    await editor.getByRole('checkbox', { name: '洗面' }).check();
    await expect(editor).toContainText('設備包含設定：未保存');
    await editor.getByRole('button', { name: '設備設定だけを保存' }).click();
    await expect(editor).toContainText('設備包含設定：保存済み');

    // 公開に要る画像・価格を入れて STEP 2 へ（STEP 1 の変更は STEP 2 へ進むときに保存される）
    await page.locator('#product-main-media input[name="image_url"]').fill('/images/equipment/unit-bath.png');
    await page.getByTestId('option-price').fill('480000');
    await page.getByRole('button', { name: /登録内容確認/ }).first().click();
    await page.waitForURL(/step=preview/);
    await expect(page.getByTestId('included-equipment-step2-saved')).toContainText('含まれる設備：洗面');

    // 登録（公開）：STEP 2 で確かめた集合が、公開のときも DB（ローカル）と同じことを確かめてから公開する
    await page.getByRole('button', { name: 'この内容で登録' }).click();
    await page.getByRole('dialog', { name: 'この内容で登録しますか？' })
      .getByRole('button', { name: 'この内容で登録' }).click();
    await page.waitForURL((url) => url.pathname === '/admin/ledger' && url.searchParams.get('created_option') === optionId);
    await expect(page.getByText('商品を公開しました。')).toBeVisible();

    // 開き直しても含まれる設備が残っている
    await page.goto('/admin/options/' + optionId);
    await expect(page.getByTestId('included-equipment-categories-summary')).toContainText('設定中 1件');
    await expect(page.getByTestId('included-equipment-categories-summary')).toContainText('洗面');

    // 後始末：未使用の登録済み商品として消す（含まれる設備の行も一緒に消える）。シミュレーターの浴室の候補を増やしたままにしない
    await page.getByTestId('published-option-delete-control').locator('summary').click();
    await page.getByTestId('published-option-delete-control').getByRole('button', { name: 'この商品を削除' }).click();
    await page.getByRole('dialog').getByRole('button').last().click();
    await page.waitForURL((url) => !url.pathname.endsWith(optionId));
    await page.goto('/admin/options/' + optionId);
    await expect(page.getByTestId('included-equipment-editor')).toHaveCount(0);
  });
});
