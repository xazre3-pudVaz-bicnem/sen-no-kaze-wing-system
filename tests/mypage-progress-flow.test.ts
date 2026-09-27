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

  it('separates progressing cases from saved draft plans without adding a new case data model', () => {
    expect(page).toContain('data-testid="active-case-section"');
    expect(page).toContain('data-testid="active-case-card"');
    expect(page).toContain('進行中の案件');
    expect(page).toContain('次にすること');
    expect(page).toContain('設置場所');
    expect(page).toContain('現在の見積');
    expect(page).toContain('担当代理店');
    expect(page).toContain("configuration.status === 'quote_requested' || configuration.status === 'quoted'");
    expect(page).toContain('data-testid="saved-plan-section"');
    expect(page).toContain("configuration.status === 'draft' && !quoteByConfig.has(configuration.id)");
    expect(page).toContain('まだ見積を依頼していない、検討中のプランです。');
    expect(page).toContain('見積履歴');
    expect(page).toContain('過去を含む見積を確認');
  });

  it('shows only the saved installation location information that already exists', () => {
    expect(page).toContain('function siteLocationLabel');
    expect(page).toContain("if (configuration.site_location_undecided) return '未定'");
    expect(page).toContain('configuration.site_prefecture');
    expect(page).toContain('configuration.site_municipality');
    expect(page).not.toContain('土地あり');
    expect(page).not.toContain('土地なし');
  });
});
