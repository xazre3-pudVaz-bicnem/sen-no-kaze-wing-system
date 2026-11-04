import type { ReactNode } from 'react';

/** Shared presentation only; each registration lifecycle retains its own save flow. */
export function ProductSectionHeading({
  label,
  description,
  level = 'h3',
  badge,
  trailing,
}: {
  label: string;
  description: ReactNode;
  level?: 'h2' | 'h3';
  badge?: ReactNode;
  trailing?: ReactNode;
}) {
  const Heading = level;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-lg font-semibold">{label}</Heading>
          {badge}
        </div>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {trailing}
    </div>
  );
}
