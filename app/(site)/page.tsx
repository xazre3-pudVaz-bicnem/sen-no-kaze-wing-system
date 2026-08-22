import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Phone } from 'lucide-react';
import { faqs } from '@/data/faq';
import { getStore } from '@/lib/data/store';
import { baseTotalOf, formatManYen } from '@/lib/domain/pricing';
import { buildMetadata, faqJsonLd, organizationJsonLd } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { ButtonLink, Container, JsonLd, Section, SectionHeading } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';

export const metadata = buildMetadata({
  title: '折り畳み式木造コンテナ Wing｜4tユニックで運び30分で展開する別荘・宿泊施設',
  description:
    '折り畳み式木造コンテナ「Wing」は4tユニック1台で運搬、現地で約30分で展開し18.72㎡の空間に。傾斜地にも設置でき建築確認申請にも対応。見積シミュレーターで仕様と概算金額をその場で確認。',
  path: '/',
  keywords: ['折り畳み式コンテナ', '木造コンテナ', 'コンテナハウス', 'トレーラーハウス', '小屋', '別荘', 'グランピング', 'Wing', '千の風プロジェクト'],
});

const keyNumbers = [
  { value: '1台', label: '4tユニックで運搬', note: '荷台にすっぽり収まる' },
  { value: '30分', label: '現地で展開', note: '朝届いて夜には過ごせる' },
  { value: '18.72㎡', label: '展開後の広さ', note: '約11.5帖・荷台の約2倍' },
];

const flow = [
  { step: '01', title: 'シミュレーション', body: 'ベースモデルとオプションを選び、完成イメージと概算金額を確認。保存して後から再編集できます。' },
  { step: '02', title: '見積依頼', body: 'マイページから仕様を送信。見積番号付きの概算見積書（PDF）がすぐに発行されます。' },
  { step: '03', title: '現地確認・正式見積', body: '設置場所の条件（搬入路・地盤・法規）を確認し、運送費・工事費を含めた正式見積をご案内。' },
  { step: '04', title: 'ご契約・製作', body: '工場で内外装まで仕上げた状態で製作。建築確認申請が必要な場合は並行して進めます。' },
  { step: '05', title: '運搬・設置', body: '4tユニックで搬入し、現地で約30分で展開。設置後に基礎工事を行い、お引き渡しです。' },
];

const useCases = [
  { title: '別荘・セカンドハウス', body: '景色のよい遊休地に、造成を最小限にして。', image: '/images/exterior/lakeside-sunset.jpg' },
  { title: '宿泊施設・グランピング', body: '1棟から始めて、人気に応じて棟数を増やせます。', image: '/images/cases/island-resort.png' },
  { title: '事務所・サテライトオフィス', body: '現場事務所やリモートワークの拠点に。', image: '/images/interior/living-tv.jpg' },
  { title: '店舗・カフェ', body: '海辺や公園に、小さな店を置く。', image: '/images/exterior/cove-day.jpg' },
];

