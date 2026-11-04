import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/(site)/mypage/configurations/[id]/request-quote/page.tsx'),
  'utf8'
);

describe('見積依頼：合計を先に表示し明細を整理する', () => {
  it('合計（税込）を明細より先に常時表示し、全体の内訳は初期状態で閉じる', () => {
    const summary = page.indexOf('data-testid="quote-request-total"');
    const detail = page.indexOf('data-testid="quote-request-price-breakdown"');
    expect(summary).toBeGreaterThan(0);
    expect(detail).toBeGreaterThan(summary);
    expect(page).toContain('概算合計（税込）');
    expect(page).toContain('<p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-ink">{formatYen(pricing.total)}</p>');
    expect(page).toContain('商品明細・金額の内訳を見る');
    expect(page).toContain('data-testid="quote-request-full-breakdown"');
    expect(page).toContain('data-testid="quote-request-zero-lines"');
    expect(page).toContain('data-testid="quote-request-separate-lines"');
  });

  it('商品マスターの分類でグループ化し、小計と0円・別途見積を区別する', () => {
    expect(page).toContain('groupQuoteRequestLines(pricing.lines, bundle.categories)');
    expect(page).toContain('{pricedGroups.map((group) => (');
    expect(page).toContain('{group.name}');
    expect(page).toContain('{formatYen(group.amount)}');
    expect(page).toContain('{zeroLines.map((line) => (');
    expect(page).toContain('{priceOnRequestLines.map((line) => (');
    expect(page).toContain('0円項目を見る');
    expect(page).toContain('別途見積項目を見る');
    expect(page).toContain('概算計上 {formatYen(line.amount)}');
    expect(page).toContain('{formatYen(pricing.base_total)}');
    expect(page).toContain('{formatYen(pricing.option_expense)}');
    expect(page).toContain('{formatYen(pricing.subtotal)}');
    expect(page).toContain('{formatYen(pricing.tax)}');
    expect(page).toContain('{formatYen(pricing.total)}');
    expect(page).toContain('{PRICE_DISCLAIMER}');
    expect(page).toContain('別途見積・別途工事の内容や金額は、設置条件の確認後にご案内します。');
  });

  it('価格計算と見積依頼の送信・仕様変更リンクを変更しない', () => {
    // v2.5 の売価を使う間（v2.5 PR-C1）だけ v2.5 の標準見積の売価で出す。それ以外はこれまでの計算
    expect(page).toContain('const pricing = sale.v25');
    expect(page).toContain('? await resolvedV25ConfigurationPricing(bundle, sale.saleViews, {');
    expect(page).toContain(': computePricing(');
    expect(page).toContain('const exteriorFaces = await getExteriorFaces(configuration.id);');
    expect(page).toContain('<QuoteRequestForm');
    expect(page).toContain('lockVersion={configuration.lock_version ?? null}');
    expect(page).toContain('selectedSiteAreaLabel={selectedSiteAreaLabel}');
    expect(page).toContain('href={`/simulator/${slug}?c=${configuration.id}`}');
  });
});
