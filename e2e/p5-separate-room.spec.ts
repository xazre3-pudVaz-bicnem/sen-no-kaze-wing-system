import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL,
  logout,
  openFreshSimulator,
  openProductDetail,
  pickOption,
  quoteLine,
  readTotal,
  register,
  signInOrRegister,
  uniqueEmail,
  waitForSimulator,
} from './helpers';

// P5（#628 の続き・A 案）：ユニットに含まれるカテゴリー（トイレ・洗面）は「ユニットに含まれています」と出し、二重に選ばない。
// 「別室に追加する」から選んだ設備だけ、普通の追加の設備として金額に入る。
// 使い捨てのローカル検証モード（WING_LOCAL_MODE）のストアだけで動かし、包含の設定は最後に元へ戻す（ほかの E2E の前提を変えない）
const UB_3POINT_ID = '30000000-0000-4000-8000-000000000002'; // 3点ユニットバス 1216（浴槽・トイレ・洗面一体）

/** 本部の画面で、3 点ユニットの「この商品に含まれる設備」を指定のカテゴリーにする（同じなら保存しない） */
async function setUb3pointInclusion(page: Page, labels: readonly ('トイレ' | '洗面')[]) {
  await signInOrRegister(page, ADMIN_EMAIL, '/admin', '管理者');
  await page.goto('/admin/options/' + UB_3POINT_ID);
  const editor = page.getByTestId('included-equipment-editor');
  await expect(editor).toContainText('設備包含設定：保存済み');
  const details = page.getByTestId('included-equipment-categories');
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.getByTestId('included-equipment-categories-summary').click();
  }
  await expect(page.getByTestId('included-equipment-categories-choices')).toBeVisible();
  let changed = false;
  for (const label of ['トイレ', '洗面'] as const) {
    const box = editor.getByRole('checkbox', { name: label });
    const want = labels.includes(label);
    if ((await box.isChecked()) !== want) {
      await box.setChecked(want);
      changed = true;
    }
  }
  if (changed) {
    await editor.getByRole('button', { name: '設備設定の変更内容を確認' }).click();
    await page.getByTestId('included-equipment-change-review').getByRole('button', { name: '設備包含設定だけを保存' }).click();
    await expect(editor).toContainText('設備包含設定：保存済み');
  }
  await logout(page);
}

test.describe('P5（#628 の続き）：ユニットに含まれる設備と「別室に追加」（ローカルストア専用）', () => {
  test('3 点ユニットに含まれるトイレ・洗面は二重に選ばず、別室に追加したトイレだけ金額に入り、保存して開き直しても残る', async ({ page }) => {
    await setUb3pointInclusion(page, ['トイレ', '洗面']);
    try {
      await register(page, uniqueEmail('p5-separate'), '/simulator/wing-01');
      await openFreshSimulator(page);
      // 標準構成：ユニットバス 1216・単体のトイレ・標準の洗面セット
      await expect(quoteLine(page, 'toilet-washlet')).toBeVisible();

      // 旧排他（3 点ユニット ↔ 洗面器）があるので、標準の洗面セットを外してから 3 点ユニットへ（今までどおり）
      await pickOption(page, 'equip-washbasin', ['washbasin-standard-set']);
      await pickOption(page, 'equip-ub', ['ub-3point-1216']);

      // T1：トイレ・洗面は「ユニットに含まれています」。選んでいた単体のトイレは外れ、見積に出ない（二重に計上しない）
      await expect(page.getByTestId('equip-included-toilet')).toContainText('ユニットに含まれています');
      await expect(page.getByTestId('equip-included-washbasin')).toContainText('ユニットに含まれています');
      await expect(page.getByTestId('equip-included-toilet')).toContainText('3点ユニットバス 1216');
      await expect(quoteLine(page, 'toilet-washlet')).toBeHidden();
      const totalIncluded = await readTotal(page);

      // T2：「別室に追加する」から選んだトイレは、普通の追加の設備として金額に入る
      await page.getByTestId('equip-add-separate-toilet').click();
      await expect(page.getByTestId('option-picker')).toBeVisible();
      await expect(page.locator('#picker-title')).toHaveText('別室に追加するトイレを選ぶ');
      await openProductDetail(page, 'toilet-washlet');
      await page.getByTestId('product-detail-apply').click();
      await expect(page.getByTestId('option-picker')).toBeHidden();
      await expect(page.getByTestId('equip-separate-toilet')).toContainText('トイレ（温水洗浄便座ウォッシュレット）');
      await expect(page.getByTestId('equip-separate-toilet')).toContainText('別室');
      await expect(quoteLine(page, 'toilet-washlet__separate_room')).toContainText('（別室）');
      await expect.poll(() => readTotal(page)).toBeGreaterThan(totalIncluded);
      const totalWithSeparate = await readTotal(page);

      // 保存して開き直しても、ユニットに含まれる表示と別室のトイレ・金額が残る
      await page.getByTestId('save-button').click();
      await page.getByTestId('config-name-input').fill('別室に追加したトイレの確認');
      await page.getByTestId('save-confirm').click();
      await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);
      const configId = new URL(page.url()).searchParams.get('c')!;
      await page.goto(`/simulator/wing-01?c=${configId}`);
      await waitForSimulator(page);
      await expect(page.getByTestId('equip-included-toilet')).toContainText('ユニットに含まれています');
      await expect(page.getByTestId('equip-separate-toilet')).toContainText('トイレ（温水洗浄便座ウォッシュレット）');
      expect(await readTotal(page)).toBe(totalWithSeparate);

      // T4：ユニットを戻すと、トイレは標準の単体に戻り、別室のトイレはそのまま残る（同じ商品でも 2 つとして数える）
      await pickOption(page, 'equip-ub', ['ub-1216']);
      await expect(page.getByTestId('equip-included-toilet')).toHaveCount(0);
      await expect(quoteLine(page, 'toilet-washlet')).toBeVisible();
      await expect(quoteLine(page, 'toilet-washlet__separate_room')).toBeVisible();
      await expect(page.getByTestId('equip-separate-toilet')).toBeVisible();

      // 別室のトイレを外すと、見積からも外れる
      await page.getByTestId('equip-remove-separate-toilet').click();
      await expect(page.getByTestId('equip-separate-toilet')).toHaveCount(0);
      await expect(quoteLine(page, 'toilet-washlet__separate_room')).toBeHidden();
    } finally {
      await logout(page).catch(() => undefined);
      await setUb3pointInclusion(page, []);
    }
  });
});
