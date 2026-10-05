import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore, type AccessibleCustomerCase } from '@/lib/data/store';
import {
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { Badge } from '@/components/ui';

function caseStatus(customerCase: AccessibleCustomerCase): string {
  if (customerCase.latest_quote) return QUOTE_STATUS_LABELS[customerCase.latest_quote.status];
  if (customerCase.request_status) return QUOTE_REQUEST_STATUS_LABELS[customerCase.request_status];
  return '状態未登録';
}

function caseStatusTone(customerCase: AccessibleCustomerCase): 'neutral' | 'success' | 'warn' | 'navy' {
  if (customerCase.latest_quote?.status === 'accepted') return 'success';
  if (customerCase.request_status === 'new') return 'warn';
  if (customerCase.ongoing) return 'navy';
  return 'neutral';
}

function siteSourceLabel(customerCase: AccessibleCustomerCase): string {
  if (customerCase.site_source === 'quote_contact') return '案件受付情報';
  if (customerCase.site_source === 'configuration') return '保存済み仕様';
  return '未登録';
}

function caseHref(customerCase: AccessibleCustomerCase): string {
  if (customerCase.open_quote_id) {
    return `/admin/quotes?case=${encodeURIComponent(customerCase.open_quote_id)}#case-workspace`;
  }
  return `/admin/quotes?request=${encodeURIComponent(customerCase.id)}#pending-quote-request`;
}

function CaseTable({
  cases,
  emptyLabel,
}: {
  cases: AccessibleCustomerCase[];
  emptyLabel: string;
}) {
  return (
    <Table minWidth="40rem">
      <thead className="bg-sand/60">
        <tr>
          <Th>案件</Th>
          <Th>設置予定地</Th>
          <Th>担当代理店</Th>
          <Th>最終更新</Th>
          <Th>確認</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {cases.length === 0 ? (
          <tr>
            <Td colSpan={5} className="py-8 text-center text-sm text-muted">{emptyLabel}</Td>
          </tr>
        ) : (
          cases.map((customerCase) => (
            <tr key={customerCase.id} data-testid="customer-case-row">
              <Td>
                <p className="font-semibold">{customerCase.latest_quote?.quote_no ?? '見積未発行'}</p>
                <p className="mt-1 text-xs text-muted">{customerCase.model_name ?? '商品モデル未登録'}</p>
                <div className="mt-2">
                  <Badge tone={caseStatusTone(customerCase)}>{caseStatus(customerCase)}</Badge>
                </div>
                {customerCase.message && (
                  <p className="mt-1 max-w-64 truncate text-xs text-muted">{customerCase.message}</p>
                )}
              </Td>
              <Td className="text-xs">
                <span className="block">{customerCase.site_address ?? '未登録'}</span>
                <span className="mt-1 block text-muted">{siteSourceLabel(customerCase)}</span>
              </Td>
              <Td className="text-xs">
                {customerCase.dealer_company || customerCase.dealer_name ? (
                  <>
                    <span className="block font-semibold">{customerCase.dealer_company ?? '代理店名未登録'}</span>
                    <span className="mt-1 block text-muted">
                      {customerCase.dealer_name ? <>担当：{customerCase.dealer_name}</> : '担当者未割り当て'}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">未割り当て</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-xs">{formatDate(customerCase.activity_at, true)}</Td>
              <Td>
                <Link href={caseHref(customerCase)} className="btn-secondary btn-sm whitespace-nowrap">案件を見る</Link>
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaff('/admin/customer-management');
  const { id } = await params;
  const store = await getStore();
  const detailResult = await store.getAccessibleCustomerDetail(id, actor);

  if (detailResult.availability === 'migration_pending') {
    return (
      <AdminPage
        title="顧客管理"
        lead="顧客詳細は本番DB更新後に表示されます。"
        notice={
          <div className="space-y-1">
            <p className="font-semibold text-ink">本番DB更新待ちです。</p>
            <p>
              顧客管理用のDB機能がまだ本番へ適用されていないため、顧客詳細は取得していません。
            </p>
          </div>
        }
      >
        <BackLink href="/admin/customer-management" label="顧客一覧へ戻る" />
        <section className="card p-5" data-testid="customer-detail-migration-pending">
          <p className="text-sm leading-6 text-ink-soft">
            顧客が存在しないという意味ではありません。DB更新後に顧客一覧から改めて開いてください。
          </p>
        </section>
      </AdminPage>
    );
  }

  const detail = detailResult.detail;
  if (!detail) notFound();

  const profile = detail.customer;
  const contact = detail.latest_contact;
  const ongoingCases = detail.cases.filter((customerCase) => customerCase.ongoing);
  const pastCases = detail.cases.filter((customerCase) => !customerCase.ongoing);
  const siteCases = detail.cases.filter((customerCase) => customerCase.site_address);

  return (
    <AdminPage
      title={profile.full_name || '顧客詳細'}
      lead="参照権限のある案件だけを、顧客単位で確認する画面です。編集や顧客統合は行いません。"
      actions={
        <Link href="/admin/quotes" className="btn-secondary btn-sm">
          案件管理を開く
        </Link>
      }
      notice={
        <div className="space-y-1">
          <p className="font-semibold text-ink">この画面は現在の顧客情報を確認する場所です。</p>
          <p>
            発行済みの正式見積は発行時点の情報を保持し、現在の顧客情報が変わってもこの画面から過去の見積内容を書き換えません。
            総代理店・代理店には、自分が担当する案件系列に由来する情報だけを表示します。
          </p>
        </div>
      }
    >
      <BackLink href="/admin/customer-management" label="顧客一覧へ戻る" />

      <section className="space-y-3" aria-labelledby="customer-basic-heading">
        <div>
          <h2 id="customer-basic-heading" className="text-lg font-semibold">基本情報</h2>
          <p className="mt-1 text-xs text-muted">
            現在のお客様情報を中心に、最新案件の受付時情報を分けて確認します。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5" data-testid="customer-profile-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">現在の顧客情報</h3>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">顧客名</dt>
                <dd className="mt-1 font-semibold">{profile.full_name || '未登録'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">法人名</dt>
                <dd className="mt-1">{profile.company_name ?? '未登録'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">メール</dt>
                <dd className="mt-1 break-all">{profile.email || '未登録'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">電話</dt>
                <dd className="mt-1">{profile.phone ?? '未登録'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted">住所</dt>
                <dd className="mt-1">
                  {[profile.postal_code, profile.address].filter(Boolean).join(' ') || '未登録'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">顧客番号</dt>
                <dd className="mt-1">{profile.customer_no ?? '未登録'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">登録日</dt>
                <dd className="mt-1">{formatDate(profile.created_at)}</dd>
              </div>
            </dl>
          </div>

          <div className="card p-5" data-testid="customer-quote-contact-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">最新案件受付情報</h3>
              <Badge tone="neutral">案件受付時</Badge>
            </div>
            {contact ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">お客様名</dt>
                  <dd className="mt-1 font-semibold">{contact.full_name || '未登録'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">法人名</dt>
                  <dd className="mt-1">{contact.company_name ?? '未登録'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">メール</dt>
                  <dd className="mt-1 break-all">{contact.email || '未登録'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">電話</dt>
                  <dd className="mt-1">{contact.phone || '未登録'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted">住所</dt>
                  <dd className="mt-1">{contact.address || '未登録'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted">案件受付時の設置予定地</dt>
                  <dd className="mt-1">{contact.site_address || '未登録'}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted">参照可能な案件受付情報はまだありません。</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="ongoing-cases-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="ongoing-cases-heading" className="text-lg font-semibold">進行中案件</h2>
            <p className="mt-1 text-xs text-muted">参照可能な案件のうち、現在の案件フロー上で継続中のものです。</p>
          </div>
          <Badge tone={ongoingCases.length > 0 ? 'navy' : 'neutral'}>{ongoingCases.length} 件</Badge>
        </div>
        <CaseTable cases={ongoingCases} emptyLabel="進行中案件はありません。" />
      </section>

      <section className="space-y-3" aria-labelledby="past-cases-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="past-cases-heading" className="text-lg font-semibold">過去案件</h2>
            <p className="mt-1 text-xs text-muted">参照可能な案件のうち、既存状態から継続中ではないと判断できるものです。</p>
          </div>
          <Badge tone="neutral">{pastCases.length} 件</Badge>
        </div>
        <CaseTable cases={pastCases} emptyLabel="過去案件はありません。" />
      </section>

      <section className="space-y-3" aria-labelledby="quote-history-heading">
        <div>
          <h2 id="quote-history-heading" className="text-lg font-semibold">見積履歴</h2>
          <p className="mt-1 text-xs text-muted">
            正式見積の改訂履歴を確認する領域です。発行済みの見積は発行時点の記録として扱い、現在の顧客情報には自動追従させません。
          </p>
        </div>
        <Table minWidth="34rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>見積</Th>
              <Th>発行日</Th>
              <Th>金額（税込）</Th>
              <Th>確認</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {detail.quote_history.length === 0 ? (
              <tr>
                <Td colSpan={4} className="py-8 text-center text-sm text-muted">見積履歴はありません。</Td>
              </tr>
            ) : (
              detail.quote_history.map((quote) => (
                <tr key={quote.id} data-testid="customer-quote-history-row">
                  <Td>
                    <p className="font-semibold">{quote.quote_no}</p>
                    <p className="mt-1 text-xs text-muted">{quote.base_model_name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">第{quote.revision}版</span>
                      <Badge tone={quote.status === 'accepted' ? 'success' : 'neutral'}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(quote.issued_at)}</Td>
                  <Td right className="whitespace-nowrap">{formatYen(quote.total)}</Td>
                  <Td>
                    {quote.can_open_quote ? (
                      <Link
                        href={`/admin/quotes/${encodeURIComponent(quote.id)}`}
                        className="text-xs font-semibold underline-offset-4 hover:underline"
                      >
                        見積書を見る
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">履歴のみ</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </section>

      <section className="space-y-3" aria-labelledby="customer-sites-heading">
        <div>
          <h2 id="customer-sites-heading" className="text-lg font-semibold">設置予定地</h2>
          <p className="mt-1 text-xs text-muted">
            参照可能な案件について、案件受付時の設置予定地を優先し、未登録時だけ保存済み仕様から参照します。
          </p>
        </div>
        {siteCases.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {siteCases.map((customerCase) => (
              <div key={customerCase.id} className="card p-4" data-testid="customer-site-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted">{customerCase.latest_quote?.quote_no ?? '見積未発行'}</p>
                    <p className="mt-1 font-semibold">{customerCase.site_address}</p>
                  </div>
                  <Badge tone="neutral">{siteSourceLabel(customerCase)}</Badge>
                </div>
                <Link
                  href={caseHref(customerCase)}
                  className="mt-3 inline-block text-xs font-semibold underline-offset-4 hover:underline"
                >
                  この案件を見る
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-4 text-sm text-muted">参照可能な案件に設置予定地はありません。</div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="customer-future-heading">
        <div>
          <h2 id="customer-future-heading" className="text-lg font-semibold">契約・所有Wing・アフター</h2>
          <p className="mt-1 text-xs text-muted">
            顧客から販売後まで同じ流れで確認できるよう、将来の配置場所だけ示しています。現在は正式データを表示しません。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3" data-testid="customer-future-sections">
          {[
            ['契約', '正式な契約データモデル実装後に、契約状態・契約日・対象見積等を表示します。'],
            ['所有中Wing', '完成個体・所有者・設置先を管理する正式データモデル実装後に表示します。'],
            ['アフター', '保証・点検・修理・問い合わせ履歴の正式データモデル実装後に表示します。'],
          ].map(([title, body]) => (
            <div key={title} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{title}</h3>
                <Badge tone="neutral">準備中</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </AdminPage>
  );
}
