import Link from 'next/link';
import { Copy, FileText, Pencil, Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { signOutAction } from '@/lib/actions/auth';
import { duplicateConfigurationAction } from '@/lib/actions/configurations';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import {
  ROLE_LABELS,
  canEditDealerItems,
  CONFIGURATION_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  type Configuration,
  type Quote,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, ButtonLink, Container, Section } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { DeleteConfigurationButton } from '@/components/mypage/delete-button';

const CUSTOMER_FLOW = [
  'プランを作る',
  '見積を依頼',
  '現地を確認',
  '確定見積が届く',
  '見積を確認',
  '契約手続き',
  '製造・施工',
  '引渡し・アフター',
] as const;

function customerProgress(quote: Quote | undefined, configurationStatus: Configuration['status'] = 'draft') {
  if (!quote && configurationStatus !== 'draft') {
    return {
      index: 1,
      title: '見積依頼を受け付けました',
      nextAction: '担当からのご案内をお待ちください。',
      description: '見積内容を確認し、現地確認へ進む準備をしています。',
    };
  }
  if (!quote) {
    return {
      index: 0,
      title: 'プランを作成中です',
      nextAction: '内容が決まったら見積を依頼してください。',
      description: '仕様を確認し、内容が決まったら見積を依頼できます。',
    };
  }
  if (quote.status === 'accepted' && quote.revision === 1) {
    return {
      index: 2,
      title: '概算見積の確認を受け付けました',
      nextAction: '担当からの現地確認のご案内をお待ちください。',
      description: 'この見積は現地確認前です。担当が現地条件を確認した後、施工金額を反映した確定見積をご案内します。',
    };
  }
  if (quote.status === 'accepted') {
    return {
      index: 5,
      title: '確定見積を確認済みです',
      nextAction: '契約条件と必要資料について、担当からの案内をご確認ください。',
      description: '契約手続きへ進む段階です。',
    };
  }
  if (quote.status === 'declined' || quote.status === 'cancelled') {
    return {
      index: 4,
      title: quote.status === 'declined' ? '今回は見送り済みです' : 'この見積はキャンセルされています',
      nextAction: '必要な場合は、保存したプランを複製して改めて検討できます。',
      description: 'この案件の進行は停止しています。',
    };
  }
  if (quote.revision > 1) {
    return {
      index: 4,
      title: '確定見積をご確認ください',
      nextAction: '確定見積の内容をご確認ください。',
      description: '担当が現地条件と施工金額を反映した見積です。',
    };
  }
  return {
    index: 2,
    title: '現地条件を確認しています',
    nextAction: '担当からの現地確認のご案内をお待ちください。',
    description: '現在は概算見積です。担当が現地条件を確認した後、施工金額を反映した確定見積をご案内します。',
  };
}

function quoteKindLabel(quote: Quote) {
  if (quote.status === 'superseded') return '旧版';
  return quote.revision > 1 ? '確定見積' : '概算見積';
}

function siteLocationLabel(configuration: Configuration) {
  if (configuration.site_location_undecided) return '未定';
  const location = [configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join('');
  return location || '未登録';
}

function CustomerProgressFlow({ progress }: { progress: ReturnType<typeof customerProgress> }) {
  return (
    <div className="overflow-x-auto" data-testid="customer-progress-flow">
      <div className="flex min-w-[50rem] items-stretch">
        {CUSTOMER_FLOW.map((label, index) => {
          const state = index < progress.index ? 'done' : index === progress.index ? 'current' : 'pending';
          const className =
            state === 'done'
              ? 'border-[#b8d3c4] bg-[#eef7f1] text-[#2f6b4f]'
              : state === 'current'
                ? 'border-[#d7aa4d] bg-[#fff4cf] text-[#765b11] ring-2 ring-[#e8cc88]/45'
                : 'border-line bg-[#f7f8f8] text-muted';
          const arrowClass =
            state === 'done'
              ? 'text-[#78a087]'
              : state === 'current'
                ? 'text-[#c59b43]'
                : 'text-[#c8cfcb]';
          return (
            <div key={label} className="flex min-w-0 flex-1 items-center">
              <div
                className={`flex min-h-[4.25rem] min-w-0 flex-1 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center ${className}`}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <p className="text-xs font-semibold">
                  {state === 'done' ? '✓ ' : state === 'current' ? '● ' : ''}
                  {label}
                </p>
                {state === 'current' && (
                  <span className="mt-1 rounded-full bg-white/75 px-2 py-0.5 text-[0.58rem] font-semibold">今ここ</span>
                )}
              </div>
              {index < CUSTOMER_FLOW.length - 1 && (
                <span
                  className={`flex w-5 shrink-0 items-center justify-center text-base font-bold ${arrowClass}`}
                  aria-hidden="true"
                  data-testid="customer-progress-arrow"
                >
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
  const activeCases = configurations
    .map((configuration) => ({ configuration, quote: quoteByConfig.get(configuration.id) }))
    .filter(({ configuration, quote }) => {
      if (quote) return !['declined', 'cancelled', 'superseded'].includes(quote.status);
      return configuration.status === 'quote_requested' || configuration.status === 'quoted';
    });
  const savedPlans = configurations.filter(
    (configuration) => configuration.status === 'draft' && !quoteByConfig.has(configuration.id)
  );

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

        <section className="mt-10" aria-labelledby="cases-heading" data-testid="active-case-section">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="cases-heading" className="text-2xl">進行中の案件</h2>
              <p className="mt-1 text-sm text-ink-soft">
                見積依頼後の案件について、現在地・次にすること・設置場所を確認できます。
              </p>
            </div>
          </div>

          {activeCases.length === 0 ? (
            <div className="card mt-5 p-8 text-center">
              <p className="text-ink-soft">進行中の案件はありません。</p>
              <p className="mt-1 text-xs text-muted">保存したプランから見積を依頼すると、こちらに表示されます。</p>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {activeCases.map(({ configuration, quote }) => {
                const progress = customerProgress(quote, configuration.status);
                const slug = slugOf.get(configuration.base_model_id) ?? '';
                const location = siteLocationLabel(configuration);
                return (
                  <article key={configuration.id} className="card overflow-hidden" data-testid="active-case-card">
                    <div className="grid lg:grid-cols-[14rem_1fr]">
                      <div className="relative min-h-[11rem] bg-sand lg:min-h-full">
                        {configuration.preview_image_url ? (
                          <SmartImage
                            src={configuration.preview_image_url}
                            alt={`${configuration.name} の完成イメージ`}
                            fill
                            sizes="(min-width: 1024px) 14rem, 100vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full min-h-[11rem] items-center justify-center text-sm text-muted">画像なし</div>
                        )}
                      </div>

                      <div className="min-w-0 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl">{configuration.name}</h3>
                              <Badge tone="navy">{quote ? quoteKindLabel(quote) : '見積依頼受付中'}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted">
                              {nameOf.get(configuration.base_model_id) ?? quote?.base_model_name ?? '商品モデル'}
                            </p>
                          </div>
                          {quote && (
                            <Link href={`/mypage/quotes/${quote.id}`} className="btn-primary btn-sm">
                              案件の内容を見る
                            </Link>
                          )}
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="rounded-lg bg-[#f7f9f8] p-3">
                            <p className="text-xs text-muted">今ここ</p>
                            <p className="mt-1 font-semibold text-[#765b11]">{CUSTOMER_FLOW[progress.index]}</p>
                          </div>
                          <div className="rounded-lg bg-[#f7f9f8] p-3">
                            <p className="text-xs text-muted">設置場所</p>
                            <p className="mt-1 font-semibold">{location}</p>
                          </div>
                          <div className="rounded-lg bg-[#f7f9f8] p-3">
                            <p className="text-xs text-muted">現在の見積</p>
                            <p className="mt-1 font-semibold">
                              {quote ? `${quoteKindLabel(quote)} ${formatYen(quote.total)}` : '準備中'}
                            </p>
                          </div>
                          <div className="rounded-lg bg-[#f7f9f8] p-3">
                            <p className="text-xs text-muted">担当代理店</p>
                            <p className="mt-1 font-semibold">{quote?.dealer_id ? '決定済み' : '調整中'}</p>
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-[#ead7a8] bg-[#fff9e9] px-4 py-3">
                          <p className="text-xs font-semibold text-[#8a6416]">次にすること</p>
                          <p className="mt-1 font-semibold text-ink">{progress.nextAction}</p>
                          <p className="mt-1 text-xs leading-5 text-ink-soft">{progress.description}</p>
                        </div>

                        <div className="mt-4">
                          <CustomerProgressFlow progress={progress} />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/simulator/${slug}?c=${configuration.id}`} className="btn-ghost btn-sm">
                            プランを見る
                          </Link>
                          {quote && (
                            <a
                              href={`/api/quotes/${quote.id}/pdf`}
                              target="_blank"
                              rel="noopener"
                              className="btn-secondary btn-sm"
                            >
                              <FileText className="size-4" aria-hidden="true" />
                              見積PDF
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-12" aria-labelledby="configs-heading" data-testid="saved-plan-section">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="configs-heading" className="text-2xl">保存したプラン</h2>
              <p className="mt-1 text-sm text-ink-soft">まだ見積を依頼していない、検討中のプランです。</p>
            </div>
            {savedPlans.length > 0 && (
              <ButtonLink href={models[0] ? `/simulator/${models[0].slug}` : '/products'} size="sm">
                <Plus className="size-4" aria-hidden="true" />
                新しく作る
              </ButtonLink>
            )}
          </div>

          {savedPlans.length === 0 ? (
            <div className="card mt-5 p-8 text-center">
              <p className="text-ink-soft">検討中の保存プランはありません。</p>
              <ButtonLink href={models[0] ? `/simulator/${models[0].slug}` : '/products'} className="mt-4">
                新しいプランを作る
              </ButtonLink>
            </div>
          ) : (
            <ul className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="configuration-list">
              {savedPlans.map((configuration) => {
                const slug = slugOf.get(configuration.base_model_id) ?? '';
                return (
                  <li key={configuration.id} className="card flex flex-col overflow-hidden" data-testid="configuration-card">
                    <div className="relative aspect-[16/10] bg-sand">
                      {configuration.preview_image_url ? (
                        <SmartImage
                          src={configuration.preview_image_url}
                          alt={`${configuration.name} の完成イメージ`}
                          fill
                          sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted">画像なし</div>
                      )}
                      <Badge tone="neutral" className="absolute left-3 top-3">
                        {CONFIGURATION_STATUS_LABELS[configuration.status]}
                      </Badge>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="truncate text-lg" title={configuration.name}>{configuration.name}</h3>
                      <p className="text-xs text-muted">{nameOf.get(configuration.base_model_id)}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-soft">
                        <dt>設置場所</dt>
                        <dd className="text-right">{siteLocationLabel(configuration)}</dd>
                        <dt>更新日</dt>
                        <dd className="text-right">{formatDate(configuration.updated_at)}</dd>
                      </dl>
                      <p className="mt-3 flex items-baseline justify-between">
                        <span className="text-xs text-muted">概算合計（税込）</span>
                        <span className="font-serif text-2xl">{formatYen(configuration.total)}</span>
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Link
                          href={`/simulator/${slug}?c=${configuration.id}`}
                          className="btn-primary btn-sm"
                          data-testid="edit-link"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          編集を再開
                        </Link>
                        <Link
                          href={`/mypage/configurations/${configuration.id}/request-quote`}
                          className="btn-secondary btn-sm"
                          data-testid="request-quote-link"
                        >
                          見積を依頼
                        </Link>
                        <form action={duplicateConfigurationAction}>
                          <input type="hidden" name="id" value={configuration.id} />
                          <button type="submit" className="btn-ghost btn-sm w-full" data-testid="duplicate-button">
                            <Copy className="size-4" aria-hidden="true" />
                            複製
                          </button>
                        </form>
                        <DeleteConfigurationButton id={configuration.id} name={configuration.name} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {quotes.length > 0 && (
          <section className="mt-14" aria-labelledby="quotes-heading">
            <h2 id="quotes-heading" className="text-2xl">見積履歴</h2>
            <details className="card mt-5 overflow-hidden">
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-ink">
                過去を含む見積を確認（{quotes.length}件）
              </summary>
              <div className="overflow-x-auto border-t border-line">
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
                    {quotes.map((quote) => (
                      <tr key={quote.id} data-testid="quote-row">
                        <td className="px-4 py-3 font-mono">{quote.quote_no}</td>
                        <td className="px-4 py-3">{formatDate(quote.issued_at)}</td>
                        <td className="px-4 py-3">{formatDate(quote.valid_until)}</td>
                        <td className="px-4 py-3">{quote.base_model_name}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatYen(quote.total)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={quote.revision > 1 && quote.status !== 'superseded' ? 'success' : 'neutral'}>
                              {quoteKindLabel(quote)}
                            </Badge>
                            <span className="text-xs text-ink-soft">{QUOTE_STATUS_LABELS[quote.status]}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Link href={`/mypage/quotes/${quote.id}`} className="btn-ghost btn-sm">詳細</Link>
                          <a
                            href={`/api/quotes/${quote.id}/pdf`}
                            target="_blank"
                            rel="noopener"
                            className="btn-secondary btn-sm ml-1"
                          >
                            PDF
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}
      </Container>
    </Section>
  );
}
