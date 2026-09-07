import Image from 'next/image';
import { foldingTech } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';
import { PairBlocks } from '@/components/ui/pair-blocks';

/**
 * 経験から生まれた不陸調整方式採用 折畳み木造コンテナ（Ver5 PDF）。
 * 2ブロック：左＝本文＋折畳み時構成図／右＝クレーン写真＋「広さ約2倍→」＋展開後平面。
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
          {/* 左ブロック：本文｜添付見本に合わせた折畳み時構成図 */}
          <Reveal variant="image" className="grid grid-cols-[0.9fr_1.6fr] items-center gap-3 sm:gap-4">
            <p className="text-[0.72rem] leading-[1.7] text-white/85 sm:text-[0.78rem]">{foldingTech.body}</p>
            <div className="relative aspect-[375/267] w-full">
              <Image
                src="/images/folding-tech/wing-folded-composite.png"
                alt="折畳み屋根面、玄関ドア、設備、木板外壁、折り畳み時の平面図をまとめた図"
                fill
                sizes="(min-width: 1024px) 27vw, 58vw"
                className="object-contain"
              />
            </div>
          </Reveal>

          {/* 右ブロック：クレーン写真｜広さ約2倍→｜展開後平面（固定3列） */}
          <Reveal variant="image" className="grid grid-cols-[1.5fr_0.55fr_0.85fr] items-center gap-1.5">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <Image src="/images/transport/unic-seaside.jpg" alt="海辺の設置場所で設置足の上に置かれた折り畳み状態のコンテナ" fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-cover" />
            </div>
            <p className="mx-auto bg-white px-1 py-0.5 text-center text-[0.54rem] leading-tight font-bold whitespace-nowrap text-red-600 sm:text-[0.66rem]">広さ約2倍 →</p>
            {/* 展開後の平面（先方提供図。向きはそのまま） */}
            <div className="relative aspect-[800/1166] w-full bg-white">
              <Image src="/images/plan/wing-expanded-plan.jpg" alt="広げるとコンテナ約2倍の広さになる平面図" fill sizes="160px" className="object-contain" />
            </div>
          </Reveal>
        </PairBlocks>
      </div>
    </section>
  );
}
