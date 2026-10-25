import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getExteriorFaces } from '@/lib/data/exterior-faces';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { todayInJapan } from '@/lib/data/case-flow/preferences-from-form';
import { dealerServesArea } from '@/lib/domain/case-flow';
import { computePricing, formatYen } from '@/lib/domain/pricing';
import { groupQuoteRequestLines } from '@/lib/domain/quote-request-line-groups';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { Alert, Container, Section } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { QuoteRequestForm } from '@/components/mypage/quote-request-form';

export default async function RequestQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/mypage/configurations/${id}/request-quote`);
  const store = await getStore();
  const found = await store.getConfiguration(id, user);
  if (!found) notFound();
  const { configuration, items } = found;
  if (configuration.status !== 'draft') {
    const quotes = await store.listQuotesByConfiguration(user.id);
    const q = quotes.get(configuration.id);
    redirect(q ? `/mypage/quotes/${q.id}` : '/mypage');
  }
  const bundle = await store.getCatalogBundle(configuration.base_model_id);
  if (!bundle) notFound();
  const profile = await store.getProfile(user.id);
  const exteriorFaces = await getExteriorFaces(configuration.id);
  // 相談したい代理店の候補：公開中で、設置予定地（未定なら全国）に対応している代理店
  const caseFlow = await getCaseFlowStore();
  // 設置予定地・土地（フェーズ3）。マイページで入力済みなら、その内容を初期値にする
  const siteProfile = await caseFlow.getSiteProfile(user, configuration.id);
  const siteArea = configuration.site_location_undecided
    ? ''
    : [configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join('');
  // 表示用には区切りを入れる。未定・未選択は、詳細な住所を入力した扱いにしない。
  const selectedSiteAreaLabel = configuration.site_location_undecided
    ? '未定'
    : [configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join(' ') || '未選択';
  const dealers = (await caseFlow.listPublishedDealerProfiles())
    .filter((dealer) => dealerServesArea(dealer, configuration.site_prefecture ?? null, configuration.site_municipality ?? null))
    .map((dealer) => ({ id: dealer.dealer_id, name: dealer.display_name }));
  const pricing = computePricing(
    bundle.model,
    bundle.options,
    bundle.categories,
    items.map((i) => ({ option_id: i.option_id, quantity: i.quantity, variant_choice_ids: i.variant_choice_ids ?? [] })),
    undefined,
    { groups: bundle.variantGroups, choices: bundle.variantChoices },
    null,
    exteriorFaces
  );
  const { pricedGroups, zeroLines, priceOnRequestLines } = groupQuoteRequestLines(pricing.lines, bundle.categories);
  const hasSeparateWork = pricing.lines.some((line) => line.is_installation) || priceOnRequestLines.length > 0;
  const slug = bundle.model.slug;

  return (
    <Section className="py-10 sm:py-14">
      <Container className="max-w-5xl">
        <p className="eyebrow">Quote request</p>
        <h1 className="mt-1 text-3xl sm:text-4xl">見積依頼</h1>
        <p className="mt-2 text-ink-soft">以下の仕様で見積を依頼します。送信すると見積番号付きの概算見積書（PDF）が発行され、別途工事は設置場所の確認後に代理店からご案内します。</p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <QuoteRequestForm
            configurationId={configuration.id}
            lockVersion={configuration.lock_version ?? null}
            dealers={dealers}
            today={todayInJapan()}
            siteProfile={siteProfile}
            siteArea={siteArea}
            selectedSiteAreaLabel={selectedSiteAreaLabel}
            defaults={{
              full_name: profile?.full_name ?? '',
              company_name: profile?.company_name ?? '',
              email: profile?.email ?? user.email,
              phone: profile?.phone ?? '',
              address: profile?.address ?? '',
              site_address: siteProfile?.site_address ?? '',
              site_profile_lock_version: siteProfile ? String(siteProfile.lock_version) : '',
            }}
          />
          <aside className="card h-fit overflow-hidden lg:sticky lg:top-24" data-testid="quote-request-price-summary">
            {configuration.preview_image_url && (
              <div className="relative aspect-[16/10] bg-sand">
                <SmartImage src={configuration.preview_image_url} alt="完成イメージ" fill sizes="(min-width: 1024px) 22rem, 100vw" className="object-cover" />
              </div>
            )}
            <div className="p-5">
              <p className="font-semibold">{configuration.name}</p>
              <p className="text-xs text-muted">{bundle.model.name}</p>
              <div className="mt-4 rounded-lg bg-sand/60 px-4 py-3" data-testid="quote-request-total">
                <p className="text-xs font-semibold text-ink-soft">概算合計（税込）</p>
                <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-ink">{formatYen(pricing.total)}</p>
              </div>
              {hasSeparateWork && (
                <p className="mt-2 text-xs leading-relaxed text-ink-soft" data-testid="quote-request-excluded-work">
                  別途見積・別途工事の内容や金額は、設置条件の確認後にご案内します。
                </p>
              )}
              <details className="group mt-4 rounded-lg border border-line" data-testid="quote-request-price-breakdown">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
                  <span>商品明細・金額の内訳を見る</span>
                  <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="space-y-4 border-t border-line px-3 py-3 text-sm" data-testid="quote-request-full-breakdown">
                  <section className="space-y-1" aria-label="本体・基本費用">
                    <h3 className="border-b border-line pb-1 font-semibold text-ink">本体・基本費用</h3>
                    <dl className="divide-y divide-line/60">
                      <div className="flex justify-between gap-3 py-1.5"><dt className="min-w-0 flex-1 text-ink-soft">本体一式</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.base_price)}</dd></div>
                      <div className="flex justify-between gap-3 py-1.5"><dt className="min-w-0 flex-1 text-ink-soft">本体諸費用</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.base_expense)}</dd></div>
                      <div className="flex justify-between gap-3 py-1.5 font-medium"><dt>本体価格計（税別）</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.base_total)}</dd></div>
                    </dl>
                  </section>
                  {pricedGroups.map((group) => (
                    <section key={group.key} className="space-y-1" aria-label={group.name}>
                      <h3 className="border-b border-line pb-1 font-semibold text-ink">{group.name}</h3>
                      <dl className="divide-y divide-line/60">
                        {group.lines.map((line) => (
                          <div key={line.code} className="flex items-start justify-between gap-3 py-1.5">
                            <dt className="min-w-0 flex-1 break-words text-ink-soft">{line.name}</dt>
                            <dd className="shrink-0 whitespace-nowrap tabular-nums">{formatYen(line.amount)}</dd>
                          </div>
                        ))}
                        <div className="flex justify-between gap-3 py-1.5 font-medium">
                          <dt className="min-w-0 flex-1">商品小計（税別）</dt>
                          <dd className="shrink-0 tabular-nums">{formatYen(group.amount)}</dd>
                        </div>
                      </dl>
                    </section>
                  ))}
                  {zeroLines.length > 0 && (
                    <details className="group rounded-md border border-line" data-testid="quote-request-zero-lines">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        <span>0円項目を見る（{zeroLines.length}件）</span>
                        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <dl className="divide-y divide-line/60 border-t border-line px-2.5">
                        {zeroLines.map((line) => (
                          <div key={line.code} className="flex items-start justify-between gap-3 py-1.5">
                            <dt className="min-w-0 flex-1 break-words text-ink-soft">{line.name}</dt>
                            <dd className="shrink-0 text-muted">0円</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                  {priceOnRequestLines.length > 0 && (
                    <details className="group rounded-md border border-line" data-testid="quote-request-separate-lines">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        <span>別途見積項目を見る（{priceOnRequestLines.length}件）</span>
                        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <dl className="divide-y divide-line/60 border-t border-line px-2.5">
                        {priceOnRequestLines.map((line) => (
                          <div key={line.code} className="flex items-start justify-between gap-3 py-1.5">
                            <dt className="min-w-0 flex-1 break-words text-ink-soft">{line.name}</dt>
                            <dd className="shrink-0 text-right text-xs text-muted">
                              <span>別途見積</span>
                              {line.amount !== 0 && <span className="block tabular-nums">概算計上 {formatYen(line.amount)}</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                  <p className="text-xs leading-relaxed text-ink-soft">
                    分類別の商品小計は税別・諸費用別の表示額です。0円は表示上の金額で、別途見積は未確定分があります。概算計上額がある場合は合計に含まれます。
                  </p>
                  <dl className="divide-y divide-line/60 border-t border-line pt-2" data-testid="quote-request-tax-totals">
                    <div className="flex justify-between gap-3 py-1.5"><dt className="min-w-0 flex-1 text-ink-soft">オプション諸費用</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.option_expense)}</dd></div>
                    {pricing.adjustment !== 0 && (
                      <div className="flex justify-between gap-3 py-1.5"><dt className="min-w-0 flex-1 text-ink-soft">端数調整</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.adjustment)}</dd></div>
                    )}
                    <div className="flex justify-between gap-3 py-1.5"><dt className="min-w-0 flex-1">税抜請負額</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.subtotal)}</dd></div>
                    <div className="flex justify-between gap-3 py-1.5"><dt>消費税</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.tax)}</dd></div>
                    <div className="flex justify-between gap-3 py-2 font-semibold"><dt>合計（税込）</dt><dd className="shrink-0 tabular-nums">{formatYen(pricing.total)}</dd></div>
                  </dl>
                </div>
              </details>
              <p className="mt-3 text-xs text-muted">{PRICE_DISCLAIMER}</p>
              <Link href={`/simulator/${slug}?c=${configuration.id}`} className="btn-ghost btn-sm mt-4 w-full">仕様を変更する</Link>
            </div>
          </aside>
        </div>
        <Alert tone="info" className="mt-8">
          送信後は仕様を編集できなくなります（複製して新しい仕様を作ることはできます）。
        </Alert>
      </Container>
    </Section>
  );
}
