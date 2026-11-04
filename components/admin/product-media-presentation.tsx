import type { OptionImage } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';

/**
 * Common, display-only product media primitives.
 * Draft editing controls and published-product review are intentionally separate.
 */
export function ProductGalleryThumbnail({
  image,
  showCaption = false,
}: {
  image: OptionImage;
  showCaption?: boolean;
}) {
  return (
    <>
      <div className="relative h-32 w-full overflow-hidden rounded-lg bg-sand/30 sm:h-36">
        <SmartImage
          src={image.url}
          alt={image.alt || image.caption?.trim() || '追加画像'}
          fill
          sizes="(max-width: 640px) 160px, 240px"
          className="object-contain"
        />
      </div>
      {showCaption && (
        <p className="mt-2 line-clamp-2 break-words text-xs text-ink-soft">
          {image.caption?.trim() || image.alt || '追加画像'}
        </p>
      )}
    </>
  );
}

export function ProductGalleryCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-ivory px-3 py-1 text-xs font-semibold text-ink-soft">
      {count}枚
    </span>
  );
}

export function ProductDocumentStatus({
  url,
  testId,
}: {
  url: string | null | undefined;
  testId?: string;
}) {
  const registered = Boolean(url);
  return (
    <span
      data-testid={testId}
      data-registered={registered ? 'true' : 'false'}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${registered ? 'bg-[#eaf6f1] text-[#245a48]' : 'bg-[#fff8e8] text-[#7c5a18]'}`}
    >
      {registered ? '登録済み' : '未登録'}
    </span>
  );
}
