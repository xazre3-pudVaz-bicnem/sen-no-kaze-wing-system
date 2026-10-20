'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui';
import { PRODUCT_HIGHLIGHT_MAX_LENGTH } from '@/lib/domain/product-highlight';

/** 下書きの登録と公開済み商品の再編集で同じ入力欄を使用する。 */
export function ProductHighlightTextarea({ id, initialValue }: { id: string; initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="min-w-0 w-full">
      <Textarea
        id={id}
        name="highlight"
        rows={4}
        maxLength={PRODUCT_HIGHLIGHT_MAX_LENGTH}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby={`${id}-count`}
        className="min-h-24 w-full resize-y"
      />
      <p id={`${id}-count`} className="mt-1 text-right text-xs text-muted">
        {value.length}/{PRODUCT_HIGHLIGHT_MAX_LENGTH}文字
      </p>
    </div>
  );
}
