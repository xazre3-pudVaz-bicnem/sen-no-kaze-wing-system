import { Reveal } from '@/components/ui/reveal';

/** 「Wingとは」の導入文のみ（運ぶ・広げる・暮らすの章は廃止） */
export function StorySection() {
  return (
    <section id="about" className="scroll-mt-20 bg-paper">
      <div className="container-x grid gap-10 py-20 sm:py-28 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <p className="label-en text-forest">What is Wing</p>
          <h2 className="mt-4 text-3xl leading-snug sm:text-5xl">
            コンテナの常識を破る、
            <br className="hidden sm:block" />
            運べる木造の住まい。
          </h2>
        </Reveal>
        <Reveal className="lg:col-span-5 lg:pt-10" delay={100}>
          <p className="text-ink-soft leading-[1.9] sm:text-lg">
            Wing は、工場で内外装まで仕上げた木造の建物を折り畳んで運び、現地で広げる新しい建築のかたちです。4tユニック1台で運び、約30分で荷台の約2倍・18.72㎡の空間に。伸縮する柱脚が傾斜地や不陸を吸収するため造成を最小限に抑えられ、建築確認申請の取得にも対応します。不要になれば畳んで移動できます。
          </p>
        </Reveal>
      </div>
    </section>
  );
}
