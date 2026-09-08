import type { MetadataRoute } from 'next';
import { getPublicModels } from '@/lib/data/public-catalog';
import { getPublishedColumnArticles } from '@/lib/column/loader';
import { COLUMN_PAGE_SIZE } from '@/lib/column/types';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  if (!base) return [];
  const models = await getPublicModels();
  // 公開済みのコラムだけを載せる（下書き・未来日付は getPublishedColumnArticles が除外する）
  const columns = getPublishedColumnArticles();
  const columnPages = Math.ceil(columns.length / COLUMN_PAGE_SIZE);
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/products`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    ...models.map((m) => ({ url: `${base}/products/${m.slug}`, lastModified: new Date(m.updated_at), changeFrequency: 'weekly' as const, priority: 0.9 })),
    ...models.map((m) => ({ url: `${base}/simulator/${m.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.8 })),
    { url: `${base}/column`, lastModified: columns[0] ? new Date(columns[0].publishedAt) : now, changeFrequency: 'daily', priority: 0.7 },
    ...Array.from({ length: Math.max(0, columnPages - 1) }, (_, i) => ({ url: `${base}/column/page/${i + 2}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.3 })),
    ...columns.map((c) => ({ url: `${base}/column/${c.slug}`, lastModified: new Date(c.updatedAt ?? c.publishedAt), changeFrequency: 'monthly' as const, priority: 0.6 })),
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
