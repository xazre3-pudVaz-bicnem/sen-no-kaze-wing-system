'use client';

import { useEffect, useRef, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * ビューポートに入ったら .is-visible を付けるだけの軽量な出現演出。
 * prefers-reduced-motion は CSS 側で無効化される。
 */
export function Reveal({ className, variant = 'text', delay = 0, children, ...props }: ComponentProps<'div'> & { variant?: 'text' | 'image'; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('is-visible');
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn(variant === 'image' ? 'reveal-image' : 'reveal-on-scroll', className)} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...props}>
      {children}
    </div>
  );
}

/** ごく弱いパララックス（縦長のブランド画像用）。reduced-motion では無効 */
export function Parallax({ className, children, strength = 0.08 }: { className?: string; children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = (r.top + r.height / 2 - vh / 2) / vh; // -1..1
      el.style.transform = `translate3d(0, ${(-progress * strength * 100).toFixed(2)}px, 0) scale(1.08)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);
  return (
    <div ref={ref} className={cn('parallax-img absolute inset-0 will-change-transform', className)}>
      {children}
    </div>
  );
}
