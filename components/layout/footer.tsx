import Link from 'next/link';
import Image from 'next/image';
import { LP_NAV } from '@/data/site-content';
import { COMPANY, PROJECT_NAME } from '@/lib/site';

/** 先方サイトと同じ構成：3拠点の住所 ＋ Contact Us ＋ ナビ ＋ 規程リンク */
export function Footer() {
  return (
    <footer className="border-t border-forest-line bg-forest-deep text-white">
      <div className="container-x grid gap-12 py-16 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <Image src="/images/brand/sennokaze-logo.png" alt={`${PROJECT_NAME} ロゴ`} width={140} height={88} className="h-16 w-auto" />
          <dl className="mt-8 space-y-5 text-sm">
            {COMPANY.offices.map((o) => (
              <div key={o.name}>
                <dt className="font-semibold text-gold">{o.name}</dt>
                <dd className="text-white/80">
                  {o.postal}　{o.address}
                  {o.tel && (
                    <>
                      <br />
                      <a href={`tel:${o.tel.replace(/-/g, '')}`} className="hover:text-gold">
                        ☎︎ {o.tel}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-white/70">
            フリーダイヤル{' '}
            <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-xl tracking-wider text-white hover:text-gold">
              {COMPANY.tel}
            </a>
          </p>
        </div>

        <div>
          <Link href="/#contact" className="btn-outline-gold font-serif tracking-wider">
            Contact&nbsp;Us
          </Link>
          <nav aria-label="フッターナビゲーション" className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {LP_NAV.map((it) => (
              <Link key={it.href} href={it.href} className="text-white/80 hover:text-gold">
                {it.label}
              </Link>
            ))}
            <Link href="/products" className="text-white/80 hover:text-gold">
              商品ラインナップ
            </Link>
            <Link href="/simulator/wing-01" className="text-white/80 hover:text-gold">
              見積シミュレーション
            </Link>
            <Link href="/mypage" className="text-white/80 hover:text-gold">
              マイページ
            </Link>
            <Link href="/login" className="text-white/80 hover:text-gold">
              ログイン
            </Link>
            <Link href="/privacy" className="text-white/80 hover:text-gold">
              プライバシーポリシー
            </Link>
            <Link href="/sct" className="text-white/80 hover:text-gold">
              特定商取引法の表示
            </Link>
            <Link href="/terms" className="text-white/80 hover:text-gold">
              利用規約
            </Link>
          </nav>
        </div>
      </div>
      <div className="border-t border-forest-line">
        <div className="container-x py-5 text-center text-xs text-white/60">© {new Date().getFullYear()} {COMPANY.nameEn}</div>
      </div>
    </footer>
  );
}
