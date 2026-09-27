import Link from 'next/link';
import { Copy, FileText, Pencil, Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { signOutAction } from '@/lib/actions/auth';
import { duplicateConfigurationAction } from '@/lib/actions/configurations';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { ROLE_LABELS, canEditDealerItems, CONFIGURATION_STATUS_LABELS, QUOTE_STATUS_LABELS, type Quote } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, ButtonLink, Container, Section } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { DeleteConfigurationButton } from '@/components/mypage/delete-button';

const CUSTOMER_FLOW = [
  'プラン作成',
  '見積依頼',
  '現地確認',
  '確定見積',
  'お客様確認',
  '契約',
  '製造・施工',
  '引渡し・アフター',
] as const;

function customerProgress(quote: Quote | undefined) {
  if (!quote) {
    return {
      index: 0,
      title: 'プランを作成中です',
      description: '仕様を確認し、内容が決まったら見積を依頼できます。',
    };
  }
  if (quote.status === 'accepted') {
    return {
      index: 5,
      title: '見積を承諾済みです',
      description: '契約条件と必要資料について、担当からの案内をご確認ください。',
    };
  }
  if (quote.status === 'declined' || quote.status === 'cancelled') {
    return {
      index: 4,
      title: quote.status === 'declined' ? '今回は見送り済みです' : 'この見積はキャンセルされています',
      description: '必要な場合は、保存したプランを複製して改めて検討できます。',
    };
  }
  if (quote.revision > 1) {
    return {
      index: 4,
      title: '確定見積をご確認ください',
      description: '担当が現地条件と施工金額を反映した見積です。内容をご確認ください。',
    };
  }
  return {
    index: 2,
    title: '現地条件を確認しています',
    description: '現在は概算見積です。担当が現地条件を確認した後、施工金額を反映した確定見積をご案内します。',
  };
}

function quoteKindLabel(quote: Quote) {
  if (quote.status === 'superseded') return '旧版';
  return quote.revision > 1 ? '確定見積' : '概算見積';
}

