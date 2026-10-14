import { Phone } from 'lucide-react';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { PREFECTURES } from '@/lib/domain/address';
import { DEALER_SERVICE_LABELS, dealerServesArea } from '@/lib/domain/case-flow';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';
import { ContactForm } from '@/components/sections/contact-form';

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: '代理店・工務店のご紹介',
  description:
    '運搬・設置・基礎・電気・給排水などの別途工事は、設置場所を確認したうえで地域の代理店・工務店がお見積りします。お近くの窓口をご紹介します。',
  path: '/dealers',
});

/** 見積書の「別途工事」から遷移する代理店紹介＋問い合わせ。本部が公開した代理店を、対応エリアで探せる（フェーズ4） */
export default async function DealersPage({ searchParams }: { searchParams: Promise<{ pref?: string; city?: string }> }) {
  const sp = await searchParams;
  const pref = sp.pref && PREFECTURES.includes(sp.pref) ? sp.pref : null;
  const city = pref && sp.city ? sp.city.trim().slice(0, 30) || null : null;
  const caseFlow = await getCaseFlowStore();
  const published = await caseFlow.listPublishedDealerProfiles();
  const dealers = published.filter((dealer) => dealerServesArea(dealer, pref, city));
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '代理店・工務店のご紹介', path: '/dealers' }])} />
      <Container className="max-w-5xl pt-10 pb-24 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '代理店・工務店のご紹介' }]} />
        <div className="py-12 sm:py-16">
          <RuleHeading
            as="h1"
            labelEn="DEALERS"
            title="代理店・工務店のご紹介"
            lead={
              '運搬、設置費など設置場所によって変動する費用は別途工事です。\n現地の代理店・工務店が、搬入路・地盤・法規を確認したうえでお見積りします。'
            }
            tone="light"
            className="max-w-2xl"
          />
        </div>

        <section className="card mb-10 space-y-5 p-6 sm:p-10" data-testid="dealer-directory">
          <div>
            <h2 className="font-serif text-xl">お近くの代理店を探す</h2>
            <p className="mt-2 text-sm text-ink-soft">
              設置予定地の都道府県を選ぶと、対応している代理店を表示します。見積依頼のときに「相談したい代理店」として指定できます。
            </p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">都道府県</span>
              <select name="pref" defaultValue={pref ?? ''} className="input h-11 min-w-40">
                <option value="">すべて</option>
                {PREFECTURES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">市区町村（任意）</span>
              <input name="city" defaultValue={city ?? ''} className="input h-11" placeholder="例：七尾市" />
            </label>
            <button type="submit" className="btn-primary h-11">
              探す
            </button>
          </form>
          {published.length === 0 ? (
            <p className="text-sm text-muted">現在、掲載している代理店はありません。下の窓口からお気軽にご相談ください。</p>
          ) : dealers.length === 0 ? (
            <p className="text-sm text-muted">この地域に対応している掲載代理店は見つかりませんでした。下の窓口からご相談ください。</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {dealers.map((dealer) => (
                <li key={dealer.dealer_id} className="rounded-xl border border-line p-5" data-testid="dealer-card">
                  <h3 className="font-semibold">{dealer.display_name}</h3>
                  <p className="mt-1 text-xs text-muted">対応エリア：{dealer.service_prefectures.join('・') || '—'}</p>
                  {dealer.services.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1">
                      {dealer.services.map((s) => (
                        <span key={s} className="rounded-full bg-sand px-2 py-0.5 text-[0.7rem]">
                          {DEALER_SERVICE_LABELS[s]}
                        </span>
                      ))}
                    </p>
                  )}
                  {dealer.intro && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{dealer.intro}</p>}
                  {dealer.qualifications && <p className="mt-2 text-xs text-ink-soft">資格：{dealer.qualifications}</p>}
                  {(dealer.track_record || dealer.completed_count !== null) && (
                    <p className="mt-1 text-xs text-ink-soft">
                      施工実績：{dealer.completed_count !== null ? `${dealer.completed_count}件　` : ''}
                      {dealer.track_record ?? ''}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    {dealer.phone && (
                      <a href={`tel:${dealer.phone.replace(/-/g, '')}`} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                        <Phone className="size-3.5" aria-hidden="true" />
                        {dealer.phone}
                      </a>
                    )}
                    {dealer.website_url && (
                      <a href={dealer.website_url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                        Web サイト
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6 sm:p-10">
          <h2 className="font-serif text-xl">別途工事に含まれるもの</h2>
          <ul className="mt-4 grid gap-x-8 gap-y-2 text-sm text-ink-soft sm:grid-cols-2">
            {[
              '運送費（設置場所までの運搬）',
              '設計監理及び確認申請費',
              '梱包養生',
              '現場設置工事（クレーン設置・展開）',
              '電気設備工事（照明器具含む）',
              '給排水給湯設備工事',
              '基礎工事（設置後工事）',
              '廃材処分費',
              '別途現場諸費用（交通費・労災・安全管理費等）',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden="true" className="text-gold">
                  ・
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-8">
            <div>
              <h2 className="font-serif text-xl">窓口</h2>
              <p className="mt-2 text-sm text-ink-soft">
                現在、能登（穴水・七尾）と千葉を拠点に対応しています。その他の地域についても、提携先のご紹介や当社での対応をご相談いただけます。
              </p>
            </div>
            <dl className="space-y-4 text-sm">
              {COMPANY.offices.map((o) => (
                <div key={o.name}>
                  <dt className="font-semibold">{o.name}</dt>
                  <dd className="text-ink-soft">
                    {o.postal}　{o.address}
                    {o.tel && (
                      <>
                        <br />
                        <a href={`tel:${o.tel.replace(/-/g, '')}`} className="inline-flex items-center gap-1 hover:underline">
                          <Phone className="size-3.5" aria-hidden="true" />
                          {o.tel}
                        </a>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-muted text-sm">お電話でのご相談</p>
              <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-3xl tracking-wider">
                {COMPANY.tel}
              </a>
              <p className="mt-1 text-xs text-muted">{COMPANY.telHours}</p>
            </div>
            <p className="text-xs text-muted">
              製作・施工パートナー、販売パートナーの募集についても準備を進めています。ご関心のある事業者様は「加盟店制度について」からお問い合わせください。
            </p>
          </div>
          <div>
            <h2 className="mb-4 font-serif text-xl">別途工事のお問い合わせ</h2>
            <ContactForm />
          </div>
        </section>
      </Container>
    </>
  );
}
