import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, signInOrRegister } from './helpers';

// All mutations in this suite run only against Playwright's disposable WING_LOCAL_MODE store.
// The GitHub Actions runner sets no Supabase production credentials.
const AIRCON_CATEGORY_ID = '20000000-0000-4000-8000-000000000011';
const EXISTING_PRODUCT_ID = '30000000-0000-4000-8000-000000000001';

async function createDraft(page: Page, returnTo?: string) {
  const suffix = Date.now().toString(36) + Math.floor(Math.random() * 10000);
  const name = 'PR632 E2E テスト商品 ' + suffix;
  const path = '/admin/options/new' + (returnTo ? '?return_to=' + encodeURIComponent(returnTo) : '');
  await page.goto(path);
  await page.getByRole('combobox', { name: 'カテゴリー', exact: true }).selectOption(AIRCON_CATEGORY_ID);
  await page.getByTestId('option-name').fill(name);
  await page.getByRole('button', { name: '次へ：画像・資料' }).click();
  await page.waitForURL(/\/admin\/options\/[0-9a-f-]{36}.*step=info/);
  const optionId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByTestId('option-registration-info')).toBeVisible();
  return { optionId, name };
}

async function preparePublish(page: Page) {
  await page.locator('#product-main-media input[name="image_url"]').fill('/images/equipment/aircon.png');
  await page.getByTestId('option-price').fill('120000');
  // Midway saving keeps the user on STEP 1.
  await page.getByRole('button', { name: '下書きを作成してSTEP 1を続ける' }).click();
  await expect(page).toHaveURL(/step=info/);
  await expect(page.getByTestId('option-registration-info')).toBeVisible();
  await page.getByRole('button', { name: /登録内容確認/ }).first().click();
  await page.waitForURL(/step=preview/);
  await expect(page.getByTestId('option-customer-preview')).toBeVisible();
  // Viewing STEP 2 does not cause an automatic publish/redirect.
  await expect(page).toHaveURL(/\/admin\/options\/[0-9a-f-]{36}.*step=preview/);
}

async function publish(page: Page) {
  await page.getByRole('button', { name: 'この内容で登録' }).click();
  await page.getByRole('dialog', { name: 'この内容で登録しますか？' })
    .getByRole('button', { name: 'この内容で登録' }).click();
}

test.describe('PR #632: 商品登録と編集の完了後の遷移（ローカルストア専用）', () => {
  test('新規の途中保存とSTEP2確認を維持し、成功時に商品台帳へ戻って強調する', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin/options/new', '管理者');
    const { optionId, name } = await createDraft(page);
    await preparePublish(page);
    await publish(page);
    await page.waitForURL((url) => url.pathname === '/admin/ledger' && url.searchParams.get('created_option') === optionId);
    await expect(page.getByText('商品を公開しました。')).toBeVisible();
    const changed = page.locator('[data-recently-changed="true"]:visible').first();
    await expect(changed).toBeVisible();
    await expect(changed).toContainText(name);

    // Existing ledger filters, sorting and detail panel remain operational.
    await page.getByRole('button', { name: /検索/ }).click();
    await page.getByRole('searchbox', { name: '商品を検索' }).fill(name);
    await expect(changed).toBeVisible();
    await page.getByRole('button', { name: '商品名の並び替え' }).click();
    await page.getByRole('button', { name: '商品名 昇順' }).click();
    await expect(changed).toBeVisible();
    await changed.click();
    await expect(page.getByTestId('ledger-product-detail-pane')).toBeVisible();
    await page.getByRole('button', { name: '商品詳細を閉じる' }).click();
    await page.getByRole('searchbox', { name: '商品を検索' }).fill('');
    await page.getByRole('navigation', { name: '商品分類' }).getByRole('button', { name: /すべて/ }).click();
    await expect(page.getByText('商品一覧', { exact: true })).toBeVisible();
  });

  test('入力不足・サーバー保存失敗では遷移せず、編集反映成功時だけ商品台帳に戻る', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin', '管理者');
    await page.goto('/admin/options/' + EXISTING_PRODUCT_ID);
    const nameInput = page.locator('#registered-name');
    const oldName = await nameInput.inputValue();
    await nameInput.fill('');
    await page.getByRole('button', { name: '変更内容を確認' }).click();
    await expect(page.getByTestId('registered-option-edit-flow')).toBeVisible();
    await expect(page.getByText('商品名を入力してください。')).toBeVisible();

    await nameInput.fill(oldName + ' PR632');
    await page.locator('#registered-list-price').fill('-1'); // Zod validation must reject on save.
    await page.getByRole('button', { name: '変更内容を確認' }).click();
    await expect(page.getByTestId('registered-option-change-review')).toBeVisible();
    await page.getByRole('button', { name: 'この変更を反映' }).click();
    await expect(page).toHaveURL(/\/admin\/options\/[0-9a-f-]{36}/);
    await expect(page.getByTestId('registered-option-change-review')).toBeVisible();

    await page.getByRole('button', { name: '編集に戻る' }).first().click();
    await page.locator('#registered-list-price').fill('100000');
    await page.getByRole('button', { name: '変更内容を確認' }).click();
    await page.getByRole('button', { name: 'この変更を反映' }).click();
    await page.waitForURL((url) => url.pathname === '/admin/ledger' && url.searchParams.get('updated_option') === EXISTING_PRODUCT_ID);
    await expect(page.getByText('商品を更新しました。')).toBeVisible();
    const changed = page.locator('[data-recently-changed="true"]:visible').first();
    await expect(changed).toBeVisible();
    await expect(changed).toContainText('PR632');
  });

  test('明示された見積テンプレートの戻り先は保持し、台帳へ横取りしない', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin', '管理者');
    const returnTo = '/admin/estimate-templates/legacy';
    const { optionId } = await createDraft(page, returnTo);
    await preparePublish(page);
    await publish(page);
    await page.waitForURL((url) => url.pathname === returnTo && url.searchParams.get('created_option') === optionId);
    await expect(page).not.toHaveURL(/\/admin\/ledger/);
  });

  test('51件目以降の強調商品は、その商品が存在する一覧ページを自動表示する', async ({ page }) => {
    await signInOrRegister(page, ADMIN_EMAIL, '/admin', '管理者');
    await page.goto('/admin/ledger');
    const countText = await page.getByText(/件中 \d+〜\d+件を表示/).first().textContent();
    const count = Number(countText?.match(/^(\d+)件中/)?.[1] ?? '0');
    test.skip(count <= 50, 'ローカル台帳に51件以上の商品がないためページ2検証不可');
    await page.getByRole('button', { name: '次へ', exact: true }).click();
    const row = page.locator('[data-testid="ledger-table-view"] tbody tr').first();
    await expect(row).toBeVisible();
    const editHref = await row.locator('a[href^="/admin/options/"]').first().getAttribute('href');
    const oldId = editHref?.match(/options\/([0-9a-f-]{36})/)?.[1];
    expect(oldId).toBeTruthy();

    await page.goto('/admin/ledger?updated_option=' + oldId);
    await expect(page.getByText('商品を更新しました。')).toBeVisible();
    const highlighted = page.locator('[data-testid="ledger-table-view"] tbody tr[data-recently-changed="true"]');
    await expect(highlighted).toBeVisible();
    await expect(page.getByText(/51〜\d+件を表示/).first()).toBeVisible();
  });
});
