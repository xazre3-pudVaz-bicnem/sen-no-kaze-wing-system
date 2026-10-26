import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const quotePage = read('app/(site)/mypage/quotes/[id]/page.tsx');
const requestForm = read('components/mypage/quote-request-form.tsx');
const requestAction = read('lib/actions/configurations.ts');
const pdf = read('lib/pdf/quote-pdf.tsx');

describe('連絡先住所と設置予定地の区別（見積依頼・発行後）', () => {
  it('見積依頼の連絡先住所は設置予定地とは別の入力で、既存の項目名を変えない', () => {
    expect(requestForm).toContain('label="お客様のご住所（連絡先）"');
    expect(requestForm).toContain('設置予定地とは異なる住所でも構いません。');
    expect(requestForm).toContain('name="address" defaultValue={v.address}');
    expect(requestForm).toContain('name="site_address" defaultValue={v.site_address}');
    expect(requestForm).toContain('selectedSiteAreaLabel');
    expect(requestAction).toContain('quoteRequestSchema.safeParse(raw)');
    expect(requestAction).toContain('createQuoteFromConfiguration(user, configuration_id, contact as QuoteContact, message, expected_lock_version)');
  });

  it('発行済み画面で連絡先・依頼時の設置情報・現在の保存プラン地域を別表示する', () => {
    expect(quotePage).toContain('data-testid="quote-contact-address"');
    expect(quotePage).toContain('{request?.contact.address || \'未記入\'}');
    expect(quotePage).toContain('data-testid="quote-request-site-address"');
    expect(quotePage).toContain('{request?.contact.site_address || \'未記入\'}');
    expect(quotePage).toContain('data-testid="quote-saved-plan-site-area"');
    expect(quotePage).toContain('const savedPlan = quote.configuration_id');
    expect(quotePage).toContain('await store.getConfiguration(quote.configuration_id, user)');
    expect(quotePage).toContain('savedPlan.configuration.site_location_undecided');
    expect(quotePage).toContain('savedPlan.configuration.site_prefecture');
    expect(quotePage).toContain('savedPlan.configuration.site_municipality');
    expect(quotePage).toContain('見積発行時点の地域情報を保証するものではありません。');
    expect(quotePage).toContain('request.contact.address.trim() === request.contact.site_address.trim()');
  });

  it('過去の発行済み見積のSnapshot、PDF、承諾・辞退は変更しない', () => {
    expect(quotePage).toContain('const canAccept = isQuoteAcceptanceEligible(quote, request);');
    expect(quotePage).toContain('const canDecline = isQuoteDeclineEligible(quote, request);');
    expect(quotePage).toContain('action={respondToQuoteAction}');
    expect(quotePage).toContain('data-testid="quote-issued-total-value"');
    expect(quotePage).toContain('{formatYen(quote.total)}');
    expect(quotePage).toContain('href={`/api/quotes/${quote.id}/pdf`}');
    expect(quotePage).not.toContain('renderQuotePdf(');
    expect(pdf).toContain('export async function renderQuotePdf(quote: Quote, items: QuoteItem[])');
  });
});