export default async function MypagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('/mypage');
  const sp = await searchParams;
  const store = await getStore();
  const [configurations, quotes, quoteByConfig, models, profile] = await Promise.all([
    store.listConfigurations(user.id),
    store.listQuotes(user.id),
    store.listQuotesByConfiguration(user.id),
    store.listModels({ includeDraft: true }),
    store.getProfile(user.id),
  ]);
  const slugOf = new Map(models.map((m) => [m.id, m.slug]));
  const nameOf = new Map(models.map((m) => [m.id, m.name]));
  const latestQuote = quotes.find((quote) => quote.status !== 'superseded') ?? quotes[0];
  const latestCaseConfiguration =
    configurations.find((configuration) => configuration.id === latestQuote?.configuration_id) ?? configurations[0];
  const progress = customerProgress(latestQuote);

  return (
    <Section className="py-10 sm:py-14">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">My page</p>
            <h1 className="mt-1 text-3xl sm:text-4xl">マイページ</h1>
            <p className="mt-2 text-ink-soft">
              {profile?.full_name || user.email} さん{profile?.company_name ? `（${profile.company_name}）` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/mypage/profile" className="btn-ghost btn-sm">登録情報の変更</Link>
            {canEditDealerItems(user.role) && <Link href="/admin" className="btn-secondary btn-sm" data-testid="to-admin">管理画面へ</Link>}
            <form action={signOutAction}>
              <button type="submit" className="btn-ghost btn-sm" data-testid="logout-button">ログアウト</button>
            </form>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {canEditDealerItems(user.role) && user.role !== 'admin' && (
            <Alert tone="info" title={`${ROLE_LABELS[user.role]}としてログインしています`}>
              担当の見積・フリー商品・商品台帳は
              <Link href="/admin" className="mx-1 font-semibold underline">
                管理画面
              </Link>
              から操作します。このページはご自身が見積を検討するときに使います。
            </Alert>
          )}
          {sp.forbidden && <Alert tone="warn">管理画面へのアクセス権限がありません。</Alert>}
          {sp.password === 'updated' && <Alert tone="success">パスワードを更新しました。</Alert>}
          {sp.duplicated && <Alert tone="success">仕様を複製しました。</Alert>}
          {sp.deleted && <Alert tone="success">仕様を削除しました。</Alert>}
          {sp.profile === 'updated' && <Alert tone="success">登録情報を更新しました。</Alert>}
          {sp.error && <Alert tone="danger">{sp.error}</Alert>}
        </div>

        {latestCaseConfiguration && (
          <section className="mt-10" aria-labelledby="progress-heading" data-testid="customer-case-progress">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="progress-heading" className="text-2xl">案件の進み具合</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {latestCaseConfiguration.name} の現在地と、次に確認する内容です。
                </p>
              </div>
              {latestQuote && (
                <Link href={`/mypage/quotes/${latestQuote.id}`} className="btn-secondary btn-sm">
                  見積を見る
                </Link>
              )}
            </div>

            <div className="card mt-5 overflow-hidden">
              <div className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-4 lg:grid-cols-8">
                {CUSTOMER_FLOW.map((label, index) => {
                  const state = index < progress.index ? 'done' : index === progress.index ? 'current' : 'pending';
                  const className =
                    state === 'done'
                      ? 'border-[#b8d3c4] bg-[#eef7f1] text-[#2f6b4f]'
                      : state === 'current'
                        ? 'border-[#e4c47f] bg-[#fff7df] text-[#8a5a20]'
                        : 'border-line bg-[#f7f8f8] text-muted';
                  return (
                    <div key={label} className={`rounded-lg border px-2 py-2 text-center ${className}`}>
                      <p className="text-xs font-semibold">
                        {state === 'done' ? '✓ ' : state === 'current' ? '● ' : ''}
                        {label}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-line bg-[#fbfcfb] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{progress.title}</p>
                  {latestQuote && (
                    <Badge tone={latestQuote.revision > 1 ? 'success' : 'neutral'}>
                      {quoteKindLabel(latestQuote)}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-soft">{progress.description}</p>
              </div>
            </div>
          </section>
        )}

        <section className="mt-10" aria-labelledby="configs-heading">
          <div className="flex items-center justify-between">
            <h2 id="configs-heading" className="text-2xl">保存したプラン</h2>
            {configurations.length > 0 && (
              <ButtonLink href={models[0] ? `/simulator/${models[0].slug}` : '/products'} size="sm">
                <Plus className="size-4" aria-hidden="true" />
                新しく作る
              </ButtonLink>
            )}
          </div>
          {configurations.length === 0 ? (
            <div className="card mt-5 p-10 text-center">
              <p className="text-ink-soft">保存したプランはまだありません。</p>
              <ButtonLink href={models[0] ? `/simulator/${models[0].slug}` : '/products'} className="mt-5">見積シミュレーションを始める</ButtonLink>
            </div>
          ) : (
            <ul className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="configuration-list">
              {configurations.map((c) => {
                const quote = quoteByConfig.get(c.id);
                const slug = slugOf.get(c.base_model_id) ?? '';
                const editable = c.status === 'draft';
                return (
                  <li key={c.id} className="card flex flex-col overflow-hidden" data-testid="configuration-card">
                    <div className="relative aspect-[16/10] bg-sand">
                      {c.preview_image_url ? (
                        <SmartImage src={c.preview_image_url} alt={`${c.name} の完成イメージ`} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted">画像なし</div>
                      )}
                      <Badge tone={c.status === 'draft' ? 'neutral' : c.status === 'closed' ? 'success' : 'navy'} className="absolute top-3 left-3">
                        {CONFIGURATION_STATUS_LABELS[c.status]}
                      </Badge>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="truncate text-lg" title={c.name}>{c.name}</h3>
                      <p className="text-xs text-muted">{nameOf.get(c.base_model_id)}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-soft">
                        <dt>見積番号</dt>
                        <dd className="text-right">{quote?.quote_no ?? '未発行'}</dd>
                        <dt>作成日</dt>
                        <dd className="text-right">{formatDate(c.created_at)}</dd>
                        <dt>更新日</dt>
                        <dd className="text-right">{formatDate(c.updated_at)}</dd>
                      </dl>
                      <p className="mt-3 flex items-baseline justify-between">
                        <span className="text-xs text-muted">概算合計（税込）</span>
                        <span className="font-serif text-2xl">{formatYen(c.total)}</span>
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Link href={`/simulator/${slug}?c=${c.id}`} className={editable ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} data-testid="edit-link">
                          <Pencil className="size-4" aria-hidden="true" />
                          {editable ? '編集を再開' : '仕様を見る'}
                        </Link>
                        {editable ? (
                          <Link href={`/mypage/configurations/${c.id}/request-quote`} className="btn-secondary btn-sm" data-testid="request-quote-link">
                            見積を依頼
                          </Link>
                        ) : quote ? (
                          <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm" data-testid="pdf-link">
                            <FileText className="size-4" aria-hidden="true" />
                            見積書PDF
                          </a>
                        ) : (
                          <span />
                        )}
                        <form action={duplicateConfigurationAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="btn-ghost btn-sm w-full" data-testid="duplicate-button">
                            <Copy className="size-4" aria-hidden="true" />
                            複製
                          </button>
                        </form>
                        {/* 見積を発行した仕様は見積書が参照しているので消せない */}
                        {quote ? (
                          <p className="self-center text-center text-xs text-muted">見積発行済みのため削除できません</p>
                        ) : (
                          <DeleteConfigurationButton id={c.id} name={c.name} />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-14" aria-labelledby="quotes-heading">
          <h2 id="quotes-heading" className="text-2xl">見積依頼履歴</h2>
          {quotes.length === 0 ? (
            <p className="card mt-5 p-8 text-center text-ink-soft">見積依頼はまだありません。</p>
          ) : (
            <div className="card mt-5 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-sand/60 text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">見積番号</th>
                    <th className="px-4 py-3 font-semibold">発行日</th>
                    <th className="px-4 py-3 font-semibold">有効期限</th>
                    <th className="px-4 py-3 font-semibold">モデル</th>
                    <th className="px-4 py-3 text-right font-semibold">合計（税込）</th>
                    <th className="px-4 py-3 font-semibold">状態</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {quotes.map((q) => (
                    <tr key={q.id} data-testid="quote-row">
                      <td className="px-4 py-3 font-mono">{q.quote_no}</td>
                      <td className="px-4 py-3">{formatDate(q.issued_at)}</td>
                      <td className="px-4 py-3">{formatDate(q.valid_until)}</td>
                      <td className="px-4 py-3">{q.base_model_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatYen(q.total)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={q.revision > 1 && q.status !== 'superseded' ? 'success' : 'neutral'}>{quoteKindLabel(q)}</Badge>
                          <span className="text-xs text-ink-soft">{QUOTE_STATUS_LABELS[q.status]}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link href={`/mypage/quotes/${q.id}`} className="btn-ghost btn-sm">詳細</Link>
                        <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm ml-1">PDF</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Container>
    </Section>
  );
}
