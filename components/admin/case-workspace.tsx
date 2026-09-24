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
  type CaseDocument,
  type EstimateTemplateBundle,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { QuoteStatusForm } from '@/components/admin/forms';
import { AssignDealerForm } from '@/components/admin/dealer-forms';
import { QuoteEstimateSheet } from '@/components/admin/quote-estimate-sheet';
import { CasePlanBoard } from '@/components/admin/case-plan-board';
import { ELEVATIONS, MODEL_WING01_ID } from '@/lib/seed/catalog';

const CASE_DOCUMENT_KIND_LABELS: Record<CaseDocument['kind'], string> = {
  floorplan: '平面図',
  elevation: '立面図',
  estimate: '見積',
  contract: '契約',
  site: '現地・敷地',
  other: 'その他',
};

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

function matchSiteValue(text: string, pattern: RegExp, suffix = '') {
  const match = text.match(pattern);
  return match?.[1] ? `${match[1]}${suffix}` : '未登録';
}

function extractCaseUnitCount(note: string | null) {
  const match = note?.match(/([0-9]+)\s*(台|棟)/);
  return match ? `${match[1]}${match[2]}` : null;
}

function extractContractReference(note: string | null) {
  const text = note?.trim() ?? '';
  const contractDate =
    text.match(/(?:受注)?契約日\s*[:：]?\s*([0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2})/)?.[1] ?? null;
  const paymentTerms = text.match(/支払条件\s*[:：]?\s*([^。]+)(?:。|$)/)?.[1]?.trim() ?? null;
  return { contractDate, paymentTerms };
}

