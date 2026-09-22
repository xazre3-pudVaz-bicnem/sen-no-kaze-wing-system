import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStore, type SessionUser } from '@/lib/data/store';
import {
  CONFIGURATION_STATUS_LABELS,
  FINISH_LEVEL_INFO,
  FREE_PRODUCT_CATEGORY_CODE,
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  canEditCatalog,
  type CatalogBundle,
  type EstimateTemplateBundle,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { QuoteStatusForm } from '@/components/admin/forms';
import { AssignDealerForm } from '@/components/admin/dealer-forms';
import { QuoteEstimateSheet } from '@/components/admin/quote-estimate-sheet';
import { CasePlanBoard } from '@/components/admin/case-plan-board';
import { ELEVATIONS, MODEL_WING01_ID } from '@/lib/seed/catalog';

const TABS = [
  { key: 'estimate', label: '見積書' },
  { key: 'plan', label: 'プランボード' },
  { key: 'site', label: '現地条件' },
  { key: 'documents', label: '契約・図面・資料' },
  { key: 'production', label: '製造・施工' },
  { key: 'handover', label: '引渡し・アフター' },
  { key: 'disaster', label: '災害時提供' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isTabKey(value: string | undefined): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

function FuturePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-semibold text-muted">今後対応予定</span>
      </div>
      <div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div>
    </section>
  );
}

function buildInlineTabHref(
  quoteId: string,
  tab: TabKey,
  searchParams: Record<string, string | undefined> | undefined
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (!value || key === 'tab' || key === 'created' || key === 'revised' || key === 'from') continue;
    query.set(key, value);
  }
  query.set('case', quoteId);
  query.set('tab', tab);
  return `/admin/quotes?${query.toString()}#case-workspace`;
}

