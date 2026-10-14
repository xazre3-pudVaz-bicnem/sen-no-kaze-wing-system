import { getStore, type SessionUser } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import {
  deleteScheduleItemAction,
  sendManufacturingOrderAction,
  setManufacturingOrderStatusAction,
  setProgressReportVisibilityAction,
  updateManufacturingUnitAction,
} from '@/lib/actions/case-flow';
import {
  MANUFACTURER_PROGRESS_KINDS,
  MANUFACTURER_SCHEDULE_CATEGORIES,
  MANUFACTURING_ORDER_STATUS_LABELS,
  PROGRESS_KIND_LABELS,
  SCHEDULE_CATEGORIES,
  SCHEDULE_CATEGORY_LABELS,
  SCHEDULE_STATUS_LABELS,
  UNIT_STATUSES,
  UNIT_STATUS_LABELS,
  canChangeOrderStatus,
  canSetUnitStatus,
  type CaseAccess,
  type ManufacturingOrderStatus,
  type ProgressKind,
  type ScheduleCategory,
} from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { CaseFileList } from '@/components/case-flow/case-site-panels';
import { CaseFileUploadForm, ManufacturingOrderForm, ProgressReportForm, ScheduleItemForm } from '@/components/case-flow/forms';

const DONE_TEXT: Record<string, string> = {
  order_sent: '製造依頼を総代理店へ送りました。',
  order_status: '製造依頼の状態を更新しました。',
  unit: '個体の状態を更新しました。',
  schedule_deleted: '工程を削除しました。',
  report_visibility: 'お客様への表示を切り替えました。',
};

const ORDER_NEXT: { to: ManufacturingOrderStatus; label: string }[] = [
  { to: 'received', label: '製造依頼を受領する' },
  { to: 'in_production', label: '製造を始める' },
  { to: 'shipped', label: '出荷した' },
  { to: 'completed', label: '設置まで完了した' },
];

