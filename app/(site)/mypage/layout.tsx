import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'マイページ',
  robots: { index: false, follow: false, nocache: true },
};

export default function MypageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
