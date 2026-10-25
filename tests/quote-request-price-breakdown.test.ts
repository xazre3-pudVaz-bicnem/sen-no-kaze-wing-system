import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/(site)/mypage/configurations/[id]/request-quote/page.tsx'),
  'utf8'
);

describe('見積依頼：合計を先に表示し明細を折り畳む', () => {
  it('合計（税込）を明細より先に常時表示し、内訳は初期状態で閉じる', () => {
    const summary = page.indexOf('data-testid="quote-request-total"');
    const detail = page.indexOf('data-testid="quote-request-price-breakdown"');
    expect(summary).toBeGreaterThan(0);
    expect(detail).toBeGreaterThan(summary);
    expect(page).toContain('概算合計（税込）');
    expect(page).toContain('<p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-ink">{formatYen(pricing.total)}</p>');
    expect(page).toContain('商品明細・金額の内訳を見る');
    expect(page).toContain('<summary className=');
    expect(page).toContain('data-testid="quote-request-full-breakdown"');
    expect(page).not.toContain('data-testid="quote-request-price-breakdown" open');
  });

  it('既存の明細行を落とさず、0円と別途を引き続き区別する', () => {
    const detail = page.slice(page.indexOf('data-testid="quote-request-full-breakdown"'));
    expect(page).toContain("const optionLines = pricing.lines.filter((l) => !l.is_installation);");
    expect(page).toContain("const siteworkLines = pricing.lines.filter((l) => l.is_installation);");
    expect(detail).toContain('{optionLines.map((l) => (');
    expect(detail).toContain("{l.price_on_request ? '別途' : formatYen(l.amount)}");
    for (const key of [
      'pricing.base_price',
      'pricing.base_expense',
      'pricing.option_expense',
      'pricing.subtotal',
      'pricing.tax',
      'pricing.total',
    ]) {
      expect(detail).toContain(`formatYen(${key})`);
    }
    expect(detail).toContain('siteworkLines.length > 0');
    expect(page).toContain('data-testid="quote-request-excluded-work"');
    expect(page).toContain('別途見積・別途工事の内容や金額は、設置条件の確認後にご案内します。');
  });

  it('価格計算と見積依頼フロー・仕様変更リンク・免責表示を変更しない', () => {
    expect(page).toContain('const pricing = computePricing(');
    expect(page).toContain('const exteriorFaces = await getExteriorFaces(configuration.id);');
    expect(page).toContain('<QuoteRequestForm');
    expect(page).toContain('lockVersion={configuration.lock_version ?? null}');
    expect(page).toContain('selectedSiteAreaLabel={selectedSiteAreaLabel}');
    expect(page).toContain('{PRICE_DISCLAIMER}');
    expect(page).toContain('href={`/simulator/${slug}?c=${configuration.id}`}');
  });
});
