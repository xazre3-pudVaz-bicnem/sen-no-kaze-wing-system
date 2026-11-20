import { expect, test } from '@playwright/test';

// 標準見積 v2.5 の手入力明細の原価単価（2026-11-20 の先方の依頼）。スマートフォン（Pixel 7）。隔離した検査用ページだけを操作する
test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseURL)) {
    throw new Error('Only disposable localhost test server allowed');
  }
  await page.goto('/v25-e2e-line-cost');
  await expect(page.getByTestId('v25-line-cost-local-fixture')).toBeVisible();
  // 画面の準備（ハイドレーション）が済むまで待ってから実際にタップする
  await expect(page.locator('[data-testid="standard-estimate-v25-workbench"][data-v25-ready="true"]')).toBeVisible({ timeout: 30_000 });
});

test('Pixel 7：原価単価のセルを実際にタップして入力でき、原価金額・粗利が出る。空に戻すと原価未設定', async ({ page }) => {
  const target = page.locator('tr[data-v25-dnd-row="line:noCostLine"]');
  const input = target.getByTestId('v25-wb-line-cost-input');
  await expect(input).toBeVisible();
  const grid = page.getByTestId('v25-excel-grid-scroll');
  await grid.evaluate((element) => {
    const cell = element.querySelector<HTMLInputElement>('tr[data-v25-dnd-row="line:noCostLine"] [data-testid="v25-wb-line-cost-input"]');
    if (!cell) throw new Error('Cost input not found');
    const rect = cell.getBoundingClientRect(), area = element.getBoundingClientRect();
    element.scrollLeft += rect.left + rect.width / 2 - (area.left + area.width * 0.6);
  });
  await input.scrollIntoViewIfNeeded();
  // 固定の列に覆われていない、実際にタップできる点を探す（fill() で固定の列を回り込まない）
  const touchPoint = await input.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const start = Math.max(1, rect.left + 2), end = Math.min(window.innerWidth - 1, rect.right - 2);
    const y = rect.top + rect.height / 2;
    for (let x = start; x <= end; x += 3) {
      const hit = document.elementFromPoint(x, y);
      if (hit === element || element.contains(hit)) return { x, y };
    }
    return null;
  });
  expect(touchPoint, '原価単価のセルを実際にタップできる必要があります').not.toBeNull();
  await page.touchscreen.tap(touchPoint!.x, touchPoint!.y);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await input.fill('700');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toHaveText('¥700');
  await expect(target.getByTestId('v25-wb-line-gross')).toHaveText('¥300');
  await input.fill('');
  await expect(target.getByTestId('v25-wb-line-cost-amount')).toContainText('原価未設定');
  // 空に戻すと保存済みの状態と同じ（変更なし）。もう一度入れてから破棄する
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
  await input.fill('800');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toBeVisible();
  await page.getByRole('button', { name: '変更を破棄' }).tap();
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('v25-wb-unsaved-position')).toHaveCount(0);
});
