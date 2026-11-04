import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/(site)/mypage/quotes/[id]/page.tsx'),
  'utf8'
);

describe('お客様の見積依頼完了後：次工程への案内', () => {
  it('現在の発行済み概算見積だけに受付後フローを表示する', () => {
    expect(page).toContain("const isCurrentPreliminaryIssued = Boolean(!isFormal && quote.status === 'issued' && request?.quote_id === quote.id);");
    expect(page).toContain('{isCurrentPreliminaryIssued && request && (');
    expect(page).toContain('data-testid="quote-preliminary-next-steps"');
    expect(page).toContain('現在は概算見積の段階です。正式なご注文・ご契約はまだ行われていません。');
    expect(page).toContain('概算見積のご依頼');
    expect(page).toContain('担当者からのご連絡');
    expect(page).toContain('打合せ・現地確認');
    expect(page).toContain('正式見積のご案内');
    expect(page).toContain('href={`/mypage/cases/${request.id}`}');
    expect(page).toContain('data-testid="customer-case-link"');
  });

  it('金額は発行済みQuoteのsnapshot金額と既存PDFを表示し、再計算しない', () => {
    expect(page).toContain('data-testid="quote-issued-total"');
    expect(page).toContain('{formatYen(quote.total)}');
    expect(page).toContain('data-testid="quote-issued-total-value"');
    expect(page).toContain('href={`/api/quotes/${quote.id}/pdf`}');
    expect(page).toContain('href={`/api/quotes/${quote.id}/pdf?download=1`}');
    expect(page).toContain('<QuoteTable quote={quote} items={items} />');
    expect(page).not.toContain('computePricing(');
  });

  it('概算見積のみ明細を初期折り畳み、正式見積は従来通り初期表示する', () => {
    expect(page).toContain('data-testid="quote-onscreen-details"');
    expect(page).toContain('open={!isCurrentPreliminaryIssued}');
    expect(page).toContain('画面で見積明細・商品画像を確認する');
  });

  it('修正依頼は折り畳み、対応中の履歴は開いて表示する', () => {
    expect(page).toContain('data-testid="quote-change-requests"');
    expect(page).toContain("open={changeRequests.some((c) => c.status === 'open')}");
    expect(page).toContain('<QuoteChangeRequestForm quoteId={quote.id} requestId={request.id} />');
    expect(page).toContain('changeRequests.map((c) => (');
  });

  it('正式見積の承諾・現行見積の辞退・電子契約とRevision判定を変更しない', () => {
    expect(page).toContain('const canAccept = isQuoteAcceptanceEligible(quote, request);');
    expect(page).toContain('const canDecline = isQuoteDeclineEligible(quote, request);');
    expect(page).toContain('{canAccept && (');
    expect(page).toContain('{canDecline && (');
    expect(page).toContain('action={respondToQuoteAction}');
    expect(page).toContain('data-testid="accept-quote"');
    expect(page).toContain('data-testid="decline-quote"');
    expect(page).toContain('data-testid="contract-awaiting-signature"');
    expect(page).toContain('data-testid="contract-signed"');
    expect(page).toContain('getAcceptedQuoteCaseState(quote, request)');
  });
});
