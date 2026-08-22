import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';

/**
 * ファーストビュー: 画面全面の写真＋短い見出し。CTA は直下の帯に置き、写真を邪魔しない。
 */
export function HomeHero({ simulatorHref }: { simulatorHref: string }) {
  return (
    <>
      <section className="relative isolate min-h-[92svh] overflow-hidden bg-forest-deep text-white">
        <Image
          src="/images/hero/wing-sunset-coast.jpg"
          alt="夕陽に染まる海岸の高台に建つ、ウッドデッキ付きの折り畳み式木造コンテナ Wing"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[68%_center] sm:object-[60%_center]"
        />
        <div className="absolute inset-0 scrim-b" aria-hidden="true" />
        <div className="absolute inset-0 scrim-t" aria-hidden="true" />
        <div className="container-x relative flex min-h-[92svh] flex-col justify-end pb-20 pt-32 sm:pb-28">
          <p className="label-en reveal text-white/75">Sen no Kaze Project — Folding Timber Module</p>
          <h1 className="reveal reveal-delay-1 mt-5 max-w-3xl text-[2.4rem] leading-[1.2] text-white sm:text-6xl lg:text-7xl">
            土地に、
            <br />
            もうひとつの可能性を。
          </h1>
          <p className="reveal reveal-delay-2 mt-6 max-w-lg text-base leading-relaxed text-white/85 sm:text-lg">
            運び、広げ、暮らしが生まれる。
            <br />
            折り畳み式木造コンテナ Wing。
          </p>
        </div>
        <a
          href="#intro"
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-[0.65rem] tracking-[0.3em] text-white/70 hover:text-white"
          aria-label="下へスクロール"
        >
          SCROLL
          <ChevronDown className="size-4 animate-bounce" aria-hidden="true" />
        </a>
      </section>

      {/* ファーストビュー直下の導線帯 */}
      <section id="intro" className="border-b border-line bg-ivory">
        <div className="container-x flex flex-col gap-6 py-7 lg:flex-row lg:items-center lg:justify-between">
          <dl className="grid grid-cols-3 gap-6 sm:gap-10">
            {[
              ['4t', 'ユニック1台で運搬'],
              ['30分', '現地で展開'],
              ['18.72㎡', '展開後の広さ'],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="font-serif text-3xl text-forest sm:text-4xl">{v}</dt>
                <dd className="text-xs text-muted sm:text-sm">{l}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href={simulatorHref} className="btn-primary btn-lg">
              見積シミュレーションを始める
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
            <Link href="/products" className="btn-ghost">
              3つのモデルを見る
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
