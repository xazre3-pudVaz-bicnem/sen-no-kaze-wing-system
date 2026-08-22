import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from '@/components/ui/reveal';

/**
 * 「暮らしを組み立てる」— 室内・ミニキッチン・3点ユニットの大きなビジュアル。
 * 画像同士をカードで囲まず、非対称に置く。
 */
export function LivingSection({ simulatorHref }: { simulatorHref: string }) {
  return (
    <section id="living" className="scroll-mt-16 bg-paper py-20 sm:py-28">
      <div className="container-x">
        <Reveal className="max-w-2xl">
          <p className="label-en text-forest">Build your living</p>
          <h2 className="mt-4 text-3xl sm:text-5xl">必要な機能を、必要な分だけ。</h2>
          <p className="mt-5 text-ink-soft sm:text-lg">キッチン、トイレ、浴室、空調、デッキ。用途に合わせて設備を組み合わせ、自分たちに必要な一棟をつくれます。</p>
        </Reveal>
      </div>

      <Reveal variant="image" className="mt-12 sm:mt-16">
        <figure className="relative aspect-[16/9] w-full sm:aspect-[21/9] lg:min-h-[70vh]">
          <Image src="/images/interior/room-white-aircon.jpg" alt="白い壁とベッド、デスク、窓越しの湖を望むWingの室内" fill sizes="100vw" className="object-cover object-[center_60%]" />
          <figcaption className="absolute bottom-0 left-0 p-6 text-white sm:p-10">
            <span className="label-en block text-white/80">Room</span>
            <span className="mt-1 block font-serif text-2xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] sm:text-4xl">光を取り込む、居室。</span>
          </figcaption>
        </figure>
      </Reveal>

      <div className="container-x mt-6 grid gap-6 sm:mt-8 lg:grid-cols-12 lg:gap-8">
        <Reveal variant="image" className="lg:col-span-7">
          <figure>
            <div className="relative aspect-[3/2] overflow-hidden">
              <Image src="/images/interior/wing-room-kitchen.jpg" alt="ベッドルームの奥に設けられたミニキッチン。シンク・IH・冷蔵庫を備える" fill sizes="(min-width: 1024px) 58vw, 100vw" className="object-cover" />
            </div>
            <figcaption className="mt-4 max-w-md">
              <p className="font-serif text-2xl">ミニキッチン</p>
              <p className="mt-1 text-sm text-ink-soft">シンク・コンロ・冷蔵庫スペースをコンパクトに。一人暮らしや宿泊施設の客室に十分な調理スペースを確保します。</p>
            </figcaption>
          </figure>
        </Reveal>
        <Reveal variant="image" className="lg:col-span-5 lg:mt-24" delay={120}>
          <figure>
            <div className="relative aspect-[3/2] overflow-hidden lg:aspect-[4/3]">
              <Image src="/images/interior/unit-bath-3point.jpg" alt="浴槽・シャワー・洗面器・トイレが一体になった3点ユニットバス" fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
            </div>
            <figcaption className="mt-4">
              <p className="font-serif text-2xl">3点ユニットバス</p>
              <p className="mt-1 text-sm text-ink-soft">浴槽・トイレ・洗面器を一体に。ホテル仕様のユニットバスやシャワーユニットも選べます。</p>
            </figcaption>
          </figure>
        </Reveal>
      </div>

      <div className="container-x mt-12 flex flex-col gap-4 sm:mt-16 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">エアコン・給湯器・スマートキー・家具・ウッドデッキなど、すべてシミュレーターで選べます。</p>
        <Link href={simulatorHref} className="btn-primary">
          設備を選んで見積を作る
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
