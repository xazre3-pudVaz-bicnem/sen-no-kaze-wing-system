import Image from 'next/image';
import { foldingTech } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';
import { PairBlocks } from '@/components/ui/pair-blocks';

/**
 * 経験から生まれた不陸調整方式採用 折畳み木造コンテナ（Ver5 PDF）。
 * 2ブロック：左＝本文＋立面図まわり／右＝クレーン写真＋「広さ約2倍→」＋展開後平面。
 * ※クレーン写真は先方が動画に差し替え予定（PDF 注記「動画に変更する」）。
 */
export function FoldingTechSection() {
  return (
    <section id="folding" className="scroll-mt-20 bg-forest-deep py-8 text-white sm:py-12">
      <div className="container-x">
        <Reveal>
          <h2 className="font-serif text-xl leading-snug whitespace-pre-line text-gold sm:text-[1.6rem]">
            {foldingTech.title}
            <span className="ml-2 text-sm text-gold/90 sm:text-base">（{foldingTech.badge}）</span>
          </h2>
        </Reveal>

        <PairBlocks className="mt-4 lg:items-center">
          {/* 左ブロック：本文｜折畳み時の外観・設備・平面図 */}
          <Reveal variant="image" className="grid gap-3 sm:grid-cols-[0.72fr_1.55fr] sm:items-center">
            <p className="text-[0.72rem] leading-[1.7] text-white/85 sm:text-[0.78rem]">{foldingTech.body}</p>

            <div
              className="relative aspect-[2521/1257] w-full sm:hidden"
              role="img"
              aria-label="折畳み屋根面、ドア、設備、木板外壁、折畳み時平面図をまとめた図"
            >
              <div
                className="absolute inset-y-0 left-0 w-[52%] bg-no-repeat"
                style={{
                  backgroundImage: "url('/images/elevation/wing-folded-composition.png')",
                  backgroundPosition: 'left center',
                  backgroundSize: 'auto 105%',
                }}
              />
              <div
                className="absolute inset-y-0 right-[15%] w-[18%] translate-y-1 bg-no-repeat"
                style={{
                  backgroundImage: "url('/images/elevation/wing-folded-composition.png')",
                  backgroundPosition: 'right center',
                  backgroundSize: 'auto 97%',
                }}
              />
            </div>

            <div className="relative hidden aspect-[1867/1390] w-full sm:block">
              <Image
                src="/images/elevation/wing-folded-composition.png"
                alt="折畳み屋根面、ドア、設備、木板外壁、折畳み時平面図をまとめた図"
                fill
                sizes="(min-width: 1024px) 30vw, (min-width: 640px) 60vw, 100vw"
                unoptimized
                className="object-contain"
              />
            </div>
          </Reveal>

          {/* 右ブロック：クレーン写真｜広さ約2倍｜展開後平面図 */}
          <Reveal variant="image" className="relative mx-auto aspect-[2521/1257] w-[92%]">
            <Image
              src="/images/transport/wing-expanded-composition.png"
              alt="クレーンで吊り上げた折畳みコンテナと展開後平面図"
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              unoptimized
              className="object-contain"
            />
          </Reveal>
        </PairBlocks>
      </div>
    </section>
  );
}
