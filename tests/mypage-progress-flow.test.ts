import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAcceptedQuoteCaseState, isFormalQuote } from '../lib/domain/quote-lifecycle';

const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/mypage/page.tsx'), 'utf8');
const quoteDetail = fs.readFileSync(path.join(process.cwd(), 'app/(site)/mypage/quotes/[id]/page.tsx'), 'utf8');

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
    expect(page).toContain('const acceptedState = getAcceptedQuoteCaseState(quote, request);');
    expect(page).toContain('if (isFormalQuote(quote))');
    expect(page).toContain("return isFormalQuote(quote) ? '確定見積' : '概算見積';");
    expect(page).not.toContain('quote.revision > 1');
    expect(page).not.toContain('quote.revision === 1');
    expect(page).toContain("acceptedState === 'preliminary'");
    expect(page).toContain("acceptedState === 'formal_current'");
    expect(page).toContain("acceptedState === 'formal_unconfirmed'");
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

  it('uses quote parent lineage instead of revision numbers for preliminary/formal classification', () => {
    const preliminaryRevision99 = { parent_quote_id: null, revision: 99 };
    const formalRevision1 = { parent_quote_id: 'q-parent', revision: 1 };

    expect(isFormalQuote(preliminaryRevision99)).toBe(false);
    expect(isFormalQuote(formalRevision1)).toBe(true);
  });

  it('distinguishes preliminary, current formal, and stale formal accepted records', () => {
    const preliminary = { id: 'q-pre', status: 'accepted' as const, parent_quote_id: null };
    const currentFormal = { id: 'q-formal-current', status: 'accepted' as const, parent_quote_id: 'q-pre' };
    const staleFormal = { id: 'q-formal-stale', status: 'accepted' as const, parent_quote_id: 'q-pre' };

    expect(getAcceptedQuoteCaseState(preliminary, { quote_id: 'q-pre' })).toBe('preliminary');
    expect(getAcceptedQuoteCaseState(currentFormal, { quote_id: 'q-formal-current' })).toBe('formal_current');
    expect(getAcceptedQuoteCaseState(staleFormal, { quote_id: 'q-formal-current' })).toBe('formal_unconfirmed');

    expect(page).toContain("if (acceptedState === 'formal_current') return '承諾済み';");
    expect(page).toContain("if (acceptedState === 'preliminary') return '確認済み';");
    expect(page).toContain("if (acceptedState === 'formal_unconfirmed') return '確認要';");
    expect(page).toContain('契約手続きには進みません。');
  });

  it('keeps the requested customer-facing quote shortcuts and case attribution', () => {
    expect(page).toContain('見積の内容を見る');
    expect(page).not.toContain('案件の内容を見る');
    expect(page).toContain('data-testid="active-case-quote-status"');
    expect(page).toContain('const configurationNameOf = new Map(configurations.map');
    expect(page).toContain('<th className="px-4 py-3 font-semibold">案件</th>');
    expect(page).toContain('data-testid="quote-history-case-name"');
    expect(page).toContain('configurationNameOf.get(quote.configuration_id)');
  });

  it('preserves the #244 quote-detail lifecycle eligibility helpers', () => {
    expect(quoteDetail).toContain('isQuoteAcceptanceEligible');
    expect(quoteDetail).toContain('isQuoteDeclineEligible');
    expect(quoteDetail).toContain('getAcceptedQuoteCaseState');
    expect(quoteDetail).toContain("acceptedQuoteCaseState === 'formal_current'");
    expect(quoteDetail).toContain("acceptedQuoteCaseState === 'preliminary'");
    expect(quoteDetail).toContain("acceptedQuoteCaseState === 'formal_unconfirmed'");
    expect(quoteDetail).not.toContain('quote.revision > 1');
    expect(quoteDetail).not.toContain('quote.revision === 1');
  });

  it('prioritizes next action and progress before case summary, with a compact responsive image', () => {
    expect(page).toContain('data-testid="active-case-image"');
    expect(page).toContain('aspect-video');
    expect(page).toContain('sm:aspect-[4/3]');
    expect(page).toContain('sm:grid-cols-[15rem_minmax(0,1fr)]');
    const nextActionIndex = page.indexOf('data-testid="active-case-next-action"');
    const flowIndex = page.indexOf('data-testid="active-case-flow"');
    const summaryIndex = page.indexOf('data-testid="active-case-summary"');
    expect(nextActionIndex).toBeGreaterThan(-1);
    expect(flowIndex).toBeGreaterThan(nextActionIndex);
    expect(summaryIndex).toBeGreaterThan(flowIndex);
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
