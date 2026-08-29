import { concept } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/**
 * コンセプト動画。先方提供の動画（public/videos/wing-concept.mp4・2026-08-29 受領）を再生する。
 * NEXT_PUBLIC_CONCEPT_MOVIE_URL（YouTube / Vimeo の埋め込み URL）を設定するとそちらを優先する。
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

        <Reveal className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <span className="border border-gold px-4 py-1.5 font-serif text-sm tracking-wider text-gold">{concept.badge}</span>
          <p className="font-serif text-lg leading-relaxed text-white sm:text-2xl">{concept.copy}</p>
        </Reveal>
      </div>
    </section>
  );
}
