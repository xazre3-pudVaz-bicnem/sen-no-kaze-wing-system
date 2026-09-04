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

          {/* 写真列（PDF どおりの並び。透過画像は背景に直置き。スマホは横スクロールで同じ並びを保つ） */}
          <Reveal variant="image" className="overflow-x-auto pb-1">
            <div className="flex min-w-[680px] items-stretch gap-2">
              {/* 1) 折畳み屋根ラベル＋ドア／AC＋木板 */}
              <div className="flex w-[26%] shrink-0 flex-col justify-between gap-2">
                <div className="flex items-stretch gap-2">
                  <p className="flex flex-1 items-center justify-center bg-[#d9d9d9] px-2 py-3 text-center text-[0.78rem] font-semibold text-ink">折畳み屋根</p>
                  <div className="relative aspect-[222/365] w-[22%]">
                    <Image src="/images/elevation/wing-door-only.png" alt="木製玄関ドアの立面図" fill sizes="60px" className="object-contain" />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="relative aspect-[265/390] w-[22%]">
                    <Image src="/images/elevation/wing-equipment-ac.png" alt="給湯器とエアコン室外機まわりの立面図" fill sizes="50px" className="object-contain" />
                  </div>
                  <div className="relative aspect-[872/392] flex-1">
                    <Image src="/images/elevation/wing-wood-panel.png" alt="木板張りの外壁パネル" fill sizes="150px" className="object-contain" />
                  </div>
                </div>
              </div>
              {/* 2) 折畳み時の平面（縦長・白地） */}
              <div className="relative w-[9%] shrink-0 bg-white">
                <Image src="/images/plan/wing-folded-half.png" alt="折り畳んだ状態の平面図" fill sizes="70px" className="object-contain p-0.5" />
              </div>
              {/* 3) クレーン写真＋「動画に変更する」（PDF 注記。後日、先方提供の動画へ差し替え） */}
              <div className="relative w-[30%] shrink-0 overflow-hidden">
                <Image src="/images/transport/unic-seaside.jpg" alt="海辺の設置場所で設置足の上に置かれた折り畳み状態のコンテナ" fill sizes="260px" className="object-cover" />
              </div>
              {/* 4) 広さ約2倍 →（PDF は白地の矢印バナーのみ。説明テキストは PDF に無いので置かない） */}
              <div className="flex w-[10%] shrink-0 items-center justify-center">
                <p className="flex items-center gap-0.5 bg-white px-1.5 py-1 text-[0.7rem] font-bold whitespace-nowrap text-red-600">
                  広さ約2倍
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </p>
              </div>
              {/* 5) 展開後の平面（PDF は縦長・白地） */}
              <div className="relative w-[16%] shrink-0 bg-white">
                <Image src="/images/plan/wing-hotel-guest-portrait.png" alt="広げるとコンテナ約2倍の広さになる平面図" fill sizes="150px" className="object-contain p-0.5" />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
