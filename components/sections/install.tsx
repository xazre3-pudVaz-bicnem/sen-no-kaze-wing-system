import Image from 'next/image';
import { Reveal } from '@/components/ui/reveal';

const steps = [
  ['運搬', '折り畳んだ状態で4tユニック1台に積載し、設置場所へ。'],
  ['設置', 'クレーンで吊り上げ、据え置き。大型重機は不要です。'],
  ['支持脚調整', '伸縮する柱脚で不陸・傾斜を吸収し、水平を出します。'],
  ['展開', '屋根を上げ、壁を広げ、床を下ろす。約30分。'],
  ['完成', '設置後に基礎工事を行い、お引き渡し。'],
];

/** 運搬・設置の横長写真を中心に、流れを簡潔に添える */
export function InstallSection() {
  return (
    <section id="install" className="scroll-mt-16 bg-ivory">
      <Reveal variant="image">
        <figure className="relative aspect-[16/9] w-full lg:min-h-[72vh]">
          <Image src="/images/transport/unic-crane-lift.jpg" alt="湖を望む高台で、4tユニック車のクレーンが折り畳み状態のWingを吊り上げている" fill sizes="100vw" className="object-cover object-[center_55%]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" aria-hidden="true" />
          <figcaption className="absolute bottom-0 left-0 p-6 text-white sm:p-10">
            <span className="label-en block text-white/80">Installation</span>
            <span className="mt-2 block max-w-xl font-serif text-3xl leading-snug sm:text-5xl">土地を大きく変えずに、空間を届ける。</span>
          </figcaption>
        </figure>
      </Reveal>
      <div className="container-x grid gap-10 py-16 sm:py-20 lg:grid-cols-[1fr_2fr]">
        <Reveal>
          <p className="label-en text-forest">Flow</p>
          <h2 className="mt-3 text-3xl sm:text-4xl">運搬から完成まで</h2>
          <p className="mt-4 text-ink-soft">朝に現場へ届き、夜には過ごせる施工性。造成を最小限にできるため、これまで諦めていた土地でも検討できます。</p>
        </Reveal>
        <Reveal delay={100}>
          <ol className="divide-y divide-line border-y border-line">
            {steps.map(([t, b], i) => (
              <li key={t} className="grid grid-cols-[3rem_8rem_1fr] items-baseline gap-4 py-4 sm:grid-cols-[3.5rem_9rem_1fr]">
                <span className="font-serif text-2xl text-gold">0{i + 1}</span>
                <span className="font-semibold">{t}</span>
                <span className="text-sm text-ink-soft">{b}</span>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
