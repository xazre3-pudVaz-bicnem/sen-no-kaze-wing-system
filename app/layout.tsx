import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP, Shippori_Mincho } from 'next/font/google';
import { getSiteUrl, SITE_NAME } from '@/lib/site';
import './globals.css';

const noto = Noto_Sans_JP({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-noto', display: 'swap', preload: false });
const mincho = Shippori_Mincho({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-mincho', display: 'swap', preload: false });

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: `${SITE_NAME}｜千の風プロジェクト`, template: `%s｜${SITE_NAME}` },
  description: '4tユニック1台で運び、現地で約30分で展開する折り畳み式木造コンテナ「Wing」。見積シミュレーターで仕様と概算金額をその場で確認できます。',
  applicationName: 'Wing',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#fbfaf7',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${noto.variable} ${mincho.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lift"
        >
          本文へスキップ
        </a>
        {children}
      </body>
    </html>
  );
}
