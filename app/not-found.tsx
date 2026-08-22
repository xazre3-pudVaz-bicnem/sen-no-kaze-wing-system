import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center">
      <Container className="max-w-xl py-24 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-3xl">ページが見つかりません</h1>
        <p className="mt-4 text-ink-soft">URL が変更されたか、削除された可能性があります。</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href="/">トップページへ</ButtonLink>
          <ButtonLink href="/products" variant="secondary">商品一覧へ</ButtonLink>
        </div>
      </Container>
    </main>
  );
}
