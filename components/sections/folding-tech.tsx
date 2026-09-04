import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { foldingTech } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';

/**
 * 経験から生まれた不陸調整方式採用 折畳み木造コンテナ（Ver4 PDF）。
 * 左＝本文、右＝Word の写真列（折畳み屋根ラベル・玄関立面・AC・木板／折畳み平面 → クレーン写真 →「広さ約2倍」→ 展開後平面）。
 * ※クレーン写真は先方が今後動画に差し替える予定（PDF 注記「動画に差替する」）。
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

        <div className="mt-4 grid items-center gap-5 lg:grid-cols-[0.9fr_2fr] lg:gap-8">
          <Reveal>
            <p className="text-[0.8rem] leading-[1.8] text-white/85 sm:text-sm">{foldingTech.body}</p>
          </Reveal>

          {/* 写真列（スマホは横スクロール） */}
          <Reveal variant="image" className="overflow-x-auto pb-1">
            <div className="flex min-w-[640px] items-stretch gap-1.5 sm:gap-2">
              {/* 折畳み屋根ラベル＋玄関立面／AC＋木板 */}
              <div className="flex w-[22%] shrink-0 flex-col justify-between gap-1.5">
                <div className="flex items-stretch gap-1.5">
                  <p className="flex flex-1 items-center justify-center bg-sand px-2 py-2 text-center text-[0.72rem] font-semibold text-ink">折畳み屋根</p>
                  <div className="relative aspect-[556/365] w-[38%]">
                    <Image src="/images/elevation/wing-entrance-color.png" alt="木製玄関ドアのある白い外壁の立面図" fill sizes="70px" className="object-contain" />
                  </div>
                </div>
                <div className="flex items-end gap-1.5">
                  <div className="relative aspect-[265/390] w-[26%]">
                    <Image src="/images/elevation/wing-equipment-ac.png" alt="給湯器とエアコン室外機まわりの立面図" fill sizes="50px" className="object-contain" />
                  </div>
                  <div className="relative aspect-[872/392] flex-1">
                    <Image src="/images/elevation/wing-wood-panel.png" alt="木板張りの外壁パネル" fill sizes="140px" className="object-contain" />
                  </div>
                </div>
              </div>
              {/* 折畳み時の平面 */}
              <div className="relative w-[10%] shrink-0 bg-white">
                <Image src="/images/plan/wing-folded-half.png" alt="折り畳んだ状態の平面図" fill sizes="80px" className="object-contain p-0.5" />
              </div>
              {/* クレーン写真（今後、先方提供の動画に差し替え予定） */}
              <div className="relative w-[30%] shrink-0 overflow-hidden">
                <Image src="/images/transport/unic-seaside.jpg" alt="海辺の設置場所で設置足の上に置かれた折り畳み状態のコンテナ" fill sizes="260px" className="object-cover" />
              </div>
              {/* 広さ約2倍 → */}
              <div className="flex w-[11%] shrink-0 flex-col items-center justify-center gap-1 text-center">
                <p className="text-[0.62rem] leading-snug whitespace-pre-line text-white/85">{'現地で下ろし\n広げ設置後\n基礎工事'}</p>
                <p className="flex items-center gap-0.5 text-[0.72rem] font-bold whitespace-nowrap text-red-400">
                  広さ約2倍
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </p>
              </div>
              {/* 展開後の平面 */}
              <div className="relative w-[20%] shrink-0 bg-white">
                <Image src="/images/plan/wing-hotel-guest.png" alt="広げるとコンテナ約2倍の広さになる平面図" fill sizes="180px" className="object-contain p-0.5" />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
