import type { NextConfig } from 'next';
import path from 'node:path';

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : null;

const nextConfig: NextConfig = {
  // 開発時に 127.0.0.1 / LAN からアクセスしても /_next/* が 403 にならないようにする
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: supabaseHost ? [{ protocol: 'https', hostname: supabaseHost }] : [],
  },
  // 見積書PDFのフォント（assets/fonts）をサーバーレス関数へ同梱する
  outputFileTracingIncludes: {
    '/api/quotes/[id]/pdf': ['./assets/fonts/**'],
  },
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