function buildSiteConditionCandidates(siteAddress: string, evidenceText: string) {
  const roadWidth = evidenceText.match(/道路幅員\s*[:：]?\s*([0-9,]+(?:\.[0-9]+)?)\s*(mm|m)/i);
  const shadowRule =
    evidenceText.includes('日影規制') && evidenceText.includes('対象建物10m超')
      ? '対象建物10m超／4時間・2.5時間／測定面4m'
      : '未登録';

  return [
    { label: '設置予定地', value: siteAddress, source: '保存済み住所' },
    {
      label: '都市計画区域',
      value: evidenceText.includes('市街化区域') ? '市街化区域' : '未登録',
      source: '案件受付・資料',
    },
    {
      label: '用途地域',
      value: evidenceText.includes('第一種住居地域') ? '第一種住居地域' : '未登録',
      source: '案件受付・資料',
    },
    {
      label: '高度地区',
      value:
        evidenceText.includes('第2種高度地区') || evidenceText.includes('第２種高度地区')
          ? '第2種高度地区'
          : '未登録',
      source: '案件受付・資料',
    },
    {
      label: '防火地域',
      value: evidenceText.includes('準防火地域') ? '準防火地域' : '未登録',
      source: '案件受付・資料',
    },
    {
      label: '建蔽率',
      value: matchSiteValue(evidenceText, /建(?:蔽|ぺい)率\s*[:：]?\s*([0-9.]+)\s*%/, '%'),
      source: '案件受付・資料',
    },
    {
      label: '容積率',
      value: matchSiteValue(evidenceText, /容積率\s*[:：]?\s*([0-9.]+)\s*%/, '%'),
      source: '案件受付・資料',
    },
    {
      label: '道路幅員',
      value: roadWidth ? `${roadWidth[1]}${roadWidth[2]}` : '未登録',
      source: '配置・敷地図',
    },
    {
      label: '接道・道路境界',
      value: evidenceText.includes('道路境界線') ? '配置図に道路境界線あり（詳細要確認）' : '未登録',
      source: '配置・敷地図',
    },
    { label: '日影規制', value: shadowRule, source: '都市計画資料' },
    {
      label: '遺跡対象地域',
      value: evidenceText.includes('遺跡地及び行政指導範囲') ? '遺跡地及び行政指導範囲' : '未登録',
      source: '都市計画資料',
    },
    { label: '搬入条件', value: '未登録', source: '要現地確認' },
    { label: '地盤条件', value: '未登録', source: '要現地確認' },
  ];
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

  const { quote, items, request } = detail;
  const isAdmin = actor.role === 'admin';
  const canManageAllQuotes = canEditCatalog(actor.role);
  const canEditBase = canEditCatalog(actor.role);
  if (!canManageAllQuotes && quote.dealer_id !== actor.id) notFound();

  const canRevise = quote.status === 'issued' && (canManageAllQuotes || quote.dealer_id === actor.id);
  const activeTab: TabKey = isTabKey(tab) ? tab : 'estimate';

  const [profiles, categories, options, casePlanConfiguration, caseDocuments] = await Promise.all([
    isAdmin ? store.listProfiles() : Promise.resolve([]),
    store.listCategories(),
    store.listOptions(),
    store.getCasePlanConfiguration(quote.id, actor),
    activeTab === 'documents' || activeTab === 'site' || activeTab === 'plan'
      ? store.listCaseDocuments(quote.id, actor)
      : Promise.resolve([] as CaseDocument[]),
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
  const caseSelectedOptionIds = new Set(casePlanConfiguration?.items.map((item) => item.option_id) ?? []);
  const fireSelection =
    options.find(
      (option) =>
        caseSelectedOptionIds.has(option.id) &&
        (option.code === 'fire-proof' || option.code === 'fire-standard')
    )?.name ?? '未確認';
  const caseStructureNote = quote.dealer_note?.trim() || null;
  const caseUnitCount = extractCaseUnitCount(caseStructureNote);
  const caseTitle = casePlanConfiguration?.configuration.name?.trim() || customerCompany || customerName;
  const caseFloorplanDocument =
    caseDocuments.find((row) => row.kind === 'floorplan' && row.is_latest && row.preview_url) ??
    caseDocuments.find((row) => row.kind === 'floorplan' && row.preview_url) ??
    null;
  const caseElevationDocuments = caseDocuments
    .filter((row) => row.kind === 'elevation' && row.preview_url)
    .sort((a, b) => a.sort_order - b.sort_order);
  const contractReference = extractContractReference(quote.notes);
  const contractDocuments = caseDocuments.filter((row) => row.kind === 'contract');
  const nonContractDocuments = caseDocuments.filter((row) => row.kind !== 'contract');
  const drawingDocuments = nonContractDocuments.filter((row) => row.preview_url);
  const currentPhaseLabel = quote.status === 'accepted' ? '契約' : '正式見積';
  const siteEvidenceText = [
    request?.message ?? '',
    ...caseDocuments.filter((row) => row.kind === 'site').flatMap((row) => [row.title, row.note ?? '']),
  ].join(' ');
  const siteConditionCandidates = buildSiteConditionCandidates(siteAddress, siteEvidenceText);
  const installationItems = items
    .filter((item) => item.kind === 'installation')
    .sort((a, b) => a.sort_order - b.sort_order);
  const installationSubtotal = installationItems.reduce((sum, item) => sum + item.amount, 0);

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
      const caseElevations = caseElevationDocuments.map((row) => ({
        url: row.preview_url ?? '',
        label: row.title,
        alt: row.title,
      }));
      const registeredElevations = planBundle.images
        .filter((image) => image.kind === 'elevation')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((image) => ({
          url: image.url,
          label: image.caption ?? image.alt ?? '立面図',
          alt: image.alt,
        }));
      planElevations =
        caseElevations.length > 0
          ? caseElevations
          : registeredElevations.length > 0
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
      state: request ? 'done' : 'pending',
    },
    {
      label: '担当決定',
      value: quote.dealer_id ? '割当済み' : '未割当',
      state: quote.dealer_id ? 'done' : 'pending',
    },
    { label: '現地確認', value: '未対応', state: 'pending' },
    {
      label: '正式見積',
      value: QUOTE_STATUS_LABELS[quote.status],
      state: quote.status === 'accepted' ? 'done' : 'current',
    },
    {
      label: '契約',
      value: '未対応',
      state: quote.status === 'accepted' ? 'current' : 'pending',
    },
    { label: '製造', value: '未対応', state: 'pending' },
    { label: '施工', value: '未対応', state: 'pending' },
    { label: '引渡し', value: '未対応', state: 'pending' },
    { label: 'アフター', value: '未対応', state: 'pending' },
  ] as const;

  const currentWorkflowLabel =
    quote.status === 'accepted' ? '契約' : `正式見積：${QUOTE_STATUS_LABELS[quote.status]}`;
  const nextWorkflowLabel =
    quote.status === 'accepted'
      ? '契約条件の確認'
      : quote.status === 'issued'
        ? '見積内容の判断'
        : '—';

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
              <span className="text-[0.62rem] font-semibold text-white/70">案件</span>
              <h2 className="min-w-0 text-base font-semibold sm:text-lg">{caseTitle}</h2>
              <span className="rounded-full border border-[#d8c07b] bg-[#fff4cf] px-2 py-0.5 text-[0.62rem] font-semibold text-[#765b11]">
                現在フェーズ：{currentPhaseLabel}
              </span>
              <span className="text-[0.62rem] text-white/70">更新 {formatDate(quote.updated_at)}</span>
            </div>
            {customerCompany && (
              <p className="mt-0.5 text-[0.64rem] text-white/75">顧客 {customerName}</p>
            )}
          </div>

          {isAdmin && (
            <details className="relative text-xs" data-testid="case-admin-controls">
              <summary className="cursor-pointer list-none rounded-md border border-white/35 px-2.5 py-1.5 font-semibold text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden">
                案件設定
              </summary>
              <div className="mt-2 grid min-w-[18rem] gap-3 rounded-lg border border-line bg-white p-3 text-ink shadow-lg sm:min-w-[34rem] sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[0.66rem] font-semibold text-muted">担当代理店を変更</p>
                  <AssignDealerForm quote={quote} dealers={dealers} />
                </div>
                <div>
                  <p className="mb-1 text-[0.66rem] font-semibold text-muted">状態を変更</p>
                  <QuoteStatusForm quote={quote} request={request} compact />
                </div>
              </div>
            </details>
          )}
        </div>

        <div
          className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/15 px-4 py-1.5 text-[0.65rem] text-white/80"
          data-testid="case-structure-summary"
          aria-label="案件概要"
        >
          <span><b className="text-white">顧客</b> {customerCompany || customerName}</span>
          <span><b className="text-white">担当</b> {assignedDealerName}</span>
          <span><b className="text-white">設置</b> {siteAddress}</span>
          <span><b className="text-white">モデル</b> {quote.base_model_name}</span>
          <span><b className="text-white">棟数</b> {caseUnitCount ?? '未登録'}</span>
          <span><b className="text-white">注文範囲</b> {FINISH_LEVEL_INFO[quote.finish_level].name}</span>
          <span><b className="text-white">防火仕様</b> {fireSelection}</span>
          <span className="min-w-0"><b className="text-white">案件構成</b> {caseStructureNote ?? '未登録'}</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm" aria-label="案件工程" data-testid="case-workflow">
        <div className="grid grid-cols-3 gap-1 p-2 md:grid-cols-9">
          {workflow.map((step, index) => {
            const stateClass =
              step.state === 'done'
                ? 'border-[#b8d3c4] bg-[#eef7f1] text-[#2f6b4f]'
                : step.state === 'current'
                  ? 'border-[#e4c47f] bg-[#fff7df] text-[#8a5a20]'
                  : 'border-line bg-[#f7f8f8] text-muted';
            return (
              <div key={step.label} className="relative min-w-0">
                <div className={`rounded-md border px-1.5 py-1.5 text-center ${stateClass}`}>
                  <p className="truncate text-[0.66rem] font-semibold">
                    {step.state === 'done' ? '✓ ' : step.state === 'current' ? '● ' : ''}{step.label}
                  </p>
                  <p className="mt-0.5 truncate text-[0.58rem] opacity-75">{step.value}</p>
                </div>
                {index < workflow.length - 1 && (
                  <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-[0.62rem] font-semibold text-muted md:block">→</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-[#fbfcfb] px-3 py-1.5 text-[0.65rem]" data-testid="case-workflow-summary">
          <span><span className="text-muted">現在</span> <strong className="text-ink">{currentWorkflowLabel}</strong></span>
          <span><span className="text-muted">次</span> <strong className="text-[#2f6b4f]">{nextWorkflowLabel}</strong></span>
          <span><span className="text-muted">要対応</span> <strong className="text-muted">未集計</strong></span>
        </div>
      </section>

      <nav aria-label="案件内メニュー" className="border-y border-line bg-white">
        <div className="flex flex-wrap">
          {TABS.map((tabItem) => {
            const active = activeTab === tabItem.key;
            const future = ['site', 'production', 'handover', 'disaster'].includes(tabItem.key);
            return (
              <Link
                key={tabItem.key}
                href={tabHref(tabItem.key)}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'border-b-2 border-[#2f6b4f] bg-[#eef7f1] px-3 py-2 text-[0.68rem] font-semibold text-[#245c45]'
                    : 'border-b-2 border-transparent px-3 py-2 text-[0.68rem] font-medium text-ink-soft hover:bg-sand/50'
                }
              >
                {tabItem.label}
                {tabItem.key === 'estimate' && <span className="ml-1 text-[0.58rem] text-[#2f6b4f]">第{quote.revision}版</span>}
                {tabItem.key === 'documents' && <span className="ml-1 text-[0.56rem] text-[#2f6b4f]">参照</span>}
                {future && <span className="ml-1 text-[0.56rem] text-muted">未対応</span>}
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
                見積番号 {quote.quote_no}／発行 {formatDate(quote.issued_at)}／有効期限 {formatDate(quote.valid_until)}／第{quote.revision}版
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <a
                href={`/api/quotes/${quote.id}/pdf`}
                target="_blank"
                rel="noopener"
                className="btn-secondary btn-sm"
                data-testid="admin-pdf-link"
              >
                見積書PDF
              </a>
              <a
                href={`/api/quotes/${quote.id}/pdf?regenerate=1`}
                target="_blank"
                rel="noopener"
                className="btn-secondary btn-sm"
                title="レイアウト変更後に PDF を作り直す（金額は変わりません）"
              >
                PDF再生成
              </a>
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
              caseFloorplan={
                caseFloorplanDocument?.preview_url
                  ? { url: caseFloorplanDocument.preview_url, title: caseFloorplanDocument.title }
                  : null
              }
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
          <div className="space-y-4" data-testid="case-site-condition-candidates">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">正式登録候補</p>
                <p className="mt-0.5 text-xs text-muted">
                  現在は保存済み住所・案件受付メモ・案件資料から暫定表示しています。正式項目化は次工程です。
                </p>
              </div>
              <Link href={tabHref('documents')} className="btn-secondary btn-sm">
                現地資料を確認
              </Link>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {siteConditionCandidates.map((row) => {
                const pending = row.value === '未登録' || row.value.includes('要確認');
                return (
                  <div key={row.label} className="rounded-lg border border-line bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-muted">{row.label}</p>
                      <span
                        className={
                          pending
                            ? 'rounded-full bg-[#fff4d6] px-2 py-0.5 text-[0.58rem] font-semibold text-[#8a6416]'
                            : 'rounded-full bg-[#eef7f1] px-2 py-0.5 text-[0.58rem] font-semibold text-[#2f6b4f]'
                        }
                      >
                        {pending ? '要登録・確認' : '既存情報'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold leading-5 text-ink">{row.value}</p>
                    <p className="mt-1 text-[0.65rem] text-muted">出典：{row.source}</p>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-[#f7f8f8] p-3">
                <p className="text-xs text-muted">案件受付・現地メモ</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                  {request?.message?.trim() || '現地条件のメモはまだありません。'}
                </p>
              </div>
              <div className="rounded-lg border border-[#e6d8a8] bg-[#fffaf0] p-3">
                <p className="text-xs font-semibold text-[#765d1f]">正式確認時の注意</p>
                <p className="mt-1 text-xs leading-5 text-ink-soft">
                  都市計画資料は参考図として扱い、建築可否・法規条件の正式判断は所管課・設計者による確認を前提とします。
                  接道、搬入、地盤についても現地確認後に確定します。
                </p>
              </div>
            </div>
          </div>
        </FuturePanel>
      )}

      {activeTab === 'documents' && (
        <section className="space-y-4" data-testid="case-tab-documents">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">契約・図面・資料</h2>
                <Badge tone="neutral">参照のみ</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                契約情報は既存の見積状態・見積金額・受注契約メモから参考表示します。正式な契約保存・アップロード・版管理は次工程です。
              </p>
            </div>
            <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm">
              現在の見積書PDF
            </a>
          </div>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-contract-reference">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">契約情報</h3>
                <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[0.62rem] font-semibold text-[#8a6416]">
                  正式保存前
                </span>
              </div>
              <span className="text-[0.65rem] text-muted">既存データからの参考表示</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              ここに表示する内容は正式な契約レコードではありません。契約済み判定・契約金額・対象Revisionの固定はまだ行っていません。
            </p>

            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">現在の見積状態</dt>
                <dd className="mt-1 font-semibold">
                  {quote.status === 'accepted' ? '見積承諾済み' : QUOTE_STATUS_LABELS[quote.status]}
                </dd>
                <p className="mt-1 text-[0.65rem] text-muted">正式な契約状態は未登録</p>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">受注契約日（メモ）</dt>
                <dd className="mt-1 font-semibold">{contractReference.contractDate ?? '未登録'}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">Quoteメモから抽出</p>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">承諾見積額（参考）</dt>
                <dd className="mt-1 font-semibold">{formatYen(quote.total)}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">現在表示中の第{quote.revision}版</p>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">契約対象見積候補</dt>
                <dd className="mt-1 font-semibold">{quote.quote_no}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">第{quote.revision}版／未固定</p>
              </div>
            </dl>

            <div className="mt-2 rounded-lg border border-line bg-white p-3">
              <p className="text-xs font-semibold text-muted">支払条件（メモ）</p>
              <p className="mt-1 text-sm leading-6 text-ink">
                {contractReference.paymentTerms ?? '未登録'}
              </p>
            </div>

            {(quote.dealer_note || quote.notes) && (
              <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="case-document-notes">
                {quote.dealer_note && (
                  <div className="rounded-lg border border-line bg-white p-3">
                    <p className="text-xs font-semibold text-muted">案件構成・申し送り</p>
                    <p className="mt-1 text-sm leading-6 text-ink">{quote.dealer_note}</p>
                  </div>
                )}
                {quote.notes && (
                  <div className="rounded-lg border border-line bg-white p-3">
                    <p className="text-xs font-semibold text-muted">受注・契約メモ</p>
                    <p className="mt-1 text-sm leading-6 text-ink">{quote.notes}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="space-y-2" data-testid="case-contract-documents">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">契約書</h3>
                <p className="mt-0.5 text-xs text-muted">正式な契約書保管・差替え・版管理はまだ未実装です。</p>
              </div>
              <span className="text-xs text-muted">{contractDocuments.length}件</span>
            </div>
            {contractDocuments.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
                {contractDocuments.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-sand px-2 py-0.5 text-[0.62rem] font-semibold text-ink-soft">契約</span>
                        {row.is_latest && <Badge tone="success">最新版</Badge>}
                        {row.revision_label && <span className="text-[0.65rem] text-muted">{row.revision_label}</span>}
                      </div>
                      <p className="mt-1 font-semibold">{row.title}</p>
                      <p className="text-[0.68rem] text-muted">
                        {row.file_name}{row.document_date ? `／${formatDate(row.document_date)}` : ''}
                      </p>
                      {row.note && <p className="mt-1 text-[0.68rem] leading-5 text-ink-soft">{row.note}</p>}
                    </div>
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noopener" className="btn-secondary btn-sm">開く</a>
                    ) : (
                      <span className="rounded-md bg-[#f7f8f8] px-2 py-1 text-[0.65rem] text-muted">原本保管は未実装</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-[#fbfcfb] px-3 py-4 text-sm text-muted">
                契約書はまだ正式保管されていません。アップロード・版管理は次工程で実装します。
              </div>
            )}
          </section>

          <section className="space-y-3" data-testid="case-drawings-and-documents">
            <div>
              <h3 className="text-sm font-semibold">図面・資料</h3>
              <p className="mt-0.5 text-xs text-muted">見積・図面・現地資料を確認します。契約書は上の契約書欄へ分けて表示します。</p>
            </div>

            {drawingDocuments.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">図面</h4>
                  <span className="text-xs text-muted">{drawingDocuments.length}点</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="case-drawing-grid">
                  {drawingDocuments.map((row) => (
                    <article key={row.id} className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
                      <div className="relative aspect-[4/3] bg-[#f7f8f8]">
                        <SmartImage
                          src={row.preview_url ?? ''}
                          alt={row.title}
                          fill
                          sizes="(min-width:1280px) 33vw, (min-width:768px) 50vw, 100vw"
                          className="object-contain p-2"
                        />
                      </div>
                      <div className="space-y-1 border-t border-line p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-sand px-2 py-0.5 text-[0.62rem] font-semibold text-ink-soft">
                            {CASE_DOCUMENT_KIND_LABELS[row.kind]}
                          </span>
                          {row.is_latest && <Badge tone="success">最新版</Badge>}
                          {row.revision_label && <span className="text-[0.65rem] text-muted">{row.revision_label}</span>}
                        </div>
                        <p className="font-semibold">{row.title}</p>
                        <p className="truncate text-[0.68rem] text-muted">{row.file_name}</p>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-[0.68rem] text-muted">
                            {row.document_date ? formatDate(row.document_date) : '日付未登録'}
                          </span>
                          {row.url && (
                            <a href={row.url} target="_blank" rel="noopener" className="text-xs font-semibold text-[#2f6b4f] underline underline-offset-4">
                              大きく見る
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">資料一覧</h4>
                <span className="text-xs text-muted">{nonContractDocuments.length + 1}件（現在の見積書を含む）</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm" data-testid="case-document-list">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-sand px-2 py-0.5 text-[0.62rem] font-semibold text-ink-soft">見積</span>
                      <Badge tone="success">現在</Badge>
                    </div>
                    <p className="mt-1 font-semibold">正式見積書 第{quote.revision}版</p>
                    <p className="text-[0.68rem] text-muted">{quote.quote_no}／発行 {formatDate(quote.issued_at)}</p>
                  </div>
                  <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm">開く</a>
                </div>
                {nonContractDocuments.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-sand px-2 py-0.5 text-[0.62rem] font-semibold text-ink-soft">
                          {CASE_DOCUMENT_KIND_LABELS[row.kind]}
                        </span>
                        {row.is_latest && <Badge tone="success">最新版</Badge>}
                        {row.revision_label && <span className="text-[0.65rem] text-muted">{row.revision_label}</span>}
                      </div>
                      <p className="mt-1 font-semibold">{row.title}</p>
                      <p className="text-[0.68rem] text-muted">
                        {row.file_name}
                        {row.document_date ? `／${formatDate(row.document_date)}` : ''}
                      </p>
                      {row.note && <p className="mt-1 text-[0.68rem] leading-5 text-ink-soft">{row.note}</p>}
                    </div>
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noopener" className="btn-secondary btn-sm">開く</a>
                    ) : (
                      <span className="rounded-md bg-[#f7f8f8] px-2 py-1 text-[0.65rem] text-muted">原本保管は未実装</span>
                    )}
                  </div>
                ))}
                {nonContractDocuments.length === 0 && (
                  <div className="px-3 py-5 text-sm text-muted">
                    案件資料はまだ登録されていません。正式な案件資料アップロード機能は次工程で実装します。
                  </div>
                )}
              </div>
            </div>
          </section>
        </section>
      )}

      {activeTab === 'production' && (
        <section className="space-y-4" data-testid="case-tab-production">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">製造・施工</h2>
                <Badge tone="neutral">参考表示</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                現在の見積・保存済み仕様から製造前提と施工範囲を確認します。製造開始・完了、搬入日、施工進捗などの正式な工程管理はまだ行いません。
              </p>
            </div>
            <Link href={tabHref('plan')} className="btn-secondary btn-sm">
              プランボードを確認
            </Link>
          </div>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-production-reference">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">製造前提</h3>
                <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[0.62rem] font-semibold text-[#8a6416]">
                  未確定
                </span>
              </div>
              <span className="text-[0.65rem] text-muted">既存データからの参考表示</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              以下は製造指示書や製造確定仕様ではありません。正式な契約・製造指示と対象Revisionの固定は次工程です。
            </p>

            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">モデル</dt>
                <dd className="mt-1 font-semibold">{quote.base_model_name}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">棟数</dt>
                <dd className="mt-1 font-semibold">{caseUnitCount ?? '未登録'}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">防火仕様</dt>
                <dd className="mt-1 font-semibold">{fireSelection}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">設置予定地</dt>
                <dd className="mt-1 font-semibold">{siteAddress}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">注文範囲</dt>
                <dd className="mt-1 font-semibold">{FINISH_LEVEL_INFO[quote.finish_level].name}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">参照見積</dt>
                <dd className="mt-1 font-semibold">{quote.quote_no}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">第{quote.revision}版／製造用には未固定</p>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3 sm:col-span-2">
                <dt className="text-xs text-muted">案件構成・申し送り</dt>
                <dd className="mt-1 text-sm font-semibold leading-5">{caseStructureNote ?? '未登録'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm" data-testid="case-installation-scope">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h3 className="font-semibold">見積に含まれる施工・搬入範囲</h3>
                <p className="mt-0.5 text-xs text-muted">
                  現在の見積明細で「現場工事」として保存されている項目を表示しています。実施済み・発注済みを意味しません。
                </p>
              </div>
              <div className="text-right">
                <p className="text-[0.65rem] text-muted">{installationItems.length}項目</p>
                <p className="text-sm font-semibold">{formatYen(installationSubtotal)}</p>
              </div>
            </div>

            {installationItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="bg-[#f7f8f8] text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">項目</th>
                      <th className="px-3 py-2 font-semibold">数量</th>
                      <th className="px-3 py-2 font-semibold">単位</th>
                      <th className="px-3 py-2 text-right font-semibold">見積金額</th>
                      <th className="px-3 py-2 font-semibold">備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installationItems.map((item) => (
                      <tr key={item.id} className="border-t border-line align-top">
                        <td className="px-3 py-2 font-medium text-ink">{item.name}</td>
                        <td className="px-3 py-2">{item.quantity.toLocaleString('ja-JP')}</td>
                        <td className="px-3 py-2">{item.unit ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatYen(item.amount)}</td>
                        <td className="px-3 py-2 text-xs leading-5 text-ink-soft">{item.remark ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-5 text-sm text-muted">
                現在の見積には、施工・搬入範囲として表示できる現場工事項目がありません。
              </div>
            )}
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-production-future">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">正式な工程管理</h3>
              <span className="rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-semibold text-muted">今後対応予定</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              製造開始日、製造完了日、製造個体番号、搬入予定日、施工予定日、担当組織・担当者、各工程の進捗を保存する正式機能はまだありません。
              見積に項目があることを、製造済み・搬入済み・施工済みとは扱いません。
            </p>
          </section>
        </section>
      )}

      {activeTab === 'handover' && (
        <section className="space-y-4" data-testid="case-tab-handover">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">引渡し・アフター</h2>
                <Badge tone="neutral">参考表示</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                現在の案件情報から引渡し対象の前提だけを確認します。引渡し完了・保証開始・点検実施などの正式な状態はまだ管理していません。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Link href={tabHref('production')} className="btn-secondary btn-sm">
                製造・施工を確認
              </Link>
              <Link href={tabHref('documents')} className="btn-secondary btn-sm">
                契約・資料を確認
              </Link>
            </div>
          </div>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-handover-reference">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">引渡し対象の前提</h3>
                <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[0.62rem] font-semibold text-[#8a6416]">
                  未確定
                </span>
              </div>
              <span className="text-[0.65rem] text-muted">既存データからの参考表示</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              以下は引渡し確定情報ではありません。正式な契約、製造・施工完了、引渡し対象Revisionの固定後に確定する想定です。
            </p>

            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">顧客</dt>
                <dd className="mt-1 font-semibold">{customerCompany || customerName}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">設置予定地</dt>
                <dd className="mt-1 font-semibold">{siteAddress}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">モデル・棟数</dt>
                <dd className="mt-1 font-semibold">
                  {quote.base_model_name}／{caseUnitCount ?? '棟数未登録'}
                </dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">参照見積</dt>
                <dd className="mt-1 font-semibold">{quote.quote_no}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">第{quote.revision}版／引渡し用には未固定</p>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-handover-readiness">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">完了確認・引渡し</h3>
              <span className="rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-semibold text-muted">正式管理は未実装</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              現在は保存先がないため、未登録を「未完了」とは判定しません。正式実装時に、完了確認と引渡しを施工進捗から独立した記録として扱います。
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['完了確認', '正式保存先なし'],
                ['引渡し日', '正式保存先なし'],
                ['引渡し確認', '正式保存先なし'],
                ['引渡し資料', '正式保存先なし'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-[#fbfcfb] p-3">
                  <p className="text-xs font-semibold text-muted">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-aftercare-future">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">保証・点検・アフター対応</h3>
              <span className="rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-semibold text-muted">今後対応予定</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              保証開始日・保証期限、点検予定・点検履歴、不具合・修理・問い合わせなどのアフター対応履歴を保存する正式機能はまだありません。
              現在の見積承諾や案件メモを、引渡し済み・保証中・点検済みとは扱いません。
            </p>
          </section>
        </section>
      )}

      {activeTab === 'disaster' && (
        <section className="space-y-4" data-testid="case-tab-disaster">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">災害時提供</h2>
                <Badge tone="neutral">未判定</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                案件情報から災害時提供を検討するための前提だけを確認します。現在は提供可否・供給可能棟数を判定しません。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Link href={tabHref('handover')} className="btn-secondary btn-sm">
                引渡し・アフターを確認
              </Link>
              <Link href={tabHref('production')} className="btn-secondary btn-sm">
                製造・施工を確認
              </Link>
            </div>
          </div>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-disaster-reference">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">提供検討の前提</h3>
                <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[0.62rem] font-semibold text-[#8a6416]">
                  参考情報
                </span>
              </div>
              <span className="text-[0.65rem] text-muted">既存案件データから表示</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              以下は完成個体の在庫情報や現在地ではありません。案件の見積・設置予定情報を、災害時提供の検討材料として表示しています。
            </p>

            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">モデル</dt>
                <dd className="mt-1 font-semibold">{quote.base_model_name}</dd>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">案件上の棟数</dt>
                <dd className="mt-1 font-semibold">{caseUnitCount ?? '未登録'}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">供給可能棟数ではありません</p>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">設置予定地</dt>
                <dd className="mt-1 font-semibold">{siteAddress}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">完成個体の現在地ではありません</p>
              </div>
              <div className="rounded-lg bg-[#f7f9f8] p-3">
                <dt className="text-xs text-muted">顧客・案件先</dt>
                <dd className="mt-1 font-semibold">{customerCompany || customerName}</dd>
                <p className="mt-1 text-[0.65rem] text-muted">提供意思は未登録</p>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-disaster-readiness">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">供給可否の確認項目</h3>
              <span className="rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-semibold text-muted">正式管理は未実装</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              未登録を「提供不可」とは扱いません。正式実装時に、所有・契約関係、完成状態、現在地、移動可否などを確認したうえで供給可否を判定します。
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['災害時の提供意思', '正式保存先なし'],
                ['完成個体', '正式保存先なし'],
                ['現在地', '正式保存先なし'],
                ['移動・運搬可否', '正式保存先なし'],
                ['即時提供可否', '正式保存先なし'],
                ['供給可能棟数', '正式保存先なし'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-[#fbfcfb] p-3">
                  <p className="text-xs font-semibold text-muted">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-disaster-future">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">正式な災害時供給管理</h3>
              <span className="rounded-full bg-sand px-2 py-0.5 text-[0.65rem] font-semibold text-muted">今後対応予定</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              提供意思の同意・撤回、対象となる完成個体、現在地、移動・運搬条件、即時提供可否、供給可能棟数を保存・集計する正式機能はまだありません。
              現在の案件棟数や設置予定地だけから「供給可能」と判定しません。
            </p>
          </section>
        </section>
      )}
    </div>
  );
}
