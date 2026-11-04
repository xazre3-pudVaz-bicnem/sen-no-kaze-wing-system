import type { OptionVariantGroup } from '@/lib/domain/types';

/**
 * Display-only heading shared by the editable draft and the published product.
 * It does not save or change a selection group.
 */
export function ProductVariantGroupHeading({
  group,
  choiceCount,
  headingLevel: Heading = 'h3',
}: {
  group: OptionVariantGroup;
  choiceCount: number;
  headingLevel?: 'h3' | 'h4';
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3" data-testid="shared-variant-group-heading">
      <div className="min-w-0">
        <Heading className="break-words text-base font-semibold sm:text-lg">{group.name}</Heading>
        <p className="mt-1 text-xs text-muted">
          {choiceCount}選択肢・{group.status === 'published' ? 'お客様に表示' : '非表示'}
          {group.is_required ? '・必須' : ''}
        </p>
      </div>
      {group.depends_on_group_code && (
        <span className="rounded-full bg-ivory px-2.5 py-1 text-xs text-ink-soft">表示条件あり</span>
      )}
    </div>
  );
}
