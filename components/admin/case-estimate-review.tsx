import Link from 'next/link';
import { getStore, type SessionUser } from '@/lib/data/store';
import { QUOTE_STATUS_LABELS, type CaseDocument, type QuoteDraftItem } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { QuoteEstimateSheet } from '@/components/admin/quote-estimate-sheet';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル仕様',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅仕様',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

const ITEM_KIND_LABELS: Record<string, string> = {
  base: '本体',
  base_expense: '本体諸費用',
  interior_exterior: '内外装工事',
  interior_exterior_expense: '内外装諸費用',
  option: 'オプション',
  option_expense: 'オプション諸費用',
  installation: '別途',
  free: '自由明細',
  discount: '調整',
};

const DOCUMENT_KIND_LABELS: Partial<Record<CaseDocument['kind'], string>> = {
  floorplan: '平面図',
  elevation: '立面図',
  other: 'その他資料',
};

type ReviewTab = 'estimate' | 'plan' | 'drawing';

export type CaseEstimateReviewSelection =
  | { kind: 'quote'; id: string }
  | { kind: 'draft'; id: string };

function isReviewTab(value: string | undefined): value is ReviewTab {
  return value === 'estimate' || value === 'plan' || value === 'drawing';
}

function buildReviewHref({
  selection,
  query,
  tab,
}: {
  selection: CaseEstimateReviewSelection;
  query: string;
  tab: ReviewTab;
}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set(selection.kind, selection.id);
  params.set('detail_tab', tab);
  return `/admin/quote-management?${params.toString()}#case-estimate-review`;
}

