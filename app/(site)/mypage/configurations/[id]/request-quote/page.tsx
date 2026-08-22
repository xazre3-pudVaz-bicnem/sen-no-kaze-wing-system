import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { computePricing, formatYen } from '@/lib/domain/pricing';
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
  const pricing = computePricing(bundle.model, bundle.options, bundle.categories, items.map((i) => ({ option_id: i.option_id, quantity: i.quantity })));
  const optionLines = pricing.lines.filter((l) => !l.is_installation);
  const siteworkLines = pricing.lines.filter((l) => l.is_installation);
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
            defaults={{
              full_name: profile?.full_name ?? '',
              company_name: profile?.company_name ?? '',
              email: profile?.email ?? user.email,
              phone: profile?.phone ?? '',
              address: profile?.address ?? '',
            }}
          />
          <aside className="card h-fit overflow-hidden lg:sticky lg:top-24">
            {configuration.preview_image_url && (
              <div className="relative aspect-[16/10] bg-sand">
                <SmartImage src={configuration.preview_image_url} alt="完成イメージ" fill sizes="(min-width: 1024px) 22rem, 100vw" className="object-cover" />
              </div>
            )}
            <div className="p-5">
              <p className="font-semibold">{configuration.name}</p>
              <p className="text-xs text-muted">{bundle.model.name}</p>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-ink-soft">本体一式</dt><dd>{formatYen(pricing.base_price)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">本体諸費用</dt><dd className="text-muted">{formatYen(pricing.base_expense)}</dd></div>
                {optionLines.map((l) => (
                  <div key={l.option_id} className="flex justify-between gap-2"><dt className="text-ink-soft">{l.name}</dt><dd className="shrink-0">{l.price_on_request ? '別途' : formatYen(l.amount)}</dd></div>
                ))}
                <div className="flex justify-between"><dt className="text-muted">オプション諸費用</dt><dd className="text-muted">{formatYen(pricing.option_expense)}</dd></div>
                {siteworkLines.length > 0 && <div className="flex justify-between"><dt className="text-muted">別途工事（{siteworkLines.length}項目）</dt><dd className="text-muted">別途</dd></div>}
                <div className="flex justify-between border-t border-line pt-2"><dt>税抜請負額</dt><dd>{formatYen(pricing.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>消費税</dt><dd>{formatYen(pricing.tax)}</dd></div>
                <div className="flex items-baseline justify-between pt-1"><dt className="font-semibold">合計（税込）</dt><dd className="font-serif text-2xl">{formatYen(pricing.total)}</dd></div>
              </dl>
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
