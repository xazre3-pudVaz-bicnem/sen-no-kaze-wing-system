import Image from 'next/image';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

interface Chapter {
  no: string;
  en: string;
  title: string;
  body: string;
  image: string;
  alt: string;
  position?: string;
}

const chapters: Chapter[] = [
  {
    no: '01',
    en: 'Carry',
    title: '運ぶ。',
    body: '内外装まで工場で仕上げ、折り畳んだ状態で4tユニック1台に積載。大型重機も広い搬入路も要りません。山間部や海沿い、これまで建物を置けなかった遊休地へ届けられます。',
    image: '/images/transport/unic-loading.jpg',
    alt: '4tユニック車の荷台に積み込まれた折り畳み状態のWing',
    position: 'center',
  },
  {
    no: '02',
    en: 'Unfold',
    title: '広げる。',
    body: '屋根を上げ、両脇の壁を広げ、床を下ろして正面の壁を建てる。約30分で荷台の約2倍、18.72㎡の空間が現れます。伸縮する柱脚が傾斜や不陸を吸収し、造成費用を最小限に抑えます。',
    image: '/images/products/wing-lakeside.jpg',
    alt: '湖を望む高台に展開された標準仕様のWing',
    position: '50% 60%',
  },
  {
    no: '03',
    en: 'Live',
    title: '暮らす。',
    body: '木造ならではの温かさをそのままに、ホテルの客室のような仕上げ。キッチン、浴室、空調、デッキ。用途に応じて設備を選び、自分たちに必要な一棟を組み立てられます。',
    image: '/images/interior/wing-room-aircon.jpg',
    alt: '木目の壁に囲まれ、湖を望む窓辺にベッドとデスクを配したWingの室内',
    position: 'center',
  },
];

/**
 * 「運ぶ・広げる・暮らす」を、横長写真と短い文章の編集的レイアウトで。
 * 章ごとに画像と文章の左右を入れ替える。
 */
export function StorySection() {
  return (
    <section id="about" className="scroll-mt-20 bg-paper">
      <div className="container-x pt-20 sm:pt-28">
        <Reveal>
          <p className="label-en text-forest">What is Wing</p>
          <h2 className="mt-4 max-w-3xl text-3xl leading-snug sm:text-5xl">
            コンテナの常識を破る、
            <br className="hidden sm:block" />
            運べる木造の住まい。
          </h2>
          <p className="mt-6 max-w-2xl text-ink-soft sm:text-lg">
            Wing は、工場で仕上げた木造の建物を折り畳んで運び、現地で広げる新しい建築のかたちです。建築確認申請の取得に対応し、住宅ローンやリースの検討も可能。不要になれば畳んで移動できます。
          </p>
        </Reveal>
      </div>

      <div className="mt-16 space-y-20 pb-20 sm:mt-24 sm:space-y-28 sm:pb-28">
        {chapters.map((c, i) => {
          const flip = i % 2 === 1;
          return (
            <article key={c.no} className="grid items-end gap-8 lg:grid-cols-12 lg:gap-0">
              <Reveal variant="image" className={cn('relative lg:col-span-9', flip ? 'lg:col-start-4' : 'lg:col-start-1')}>
                <div className="relative aspect-[16/10] w-full overflow-hidden sm:aspect-[16/9] lg:min-h-[64vh]">
                  <Image src={c.image} alt={c.alt} fill sizes="(min-width: 1024px) 75vw, 100vw" className="object-cover" style={{ objectPosition: c.position }} />
                  <div className={cn('absolute bottom-0 p-6 text-white sm:p-10', flip ? 'right-0 text-right' : 'left-0')}>
                    <span className="label-en block text-white/80">
                      {c.no} — {c.en}
                    </span>
                    <span className="mt-2 block font-serif text-4xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-6xl">{c.title}</span>
                  </div>
                </div>
              </Reveal>
              <Reveal className={cn('container-x lg:col-span-3 lg:px-0', flip ? 'lg:col-start-1 lg:row-start-1 lg:pr-10' : 'lg:col-start-10 lg:pl-10')} delay={120}>
                <p className="max-w-md text-base leading-[1.9] text-ink-soft lg:max-w-none">{c.body}</p>
              </Reveal>
            </article>
          );
        })}
      </div>
    </section>
  );
}
