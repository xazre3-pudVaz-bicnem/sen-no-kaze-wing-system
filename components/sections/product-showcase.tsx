import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { showcase, type ShowcaseProduct } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';
import { PairBlocks } from '@/components/ui/pair-blocks';

/** 商品見出し（Ver5 PDF：キャッチ → 商品名（寸法）） */
function ProductHeading({ p }: { p: ShowcaseProduct }) {
  return (
    <>
      <p className="font-serif text-sm tracking-wider text-white/85 sm:text-base">{p.catch}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-2xl leading-tight text-gold sm:text-3xl">{p.name}</h3>
        <p className="text-xs tracking-[0.1em] text-white/80 sm:text-sm">（{p.size}）</p>
      </div>
    </>
  );
}

function EstimateButton({ p }: { p: ShowcaseProduct }) {
  return (
    <Link href={`/simulator/${p.slug}`} className="btn-gold mt-3 px-3 py-1.5 text-[0.72rem] sm:px-5 sm:py-2.5 sm:text-sm">
      {showcase.cta}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * 商品ラインナップ：Ver5 PDF の「最小ブロック」モデル。
 * 各行は2ブロックで、狭い画面では右ブロックが下へ落ちるだけ。ブロック内部の配置は固定。
 */
export function ProductShowcase() {
  const [wing, box, flat] = showcase.products;
  return (
    <section id="lineup" className="scroll-mt-20 text-white">
      {/* ── Wing（濃緑） ── */}
      <article id="wing" className="scroll-mt-24 bg-forest-deep py-8 sm:py-12">
        <div className="container-x space-y-4">
          <PairBlocks className="lg:items-start">
            {/* 左：見出し＋本文＋アイソメ図＋ボタン（固定2列） */}
            <Reveal>
              <ProductHeading p={wing} />
              <div className="mt-2 grid grid-cols-[1.15fr_1fr] items-start gap-3">
                <div>
                  <p className="text-[0.8rem] leading-[1.85] whitespace-pre-line text-white/90 sm:text-[0.9rem]">{wing.body}</p>
                  <EstimateButton p={wing} />
                </div>
                <div className="relative aspect-[4/5] w-full">
                  <Image src={wing.images[0].src} alt={wing.images[0].alt} fill sizes="(min-width: 1024px) 24vw, 50vw" className="object-contain" />
                </div>
              </div>
            </Reveal>

            {/* 右：室内2×2＋キャプション */}
            <Reveal variant="image">
              <div className="grid grid-cols-2 gap-2">
                {wing.images.slice(1, 5).map((img) => (
                  <div key={img.src} className="relative aspect-[16/10] overflow-hidden">
                    <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 24vw, 45vw" className="object-cover" />
                  </div>
                ))}
              </div>
              {wing.caption && <p className="mt-1.5 text-right text-[0.78rem] leading-relaxed text-white/90 sm:text-[0.85rem]">{wing.caption}</p>}
            </Reveal>
          </PairBlocks>

          {/* 立面図：正面側2面／設備・木板側2面 */}
          <PairBlocks>
            <Reveal variant="image" className="relative aspect-[3/1] w-full">
              <Image
                src="/images/elevation/wing-front-elevations-cutout.png"
                alt="玄関ドア側と掃き出し窓側の立面図"
                fill
                sizes="(min-width: 1024px) 45vw, 100vw"
                unoptimized
                className="object-contain"
              />
            </Reveal>
            <Reveal variant="image" className="relative aspect-[3/1] w-full">
              <Image
                src="/images/elevation/wing-side-elevations.png"
                alt="設備側と木板外壁側の立面図"
                fill
                sizes="(min-width: 1024px) 45vw, 100vw"
                unoptimized
                className="object-contain"
              />
            </Reveal>
          </PairBlocks>
        </div>
      </article>

      {/* ── BOX（青緑） ── */}
      <article id="box" className="scroll-mt-24 bg-[#0b4f66] py-8 sm:py-12">
        <div className="container-x">
          <PairBlocks className="lg:items-start">
            {/* 左：見出し＋本文＋外観CG＋内装図＋ボタン（固定2列） */}
            <Reveal>
              <ProductHeading p={box} />
              <div className="mt-2 grid grid-cols-[1.1fr_1fr] items-start gap-3">
                <div>
                  <p className="text-[0.8rem] leading-[1.85] whitespace-pre-line text-white/90 sm:text-[0.9rem]">{box.body}</p>
                  <EstimateButton p={box} />
                </div>
                <div className="space-y-3">
                  <div className="relative mx-auto aspect-[1672/941] w-full max-w-[135px] sm:max-w-[230px]">
                    <Image src={box.images[0].src} alt={box.images[0].alt} fill sizes="(min-width: 1024px) 230px, 135px" unoptimized className="object-contain" />
                  </div>
                  <div className="relative mx-auto aspect-[2098/750] w-[94%] max-w-[135px] sm:w-full sm:max-w-[230px]">
                    <Image src={box.images[1].src} alt={box.images[1].alt} fill sizes="(min-width: 1024px) 230px, 135px" unoptimized className="object-contain" />
                  </div>
                </div>
              </div>
            </Reveal>

            {/* 右：土地活用例／事務所やワンルーム（各「文章｜写真」の固定2列） */}
            <div className="space-y-3">
              {box.topics.map((t) => (
                <Reveal key={t.title} className="grid grid-cols-[1fr_0.85fr] items-start gap-3">
                  <div>
                    {t.tag && <p className="font-serif text-[0.78rem] tracking-wider text-gold sm:text-[0.9rem]">【{t.tag}】</p>}
                    <h4 className="mt-0.5 font-serif text-[0.86rem] leading-snug text-white sm:text-[0.95rem]">{t.title}</h4>
                    <p className="mt-1 text-[0.76rem] leading-[1.75] whitespace-pre-line text-white/85 sm:text-[0.82rem]">{t.body}</p>
                  </div>
                  <div className={`relative ml-auto w-[88%] ${t.size === 'sm' ? 'aspect-[4/3]' : 'aspect-[1239/1269]'}`}>
                    <Image
                      src={t.image}
                      alt={t.alt}
                      fill
                      sizes="(min-width: 1024px) 18vw, 40vw"
                      unoptimized
                      className={t.size === 'sm' ? 'object-cover' : 'object-contain'}
                    />
                    {t.caption && (
                      <p className="absolute bottom-0 left-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{t.caption}</p>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </PairBlocks>
        </div>
      </article>

      {/* ── Flat（黒） ── */}
      <article id="flat" className="scroll-mt-24 bg-[#303030] py-8 sm:py-12">
        <div className="container-x">
          <PairBlocks className="lg:items-start">
            {/* 左：見出し＋本文＋外観CG＋基本平面図＋ボタン */}
            <Reveal>
              <ProductHeading p={flat} />
              {/* PDF の比率：文字が主役、画像は控えめ */}
              <div className="mt-2 grid grid-cols-[1.15fr_1fr] items-start gap-3">
                <div>
                  <p className="text-[0.8rem] leading-[1.85] whitespace-pre-line text-white/90 sm:text-[0.9rem]">{flat.body}</p>
                  <EstimateButton p={flat} />
                </div>
                <div className="mx-auto w-[88%] space-y-3 lg:w-[90%]">
                  <div className="relative mx-auto aspect-[237/202] w-[74%]">
                    <Image src={flat.images[0].src} alt={flat.images[0].alt} fill sizes="(min-width: 1024px) 17vw, 34vw" unoptimized className="object-contain" />
                  </div>
                  {flat.basicPlan && (
                    <div className="relative mx-auto aspect-[733/266] w-[79%] overflow-hidden bg-white">
                      <Image src={flat.basicPlan.image} alt={flat.basicPlan.alt} fill sizes="(min-width: 1024px) 18vw, 36vw" unoptimized className="object-contain" />
                    </div>
                  )}
                </div>
              </div>
            </Reveal>

            {/* 右：物置Plus 文→Flat＋Wing図｜物置写真→BOX＋Flat図（固定2列） */}
            <Reveal className="grid grid-cols-2 items-start gap-x-10">
              <div>
                <p className="font-serif text-[0.8rem] tracking-wider text-gold sm:text-[0.95rem]">【{flat.plansTag}】</p>
                <p className="mt-1.5 text-[0.78rem] leading-[1.8] text-white/90 sm:text-[0.88rem]">{flat.plansLead}</p>
              </div>
              <div>
                {flat.storagePhoto && (
                  <>
                    <div className="relative mr-auto aspect-[4/3] w-[69%]">
                      <Image src={flat.storagePhoto.image} alt={flat.storagePhoto.alt} fill sizes="(min-width: 1024px) 20vw, 45vw" unoptimized className="object-cover" />
                    </div>
                    {flat.storagePhoto.note && <p className="mt-1 mr-auto w-[69%] text-[0.76rem] text-white/85 sm:text-[0.84rem]">{flat.storagePhoto.note}</p>}
                  </>
                )}
              </div>
              {flat.plans && (
                <>
                  <div className="relative mt-3 ml-auto aspect-[900/948] w-[69%] overflow-hidden bg-white">
                    <Image src={flat.plans[0].images[0].image} alt={flat.plans[0].images[0].alt} fill sizes="(min-width: 1024px) 20vw, 45vw" className="object-contain p-1" />
                  </div>
                  <div className="relative mt-3 mr-auto aspect-[900/715] w-[69%] overflow-hidden bg-white">
                    <Image src={flat.plans[1].images[0].image} alt={flat.plans[1].images[0].alt} fill sizes="(min-width: 1024px) 20vw, 45vw" className="object-contain p-1" />
                  </div>
                </>
              )}
            </Reveal>
          </PairBlocks>
        </div>
      </article>
    </section>
  );
}
