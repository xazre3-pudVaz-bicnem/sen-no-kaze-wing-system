import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, FileText } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { COMPANY } from '@/lib/site';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Container, Section } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { QuoteTable } from '@/components/mypage/quote-table';

export default async function QuoteDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ requested?: string }> }) {
  const { id } = await params;
  const { requested } = await searchParams;
  const user = await requireUser(`/mypage/quotes/${id}`);
  const store = await getStore();
  const detail = await store.getQuote(id, user);
  if (!detail) notFound();
  const { quote, items, request } = detail;

  return (
    <Section className="py-10 sm:py-14">
      <Container className="max-w-4xl">
        <Link href="/mypage" className="text-sm text-ink-soft underline-offset-4 hover:underline">← マイページへ戻る</Link>
        {requested && (
          <Alert tone="success" title="見積依頼を受け付けました" className="mt-4">
            工場生産分（本体・オプション）の概算見積書（PDF）を発行しました。別途工事（運送・現地工事）は設置場所の条件を確認のうえ、代理店よりお見積りします。
          </Alert>
        )}
        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Quote</p>
            <h1 className="mt-1 text-3xl sm:text-4xl">
              見積書 <span className="font-mono text-2xl" data-testid="quote-no">{quote.quote_no}</span>
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              発行日 {formatDate(quote.issued_at)}　有効期限 {formatDate(quote.valid_until)}
              {quote.customer_no && <>　顧客番号 <span className="font-mono">{quote.customer_no}</span></>}
            </p>
          </div>
          <Badge tone={quote.status === 'issued' ? 'navy' : quote.status === 'accepted' ? 'success' : 'neutral'} className="text-sm">{QUOTE_STATUS_LABELS[quote.status]}</Badge>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-primary" data-testid="pdf-view">
            <FileText className="size-4" aria-hidden="true" />
            見積書PDFを表示
          </a>
          <a href={`/api/quotes/${quote.id}/pdf?download=1`} className="btn-secondary" data-testid="pdf-download">
            <Download className="size-4" aria-hidden="true" />
            ダウンロード
          </a>
        </div>

        <div className="card mt-8 overflow-hidden">
          {quote.preview_image_url && (
            <div className="relative aspect-[16/7] bg-sand">
              <SmartImage src={quote.preview_image_url} alt="完成イメージ" fill sizes="(min-width: 896px) 56rem, 100vw" className="object-cover" />
              <span className="absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1 text-xs text-white">完成イメージ（参考）</span>
            </div>
          )}
          <div className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8">
            <div>
              <p className="text-xs text-muted">お客様</p>
              <p className="text-lg">
                {quote.customer_company && <span className="block">{quote.customer_company}</span>}
                {quote.customer_name} 様
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">件名</p>
              <p className="text-lg">折り畳み式木造コンテナ {quote.base_model_name} 一式（工場生産分）</p>
            </div>
          </div>
          <QuoteTable quote={quote} items={items} />
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="card p-6 text-sm">
            <p className="font-semibold">注意事項</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
              {COMPANY.quoteNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-6">
            <div className="card p-6 text-sm">
              <p className="font-semibold">お支払い</p>
              <dl className="mt-2 space-y-1 text-ink-soft">
                <div><dt className="inline text-muted">支払条件：</dt><dd className="inline">{COMPANY.paymentTerms}</dd></div>
                <div><dt className="inline text-muted">振込先：</dt><dd className="inline">{COMPANY.bank.name} {COMPANY.bank.type} {COMPANY.bank.number} {COMPANY.bank.holder}</dd></div>
                <div><dt className="inline text-muted">登録番号：</dt><dd className="inline">{COMPANY.invoiceRegistrationNo}</dd></div>
              </dl>
            </div>
            <div className="card p-6 text-sm">
              <p className="font-semibold">ご依頼内容</p>
              <dl className="mt-2 space-y-1 text-ink-soft">
                <div><dt className="inline text-muted">設置予定地：</dt><dd className="inline">{request?.contact.site_address || '未記入'}</dd></div>
                <div><dt className="inline text-muted">ご要望：</dt><dd className="inline whitespace-pre-wrap">{request?.message || '—'}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
