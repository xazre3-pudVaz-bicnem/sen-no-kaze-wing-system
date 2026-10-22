import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);
const bottomActions = page.slice(
  page.indexOf('<section className="card space-y-4 p-4 sm:p-5" aria-label="商品登録" data-testid="step2-publish-panel">'),
  page.indexOf('</OptionRegistrationSaveBoundary>')
);

describe('商品登録STEP2の下部操作', () => {
  it('プレビュー後の最終操作は説明とボタンを縦に分け、登録ボタン内で折り返さない', () => {
    expect(page).toContain('data-testid="option-customer-preview"');
    expect(bottomActions).toContain('data-testid="step2-publish-actions"');
    expect(bottomActions).toContain('className="card space-y-4 p-4 sm:p-5"');
    expect(bottomActions).toContain('className="w-full space-y-3"');
    expect(bottomActions).toContain('className="btn-primary btn-sm shrink-0 whitespace-nowrap"');
    expect(bottomActions).toContain('この内容で登録');
  });

  it('登録ボタンの横からSTEP1に戻れるが、登録確認と保存処理は従来どおり', () => {
    const back = bottomActions.indexOf('<Link href={stepHref(\'info\')}');
    const publish = bottomActions.indexOf('<ConfirmSubmit');
    expect(back).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(back);
    expect(bottomActions).toContain('STEP1に戻る');
    expect(bottomActions).toContain('className="btn-secondary btn-sm shrink-0 whitespace-nowrap"');
    expect(bottomActions).toContain('<form action={publishOptionAction}');
    expect(bottomActions).toContain('<input type="hidden" name="id" value={option.id} />');
    expect(bottomActions).toContain('name="confirm_zero_price"');
    expect(bottomActions).toContain('needsZeroPriceConfirmation');
    expect(bottomActions).toContain('この内容で登録しますか？');
  });
});
