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
    expect(page).toContain('現在');
    for (const label of [
      'プラン作成',
      '見積依頼',
      '現地確認',
      '確定見積',
      'お客様確認',
      '契約',
      '製造・施工',
      '引渡し・アフター',
    ]) {
      expect(page).toContain(label);
    }
  });
});
