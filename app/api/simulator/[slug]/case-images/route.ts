import { NextResponse } from 'next/server';
import { getPublicBundleBySlug } from '@/lib/data/public-catalog';

type Params = Promise<{ slug: string }>;

/** シミュレーターの施工事例タブ用。ベースコンテナに登録された case 画像だけを返す。 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { slug } = await params;
  const bundle = await getPublicBundleBySlug(slug);
  if (!bundle) return NextResponse.json({ images: [] }, { status: 404 });

  const images = bundle.images
    .filter((image) => image.kind === 'case')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      caption: image.caption,
    }));

  return NextResponse.json({ images });
}
