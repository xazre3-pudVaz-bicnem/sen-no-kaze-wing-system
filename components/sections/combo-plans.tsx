import Image from 'next/image';
import { combos } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';
import { PairBlocks } from '@/components/ui/pair-blocks';

interface Group {
  label: string;
  badge: string;
  panel?: boolean;
  wide?: boolean;
  items: { image: string; alt: string }[];
}

/** ラベル（丸ピル）＋図。panel の場合は青緑パネルに入れる */
function PlanGroup({ g }: { g: Group }) {
  return (
    <Reveal variant="image" className={g.wide ? 'col-span-2' : undefined}>
      <p className="inline-block rounded-full px-4 py-1 font-serif text-[0.7rem] tracking-wider text-white sm:text-xs" style={{ backgroundColor: g.badge }}>
        {g.label}
      </p>
      <div className={`mt-1.5 grid gap-2 ${g.items.length > 1 && !g.panel ? 'grid-cols-2' : 'grid-cols-1'} ${g.panel ? 'bg-[#0b4f66] p-2' : ''}`}>
        {g.items.map((item) => (
          <figure key={item.image} className="border border-brown/15 bg-white">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <Image src={item.image} alt={item.alt} fill sizes="(min-width: 1024px) 20vw, 45vw" className="object-contain p-1" />
            </div>
          </figure>
        ))}
      </div>
    </Reveal>
  );
}

/**
 * 組合せプラン：Ver5 PDF の2ブロック（黒枠）。
 * 左＝基本本体・Wing居住用・Flatプラス居室例／右＝Wingホテル用・Wing居室プラン例・BOX水回りキット例。
 * 組合せ4例も左2枚／右2枚の2ブロック。狭い画面では右が下に落ちるだけ。
 */
export function ComboPlansSection() {
  return (
    <section id="plans" className="scroll-mt-20 bg-ivory py-8 sm:py-12">
      <div className="container-x">
        <RuleHeading labelEn={combos.labelEn} title={combos.title} tone="light" compact />

        <Reveal className="mt-3">
          <p className="text-[0.78rem] leading-[1.7] whitespace-pre-line text-ink-soft sm:text-sm">{combos.note}</p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-red-600">{combos.caution}</p>
        </Reveal>

        <PairBlocks className="mt-5 lg:items-start">
          {/* 左ブロック：基本本体（大・パネル）｜Wing居住用／Flatプラス居室例 */}
          <div className="grid grid-cols-[1.1fr_1fr] items-start gap-3">
            <PlanGroup g={combos.leftGroups[0] as Group} />
            <div className="space-y-3">
              <PlanGroup g={combos.leftGroups[1] as Group} />
              <PlanGroup g={combos.leftGroups[2] as Group} />
            </div>
          </div>

          {/* 右ブロック：Wingホテル用｜Wing居室プラン例／BOX水回りキット例（横長） */}
          <div className="grid grid-cols-2 items-start gap-3">
            <PlanGroup g={combos.rightGroups[0] as Group} />
            <PlanGroup g={combos.rightGroups[1] as Group} />
            <PlanGroup g={combos.rightGroups[2] as Group} />
          </div>
        </PairBlocks>

        {/* 組合せ例：帯見出し＋4図（左2／右2の2ブロック） */}
        <Reveal className="mt-6">
          <p className="rounded-sm px-3 py-1.5 text-center text-[0.75rem] font-semibold tracking-wide text-white sm:text-sm" style={{ backgroundColor: combos.comboBand.color }}>
            {combos.comboBand.label}　{combos.comboBand.note}
          </p>
        </Reveal>
        <PairBlocks className="mt-3">
          {[combos.comboBand.items.slice(0, 2), combos.comboBand.items.slice(2, 4)].map((pair, i) => (
            <Reveal key={i} variant="image" className="grid grid-cols-2 gap-3">
              {pair.map((item) => (
                <figure key={item.image} className="border border-brown/15 bg-white">
                  <div className="relative aspect-[4/5] w-full overflow-hidden">
                    <Image src={item.image} alt={item.alt} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-contain p-1" />
                  </div>
                </figure>
              ))}
            </Reveal>
          ))}
        </PairBlocks>
      </div>
    </section>
  );
}
