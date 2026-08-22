import Link from 'next/link';
import Image from 'next/image';
import { COMPANY, PROJECT_NAME } from '@/lib/site';

export function Footer() {
  return (
    <footer className="border-t border-line bg-sand/60">
      <div className="container-x grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-4">
            <Image src="/images/brand/sennokaze-logo.png" alt={`${PROJECT_NAME} ロゴ`} width={120} height={76} className="h-auto w-24" />
            <div>
              <p className="font-serif text-2xl tracking-[0.08em]">Wing</p>
              <p className="text-xs tracking-[0.2em] text-muted">{PROJECT_NAME}</p>
            </div>
          </div>
          <p className="mt-5 max-w-md text-sm text-ink-soft">
            4tユニック1台で運び、現地で約30分で展開する折り畳み式木造コンテナ。別荘・宿泊施設・事務所・店舗・住まいに。
          </p>
          <p className="mt-5 text-sm">
            <span className="text-muted">お電話でのご相談</span>
            <br />
            <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-2xl tracking-wider text-ink">
              {COMPANY.tel}
            </a>
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Wing について</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li><Link href="/#about" className="hover:text-ink">Wingとは</Link></li>
            <li><Link href="/products" className="hover:text-ink">商品一覧</Link></li>
            <li><Link href="/#cases" className="hover:text-ink">施工事例</Link></li>
            <li><Link href="/#flow" className="hover:text-ink">導入の流れ</Link></li>
            <li><Link href="/#faq" className="hover:text-ink">よくある質問</Link></li>
            <li><a href="/downloads/wing-pamphlet.pdf" target="_blank" rel="noopener" className="hover:text-ink">パンフレット（PDF）</a></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">ご利用案内</p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li><Link href="/simulator/wing-01" className="hover:text-ink">見積シミュレーション</Link></li>
            <li><Link href="/mypage" className="hover:text-ink">マイページ</Link></li>
            <li><Link href="/login" className="hover:text-ink">ログイン</Link></li>
            <li><Link href="/register" className="hover:text-ink">新規会員登録</Link></li>
            <li><Link href="/contact" className="hover:text-ink">お問い合わせ</Link></li>
            <li><Link href="/terms" className="hover:text-ink">利用規約</Link></li>
            <li><Link href="/privacy" className="hover:text-ink">プライバシーポリシー</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-x flex flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            {COMPANY.name}　本社：{COMPANY.headOffice}
          </p>
          <p>© {new Date().getFullYear()} {COMPANY.name}</p>
        </div>
      </div>
    </footer>
  );
}