export async function CaseWorkspace({
  quoteId,
  actor,
  tab,
  created,
  revised,
  from,
  embedded = false,
  listSearchParams,
}: {
  quoteId: string;
  actor: SessionUser;
  tab?: string;
  created?: string;
  revised?: string;
  from?: string;
  embedded?: boolean;
  listSearchParams?: Record<string, string | undefined>;
}) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail) notFound();

  const { quote, items, request, document } = detail;
  const isAdmin = actor.role === 'admin';
  const canManageAllQuotes = canEditCatalog(actor.role);
  const canEditBase = canEditCatalog(actor.role);
  if (!canManageAllQuotes && quote.dealer_id !== actor.id) notFound();

  const canRevise = quote.status === 'issued' && (canManageAllQuotes || quote.dealer_id === actor.id);
  const activeTab: TabKey = isTabKey(tab) ? tab : 'estimate';

  const [profiles, categories, options, casePlanConfiguration] = await Promise.all([
    isAdmin ? store.listProfiles() : Promise.resolve([]),
    store.listCategories(),
    store.listOptions(),
    store.getCasePlanConfiguration(quote.id, actor),
  ]);

  const dealers = profiles.filter((p) => p.role_code === 'dealer' || p.role_code === 'master_dealer');
  const assignedDealer = dealers.find((dealer) => dealer.id === quote.dealer_id);
  const freeCategory = categories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const freeProducts = options
    .filter((o) => o.category_id === freeCategory?.id && o.status === 'published' && (isAdmin || o.owner_id === actor.id))
    .map((o) => ({ code: o.code, name: o.name, price: o.price }));

  const catalogByCat = new Map(categories.map((c) => [c.id, c.name]));
  const catalog = options
    .filter((o) => o.status === 'published')
    .map((o) => ({
      code: o.code,
      name: o.name,
      category: catalogByCat.get(o.category_id) ?? 'その他',
      price: o.price,
      price_on_request: o.price_on_request,
      image_url: o.image_url,
      manufacturer: o.manufacturer,
    }));

  const customerName = request?.contact.full_name ?? quote.customer_name;
  const customerCompany = request?.contact.company_name ?? quote.customer_company;
  const assignedDealerName =
    assignedDealer?.company_name ??
    assignedDealer?.full_name ??
    (quote.dealer_id ? (actor.role === 'dealer' ? actor.full_name || '担当中' : '割当済み') : '未割当');
  const siteAddress =
    request?.contact.site_address ||
    (casePlanConfiguration?.configuration.site_location_undecided
      ? '未定'
      : [casePlanConfiguration?.configuration.site_prefecture, casePlanConfiguration?.configuration.site_municipality]
          .filter(Boolean)
          .join('')) ||
    '—';

  let planBundle: CatalogBundle | null = null;
  let planEstimateTemplate: EstimateTemplateBundle | null = null;
  let planElevations: { url: string; label: string; alt: string }[] = [];
  if (activeTab === 'plan' && casePlanConfiguration) {
    planBundle = await store.getCatalogBundle(casePlanConfiguration.configuration.base_model_id);
    if (planBundle) {
      const specCode = casePlanConfiguration.configuration.spec_code;
      if (specCode) {
        planEstimateTemplate = await store.getEstimateTemplateBundle(planBundle.model.id, specCode);
      }
      const registeredElevations = planBundle.images
        .filter((image) => image.kind === 'elevation')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((image) => ({
          url: image.url,
          label: image.caption ?? image.alt ?? '立面図',
          alt: image.alt,
        }));
      planElevations =
        registeredElevations.length > 0
          ? registeredElevations
          : planBundle.model.id === MODEL_WING01_ID
            ? ELEVATIONS.map((row) => ({ ...row }))
            : [];
    }
  }

  const workflow = [
    {
      label: '見積依頼',
      value: request ? QUOTE_REQUEST_STATUS_LABELS[request.status] : '記録なし',
      available: Boolean(request),
    },
    {
      label: '担当決定',
      value: quote.dealer_id ? '割当済み' : '未割当',
      available: Boolean(quote.dealer_id),
    },
    { label: '現地確認', value: '未対応', available: false },
    {
      label: '正式見積',
      value: QUOTE_STATUS_LABELS[quote.status],
      available: true,
    },
    { label: '契約', value: '未対応', available: false },
    { label: '製造', value: '未対応', available: false },
    { label: '施工', value: '未対応', available: false },
    { label: '引渡し', value: '未対応', available: false },
    { label: 'アフター', value: '未対応', available: false },
  ];

  const tabHref = (nextTab: TabKey) =>
    embedded
      ? buildInlineTabHref(quote.id, nextTab, listSearchParams)
      : `/admin/quotes/${quote.id}?tab=${nextTab}`;

  return (
    <div id="case-workspace" className="scroll-mt-3 space-y-2" data-testid="case-workspace">
      <section className="overflow-hidden rounded-lg border border-[#2b5d48] bg-[#245c45] text-white shadow-sm" data-testid="case-workspace-header">
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-base font-semibold sm:text-lg">{customerName}</h2>
              <Badge tone={quote.status === 'accepted' ? 'success' : quote.status === 'issued' ? 'navy' : 'neutral'}>
                {QUOTE_STATUS_LABELS[quote.status]}
              </Badge>
              {request && (
                <span className="rounded-full border border-white/30 px-2 py-0.5 text-[0.65rem]">
                  依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-[0.65rem] text-white/70">
              見積番号 {quote.quote_no}／第{quote.revision}版　更新 {formatDate(quote.updated_at, true)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <a
              href={`/api/quotes/${quote.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="rounded-md border border-white/30 px-2.5 py-1 text-[0.7rem] font-semibold hover:bg-white/10"
              data-testid="admin-pdf-link"
            >
              見積書PDF
            </a>
            <a
              href={`/api/quotes/${quote.id}/pdf?regenerate=1`}
              target="_blank"
              rel="noopener"
              className="rounded-md border border-white/30 px-2.5 py-1 text-[0.7rem] hover:bg-white/10"
              title="レイアウト変更後に PDF を作り直す（金額は変わりません）"
            >
              PDF再生成
            </a>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/15 px-4 py-1.5 text-[0.68rem] text-white/85">
          <span><b className="text-white">顧客</b> {customerCompany || customerName}</span>
          <span><b className="text-white">担当代理店</b> {assignedDealerName}</span>
          <span><b className="text-white">設置</b> {siteAddress}</span>
          <span><b className="text-white">モデル</b> {quote.base_model_name}</span>
          <span><b className="text-white">注文範囲</b> {FINISH_LEVEL_INFO[quote.finish_level].name}</span>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm [scrollbar-width:thin]" aria-label="案件工程" data-testid="case-workflow">
        <div className="flex min-w-max items-center px-2.5 py-2">
          {workflow.map((step, index) => (
            <div key={step.label} className="flex items-center">
              <div
                className={
                  step.available
                    ? 'min-w-20 rounded-md border border-[#b8d3c4] bg-[#eef7f1] px-2 py-1.5 text-center'
                    : 'min-w-20 rounded-md border border-line bg-[#f7f8f8] px-2 py-1.5 text-center'
                }
              >
                <p className={step.available ? 'text-[0.68rem] font-semibold text-[#2f6b4f]' : 'text-[0.68rem] font-semibold text-muted'}>
                  {step.label}
                </p>
                <p className="mt-0.5 text-[0.6rem] text-muted">{step.value}</p>
              </div>
              {index < workflow.length - 1 && <span className="px-1 text-[0.65rem] text-muted">→</span>}
            </div>
          ))}
        </div>
      </section>

      {isAdmin && (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="case-admin-controls">
          <details className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
            <summary className="cursor-pointer font-semibold text-[#315745]">担当代理店を変更</summary>
            <div className="mt-2">
              <AssignDealerForm quote={quote} dealers={dealers} />
            </div>
          </details>
          <details className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
            <summary className="cursor-pointer font-semibold text-[#315745]">状態を変更</summary>
            <div className="mt-2">
              <QuoteStatusForm quote={quote} request={request} compact />
            </div>
          </details>
        </div>
      )}

      <nav aria-label="案件内メニュー" className="overflow-x-auto border-y border-line bg-white [scrollbar-width:none]">
        <div className="flex min-w-max">
          {TABS.map((tabItem) => {
            const active = activeTab === tabItem.key;
            const future = ['site', 'documents', 'production', 'handover', 'disaster'].includes(tabItem.key);
            return (
              <Link
                key={tabItem.key}
                href={tabHref(tabItem.key)}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'border-b-2 border-[#2f6b4f] bg-[#eef7f1] px-3 py-2 text-[0.7rem] font-semibold text-[#245c45]'
                    : 'border-b-2 border-transparent px-3 py-2 text-[0.7rem] font-medium text-ink-soft hover:bg-sand/50'
                }
              >
                {tabItem.label}
                {tabItem.key === 'estimate' && <span className="ml-1 text-[0.6rem] text-[#2f6b4f]">第{quote.revision}版</span>}
                {future && <span className="ml-1 text-[0.58rem] text-muted">未対応</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      {activeTab === 'estimate' && (
        <section className="space-y-3" data-testid="case-tab-estimate">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">正式見積書</h2>
                <Badge tone={quote.status === 'accepted' ? 'success' : quote.status === 'issued' ? 'navy' : 'neutral'}>
                  {QUOTE_STATUS_LABELS[quote.status]}
                </Badge>
              </div>
              <p className="mt-0.5 text-[0.68rem] text-muted">
                発行 {formatDate(quote.issued_at)}／有効期限 {formatDate(quote.valid_until)}／第{quote.revision}版
              </p>
            </div>
          </div>

          {created && (
            <Alert tone="success" title="見積を作成しました">
              下の入力表で本体・オプション・別途工事の行を確認し、必要に応じて編集して発行してください。
            </Alert>
          )}
          {revised && (
            <Alert tone="success" title={`第${quote.revision}版を発行しました`}>
              新しい版を案件ワークスペースへ反映しました。以前の版は履歴として残っています。
            </Alert>
          )}
          {from === 'mail' && canRevise && (
            <Alert tone="info" title="メールからお越しの方へ">
              この案件の見積を編集し、次の版を発行できます。代理店は本体を閲覧のみ、オプション・別途工事等を編集できます。
            </Alert>
          )}

          <QuoteEstimateSheet
            quote={quote}
            items={items}
            freeProducts={freeProducts}
            catalog={catalog}
            canEditBase={canEditBase}
            canRevise={canRevise}
            startInEditMode={Boolean(created)}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
            <div>
              <span className="font-semibold text-ink">この見積のPDF・画像</span>
              <span className="ml-2 text-muted">
                {document ? `${document.file_name}（${formatDate(document.generated_at, true)}）` : 'PDFは初回表示時に生成されます'}
              </span>
            </div>
            <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm">確認</a>
          </div>

          <p className="text-xs leading-5 text-muted">
            金額は発行時点の確定内容です。マスター価格を変更しても変わりません。
            別途工事・フリー商品を入れる場合は、書き換えではなく次の版として発行します。
          </p>

          {quote.status === 'superseded' && <Alert tone="info">この版は改訂済みです。最新の版から編集してください。</Alert>}
        </section>
      )}

      {activeTab === 'plan' && (
        <section className="space-y-3" data-testid="case-tab-plan">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">プランボード</h2>
              <p className="mt-1 text-xs text-muted">
                案件に紐づく保存済み仕様を、シミュレーターと同じ表示ロジックで確認します。ここでは変更できません。
              </p>
            </div>
            {isAdmin && planBundle && casePlanConfiguration && (
              <Link
                href={`/simulator/${planBundle.model.slug}?c=${casePlanConfiguration.configuration.id}`}
                target="_blank"
                className="btn-secondary btn-sm"
              >
                シミュレーターで確認
              </Link>
            )}
          </div>

          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-[#f7f9f8] p-2.5"><dt className="text-xs text-muted">本体</dt><dd className="mt-1 font-semibold">{quote.base_model_name}</dd></div>
            <div className="rounded-lg bg-[#f7f9f8] p-2.5"><dt className="text-xs text-muted">注文範囲</dt><dd className="mt-1 font-semibold">{FINISH_LEVEL_INFO[quote.finish_level].name}</dd></div>
            <div className="rounded-lg bg-[#f7f9f8] p-2.5"><dt className="text-xs text-muted">設置予定地</dt><dd className="mt-1 font-semibold">{siteAddress}</dd></div>
            <div className="rounded-lg bg-[#f7f9f8] p-2.5">
              <dt className="text-xs text-muted">保存状態</dt>
              <dd className="mt-1 font-semibold">
                {casePlanConfiguration
                  ? CONFIGURATION_STATUS_LABELS[casePlanConfiguration.configuration.status]
                  : '読み込み不可'}
              </dd>
            </div>
          </dl>

          {casePlanConfiguration && planBundle ? (
            <CasePlanBoard
              bundle={planBundle}
              configuration={casePlanConfiguration.configuration}
              items={casePlanConfiguration.items}
              exteriorFaces={casePlanConfiguration.exterior_faces}
              estimateTemplate={planEstimateTemplate}
              elevations={planElevations}
            />
          ) : (
            <Alert tone="warn">
              この案件の保存済みプランボードを読み込めませんでした。Configurationとの紐付けと閲覧権限を確認してください。
            </Alert>
          )}
        </section>
      )}

      {activeTab === 'site' && (
        <FuturePanel title="現地条件">
          <p><b>現在保存されている設置予定地：</b>{siteAddress}</p>
          <p className="mt-2">現地調査、搬入条件、地盤条件などを案件工程として保存する機能はまだありません。今回は入力欄や完了状態を追加しません。</p>
        </FuturePanel>
      )}

      {activeTab === 'documents' && (
        <FuturePanel title="契約・図面・資料">
          契約書・確定図面・案件資料を案件単位で保存し、版や交付状況を管理する正式機能はまだありません。見積書PDFは「見積書」タブで既存機能を利用できます。
        </FuturePanel>
      )}

      {activeTab === 'production' && (
        <FuturePanel title="製造・施工">
          製造指示、製造個体、工程日、搬入・施工進捗を保存する正式機能はまだありません。架空の製造状態・施工日・担当者は表示しません。
        </FuturePanel>
      )}

      {activeTab === 'handover' && (
        <FuturePanel title="引渡し・アフター">
          引渡し日、完了確認、保証、点検、アフター対応を保存する正式機能はまだありません。今後の工程で対応予定です。
        </FuturePanel>
      )}

      {activeTab === 'disaster' && (
        <FuturePanel title="災害時提供">
          災害時の提供意思、完成個体、現在の供給可否、供給可能棟数を管理する正式データはまだありません。現在は供給可否を判定・集計しません。
        </FuturePanel>
      )}
    </div>
  );
}
