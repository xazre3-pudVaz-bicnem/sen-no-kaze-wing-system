import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import {
  buildCustomerManagementView,
  customerCaseHref,
  customerCaseLabel,
  type CustomerCaseView,
} from '@/lib/domain/customer-management';
import {
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { Badge } from '@/components/ui';

function caseStatus(customerCase: CustomerCaseView): string {
  if (customerCase.latestQuote) return QUOTE_STATUS_LABELS[customerCase.latestQuote.status];
  if (customerCase.request) return QUOTE_REQUEST_STATUS_LABELS[customerCase.request.status];
  return '状態未登録';
}

function caseStatusTone(customerCase: CustomerCaseView): 'neutral' | 'success' | 'warn' | 'navy' {
  if (customerCase.latestQuote?.status === 'accepted') return 'success';
  if (customerCase.request?.status === 'new') return 'warn';
  if (customerCase.ongoing) return 'navy';
  return 'neutral';
}

function siteSourceLabel(customerCase: CustomerCaseView): string {
  if (customerCase.siteSource === 'quote_contact') return '案件受付情報';
  if (customerCase.siteSource === 'configuration') return '保存済み仕様';
  return '未登録';
}

function CaseTable({
  cases,
  emptyLabel,
}: {
  cases: CustomerCaseView[];
  emptyLabel: string;
}) {
  return (
    <Table minWidth="62rem">
      <thead className="bg-sand/60">
        <tr>
          <Th>案件</Th>
          <Th>状態</Th>
          <Th>商品モデル</Th>
          <Th>設置予定地</Th>
          <Th>担当代理店</Th>
          <Th>最終更新</Th>
          <Th>確認</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {cases.length === 0 ? (
          <tr>
            <Td colSpan={7} className="py-8 text-center text-sm text-muted">{emptyLabel}</Td>
          </tr>
        ) : (
          cases.map((customerCase) => (
            <tr key={customerCase.id} data-testid="customer-case-row">
              <Td>
                <p className="font-semibold">{customerCaseLabel(customerCase)}</p>
                {customerCase.request?.message && (
                  <p className="mt-1 max-w-64 truncate text-xs text-muted">{customerCase.request.message}</p>
                )}
              </Td>
              <Td>
                <Badge tone={caseStatusTone(customerCase)}>{caseStatus(customerCase)}</Badge>
              </Td>
              <Td className="text-xs">{customerCase.latestQuote?.base_model_name ?? '見積未発行'}</Td>
              <Td className="text-xs">
                <span className="block">{customerCase.siteAddress ?? '未登録'}</span>
                <span className="mt-1 block text-muted">{siteSourceLabel(customerCase)}</span>
              </Td>
              <Td className="text-xs">
                {customerCase.dealer ? (
                  <>
                    <span className="block font-semibold">{customerCase.dealer.full_name}</span>
                    <span className="mt-1 block text-muted">
                      {customerCase.dealer.company_name ?? customerCase.dealer.email}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">未割り当て</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-xs">{formatDate(customerCase.activityAt, true)}</Td>
              <Td>
                <Link href={customerCaseHref(customerCase)} className="btn-secondary btn-sm">案件を見る</Link>
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
  await requireAdmin('/admin/customer-management');
  const { id } = await params;
  const store = await getStore();
  const [profiles, quotes, requests, configurations] = await Promise.all([
    store.listProfiles(),
    store.listAllQuotes(),
    store.listQuoteRequests(),
    store.listAllConfigurations(),
  ]);
  const view = buildCustomerManagementView({ profiles, quotes, requests, configurations });
  const customer = view.customers.find((entry) => entry.profile.id === id);
  if (!customer) notFound();

  const profile = customer.profile;
  const contact = customer.latestContact;
  const siteCases = customer.cases.filter((customerCase) => customerCase.siteAddress);

  return (
    <AdminPage
      title={profile.full_name || '顧客詳細'}
      lead="既存データを user_id で紐づけた顧客・案件の参照画面です。編集や顧客統合は行いません。"
      actions={
        <Link href="/admin/quotes" className="btn-secondary btn-sm">
          案件管理を開く
        </Link>
      }
      notice={
        <div className="space-y-1">
          <p className="font-semibold text-ink">顧客情報の正本は未確定です。</p>
          <p>
            下の Profile と QuoteContact は別々の既存情報として表示しています。
            値が異なっていても、この画面では上書き・自動統合しません。
          </p>
        </div>
      }
    >
      <BackLink href="/admin/customer-management" label="顧客一覧へ戻る" />

      <section className="space-y-3" aria-labelledby="customer-basic-heading">
        <div>
          <h2 id="customer-basic-heading" className="text-lg font-semibold">基本情報</h2>
          <p className="mt-1 text-xs text-muted">
            アカウント情報と最新案件の受付情報を、出典を分けて確認します。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5" data-testid="customer-profile-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Profile（アカウント情報）</h3>
              <Badge tone="neutral">正本未決定</Badge>
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
              <h3 className="font-semibold">QuoteContact（最新案件受付情報）</h3>
              <Badge tone="neutral">正本未決定</Badge>
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
              <p className="mt-4 text-sm text-muted">user_id で紐づく案件受付情報はまだありません。</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="ongoing-cases-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="ongoing-cases-heading" className="text-lg font-semibold">進行中案件</h2>
            <p className="mt-1 text-xs text-muted">新規・確認中・回答済み等、現在の案件フロー上で継続中の案件です。</p>
          </div>
          <Badge tone={customer.ongoingCases.length > 0 ? 'navy' : 'neutral'}>
            {customer.ongoingCases.length} 件
          </Badge>
        </div>
        <CaseTable cases={customer.ongoingCases} emptyLabel="進行中案件はありません。" />
      </section>

      <section className="space-y-3" aria-labelledby="past-cases-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="past-cases-heading" className="text-lg font-semibold">過去案件</h2>
            <p className="mt-1 text-xs text-muted">完了・キャンセル等、既存の案件状態から継続中ではないと判断できる案件です。</p>
          </div>
          <Badge tone="neutral">{customer.pastCases.length} 件</Badge>
        </div>
        <CaseTable cases={customer.pastCases} emptyLabel="過去案件はありません。" />
      </section>

      <section className="space-y-3" aria-labelledby="quote-history-heading">
        <div>
          <h2 id="quote-history-heading" className="text-lg font-semibold">見積履歴</h2>
          <p className="mt-1 text-xs text-muted">
            同じ案件の改訂版も別の見積履歴として表示します。発行済みの内容はここでは変更しません。
          </p>
        </div>
        <Table minWidth="58rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>見積番号</Th>
              <Th>版</Th>
              <Th>状態</Th>
              <Th>商品モデル</Th>
              <Th>発行日</Th>
              <Th>金額（税込）</Th>
              <Th>案件</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {customer.quoteHistory.length === 0 ? (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-sm text-muted">見積履歴はありません。</Td>
              </tr>
            ) : (
              customer.quoteHistory.map((quote) => (
                <tr key={quote.id} data-testid="customer-quote-history-row">
                  <Td className="font-semibold">{quote.quote_no}</Td>
                  <Td className="whitespace-nowrap">第{quote.revision}版</Td>
                  <Td><Badge tone={quote.status === 'accepted' ? 'success' : 'neutral'}>{QUOTE_STATUS_LABELS[quote.status]}</Badge></Td>
                  <Td className="text-xs">{quote.base_model_name}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(quote.issued_at)}</Td>
                  <Td right className="whitespace-nowrap">{formatYen(quote.total)}</Td>
                  <Td>
                    <Link
                      href={`/admin/quotes/${encodeURIComponent(quote.id)}`}
                      className="text-xs font-semibold underline-offset-4 hover:underline"
                    >
                      案件を見る
                    </Link>
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
            案件受付時の設置予定地を優先し、未登録の場合だけ同じ user_id の保存済み仕様から参照します。
          </p>
        </div>
        {siteCases.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {siteCases.map((customerCase) => (
              <div key={customerCase.id} className="card p-4" data-testid="customer-site-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted">{customerCaseLabel(customerCase)}</p>
                    <p className="mt-1 font-semibold">{customerCase.siteAddress}</p>
                  </div>
                  <Badge tone="neutral">{siteSourceLabel(customerCase)}</Badge>
                </div>
                <Link
                  href={customerCaseHref(customerCase)}
                  className="mt-3 inline-block text-xs font-semibold underline-offset-4 hover:underline"
                >
                  この案件を見る
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-4 text-sm text-muted">既存データに設置予定地はありません。</div>
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
