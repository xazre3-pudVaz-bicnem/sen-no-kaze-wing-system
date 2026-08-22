import Image from 'next/image';
import { PlayCircle } from 'lucide-react';
import { concept } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/**
 * コンセプト動画。NEXT_PUBLIC_CONCEPT_MOVIE_URL（YouTube / Vimeo の埋め込み URL）を
 * 設定すると動画を埋め込み、未設定のときはキービジュアルと「準備中」を表示する。
 */
export function ConceptMovieSection() {
  const movie = process.env.NEXT_PUBLIC_CONCEPT_MOVIE_URL?.trim();
  return (
    <section id="concept" className="scroll-mt-20 bg-forest py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={concept.labelEn} title={concept.title} />

        <Reveal variant="image" className="mt-12">
          <div className="relative aspect-video w-full overflow-hidden bg-forest-deep">
            {movie ? (
              <iframe
                src={movie}
                title="折り畳み式木造コンテナ Wing コンセプト動画"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 size-full"
              />
            ) : (
              <>
                <Image src="/images/exterior/cove-night.jpg" alt="夜の入り江に設置された Wing" fill sizes="(min-width: 1024px) 80vw, 100vw" className="object-cover opacity-70" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                  <PlayCircle className="size-16 text-gold" aria-hidden="true" />
                  <p className="text-sm tracking-wider">コンセプト動画は公開準備中です</p>
                </div>
              </>
            )}
          </div>
        </Reveal>

        <Reveal className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <span className="border border-gold px-4 py-1.5 font-serif text-sm tracking-wider text-gold">{concept.badge}</span>
          <p className="font-serif text-lg leading-relaxed text-white sm:text-2xl">{concept.copy}</p>
        </Reveal>
      </div>
    </section>
  );
}
