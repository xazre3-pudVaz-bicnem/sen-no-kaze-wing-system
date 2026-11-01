import { expect, test } from '@playwright/test';
import {
  openFreshSimulator,
  openPicker,
  openProductDetail,
  readTotal,
  register,
  uniqueEmail,
  waitForSimulator,
} from './helpers';

/**
 * ④ プラン保存・再表示：選択した商品、外壁4面、設置予定地が
 * DB 保存 → URL 再読込 → 同じプランへの再保存を通して失われないこと。
 * 本番DBには接続しない通常のローカル E2E。
 */
test('保存した仕様・外壁・設置予定地を再表示し、同じプランに再保存できる', async ({ page }) => {
  await register(page, uniqueEmail('plan-roundtrip'), '/simulator/wing-01');
  await openFreshSimulator(page);

  // 設置予定地（都道府県・市区町村）。
  await page.getByTestId('site-prefecture-select').selectOption('石川県');
  await page.getByTestId('site-municipality-select').selectOption('七尾市');

  // 標準構成からの変更：外壁の正面を木板に変更。
  await page.getByTestId('equip-exterior-wall').click();
  const faces = page.getByTestId('exterior-wall-faces-dialog');
  await expect(faces).toBeVisible();
  await faces.getByTestId('product-card-open-exterior-wood').click();
  await faces.getByTestId('exterior-faces-apply').click();
  await expect(faces).toBeHidden();
  await expect(page.getByTestId('equip-exterior-wall')).toContainText('木板下見板張り');

  // 複数選択可能なカテゴリーから追加した商品。
  await openPicker(page, 'equip-exterior-parts');
  await openProductDetail(page, 'wood-deck');
  await page.getByTestId('product-detail-apply').click();
  await expect(page.getByTestId('option-picker')).toBeHidden();
  await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');

  const totalBefore = await readTotal(page);

  // 初回保存。
  await page.getByTestId('save-button').click();
  await page.getByTestId('config-name-input').fill('保存・再表示確認プラン');
  await page.getByTestId('save-confirm').click();
  await expect(page).toHaveURL(/\\?c=[0-9a-f-]{36}/);
  const configId = new URL(page.url()).searchParams.get('c')!;
  await expect(page.getByTestId('simulator')).toContainText('保存済み');

  // ブラウザ内の下書きではなく、DB の保存プランを URL から再読込。
  await page.goto(`/simulator/wing-01?c=${configId}`);
  await waitForSimulator(page);
  await expect(page.getByTestId('site-prefecture-select')).toHaveValue('石川県');
  await expect(page.getByTestId('site-municipality-select')).toHaveValue('七尾市');
  await expect(page.getByTestId('equip-exterior-wall')).toContainText('木板下見板張り');
  await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');
  expect(await readTotal(page)).toBe(totalBefore);

  // 既存プランを編集・再保存。同じ ID への更新であり、新規プランを作らない。
  await page.getByTestId('site-municipality-select').selectOption('輪島市');
  await expect(page.getByTestId('simulator')).toContainText('未保存の変更あり');
  await page.getByTestId('save-button').click();
  await page.getByTestId('save-confirm').click();
  await expect(page.getByTestId('simulator')).toContainText('保存済み');
  await expect(page).toHaveURL(new RegExp(`c=${configId}`));

  await page.reload();
  await waitForSimulator(page);
  await expect(page.getByTestId('site-municipality-select')).toHaveValue('輪島市');
  await expect(page.getByTestId('equip-exterior-wall')).toContainText('木板下見板張り');
  await expect(page.getByTestId('equip-exterior-parts')).toContainText('ウッドデッキ');
  expect(await readTotal(page)).toBe(totalBefore);

  await page.goto('/mypage');
  await expect(page.getByTestId('configuration-card')).toHaveCount(1);
  await expect(page.getByTestId('configuration-card')).toContainText('保存・再表示確認プラン');
});
