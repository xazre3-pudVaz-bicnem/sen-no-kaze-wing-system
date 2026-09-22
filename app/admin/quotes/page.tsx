import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import {
  canEditCatalog,
  FINISH_LEVEL_INFO,
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';
import { RegionFilter } from '@/components/admin/region-filter';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル仕様',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅仕様',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

function quoteStatusTone(status: keyof typeof QUOTE_STATUS_LABELS) {
  if (status === 'accepted') return 'success' as const;
  if (status === 'issued') return 'navy' as const;
  return 'neutral' as const;
}

export default async function AdminQuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();

  // 代理店は自分に割り当てられた案件だけ。既存の権限・Quote lifecycleは変更しない。
  if (!canEditCatalog(actor.role)) {
    const mine = await store.listDealerQuotes(actor.id);
    const latest = mine.filter((q) => q.status !== 'superseded');
    const details = await Promise.all(latest.map((q) => store.getQuote(q.id, actor)));
    const requestByQuoteId = new Map(
      details.flatMap((detail) => (detail?.request ? [[detail.quote.id, detail.request] as const] : []))
    );

    return (
      <AdminPage
        title="担当案件"
        lead={`割り当てられた案件 ${latest.length} 件。お客様・対象商品・現在の状態を確認し、必要な案件を開きます。`}
        actions={
          <Link href="/admin/quotes/new" className="btn-primary btn-sm" data-testid="new-quote-link">
            新規見積を作成
          </Link>
        }
      >
        <Table minWidth="68rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>お客様・案件</Th>
              <Th>対象商品・仕様</Th>
              <Th>設置予定地</Th>
              <Th>担当代理店</Th>
              <Th>現在の状態</Th>
              <Th right>見積金額</Th>
              <Th>更新・受付</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {latest.map((q) => {
              const request = requestByQuoteId.get(q.id);
              return (
                <tr key={q.id} data-testid="dealer-quote-row">
                  <Td>
                    <p className="font-semibold">{q.customer_name}</p>
                    {q.customer_company && <p className="mt-0.5 text-xs text-muted">{q.customer_company}</p>}
                    <p className="mt-1 font-mono text-xs text-muted">
                      見積番号 {q.quote_no}／第{q.revision}版
                    </p>
                  </Td>
                  <Td>
                    <p className="font-semibold">{q.base_model_name}</p>
                    <p className="mt-0.5 text-xs text-muted">注文範囲：{FINISH_LEVEL_INFO[q.finish_level].name}</p>
                  </Td>
                  <Td className="max-w-56 text-xs">{request?.contact.site_address || '—'}</Td>
                  <Td className="text-xs">担当中</Td>
                  <Td>
                    <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                    {request && (
                      <p className="mt-1 text-xs text-muted">依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}</p>
                    )}
                  </Td>
                  <Td right className="font-semibold">{formatYen(q.total)}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    <span className="block">更新 {formatDate(q.updated_at, true)}</span>
                    <span className="mt-0.5 block text-muted">発行 {formatDate(q.issued_at, true)}</span>
                  </Td>
                  <Td right className="whitespace-nowrap">
                    <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener" className="btn-ghost btn-sm">
                      PDF
                    </a>
                    <Link href={`/admin/quotes/${q.id}`} className="btn-secondary btn-sm ml-1">
                      案件を開く
                    </Link>
                  </Td>
                </tr>
              );
            })}
            {latest.length === 0 && (
              <tr>
                <Td className="text-center text-muted">割り当てられた案件はまだありません</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </AdminPage>
    );
  }

  const [requests, quotes, configurations, models, profiles] = await Promise.all([
    store.listQuoteRequests(),
    store.listAllQuotes(),
    actor.role === 'admin' ? store.listAllConfigurations() : Promise.resolve([]),
    actor.role === 'admin' ? store.listModels({ includeDraft: true }) : Promise.resolve([]),
    actor.role === 'admin' ? store.listProfiles() : Promise.resolve([]),
  ]);
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const configurationById = new Map(configurations.map((configuration) => [configuration.id, configuration]));
  const modelNameById = new Map(models.map((model) => [model.id, model.name]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  // 地域で抽出（設置予定地を優先し、無ければ顧客住所で判定）
  const filter = readRegionFilter(sp);
  const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || r.contact.address || '';
  const cityPool = filter.pref
    ? [...new Set(
        requests
          .map((r) => parseAddress(addrOf(r)))
          .filter((a) => a.prefecture === filter.pref && a.city)
          .map((a) => a.city as string)
      )].sort()
    : [];
  const shown = requests.filter((r) => matchesRegion(addrOf(r), filter));

  return (
    <AdminPage
      title="案件一覧"
      lead={`見積依頼を起点にした案件 ${requests.length} 件。現在保存されている情報だけで、お客様・対象商品・担当・状態を確認します。`}
      actions={
        <Link href="/admin/quotes/new" className="btn-primary btn-sm" data-testid="new-quote-link">
          新規見積を作成
        </Link>
      }
    >
      <RegionFilter value={filter} cities={cityPool} total={requests.length} matched={shown.length} />
      <Table minWidth="76rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>お客様・案件</Th>
            <Th>対象商品・仕様</Th>
            <Th>設置予定地</Th>
            <Th>担当代理店</Th>
            <Th>現在の状態</Th>
            <Th right>見積金額</Th>
            <Th>更新・受付</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r) => {
            const q = r.quote_id ? quoteById.get(r.quote_id) : undefined;
            const configuration = configurationById.get(r.configuration_id);
            const modelName = q?.base_model_name ?? (configuration ? modelNameById.get(configuration.base_model_id) : undefined);
            const specName = configuration?.spec_code
              ? (SPEC_LABELS[configuration.spec_code] ?? configuration.spec_code)
              : null;
            const finishLevelName = q ? FINISH_LEVEL_INFO[q.finish_level].name : null;
            const dealer = q?.dealer_id ? profileById.get(q.dealer_id) : undefined;
            const dealerName = dealer?.company_name ?? dealer?.full_name;
            const updatedAt = q?.updated_at ?? r.updated_at;

            return (
              <tr key={r.id} data-testid="admin-quote-row">
                <Td>
                  <p className="font-semibold">{r.contact.full_name}</p>
                  {r.contact.company_name && <p className="mt-0.5 text-xs text-muted">{r.contact.company_name}</p>}
                  <p className="mt-0.5 text-xs text-muted">{r.user_email}</p>
                  <p className="mt-1 font-mono text-xs text-muted">
                    見積番号 {r.quote_no ?? '未発行'}
                    {q && q.revision > 1 && <>／第{q.revision}版</>}
                  </p>
                </Td>
                <Td>
                  <p className="font-semibold">{modelName ?? '—'}</p>
                  {specName ? (
                    <p className="mt-0.5 text-xs text-muted">{specName}</p>
                  ) : finishLevelName ? (
                    <p className="mt-0.5 text-xs text-muted">注文範囲：{finishLevelName}</p>
                  ) : null}
                </Td>
                <Td className="max-w-64 text-xs">{r.contact.site_address || '—'}</Td>
                <Td className="text-xs">
                  {q?.dealer_id
                    ? dealerName ?? <Badge tone="success">割当済み</Badge>
                    : <span className="text-muted">未割当</span>}
                </Td>
                <Td>
                  {q ? (
                    <>
                      <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                      <p className="mt-1 text-xs text-muted">依頼：{QUOTE_REQUEST_STATUS_LABELS[r.status]}</p>
                    </>
                  ) : (
                    <Badge tone={r.status === 'new' ? 'danger' : r.status === 'closed' ? 'success' : 'neutral'}>
                      {QUOTE_REQUEST_STATUS_LABELS[r.status]}
                    </Badge>
                  )}
                </Td>
                <Td right className="font-semibold">{q ? formatYen(q.total) : '—'}</Td>
                <Td className="whitespace-nowrap text-xs">
                  <span className="block">更新 {formatDate(updatedAt, true)}</span>
                  <span className="mt-0.5 block text-muted">受付 {formatDate(r.created_at, true)}</span>
                </Td>
                <Td right className="whitespace-nowrap">
                  {q ? (
                    <>
                      <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener" className="btn-ghost btn-sm">
                        PDF
                      </a>
                      <Link href={`/admin/quotes/${q.id}`} className="btn-secondary btn-sm ml-1">
                        案件を開く
                      </Link>
                    </>
                  ) : (
                    <span className="text-xs text-muted">見積未作成</span>
                  )}
                </Td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr>
              <Td className="text-center text-muted">条件に合う案件はありません</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
