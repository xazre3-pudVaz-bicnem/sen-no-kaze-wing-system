import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  // 本番 URL 未設定（プレビュー等）では全面 Disallow にして誤インデックスを防ぐ
  if (!base) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/mypage', '/admin', '/api/', '/login', '/register', '/reset-password', '/auth/'] },
    sitemap: `${base}/sitemap.xml`,
  };
}
