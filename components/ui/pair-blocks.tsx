import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 先方 Ver5 PDF の「最小ブロック」モデル。
 * 黄色い枠 = 1ブロック。ブロックの中の配置は画面幅が変わっても崩さない。
 * 画面が狭くなったら、右のブロックが下に落ちるだけ（PairBlocks が担当）。
 */
export function PairBlocks({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('grid gap-5 lg:grid-cols-2 lg:gap-6', className)}>{children}</div>;
}

/** ブロック内部の固定グリッド（レスポンシブで列数を変えない） */
export function FixedGrid({ cols, className, children }: { cols: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid gap-2', className)} style={{ gridTemplateColumns: cols }}>
      {children}
    </div>
  );
}