export default async function HomePage() {
  const store = await getStore();
  const models = await store.listModels();
  const primary = models[0] ?? null;
  const cases = primary ? (await store.getCatalogBundle(primary.id))?.images.filter((i) => i.kind === 'case') ?? [] : [];
  const simulatorHref = primary ? `/simulator/${primary.slug}` : '/products';

  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={faqJsonLd(faqs)} />

      {/* Hero */}
      <section className="relative isolate min-h-[88svh] overflow-hidden bg-navy text-white">
        <Image
          src="/images/hero/sunset-sea-4k.webp"
          alt="夕陽の海を望む高台に設置された折り畳み式木造コンテナ Wing"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[70%_center]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10" />
        <div className="container-x relative flex min-h-[88svh] flex-col justify-end pb-16 pt-28 sm:pb-24">
          <p className="eyebrow reveal text-wood-light">千の風プロジェクト｜折り畳み式木造コンテナ</p>
          <h1 className="reveal reveal-delay-1 mt-4 max-w-3xl text-4xl leading-tight text-white sm:text-6xl">
            この景色を、
            <br />
            運べる家で。
          </h1>
          <p className="reveal reveal-delay-2 mt-6 max-w-xl text-base text-white/85 sm:text-lg">
            4tユニック1台で運び、現地で約30分で広がる木造の住まい「Wing」。
            内装は高級ホテルの仕上げ。傾斜地にも、島にも、造成を最小限にして置けます。
          </p>
          <div className="reveal reveal-delay-3 mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={simulatorHref} size="lg" className="bg-white text-ink hover:bg-wood-light">
              見積シミュレーションを始める
              <ArrowRight className="size-5" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/products" size="lg" variant="ghost" className="border border-white/40 text-white hover:bg-white/10">
              商品を見る
            </ButtonLink>
          </div>
          <p className="mt-6 text-xs text-white/60">画像は完成イメージ（CGパース）です。</p>
        </div>
      </section>

      {/* Key numbers */}
      <section className="border-b border-line bg-white">
        <Container className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {keyNumbers.map((k) => (
            <div key={k.label} className="py-8 sm:px-8 sm:py-10">
              <p className="font-serif text-4xl text-brown sm:text-5xl">{k.value}</p>
              <p className="mt-2 font-semibold">{k.label}</p>
              <p className="text-sm text-muted">{k.note}</p>
            </div>
          ))}
        </Container>
      </section>

      {/* About */}
      <Section id="about" className="scroll-mt-20">
        <Container className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="What is Wing"
              title="コンテナの常識を破る、小さな宝箱。"
              lead="Wing は、工場で内外装まで仕上げた木造の建物を折り畳んで運び、現地で広げる新しい住まいのかたちです。折り畳めば4tトラックの荷台に収まり、広げれば荷台の約2倍・18.72㎡。建築確認申請の取得に対応した、高性能住宅レベルの品質です。"
            />
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                ['遊休地に、造成を最小限', '伸縮する柱脚が不陸を吸収。自然のままの土地に置けます。'],
                ['不要なら撤去・移動', '折り畳んで別の場所へ。下取りのご相談も可能です。'],
                ['災害時は仮設住宅に', '運んで30分で展開できる機動力を、もしもの備えに。'],
                ['子や孫への資産に', '確認申請が取れる品質だから、住宅ローン・リースも検討可能。'],
              ].map(([t, b]) => (
                <li key={t} className="rounded-2xl border border-line bg-white p-5">
                  <p className="font-semibold">{t}</p>
                  <p className="mt-1 text-sm text-ink-soft">{b}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl">
            <Image src="/images/exterior/lakeside-family.jpg" alt="湖畔のデッキで家族が過ごすWing" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
          </div>
        </Container>
      </Section>

      {/* Fold / transport / setup */}
      <Section className="bg-sand/60">
        <Container>
          <SectionHeading eyebrow="Fold · Carry · Unfold" title="折り畳んで運び、現地で広げる。" lead="屋根を上げ、両脇の壁を広げ、床を下ろして正面の壁を建てる。約30分で、荷台の約2倍の空間が現れます。" align="center" />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { img: '/images/transport/unic-loading.jpg', t: '01 折り畳んで積む', b: '内外装を仕上げた状態で折り畳み、4tユニック1台に積載。約2,150×4,950mm。' },
              { img: '/images/transport/unic-setup.jpg', t: '02 現地で下ろす', b: 'クレーンで設置場所へ。伸縮する柱脚が傾斜や不陸を吸収します。' },
              { img: '/images/exterior/lakeside-sunset.jpg', t: '03 30分で展開', b: '3,900×4,800mm・18.72㎡の空間に。設置後に基礎工事を行います。' },
            ].map((s) => (
              <figure key={s.t} className="card overflow-hidden">
                <div className="relative aspect-[16/10]">
                  <Image src={s.img} alt={s.t} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                </div>
                <figcaption className="p-6">
                  <p className="font-serif text-xl">{s.t}</p>
                  <p className="mt-2 text-sm text-ink-soft">{s.b}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </Container>
      </Section>

      {/* Use cases */}
      <Section>
        <Container>
          <SectionHeading eyebrow="Use cases" title="別荘に、ホテルに、住まいに。" lead="お一人様の住まいから別荘、事務所、店舗まで。2台を結合すれば家族で暮らせる広さになります。" />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {useCases.map((u) => (
              <div key={u.title} className="group relative aspect-[3/4] overflow-hidden rounded-3xl">
                <Image src={u.image} alt={u.title} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <p className="font-serif text-xl">{u.title}</p>
                  <p className="mt-1 text-sm text-white/80">{u.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Product */}
      {primary && (
        <Section className="bg-navy text-white">
          <Container className="grid items-center gap-12 lg:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl lg:order-2">
              <Image src="/images/exterior/forest-deck.jpg" alt={`${primary.name} 外観イメージ`} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
            </div>
            <div>
              <p className="eyebrow text-wood-light">Base model</p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">{primary.name}</h2>
              <p className="mt-4 text-white/80">{primary.tagline}</p>
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                {primary.specs.slice(0, 6).map((s) => (
                  <div key={s.label} className="border-t border-white/15 pt-3">
                    <dt className="text-white/60">{s.label}</dt>
                    <dd className="mt-0.5">{s.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-8 text-sm text-white/70">本体参考価格（税別）</p>
              <p className="font-serif text-4xl">{formatManYen(baseTotalOf(primary))}〜</p>
              <p className="mt-1 text-xs text-white/60">本体一式＋諸費用。オプション・別途工事は含みません。</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href={`/products/${primary.slug}`} className="bg-white text-ink hover:bg-wood-light">
                  商品詳細を見る
                </ButtonLink>
                <ButtonLink href={simulatorHref} variant="ghost" className="border border-white/40 text-white hover:bg-white/10">
                  この商品で見積を作る
                </ButtonLink>
              </div>
            </div>
          </Container>
        </Section>
      )}

      {/* Cases */}
      {cases.length > 0 && (
        <Section id="cases" className="scroll-mt-20">
          <Container>
            <SectionHeading eyebrow="Works" title="施工事例・設置イメージ" lead="海辺、島、入り江。Wing は景色のいちばん良い場所に置けます。" />
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {cases.map((c) => (
                <figure key={c.id} className="overflow-hidden rounded-3xl">
                  <div className="relative aspect-[4/3]">
                    <SmartImage src={c.url} alt={c.alt} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                  </div>
                  <figcaption className="px-1 pt-3 text-sm text-ink-soft">{c.caption}</figcaption>
                </figure>
              ))}
            </div>
          </Container>
        </Section>
      )}

      {/* Flow */}
      <Section id="flow" className="scroll-mt-20 bg-sand/60">
        <Container>
          <SectionHeading eyebrow="Flow" title="導入の流れ" lead="シミュレーションから設置まで、5つのステップ。" align="center" />
          <ol className="mt-12 grid gap-5 md:grid-cols-5">
            {flow.map((f) => (
              <li key={f.step} className="card p-6">
                <p className="font-serif text-3xl text-wood">{f.step}</p>
                <p className="mt-3 font-semibold">{f.title}</p>
                <p className="mt-2 text-sm text-ink-soft">{f.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* FAQ */}
      <Section id="faq" className="scroll-mt-20">
        <Container className="max-w-3xl">
          <SectionHeading eyebrow="FAQ" title="よくある質問" align="center" />
          <div className="mt-10 divide-y divide-line border-y border-line">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-base font-semibold sm:text-lg [&::-webkit-details-marker]:hidden">
                  <span>Q. {f.q}</span>
                  <span aria-hidden="true" className="mt-1 shrink-0 text-muted transition-transform group-open:rotate-45">＋</span>
                </summary>
                <p className="mt-3 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <section className="relative isolate overflow-hidden bg-brown text-white">
        <Image src="/images/exterior/cove-night.jpg" alt="" aria-hidden="true" fill sizes="100vw" className="object-cover opacity-30" />
        <Container className="relative py-20 text-center sm:py-28">
          <h2 className="text-3xl text-white sm:text-4xl">あなたの土地に、Wing を置いてみる。</h2>
          <p className="mx-auto mt-4 max-w-xl text-white/85">
            オプションを選ぶだけで、完成イメージと概算金額がその場で分かります。保存しておけば、いつでも続きから。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href={simulatorHref} size="lg" className="bg-white text-ink hover:bg-wood-light">
              見積シミュレーションを始める
            </ButtonLink>
            <Link href="/contact" className="btn btn-lg border border-white/40 text-white hover:bg-white/10">
              相談する
            </Link>
          </div>
          <p className="mt-8 inline-flex items-center gap-2 text-sm text-white/80">
            <Phone className="size-4" aria-hidden="true" />
            お電話でも：
            <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-xl tracking-wider text-white">
              {COMPANY.tel}
            </a>
          </p>
        </Container>
      </section>
    </>
  );
}