function Section({ title, badge, children, testId }: { title: string; badge?: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

/**
 * 案件画面の「製造・施工」タブ：製造依頼と個体（フェーズ11）、工程表（フェーズ12）、施工の記録と写真（フェーズ13）。
 * 本部・担当代理店・製造の担当（総代理店）だけに表示する。お客様に見せるかは、項目ごとに担当代理店・本部が決める。
 */
export async function CaseProductionPanels({ quoteId, actor, flash }: { quoteId: string; actor: SessionUser; flash?: { done?: string; error?: string } }) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail) return null;
  const requestId = detail.quote.quote_request_id;
  const caseFlow = await getCaseFlowStore();
  const access: CaseAccess | null = await caseFlow.getCaseAccess(actor, requestId);
  if (!access || access === 'customer') return null;
  const isAdmin = access === 'admin';
  const canOperate = access === 'admin' || access === 'staff';
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

  const [order, workflow, contracts, scheduleItems, reports, files] = await Promise.all([
    caseFlow.getManufacturingOrder(actor, requestId),
    caseFlow.getCaseWorkflow(actor, requestId),
    store.listElectronicContracts(requestId, actor),
    caseFlow.listScheduleItems(actor, requestId),
    caseFlow.listProgressReports(actor, requestId),
    caseFlow.listCaseFiles(actor, requestId),
  ]);
  const units = order ? await caseFlow.listManufacturingUnits(actor, order.id) : [];
  const hasSignedContract = contracts.some((c) => c.status === 'signed');
  const scheduleCategories: ScheduleCategory[] = access === 'manufacturer' ? MANUFACTURER_SCHEDULE_CATEGORIES : [...SCHEDULE_CATEGORIES];
  const reportKinds: ProgressKind[] = access === 'manufacturer' ? MANUFACTURER_PROGRESS_KINDS : ['progress', 'completion', 'inspection', 'support'];
  const back = `/admin/quotes/${quoteId}?tab=production`;
  const progressFiles = files.filter((file) => file.context === 'progress');

  return (
    <div className="mt-2 space-y-2" id="case-flow-production">
      {flash?.error && <Alert tone="danger">{flash.error}</Alert>}
      {flash?.done && DONE_TEXT[flash.done] && <Alert tone="success">{DONE_TEXT[flash.done]}</Alert>}

      <Section
        title="製造依頼と個体"
        testId="manufacturing-order-panel"
        badge={order ? <Badge tone={order.status === 'draft' ? 'warn' : 'success'}>{MANUFACTURING_ORDER_STATUS_LABELS[order.status]}</Badge> : <Badge tone="neutral">未作成</Badge>}
      >
        {!order ? (
          canOperate && hasSignedContract ? (
            <ManufacturingOrderForm quoteId={quoteId} requestId={requestId} order={null} canEditSupply={false} today={today} />
          ) : (
            <p className="text-sm text-muted">{hasSignedContract ? '製造依頼は担当代理店か本部が作ります。' : '契約が締結されてから、製造依頼を作れます。'}</p>
          )
        ) : (
          <div className="space-y-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">注文番号</dt>
                <dd>{order.order_no ?? '採番の形式の確定待ち'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">棟数</dt>
                <dd>{order.unit_count} 棟</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">希望納期</dt>
                <dd>{order.requested_delivery_on ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">送った日</dt>
                <dd>{order.sent_at ? formatDate(order.sent_at) : '—'}</dd>
              </div>
            </dl>
            {order.spec_note && <p className="whitespace-pre-wrap rounded bg-[#f7f8f8] p-2 text-xs">製造仕様のメモ：{order.spec_note}</p>}
            {order.spec_snapshot && (
              <details className="rounded-lg border border-line p-2 text-xs">
                <summary className="cursor-pointer font-semibold">
                  製造仕様（{order.spec_snapshot.quote_no} 第{order.spec_snapshot.revision ?? '—'}版・{order.spec_snapshot.base_model_name}）
                </summary>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {order.spec_snapshot.items.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      {item.name}　{String(item.quantity)}
                      {item.unit ?? ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(order.status === 'draft' || isAdmin) && (
              <ManufacturingOrderForm quoteId={quoteId} requestId={requestId} order={order} canEditSupply={isAdmin} today={today} />
            )}
            {!isAdmin && order.supply_note && <p className="text-xs text-ink-soft">基幹資材の供給手配：{order.supply_note}</p>}
            <div className="flex flex-wrap gap-2">
              {order.status === 'draft' && canOperate && (
                <form action={sendManufacturingOrderAction}>
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="request_id" value={requestId} />
                  <input type="hidden" name="order_id" value={order.id} />
                  <input type="hidden" name="expected_lock_version" value={order.lock_version} />
                  <button type="submit" className="btn-primary btn-sm" disabled={!workflow?.manufacturer_id}>
                    総代理店へ製造依頼を送る
                  </button>
                  {!workflow?.manufacturer_id && <p className="mt-1 text-[0.65rem] text-muted">先に本部が「現地確認」タブで技術検討・製造の担当を決めてください。</p>}
                </form>
              )}
              {ORDER_NEXT.filter((step) => canChangeOrderStatus(access, order.status, step.to)).map((step) => (
                <form key={step.to} action={setManufacturingOrderStatusAction}>
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="request_id" value={requestId} />
                  <input type="hidden" name="order_id" value={order.id} />
                  <input type="hidden" name="expected_lock_version" value={order.lock_version} />
                  <input type="hidden" name="status" value={step.to} />
                  <button type="submit" className="btn-secondary btn-sm">
                    {step.label}
                  </button>
                </form>
              ))}
            </div>
            {canChangeOrderStatus(access, order.status, 'canceled') && (
              <details className="text-xs">
                <summary className="cursor-pointer text-danger">製造依頼を取り消す（本部）</summary>
                <form action={setManufacturingOrderStatusAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="request_id" value={requestId} />
                  <input type="hidden" name="order_id" value={order.id} />
                  <input type="hidden" name="expected_lock_version" value={order.lock_version} />
                  <input type="hidden" name="status" value="canceled" />
                  <input name="reason" required className="input h-9 min-w-64 flex-1 text-sm" placeholder="取り消す理由" aria-label="取り消す理由" maxLength={1000} />
                  <button type="submit" className="btn-secondary btn-sm">
                    取り消す
                  </button>
                </form>
              </details>
            )}
            {units.length > 0 && order.status !== 'draft' && (
              <div className="overflow-x-auto rounded-lg border border-line" data-testid="manufacturing-units">
                <table className="w-full min-w-[44rem] text-left text-xs">
                  <thead className="bg-[#f7f8f8] text-muted">
                    <tr>
                      <th className="px-3 py-2">棟</th>
                      <th className="px-3 py-2">個体番号</th>
                      <th className="px-3 py-2">状態</th>
                      <th className="px-3 py-2">製造・検査・出荷・設置・引渡し</th>
                      <th className="px-3 py-2">記録する</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((unit) => {
                      const options = UNIT_STATUSES.filter((status) => canSetUnitStatus(access, unit.status, status));
                      return (
                        <tr key={unit.id} className="border-t border-line align-top">
                          <td className="px-3 py-2">{unit.seq}</td>
                          <td className="px-3 py-2">{unit.unit_no ?? '採番待ち'}</td>
                          <td className="px-3 py-2">{UNIT_STATUS_LABELS[unit.status]}</td>
                          <td className="px-3 py-2 text-muted">
                            {[unit.produced_on, unit.inspected_on, unit.shipped_on, unit.installed_on, unit.handed_over_on].map((d) => d ?? '—').join(' / ')}
                          </td>
                          <td className="px-3 py-2">
                            <form action={updateManufacturingUnitAction} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="quote_id" value={quoteId} />
                              <input type="hidden" name="request_id" value={requestId} />
                              <input type="hidden" name="unit_id" value={unit.id} />
                              <input type="hidden" name="current_status" value={unit.status} />
                              <input type="hidden" name="expected_lock_version" value={unit.lock_version} />
                              <select name="status" defaultValue={unit.status} className="input h-8 text-xs" aria-label={`${unit.seq}棟目の状態`}>
                                {options.map((status) => (
                                  <option key={status} value={status}>
                                    {UNIT_STATUS_LABELS[status]}
                                  </option>
                                ))}
                              </select>
                              <input type="date" name="status_date" max={today} className="input h-8 text-xs" aria-label="その状態になった日" />
                              <button type="submit" className="btn-secondary btn-sm">
                                記録
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="工程表" testId="case-schedule-panel" badge={<span className="text-[0.65rem] text-muted">お客様に表示する項目だけがマイページに出ます</span>}>
        {scheduleItems.length === 0 ? (
          <p className="text-xs text-muted">工程はまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {scheduleItems.map((item) => {
              const editable = access !== 'manufacturer' || MANUFACTURER_SCHEDULE_CATEGORIES.includes(item.category);
              return (
                <li key={item.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{SCHEDULE_CATEGORY_LABELS[item.category]}</Badge>
                    <span className="font-semibold">{item.title}</span>
                    <Badge tone={item.status === 'done' ? 'success' : item.status === 'delayed' ? 'danger' : 'neutral'}>{SCHEDULE_STATUS_LABELS[item.status]}</Badge>
                    {item.customer_visible && <Badge tone="navy">お客様に表示</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    予定 {item.planned_start ?? '—'}〜{item.planned_end ?? '—'}／実績 {item.actual_start ?? '—'}〜{item.actual_end ?? '—'}
                  </p>
                  {item.note && <p className="mt-1 text-xs text-muted">{item.note}</p>}
                  {editable && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs">編集する</summary>
                      <div className="mt-2 space-y-2">
                        <ScheduleItemForm quoteId={quoteId} requestId={requestId} item={item} categories={scheduleCategories} canSetVisible={canOperate} />
                        <form action={deleteScheduleItemAction}>
                          <input type="hidden" name="quote_id" value={quoteId} />
                          <input type="hidden" name="request_id" value={requestId} />
                          <input type="hidden" name="item_id" value={item.id} />
                          <button type="submit" className="text-[0.65rem] text-danger underline-offset-4 hover:underline">
                            この工程を削除
                          </button>
                        </form>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <details className="rounded-lg bg-[#fbfcfb] p-3">
          <summary className="cursor-pointer text-sm font-semibold">工程を追加する</summary>
          <div className="mt-3">
            <ScheduleItemForm quoteId={quoteId} requestId={requestId} item={null} categories={scheduleCategories} canSetVisible={canOperate} />
          </div>
        </details>
      </Section>

      <Section title="施工の記録・写真" testId="case-progress-panel">
        {reports.length === 0 ? (
          <p className="text-xs text-muted">記録はまだありません。</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((report) => (
              <li key={report.id} className="space-y-2 rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="neutral">{PROGRESS_KIND_LABELS[report.kind]}</Badge>
                  <span className="text-muted">
                    {report.reported_on}・{report.author_name}
                  </span>
                  {report.customer_visible ? <Badge tone="navy">お客様に表示</Badge> : <span className="text-muted">社内のみ</span>}
                  {canOperate && (
                    <form action={setProgressReportVisibilityAction}>
                      <input type="hidden" name="quote_id" value={quoteId} />
                      <input type="hidden" name="request_id" value={requestId} />
                      <input type="hidden" name="report_id" value={report.id} />
                      <input type="hidden" name="visible" value={report.customer_visible ? 'false' : 'true'} />
                      <button type="submit" className="underline-offset-4 hover:underline">
                        {report.customer_visible ? 'お客様に表示しない' : 'お客様に表示する'}
                      </button>
                    </form>
                  )}
                </div>
                <p className="font-semibold">{report.title}</p>
                {report.body && <p className="whitespace-pre-wrap text-ink-soft">{report.body}</p>}
                <CaseFileList files={progressFiles.filter((file) => file.context_id === report.id)} actor={actor} quoteId={quoteId} requestId={requestId} back={back} />
                <details>
                  <summary className="cursor-pointer text-xs">この記録に写真を登録する</summary>
                  <div className="mt-2">
                    <CaseFileUploadForm quoteId={quoteId} requestId={requestId} context="progress" contextId={report.id} allowCustomerVisible={canOperate} label="写真を登録" />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-lg bg-[#fbfcfb] p-3">
          <summary className="cursor-pointer text-sm font-semibold">記録を追加する</summary>
          <div className="mt-3">
            <ProgressReportForm
              quoteId={quoteId}
              requestId={requestId}
              kinds={reportKinds}
              scheduleItems={scheduleItems.map((item) => ({ id: item.id, label: `${SCHEDULE_CATEGORY_LABELS[item.category]}：${item.title}` }))}
              canSetVisible={canOperate}
              today={today}
            />
          </div>
        </details>
      </Section>
    </div>
  );
}
