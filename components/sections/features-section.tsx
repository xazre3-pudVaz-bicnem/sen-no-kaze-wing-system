import { Check } from 'lucide-react';
import { features } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';

/** 商品のメリット：特徴のチェックリスト（左）＋コンセプト動画（右）。Ver4 PDF の濃緑2列構成 */
export function FeaturesSection() {
  const movie = process.env.NEXT_PUBLIC_CONCEPT_MOVIE_URL?.trim();
  return (
    <section id="features" className="scroll-mt-20 bg-forest py-8 text-white sm:py-12">
      <div className="container-x grid items-start gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <Reveal>
          <h2 className="font-serif text-xl leading-snug text-gold sm:text-[1.6rem]">
            {features.title}
            <span className="mt-1 block text-sm text-gold/90 sm:text-base">（{features.lead}）</span>
          </h2>
          <ul className="mt-4 space-y-1.5">
            {features.items.map((t) => (
              <li key={t} className="flex items-start gap-2 text-[0.8rem] leading-[1.7] text-white/90 sm:text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* コンセプト動画（Ver4 で特徴の右隣に配置） */}
        <Reveal variant="image" id="concept" className="scroll-mt-24">
          <h2 className="inline-block bg-ink px-3 py-1 font-serif text-sm tracking-wider text-white sm:text-base">コンセプト動画</h2>
          <div className="relative mt-2 aspect-video w-full overflow-hidden bg-forest-deep">
            {movie ? (
              <iframe
                src={movie}
                title="折り畳み式木造コンテナ Wing コンセプト動画"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 size-full"
              />
            ) : (
              <video
                controls
                playsInline
                preload="metadata"
                poster="/images/exterior/wing-night-fireworks.jpg"
                className="absolute inset-0 size-full object-cover"
                aria-label="折り畳み式木造コンテナ Wing コンセプト動画"
              >
                <source src="/videos/wing-concept.mp4" type="video/mp4" />
                お使いのブラウザでは動画を再生できません。
              </video>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
