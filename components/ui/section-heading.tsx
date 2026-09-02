import type { ReactNode } from 'react';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

/**
 * 先方サイトと同じ見出し様式：
 * 金の縦罫 ＋ 英字ラベル（金）＋ 明朝の大見出し ＋ 任意のリード文。
 * compact は 2026-09-02 の先方指摘（文字が大きすぎる）に合わせたトップ用の縮小版。
 */
export function RuleHeading({
  labelEn,
  title,
  lead,
  tone = 'dark',
  as: Tag = 'h2',
  compact = false,
  className,
  children,
}: {
  labelEn: string;
  title: ReactNode;
  lead?: string;
  tone?: 'dark' | 'light';
  /** ページの主見出しとして使う場合は h1 を指定する */
  as?: 'h1' | 'h2';
  /** トップページ用の小さめ見出し */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Reveal className={cn('rule-heading', className)}>
      <p className="label-en text-gold">{labelEn}</p>
      <Tag
        className={cn(
          compact ? 'mt-2 text-xl leading-snug sm:text-[1.7rem]' : 'mt-3 text-3xl leading-tight sm:text-[2.75rem]',
          tone === 'dark' ? 'text-white' : 'text-ink'
        )}
      >
        {title}
      </Tag>
      {lead && (
        <p
          className={cn(
            compact ? 'mt-2 text-xs leading-[1.7] whitespace-pre-line sm:text-sm' : 'mt-4 text-sm leading-[1.9] whitespace-pre-line sm:text-base',
            tone === 'dark' ? 'text-white/80' : 'text-ink-soft'
          )}
        >
          {lead}
        </p>
      )}
      {children}
    </Reveal>
  );
}
