import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/mypage/page.tsx'), 'utf8');

describe('Mypage customer progress flow', () => {
  it('shows the customer journey as a directional flow with an explicit current step', () => {
    expect(page).toContain('data-testid="customer-progress-flow"');
    expect(page).toContain('data-testid="customer-progress-arrow"');
    expect(page).toContain("aria-current={state === 'current' ? 'step' : undefined}");
    expect(page).toContain('min-w-[50rem]');
    expect(page).toContain('今ここ');
    for (const label of [
      'プランを作る',
      '見積を依頼',
      '現地を確認',
      '確定見積が届く',
      '見積を確認',
      '契約手続き',
      '製造・施工',
      '引渡し・アフター',
    ]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("quote.status === 'accepted' && quote.revision === 1");
    expect(page).toContain("index: 2");
    expect(page).toContain('概算見積の確認を受け付けました');
    expect(page).toContain('確定見積を確認済みです');
  });
});
