import { expect, test } from '@playwright/test';
import {
  fillQuoteRequestContact,
  openFreshSimulator,
  pickOption,
  readTotal,
  register,
  uniqueEmail,
  waitForSimulator,
} from './helpers';

/**
 * ⑤ 見積依頼：保存プランから見積依頼へ進み、誤った同一住所の送信を防ぎ、
 * 正しい依頼が１件だけ発行されることをローカル E2E で確認する。
 * 本番 DB では実行しない。
 */
test('保存プランの見積依頼で住所を確認し、送信後に見積が重複しない', async ({ page }) => {
  await register(page, uniqueEmail('quote-intake'), '/simulator/wing-01');
  await openFreshSimulator(page);

  await page.getByTestId('site-prefecture-select').selectOption('石川県');
  await page.getByTestId('site-municipality-select').selectOption('七尾市');
  await pickOption(page, 'equip-exterior-parts', ['wood-deck']);
  const simulatorTotal = await readTotal(page);

  await page.getByTestId('save-button').click();
  await page.getByTestId('config-name-input').fill('見積依頼の確認プラン');
  await page.getByTestId('save-confirm').click();
  await expect(page).toHaveURL(/\?c=[0-9a-f-]{36}/);
  const configId = new URL(page.url()).searchParams.get('c')!;

  // 保存した地域・金額・商品を見積依頼画面で確認する。
  const requestPath = '/mypage/configurations/' + configId + '/request-quote';
  await page.goto(requestPath);
  await expect(page.getByTestId('quote-request-form')).toBeVisible();
  await expect(page.getByTestId('quote-request-selected-site-area')).toContainText('石川県 七尾市');
  expect(Number(((await page.getByTestId('quote-request-total').textContent()) ?? '').replace(/[^0-9]/g, ''))).toBe(simulatorTotal);
  await page.getByTestId('quote-request-price-breakdown').locator('summary').click();
  await expect(page.getByTestId('quote-request-full-breakdown')).toContainText('ウッドデッキ');

  // 連絡先住所を設置先にも誤入力した場合、明示確認なしの依頼を防ぐ。
  await fillQuoteRequestContact(page);
  const contactAddress = await page.locator('#address').inputValue();
  await page.locator('#site_address').fill(contactAddress);
  await expect(page.getByTestId('quote-request-same-address-confirmation')).toBeVisible();
  await page.getByTestId('submit-quote-request').click();
  await expect(page).toHaveURL(new RegExp('/mypage/configurations/' + configId + '/request-quote'));
  await expect(page.getByTestId('quote-request-same-address-confirmation')).toBeVisible();

  // 正しい設置住所に修正して送信する。
  await page.locator('#site_address').fill('石川県七尾市中島町1-1');
  await expect(page.getByTestId('quote-request-same-address-confirmation')).toBeHidden();
  await page.getByTestId('submit-quote-request').click();
  await expect(page).toHaveURL(/\/mypage\/quotes\/[0-9a-f-]{36}\?requested=1/);
  const quoteId = new URL(page.url()).pathname.split('/').at(-1);
  await expect(page.getByTestId('quote-no')).toContainText(/Q\d{6}-\d{4}/);
  expect(Number(((await page.getByTestId('quote-total').textContent()) ?? '').replace(/[^0-9]/g, ''))).toBe(simulatorTotal);
  await expect(page.getByTestId('quote-table')).toContainText('ウッドデッキ');

  // 同じプランの「見積依頼」を開き直しても新しい見積を発行させない。
  await page.goto(requestPath);
  await expect(page).toHaveURL(new RegExp('/mypage/quotes/' + quoteId + '$'));
  await page.goto('/simulator/wing-01?c=' + configId);
  await waitForSimulator(page);
  await expect(page.getByText('見積依頼済みのため編集できません')).toBeVisible();

  await page.goto('/mypage');
  await expect(page.getByTestId('quote-row')).toHaveCount(1);
});