function ReviewTabs({
  selection,
  query,
  activeTab,
}: {
  selection: CaseEstimateReviewSelection;
  query: string;
  activeTab: ReviewTab;
}) {
  const tabs: Array<{ key: ReviewTab; label: string }> = [
    { key: 'estimate', label: '見積書' },
    { key: 'plan', label: 'プランボード' },
    { key: 'drawing', label: '図面' },
  ];

  return (
    <nav
      aria-label="案件見積の確認内容"
      className="flex items-center gap-1 border-b border-line px-3"
      data-testid="case-estimate-review-tabs"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={buildReviewHref({ selection, query, tab: tab.key })}
          aria-current={activeTab === tab.key ? 'page' : undefined}
          className={
            activeTab === tab.key
              ? 'min-h-10 border-b-2 border-forest px-4 py-2 text-sm font-semibold text-forest'
              : 'min-h-10 border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-muted hover:border-line hover:text-ink'
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function EmptyPlanNotice({
  modelName,
  specCode,
  selectionNames,
  draft = false,
}: {
  modelName: string;
  specCode: string | null | undefined;
  selectionNames: string[];
  draft?: boolean;
}) {
  return (
    <section className="space-y-3 p-4" data-testid="case-estimate-plan-unavailable">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-[#f7f9f8] p-3">
          <p className="text-xs text-muted">商品モデル</p>
          <p className="mt-1 font-semibold">{modelName}</p>
        </div>
        <div className="rounded-lg bg-[#f7f9f8] p-3">
          <p className="text-xs text-muted">仕様</p>
          <p className="mt-1 font-semibold">{specCode ? (SPEC_LABELS[specCode] ?? specCode) : '未登録'}</p>
        </div>
      </div>
      {selectionNames.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-3" data-testid="case-estimate-plan-selections">
          <p className="text-xs font-semibold text-muted">保存済み見積の選択内容</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectionNames.slice(0, 12).map((name, index) => (
              <span key={`${name}-${index}`} className="rounded-full border border-line bg-[#f7f9f8] px-2 py-1 text-xs">
                {name}
              </span>
            ))}
            {selectionNames.length > 12 && (
              <span className="rounded-full border border-line bg-white px-2 py-1 text-xs text-muted">
                ほか {selectionNames.length - 12}件
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            見積明細に保存された項目名の確認です。平面図上の配置や発行時点のプランSnapshotを表すものではありません。
          </p>
        </section>
      )}

      <Alert tone="info" title="プランボードは現在準備中です">
        {draft
          ? 'Draftに対して、正式なプランSnapshotを固定して確認する契約は現在ありません。案件管理側の保存済み仕様と混同しないため、この確認画面ではプラン画像を表示していません。'
          : 'Quote Revisionに発行時点の平面図・完成イメージを固定する契約を現在確認できないため、現在のConfigurationやlive masterを発行時点のプランとして表示していません。'}
      </Alert>
    </section>
  );
}

function DraftItemTable({ items }: { items: QuoteDraftItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line" data-testid="case-estimate-draft-items">
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="bg-[#eef3f2] text-[#536771]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">区分</th>
            <th className="px-3 py-2 text-left font-semibold">品名</th>
            <th className="px-3 py-2 text-right font-semibold">数量</th>
            <th className="px-3 py-2 text-left font-semibold">単位</th>
            <th className="px-3 py-2 text-right font-semibold">単価</th>
            <th className="px-3 py-2 text-right font-semibold">金額</th>
            <th className="px-3 py-2 text-left font-semibold">備考</th>
          </tr>
        </thead>
        <tbody>
          {items
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item) => {
              const separate = item.unit_price === 0 && item.remark?.trim() === '別途見積';
              return (
                <tr key={item.id} className="border-t border-line">
                  <td className="px-3 py-2 text-xs text-muted">{ITEM_KIND_LABELS[item.kind] ?? item.kind}</td>
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-3 py-2">{item.unit || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{separate ? '別途見積' : formatYen(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{separate ? '—' : formatYen(item.amount)}</td>
                  <td className="px-3 py-2 text-xs text-muted">{item.remark || '—'}</td>
                </tr>
              );
            })}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                保存済み明細はありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export async function CaseEstimateReview({
  selection,
  actor,
  query,
  requestedTab,
  listModelName,
}: {
  selection: CaseEstimateReviewSelection;
  actor: SessionUser;
  query: string;
  requestedTab?: string;
  listModelName: string;
}) {
  const store = await getStore();
  const activeTab: ReviewTab = isReviewTab(requestedTab) ? requestedTab : 'estimate';

  if (selection.kind === 'draft') {
    const detail = await store.getQuoteDraft(selection.id, actor);
    if (!detail) {
      return (
        <Alert tone="warn">
          選択したDraftを読み込めませんでした。案件見積一覧から別の見積を選択してください。
        </Alert>
      );
    }

    const { draft, items, request } = detail;
    const caseName = request.case_name?.trim() || request.contact.full_name || '案件名未設定';
    const caseOpenHref = `/admin/quotes?request=${encodeURIComponent(draft.quote_request_id)}#pending-quote-request`;

    return (
      <section
        id="case-estimate-review"
        className="scroll-mt-3 overflow-hidden rounded-lg border border-line bg-white shadow-sm"
        data-testid="case-estimate-review"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold text-muted">選択中の案件見積</p>
              <Badge tone="neutral">Draft</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="truncate text-lg font-semibold">{caseName}</h2>
              <span className="font-mono text-xs text-muted">見積番号 未発行</span>
              <span className="text-xs text-muted">版 Draft</span>
              <span className="text-xs font-semibold text-amber-800">下書き</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              顧客 {request.contact.full_name}
              {request.contact.company_name ? ` ／ ${request.contact.company_name}` : ''}
            </p>
          </div>
          <Link href={caseOpenHref} className="btn-primary btn-sm" data-testid="case-estimate-open-case">
            案件管理で開く
          </Link>
        </header>

        <ReviewTabs selection={selection} query={query} activeTab={activeTab} />

        {activeTab === 'estimate' && (
          <div className="space-y-3 p-4" data-testid="case-estimate-tab-estimate">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">保存済みDraft内容</h3>
                <p className="mt-0.5 text-xs text-muted">確認専用です。編集は案件管理から行います。</p>
              </div>
              <span className="text-xs text-muted">更新 {formatDate(draft.updated_at, true)}</span>
            </div>

            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-[#f7f9f8] p-3"><dt className="text-xs text-muted">商品モデル</dt><dd className="mt-1 font-semibold">{listModelName || draft.base_model_id}</dd></div>
              <div className="rounded-lg bg-[#f7f9f8] p-3"><dt className="text-xs text-muted">仕様</dt><dd className="mt-1 font-semibold">{SPEC_LABELS[draft.spec_code] ?? draft.spec_code}</dd></div>
              <div className="rounded-lg bg-[#f7f9f8] p-3"><dt className="text-xs text-muted">状態</dt><dd className="mt-1 font-semibold">下書き</dd></div>
              <div className="rounded-lg bg-[#f7f9f8] p-3"><dt className="text-xs text-muted">PDF</dt><dd className="mt-1 font-semibold text-muted">未発行のためなし</dd></div>
            </dl>

            <DraftItemTable items={items} />

            <dl className="ml-auto grid w-full max-w-md gap-1 text-sm">
              <div className="flex items-center justify-between border-b border-line py-1"><dt>明細合計</dt><dd className="font-semibold tabular-nums">{formatYen(draft.subtotal_raw)}</dd></div>
              <div className="flex items-center justify-between border-b border-line py-1"><dt>調整額</dt><dd className="font-semibold tabular-nums">{formatYen(draft.adjustment)}</dd></div>
              <div className="flex items-center justify-between border-b border-line py-1"><dt>税抜請負額</dt><dd className="font-semibold tabular-nums">{formatYen(draft.subtotal)}</dd></div>
              <div className="flex items-center justify-between border-b border-line py-1"><dt>消費税</dt><dd className="font-semibold tabular-nums">{formatYen(draft.tax)}</dd></div>
              <div className="flex items-center justify-between py-1.5 text-base"><dt className="font-semibold">合計（税込）</dt><dd className="font-bold tabular-nums">{formatYen(draft.total)}</dd></div>
            </dl>
          </div>
        )}

        {activeTab === 'plan' && (
          <EmptyPlanNotice
            modelName={listModelName || draft.base_model_id}
            specCode={draft.spec_code}
            selectionNames={items
              .filter((item) => !item.kind.includes('expense') && item.kind !== 'discount')
              .map((item) => item.name)}
            draft
          />
        )}

        {activeTab === 'drawing' && (
          <section className="p-4" data-testid="case-estimate-tab-drawing">
            <Alert tone="info" title="図面は現在準備中です">
              Draftには発行時点の正式図面versionを固定する契約がありません。案件管理側の現在資料をDraftの正式図面として見せないため、この画面では表示していません。
            </Alert>
          </section>
        )}
      </section>
    );
  }

  const detail = await store.getQuote(selection.id, actor);
  if (!detail) {
    return (
      <Alert tone="warn">
        選択した見積を読み込めませんでした。案件見積一覧から別の見積を選択してください。
      </Alert>
    );
  }

  const { quote, items, request } = detail;
  const caseName = request?.case_name?.trim() || quote.customer_company || quote.customer_name || '案件名未設定';
  const specCode = quote.spec_code ?? null;
  const caseOpenHref = `/admin/quotes?case=${encodeURIComponent(quote.id)}&tab=estimate#case-workspace`;
  const drawingDocuments =
    activeTab === 'drawing'
      ? (await store.listCaseDocuments(quote.id, actor))
          .filter((document) => document.kind === 'floorplan' || document.kind === 'elevation' || document.kind === 'other')
          .sort((a, b) => a.sort_order - b.sort_order)
      : [];

  return (
    <section
      id="case-estimate-review"
      className="scroll-mt-3 overflow-hidden rounded-lg border border-line bg-white shadow-sm"
      data-testid="case-estimate-review"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold text-muted">選択中の案件見積</p>
            <Badge tone={quote.status === 'accepted' ? 'success' : quote.status === 'issued' ? 'navy' : 'neutral'}>
              {QUOTE_STATUS_LABELS[quote.status]}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="truncate text-lg font-semibold">{caseName}</h2>
            <span className="font-mono text-xs text-muted">{quote.quote_no}</span>
            <span className="text-xs text-muted">第{quote.revision}版</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            顧客 {quote.customer_name}
            {quote.customer_company ? ` ／ ${quote.customer_company}` : ''}
          </p>
        </div>
        <Link href={caseOpenHref} className="btn-primary btn-sm" data-testid="case-estimate-open-case">
          案件管理で開く
        </Link>
      </header>

      <ReviewTabs selection={selection} query={query} activeTab={activeTab} />

      {activeTab === 'estimate' && (
        <div className="space-y-3 p-4" data-testid="case-estimate-tab-estimate">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <div><dt className="inline text-muted">発行日 </dt><dd className="inline font-semibold">{formatDate(quote.issued_at)}</dd></div>
              <div><dt className="inline text-muted">有効期限 </dt><dd className="inline font-semibold">{formatDate(quote.valid_until)}</dd></div>
              <div><dt className="inline text-muted">商品モデル </dt><dd className="inline font-semibold">{quote.base_model_name}</dd></div>
              <div><dt className="inline text-muted">仕様 </dt><dd className="inline font-semibold">{specCode ? (SPEC_LABELS[specCode] ?? specCode) : '未登録'}</dd></div>
            </dl>
            <a
              href={`/api/quotes/${quote.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary btn-sm"
              data-testid="case-estimate-pdf-link"
            >
              見積書PDF
            </a>
          </div>

          <QuoteEstimateSheet
            quote={quote}
            items={items}
            freeProducts={[]}
            catalog={[]}
            canEditBase={false}
            canRevise={false}
          />

          <p className="text-xs leading-5 text-muted">
            発行済み見積は確認専用です。この画面では明細を直接編集しません。変更する場合は「案件管理で開く」から次の見積を作成します。
          </p>
        </div>
      )}

      {activeTab === 'plan' && (
        <EmptyPlanNotice
          modelName={quote.base_model_name}
          specCode={specCode}
          selectionNames={items
            .filter((item) => !item.kind.includes('expense') && item.kind !== 'discount')
            .map((item) => item.name)}
        />
      )}

      {activeTab === 'drawing' && (
        <section className="space-y-3 p-4" data-testid="case-estimate-tab-drawing">
          <Alert tone="info" title="図面のversionについて">
            下記はこの案件見積に紐づく登録済み資料です。発行時点に使用した正式図面versionとして固定されていることまでは保証しないため、現在の正式図面とは表示しません。
          </Alert>

          {drawingDocuments.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2" data-testid="case-estimate-drawing-list">
              {drawingDocuments.map((document) => (
                <article key={document.id} className="overflow-hidden rounded-lg border border-line bg-white">
                  {document.preview_url && (
                    <div className="relative aspect-[16/9] border-b border-line bg-sand">
                      <SmartImage
                        src={document.preview_url}
                        alt={document.title}
                        fill
                        sizes="(min-width: 768px) 50vw, 100vw"
                        className="object-contain p-2"
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{document.title}</h3>
                      <Badge tone="neutral">{DOCUMENT_KIND_LABELS[document.kind] ?? '図面'}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {document.revision_label ? `版 ${document.revision_label} ／ ` : ''}
                      {document.document_date ? `日付 ${document.document_date}` : '日付未登録'}
                    </p>
                    {document.note && <p className="mt-2 text-xs leading-5 text-ink-soft">{document.note}</p>}
                    {document.url && (
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noopener"
                        className="mt-2 inline-flex text-sm font-semibold text-forest underline underline-offset-4"
                      >
                        資料を開く
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              安全に紐づけて表示できる平面図・立面図・その他図面は現在ありません。
            </div>
          )}
        </section>
      )}
    </section>
  );
}
