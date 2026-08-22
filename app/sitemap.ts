import type { MetadataRoute } from 'next';
import { getPublicModels } from '@/lib/data/public-catalog';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  if (!base) return [];
  const models = await getPublicModels();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/products`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    ...models.map((m) => ({ url: `${base}/products/${m.slug}`, lastModified: new Date(m.updated_at), changeFrequency: 'weekly' as const, priority: 0.9 })),
    ...models.map((m) => ({ url: `${base}/simulator/${m.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.8 })),
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
