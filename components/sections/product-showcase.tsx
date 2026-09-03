import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { showcase, type ShowcaseProduct } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';

/** 商品見出し：「よりコンパクトに合理的に・・・ BOX（基本 2,100×4,800）」の帯（Word 準拠） */
function ProductHeading({ p }: { p: ShowcaseProduct }) {
  return (
    <Reveal>
      <p className="font-serif text-sm tracking-wider text-white/85 sm:text-base">{p.catch}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-2xl leading-tight text-gold sm:text-3xl">{p.name}</h3>
        <p className="text-xs tracking-[0.1em] text-white/80 sm:text-sm">（{p.size}）</p>
      </div>
    </Reveal>
  );
}

function EstimateButton({ p }: { p: ShowcaseProduct }) {
  return (
    <Link href={`/simulator/${p.slug}`} className="btn-gold btn-sm mt-4">
      {showcase.cta}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * Wing の設置の流れ：Word の貼り込み構成をそのまま再現した横長コラージュ（2026-09-03 赤入れ「この通りに」）。
 * クレーン写真／折畳み屋根ラベル＋木板／玄関側立面図／折畳み時平面 →（広さ約2倍）→ 展開後平面／設備側立面図＋木板。
 * スマホでは横スクロールで Word と同じ並びを保つ。
 */
function WingFlowStrip() {
  return (
    <div className="mt-6 overflow-x-auto pb-1">
      <div className="flex min-w-[760px] items-stretch gap-1.5 sm:gap-2">
        {/* 1) クレーン写真 */}
        <div className="relative w-[16%] shrink-0 overflow-hidden">
          <Image src="/images/transport/unic-seaside.jpg" alt="海辺の設置場所で設置足の上に置かれた折り畳み状態のコンテナ" fill sizes="180px" className="object-cover" />
        </div>
        {/* 2) 折畳み屋根ラベル＋（AC小箱・木板） */}
        <div className="flex w-[14%] shrink-0 flex-col justify-between gap-1.5">
          <p className="bg-sand px-2 py-2 text-center text-[0.72rem] font-semibold text-ink">折畳み屋根</p>
          <div className="flex items-end gap-1">
            <div className="relative aspect-[265/390] w-[34%]">
              <Image src="/images/elevation/wing-equipment-ac.png" alt="給湯器とエアコン室外機まわりの立面図" fill sizes="60px" className="object-contain" />
            </div>
            <div className="relative aspect-[872/392] flex-1">
              <Image src="/images/elevation/wing-wood-panel.png" alt="木板張りの外壁パネル" fill sizes="110px" className="object-contain" />
            </div>
          </div>
        </div>
        {/* 3) 玄関側立面図 */}
        <div className="relative w-[9%] shrink-0">
          <Image src="/images/elevation/wing-entrance-color.png" alt="木製玄関ドアのある白い外壁の立面図" fill sizes="90px" className="object-contain" />
        </div>
        {/* 4) 折畳み時の平面 */}
        <div className="relative w-[8%] shrink-0 bg-white">
          <Image src="/images/plan/wing-folded-half.png" alt="折り畳んだ状態の平面図" fill sizes="70px" className="object-contain p-0.5" />
        </div>
        {/* 5) ラベル群（Word の赤字「広さ約2倍→」） */}
        <div className="flex w-[12%] shrink-0 flex-col items-center justify-center gap-1.5 text-center">
          <p className="text-[0.62rem] leading-snug whitespace-pre-line text-white/85">{'現地で下ろし\n広げ設置後\n基礎工事'}</p>
          <p className="flex items-center gap-0.5 text-[0.7rem] font-bold whitespace-nowrap text-red-400">
            広さ約2倍
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </p>
          <p className="text-[0.6rem] leading-snug whitespace-pre-line text-white/85">{'UB・エアコン\nウォッシュレット・洗面\nエアコン付き'}</p>
        </div>
        {/* 6) 展開後の平面 */}
        <div className="relative w-[14%] shrink-0 bg-white">
          <Image src="/images/plan/wing-hotel-guest.png" alt="広げるとコンテナ約2倍の広さになる平面図" fill sizes="130px" className="object-contain p-0.5" />
        </div>
        {/* 7) 木板（窓・戸あり）＋（玄関小・木板） */}
        <div className="flex w-[13%] shrink-0 flex-col justify-between gap-1.5">
          <div className="relative aspect-[912/420] w-full">
            <Image src="/images/elevation/wing-roof-face.png" alt="窓と戸のある木板張りの立面図" fill sizes="110px" className="object-contain" />
          </div>
          <div className="flex items-end gap-1">
            <div className="relative aspect-[556/365] w-[45%]">
              <Image src="/images/elevation/wing-entrance-color.png" alt="木製玄関ドアのある白い外壁の立面図" fill sizes="55px" className="object-contain" />
            </div>
            <div className="relative aspect-[872/392] flex-1">
              <Image src="/images/elevation/wing-wood-panel-2.png" alt="木板張りの外壁パネル" fill sizes="60px" className="object-contain" />
            </div>
          </div>
        </div>
        {/* 8) 設備側立面図＋木板 */}
        <div className="flex w-[14%] shrink-0 flex-col justify-between gap-1.5">
          <div className="relative aspect-[631/390] w-full">
            <Image src="/images/elevation/wing-equipment-side.png" alt="給湯器とエアコン室外機、ユニットバスの窓が並ぶ設備側の立面図" fill sizes="120px" className="object-contain" />
          </div>
          <div className="relative aspect-[872/392] w-full">
            <Image src="/images/elevation/wing-wood-panel.png" alt="木板張りの外壁パネル" fill sizes="120px" className="object-contain" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 商品ラインナップ：Wing / BOX / Flat。
 * スマホは Word の赤線指示どおり「左列 → 右列」の順で1列に流す（見積ボタンは Word と同じく説明文の直下）。
 */
export function ProductShowcase() {
  const [wing, box, flat] = showcase.products;
  return (
    <section id="lineup" className="scroll-mt-20 text-white">
      {/* ── Wing（濃緑） ── */}
      <article id="wing" className="scroll-mt-24 bg-forest-deep py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={wing} />
          <div className="mt-4 grid items-start gap-5 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{wing.body}</p>
              {wing.highlight && (
                <p className="mt-3 border-l-2 border-gold pl-3 font-serif text-sm leading-relaxed whitespace-pre-line text-gold-light sm:text-base">{wing.highlight}</p>
              )}
              <EstimateButton p={wing} />
            </Reveal>
            {/* コラージュ：左に透過のアイソメ図（大）、右に外観1枚＋室内3枚の2×2 */}
            <Reveal variant="image">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="relative row-span-2">
                  <Image src={wing.images[0].src} alt={wing.images[0].alt} fill sizes="(min-width: 1024px) 18vw, 32vw" className="object-contain" />
                </div>
                {wing.images.slice(1, 5).map((img) => (
                  <div key={img.src} className="relative aspect-video overflow-hidden">
                    <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 18vw, 32vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
          <WingFlowStrip />
        </div>
      </article>

      {/* ── BOX（紺） ── */}
      <article id="box" className="scroll-mt-24 bg-navy py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={box} />
          <div className="mt-4 grid gap-5 lg:grid-cols-[0.9fr_1.1fr_1fr] lg:items-start lg:gap-8">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{box.body}</p>
              <EstimateButton p={box} />
            </Reveal>
            {/* 外観（透過）＋内装レイアウト */}
            <Reveal variant="image" className="grid grid-cols-2 items-center gap-3 lg:grid-cols-1">
              <div className="relative aspect-[3/2] w-full">
                <Image src={box.images[0].src} alt={box.images[0].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain" />
              </div>
              <div className="relative aspect-[21/9] w-full overflow-hidden bg-white">
                <Image src={box.images[1].src} alt={box.images[1].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain p-0.5" />
              </div>
            </Reveal>
            {/* 活用トピック：スマホは「文章｜写真」の2列（2026-09-03 赤入れ）、PCは文章の下に写真 */}
            <div className="space-y-5">
              {box.topics.map((t) => (
                <Reveal key={t.title} className="grid grid-cols-2 items-start gap-3 lg:block">
                  <div>
                    {t.tag && <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{t.tag}】</p>}
                    <h4 className="mt-0.5 font-serif text-sm leading-snug text-white">{t.title}</h4>
                    <p className="mt-1 text-[0.72rem] leading-[1.7] whitespace-pre-line text-white/80">{t.body}</p>
                  </div>
                  <div className="relative aspect-[4/3] w-full lg:mt-2 lg:max-w-xs">
                    <Image src={t.image} alt={t.alt} fill sizes="(min-width: 1024px) 20rem, 45vw" className={t.image.endsWith('.png') ? 'object-contain' : 'object-cover'} />
                    {t.caption && (
                      <p className="absolute bottom-0 left-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{t.caption}</p>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </article>

      {/* ── Flat（黒）。スマホは説明→基本平面図→外観CG→物置Plus→組合せ図の1列（Word の赤線指示） ── */}
      <article id="flat" className="scroll-mt-24 bg-[#303030] py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={flat} />
          <div className="mt-4 grid gap-5 lg:grid-cols-[0.9fr_1.1fr_1fr] lg:items-start lg:gap-8">
            <Reveal className="lg:col-start-1 lg:row-start-1">
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{flat.body}</p>
              <EstimateButton p={flat} />
            </Reveal>
            {flat.basicPlan && (
              <Reveal variant="image" className="lg:col-start-1 lg:row-start-2">
                <div className="relative aspect-[21/9] w-full max-w-sm overflow-hidden bg-white">
                  <Image src={flat.basicPlan.image} alt={flat.basicPlan.alt} fill sizes="(min-width: 640px) 24rem, 80vw" className="object-contain p-0.5" />
                </div>
              </Reveal>
            )}
            <Reveal variant="image" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <div className="relative aspect-[4/3] w-full max-w-[18rem] sm:max-w-sm lg:mx-auto lg:max-w-md">
                <Image src={flat.images[0].src} alt={flat.images[0].alt} fill sizes="(min-width: 1024px) 32vw, 60vw" className="object-contain" />
              </div>
            </Reveal>
            <div className="lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <Reveal>
                <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{flat.plansTag}】</p>
                <p className="mt-1 text-[0.75rem] leading-[1.7] text-white/85 sm:text-sm">{flat.plansLead}</p>
              </Reveal>
              {flat.storagePhoto && (
                <Reveal variant="image" className="relative mt-2 aspect-[4/3] w-full max-w-[14rem] sm:max-w-xs">
                  <Image src={flat.storagePhoto.image} alt={flat.storagePhoto.alt} fill sizes="(min-width: 1024px) 22vw, 60vw" className="object-cover" />
                  <p className="absolute right-0 bottom-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{flat.storagePhoto.caption}</p>
                </Reveal>
              )}
            </div>
          </div>

          {/* 組合せ平面図（BOX＋Flat は水回りキット＋居室の2枚重ね） */}
          {flat.plans && (
            <div className="mt-6 grid max-w-lg grid-cols-2 gap-3 sm:max-w-xl sm:gap-5">
              {flat.plans.map((pl) => (
                <Reveal key={pl.label} variant="image">
                  <figure>
                    <div className="overflow-hidden bg-white">
                      {pl.images.map((img) => (
                        <div key={img.image} className={`relative w-full ${pl.images.length > 1 ? 'aspect-[7/3]' : 'aspect-[4/3]'}`}>
                          <Image src={img.image} alt={img.alt} fill sizes="(min-width: 640px) 24vw, 45vw" className="object-contain" />
                        </div>
                      ))}
                    </div>
                    <figcaption className="mt-1 text-center font-serif text-xs tracking-wider text-gold-light">{pl.label}</figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
