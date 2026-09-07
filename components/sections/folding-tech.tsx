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
          {/* 左ブロック：本文｜折畳み屋根ラベル・ドア・AC・木板｜縦長平面（固定3列） */}
          <Reveal variant="image" className="grid grid-cols-[1fr_1fr_0.5fr] items-center gap-2">
            <p className="text-[0.72rem] leading-[1.7] text-white/85 sm:text-[0.78rem]">{foldingTech.body}</p>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_0.42fr] items-stretch gap-2">
                <p className="flex items-center justify-center bg-[#d9d9d9] px-2 py-1 text-center text-[0.66rem] font-semibold text-ink sm:text-[0.74rem]">折畳み屋根</p>
                <div className="relative aspect-[222/365] w-full">
                  <Image src="/images/elevation/wing-door-only.png" alt="木製玄関ドアの立面図" fill sizes="60px" className="object-contain" />
                </div>
              </div>
              <div className="grid grid-cols-[0.42fr_1fr] items-end gap-2">
                <div className="relative aspect-[265/390] w-full">
                  <Image src="/images/elevation/wing-equipment-ac.png" alt="給湯器とエアコン室外機まわりの立面図" fill sizes="50px" className="object-contain" />
                </div>
                <div className="relative aspect-[872/392] w-full">
                  <Image src="/images/elevation/wing-wood-panel.png" alt="木板張りの外壁パネル" fill sizes="150px" className="object-contain" />
                </div>
              </div>
            </div>
            {/* 折畳み時の平面（先方提供図。向きはそのまま） */}
            <div className="relative aspect-[400/1106] w-full bg-white">
              <Image src="/images/plan/wing-folded-plan.jpg" alt="折り畳んだ状態の平面図" fill sizes="80px" className="object-contain" />
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
