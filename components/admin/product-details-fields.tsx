import type { ReactNode } from 'react';
import { Field, Textarea } from '@/components/ui';
import { ProductHighlightTextarea } from '@/components/admin/product-highlight-textarea';

/**
 * Shared display and input layout for product details.
 * The size input remains owned by the caller, so draft-specific category
 * suggestions and published-product save boundaries do not change.
 */
export function ProductDetailsFields({
  sizeField,
  highlightId,
  highlight,
  descriptionId,
  description,
  highlightErrors,
  descriptionErrors,
}: {
  sizeField: ReactNode;
  highlightId: string;
  highlight: string;
  descriptionId: string;
  description: string;
  highlightErrors?: string[];
  descriptionErrors?: string[];
}) {
  return (
    <div className="space-y-4" data-testid="shared-product-details-fields">
      <div className="grid gap-4 sm:grid-cols-2">
        {sizeField}
        <Field
          label="メーカー記載の特徴（任意）"
          htmlFor={highlightId}
          hint="メーカー資料・カタログに明確な記載がある場合のみ入力。記載がなければ空欄で構いません。"
          errors={highlightErrors}
        >
          <ProductHighlightTextarea id={highlightId} initialValue={highlight} />
        </Field>
      </div>
      <Field label="商品説明" htmlFor={descriptionId} errors={descriptionErrors}>
        <Textarea id={descriptionId} name="description" defaultValue={description} className="min-h-28" />
      </Field>
    </div>
  );
}
