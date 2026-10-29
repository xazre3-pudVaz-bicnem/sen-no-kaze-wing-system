import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP, Shippori_Mincho } from 'next/font/google';
import Script from 'next/script';
import { getSiteUrl, SITE_NAME } from '@/lib/site';
import './globals.css';

const noto = Noto_Sans_JP({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-noto', display: 'swap', preload: false });
const mincho = Shippori_Mincho({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-mincho', display: 'swap', preload: false });

const siteUrl = getSiteUrl();

// Google アナリティクス 4（プロパティ「千の風プロジェクト」）の測定 ID
const GA_MEASUREMENT_ID = 'G-NW3VCYE0BX';

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: `${SITE_NAME}｜千の風プロジェクト`, template: `%s｜${SITE_NAME}` },
  description: '4tユニック1台で運び、現地で約30分で展開する折り畳み式木造コンテナ「Wing」。見積シミュレーターで仕様と概算金額をその場で確認できます。',
  applicationName: 'Wing',
  formatDetection: { telephone: false },
  // Google Search Console の所有権確認（URL プレフィックス https://www.sen-no-kaze.com/）
  verification: { google: 'OSQRQR8T3m2RxrugKv5svzkzeLvjN-GxacMHkQQrUrA' },
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
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
        </Script>
      </body>
    </html>
  );
}
