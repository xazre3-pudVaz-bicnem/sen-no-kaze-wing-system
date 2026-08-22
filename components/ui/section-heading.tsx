import type { ReactNode } from 'react';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

/**
 * 先方サイトと同じ見出し様式：
 * 金の縦罫 ＋ 英字ラベル（金）＋ 明朝の大見出し ＋ 任意のリード文。
 */
export function RuleHeading({
  labelEn,
  title,
  lead,
  tone = 'dark',
  className,
  children,
}: {
  labelEn: string;
  title: ReactNode;
  lead?: string;
  tone?: 'dark' | 'light';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Reveal className={cn('rule-heading', className)}>
      <p className="label-en text-gold">{labelEn}</p>
      <h2 className={cn('mt-3 text-3xl leading-tight sm:text-[2.75rem]', tone === 'dark' ? 'text-white' : 'text-ink')}>{title}</h2>
      {lead && (
        <p className={cn('mt-4 text-sm leading-[1.9] whitespace-pre-line sm:text-base', tone === 'dark' ? 'text-white/80' : 'text-ink-soft')}>{lead}</p>
      )}
      {children}
    </Reveal>
  );
}
