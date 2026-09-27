import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = fs.readFileSync(path.join(process.cwd(), 'app/admin/page.tsx'), 'utf8');

describe('Admin dashboard actions', () => {
  it('shows concrete next actions instead of count-only summary cards', () => {
    expect(dashboard).toContain('まず確認すること');
    expect(dashboard).toContain('data-testid="dashboard-action-card"');
    expect(dashboard).toContain('次に何をするかまで確認できます。');
    expect(dashboard).not.toContain('<Stat ');
  });

  it('uses only existing quote/request/contact/notification state for admin actions', () => {
    expect(dashboard).toContain("request.status === 'new'");
    expect(dashboard).toContain("contact.status === 'new'");

    for (const label of [
      '新しい見積依頼',
      '担当代理店が未割当',
      '現地確認・施工金額確認',
      '概算見積の承諾記録あり／現地確認・確定見積が必要',
      '確定見積の確認・案内',
      'お客様が見積を承諾',
      '未対応のお問い合わせ',
      '未読のお知らせ',
    ]) {
      expect(dashboard).toContain(label);
    }
  });

  it('treats a lineage root as preliminary regardless of revision number', () => {
    expect(dashboard).toContain("q.status === 'issued' && q.parent_quote_id === null");
    expect(dashboard).toContain("q.status === 'accepted' && q.parent_quote_id === null");
    expect(dashboard).toContain("quote.status === 'issued' && quote.parent_quote_id === null");
    expect(dashboard).toContain("quote.status === 'accepted' && quote.parent_quote_id === null");
  });

  it('treats a quote with a parent as final regardless of revision number', () => {
    expect(dashboard).toContain("q.status === 'issued' && q.parent_quote_id !== null");
    expect(dashboard).toContain("q.status === 'accepted' && q.parent_quote_id !== null");
    expect(dashboard).toContain("quote.status === 'issued' && quote.parent_quote_id !== null");
    expect(dashboard).toContain("quote.status === 'accepted' && quote.parent_quote_id !== null");
  });

  it('routes accepted preliminary quotes to site/final-quote work instead of contract confirmation', () => {
    expect(dashboard).toContain("const acceptedPreliminary = mine.filter((q) => q.status === 'accepted' && q.parent_quote_id === null)");
    expect(dashboard).toContain("href: caseHref(acceptedPreliminary[0].id, 'site')");
    expect(dashboard).toContain('概算見積に承諾記録がありますが、契約工程には進めません。');
    expect(dashboard).toContain('施工金額を反映した確定見積を作成します。');
  });

  it('routes accepted final quotes to contract/document confirmation', () => {
    expect(dashboard).toContain("const accepted = mine.filter((q) => q.status === 'accepted' && q.parent_quote_id !== null)");
    expect(dashboard).toContain("href: caseHref(accepted[0].id, 'documents')");
    expect(dashboard).toContain("const accepted = activeQuotes.filter(");
    expect(dashboard).toContain("(quote) => quote.status === 'accepted' && quote.parent_quote_id !== null");
  });

  it('keeps dealer dashboard scoped to assigned quotes and uses lineage for the same stage rules', () => {
    expect(dashboard).toContain('store.listDealerQuotes(actor.id)');
    expect(dashboard).not.toContain('store.listAllQuotes(actor.id)');
    expect(dashboard).toContain("q.parent_quote_id === null");
    expect(dashboard).toContain("q.parent_quote_id !== null");
  });

  it('uses request quote_id to limit admin action cards to current quotes', () => {
    expect(dashboard).toContain('const currentQuoteIds = new Set(');
    expect(dashboard).toContain('currentQuoteIds.has(quote.id)');
    expect(dashboard).toContain('request.quote_id ? [request.quote_id] : []');
  });

  it('routes issued preliminary quotes to site confirmation before estimate editing', () => {
    expect(dashboard).toContain("href: caseHref(siteWork[0].id, 'site')");
    expect(dashboard).toContain("action: '現地確認を開く'");
    expect(dashboard).not.toContain("href: caseHref(siteWork[0].id, 'estimate', true)");
  });

  it('does not use revision number as the preliminary/final classification source', () => {
    expect(dashboard).not.toMatch(/\.(?:revision)\s*(?:===|!==|>|<|>=|<=)/);
    expect(dashboard).not.toContain('第1版の概算見積');
    expect(dashboard).not.toContain('第2版以降の見積');
  });

  it('does not invent unsupported deadlines or downstream workflow state', () => {
    expect(dashboard).not.toContain('契約待ち');
    expect(dashboard).not.toContain('製造遅延');
    expect(dashboard).not.toContain('引渡し期限超過');
    expect(dashboard).not.toContain('今日の予定');
    expect(dashboard).not.toContain('担当者期限');
  });
});
