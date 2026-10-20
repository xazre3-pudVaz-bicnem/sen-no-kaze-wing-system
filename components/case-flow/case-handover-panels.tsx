import Link from 'next/link';
import { getStore, type SessionUser } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import {
  addPunchItemAction,
  completeHandoverAction,
  recordCompletionCertificateAction,
  setPunchItemStatusAction,
  updateAfterServiceRequestAction,
} from '@/lib/actions/case-flow';
import {
  AFTER_SERVICE_KIND_LABELS,
  AFTER_SERVICE_STATUS_LABELS,
  CUSTOMER_CONFIRMATION_LABELS,
  DISASTER_DECISION_LABELS,
  HANDOVER_STATUS_LABELS,
  PUNCH_ITEM_STATUS_LABELS,
  STOCK_REGISTRATION_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  canSetPunchItemStatus,
  canUpdateAfterService,
  type AfterServiceStatus,
  type CaseAccess,
} from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { CaseFileList } from '@/components/case-flow/case-site-panels';
import { AfterServiceRequestForm, CaseFileUploadForm, HandoverInspectionForm } from '@/components/case-flow/forms';

const DONE_TEXT: Record<string, string> = {
  punch_added: '是正事項を追加しました。是正のあと、お客様にもう一度確認していただきます。',
  punch_status: '是正事項の状態を更新しました。',
  certificate: '工事完了承諾書の写しを記録しました。引渡し完了にできます。',
  handed_over: '引渡しを完了しました。設置済みの個体を引渡し済みにしました。',
  after_service: 'アフターを更新しました。',
};

const AFTER_SERVICE_STATUSES: AfterServiceStatus[] = ['open', 'in_progress', 'escalated', 'resolved'];

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

const todayJst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

/**
 * 案件画面の「引渡し・アフター」タブ：完成確認・是正・工事完了承諾書・引渡し（フェーズ14）と、アフター（フェーズ15）。
 * 本部・担当代理店・製造の担当（総代理店）に表示する。総代理店が見られるアフターは、回されたもの（製造起因）だけ。
 * 営業担当組織の管理者には読み取りだけで表示する（20261016150000）。
 */
export async function CaseHandoverPanels({ quoteId, actor, flash }: { quoteId: string; actor: SessionUser; flash?: { done?: string; error?: string } }) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail) return null;
  const requestId = detail.quote.quote_request_id;
  const caseFlow = await getCaseFlowStore();
  const caseAccess: CaseAccess | null = await caseFlow.getCaseAccess(actor, requestId);
  // 営業担当組織の管理者は、担当と同じものを読み取りだけで見る（編集は自分を主担当者にして行う）
  const readOnly = (!caseAccess || caseAccess === 'customer') && (await caseFlow.getCaseRole(actor, requestId)) === 'manager';
  if (!readOnly && (!caseAccess || caseAccess === 'customer')) return null;
  const access: CaseAccess = readOnly ? 'staff' : (caseAccess as CaseAccess);
  const canOperate = !readOnly && (access === 'admin' || access === 'staff');
  const today = todayJst();

  const [handover, punchItems, afterService, files, progress, order] = await Promise.all([
    caseFlow.getHandover(actor, requestId),
    caseFlow.listPunchItems(actor, requestId),
    caseFlow.listAfterServiceRequests(actor, requestId),
    caseFlow.listCaseFiles(actor, requestId),
    caseFlow.getCaseProgress(actor, requestId),
    caseFlow.getManufacturingOrder(actor, requestId),
  ]);
  const units = order ? await caseFlow.listManufacturingUnits(actor, order.id) : [];
  // 契約の表は本部とお客様しか読めないため、進み具合の「締結済み」で判定する（判定の正本は DB）
  const hasSignedContract = Boolean(progress?.contract_signed);
  const handedOver = handover?.status === 'handed_over';
  const openPunch = punchItems.filter((item) => item.status !== 'verified');
  const notInstalled = units.filter((unit) => unit.status !== 'installed' && unit.status !== 'handed_over');
  const handoverFiles = files.filter((file) => file.context === 'handover');
  const punchFiles = files.filter((file) => file.context === 'punch');
  const afterFiles = files.filter((file) => file.context === 'after_service');
  const certificate = handover?.certificate_file_id ? files.find((file) => file.id === handover.certificate_file_id) : null;
  const back = `/admin/quotes/${quoteId}?tab=handover`;

  return (
    <div className="mt-2 space-y-2" id="case-flow-handover">
      {flash?.error && <Alert tone="danger">{flash.error}</Alert>}
      {flash?.done && DONE_TEXT[flash.done] && <Alert tone="success">{DONE_TEXT[flash.done]}</Alert>}

      <Section
        title="完了確認・引渡し"
        testId="handover-panel"
        badge={handover ? <Badge tone={handedOver ? 'success' : handover.status === 'ready' ? 'navy' : 'warn'}>{HANDOVER_STATUS_LABELS[handover.status]}</Badge> : <Badge tone="neutral">未着手</Badge>}
      >
        {notInstalled.length > 0 && !handedOver && (
          <p className="rounded bg-[#fff8e6] px-3 py-2 text-xs text-[#8a6416]">
            設置済みになっていない個体が {notInstalled.length} 棟あります（「製造・施工」タブ）。引渡し完了で引渡し済みになるのは、設置済みの個体だけです。
          </p>
        )}
        {!handover ? (
          canOperate && hasSignedContract ? (
            <HandoverInspectionForm quoteId={quoteId} requestId={requestId} handover={null} today={today} />
          ) : (
            <p className="text-sm text-muted">{hasSignedContract ? '完成確認は担当代理店か本部が始めます。' : '契約が締結されてから、完成確認を始められます。'}</p>
          )
        ) : (
          <div className="space-y-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">完成確認の日</dt>
                <dd>{handover.inspection_on}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">お客様の確認</dt>
                <dd>
                  {CUSTOMER_CONFIRMATION_LABELS[handover.customer_confirmation]}
                  {handover.customer_confirmed_via === 'certificate' && <span className="text-xs text-muted">（承諾書で確認）</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">工事完了承諾書</dt>
                <dd>{handover.certificate_signed_on ? `署名日 ${handover.certificate_signed_on}` : '未記録'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">引渡し日</dt>
                <dd>{handover.handed_over_on ?? '—'}</dd>
              </div>
            </dl>
            {handover.inspection_summary && <p className="whitespace-pre-wrap rounded bg-[#f7f8f8] p-2 text-xs">完成確認の内容：{handover.inspection_summary}</p>}
            {certificate && (
              <p className="text-xs">
                承諾書の写し：
                <a href={`/api/case-files/${certificate.id}`} target="_blank" rel="noopener" className="font-semibold underline-offset-4 hover:underline">
                  {certificate.caption || certificate.file_name}
                </a>
              </p>
            )}

            <div className="space-y-2" data-testid="punch-items">
              <h4 className="text-sm font-semibold">是正事項</h4>
              {punchItems.length === 0 ? (
                <p className="text-xs text-muted">是正事項はありません。</p>
              ) : (
                <ul className="space-y-2">
                  {punchItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone={item.status === 'verified' ? 'success' : item.status === 'fixed' ? 'navy' : 'warn'}>{PUNCH_ITEM_STATUS_LABELS[item.status]}</Badge>
                          {item.raised_by_customer && <Badge tone="neutral">お客様の指摘</Badge>}
                          <span className="text-muted">{formatDate(item.created_at)}</span>
                          {item.fixed_on && <span className="text-muted">是正 {item.fixed_on}</span>}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{item.description}</p>
                      </div>
                      {!handedOver && (
                        <div className="flex gap-1">
                          {!readOnly && canSetPunchItemStatus(access, item.status, 'fixed') && (
                            <form action={setPunchItemStatusAction}>
                              <input type="hidden" name="quote_id" value={quoteId} />
                              <input type="hidden" name="request_id" value={requestId} />
                              <input type="hidden" name="item_id" value={item.id} />
                              <input type="hidden" name="status" value="fixed" />
                              <input type="hidden" name="expected_lock_version" value={item.lock_version} />
                              <button type="submit" className="btn-secondary btn-sm">
                                是正した
                              </button>
                            </form>
                          )}
                          {canOperate && canSetPunchItemStatus(access, item.status, 'verified') && (
                            <form action={setPunchItemStatusAction}>
                              <input type="hidden" name="quote_id" value={quoteId} />
                              <input type="hidden" name="request_id" value={requestId} />
                              <input type="hidden" name="item_id" value={item.id} />
                              <input type="hidden" name="status" value="verified" />
                              <input type="hidden" name="expected_lock_version" value={item.lock_version} />
                              <button type="submit" className="btn-secondary btn-sm" title="お客様と一緒に確認したときなど">
                                是正を確認した
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canOperate && !handedOver && (
                <form action={addPunchItemAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="request_id" value={requestId} />
                  <input type="hidden" name="expected_lock_version" value={handover.lock_version} />
                  <input name="description" required maxLength={1000} className="input h-9 min-w-64 flex-1 text-sm" placeholder="是正事項（例：外壁のキズの補修）" aria-label="是正事項" />
                  <button type="submit" className="btn-secondary btn-sm">
                    是正事項を追加
                  </button>
                </form>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">完了確認・是正の写真と書類</h4>
              <CaseFileList files={[...handoverFiles, ...punchFiles]} actor={actor} quoteId={quoteId} requestId={requestId} back={back} />
              {canOperate && !handedOver && (
                <details>
                  <summary className="cursor-pointer text-xs">写真・承諾書の写しを登録する</summary>
                  <div className="mt-2">
                    <CaseFileUploadForm quoteId={quoteId} requestId={requestId} context="handover" allowCustomerVisible label="登録する" />
                  </div>
                </details>
              )}
            </div>

            {canOperate && !handedOver && (
              <div className="space-y-2 rounded-lg bg-[#fbfcfb] p-3" data-testid="completion-certificate">
                <h4 className="text-sm font-semibold">工事完了承諾書（署名済みの写し）</h4>
                <p className="text-xs text-muted">
                  署名済みの承諾書を上の「写真・承諾書の写しを登録する」から登録し、ここで選んで記録します。記録はお客様の確認（書面）として扱います。
                  電子署名（GMOサイン）のテンプレートは準備待ちです。
                </p>
                {openPunch.length > 0 ? (
                  <p className="text-xs text-[#8a6416]">是正の確認が済んでいない是正事項が {openPunch.length} 件あります。確認が済んでから記録できます。</p>
                ) : handoverFiles.length === 0 ? (
                  <p className="text-xs text-muted">「完了確認・引渡し」の資料がまだ登録されていません。</p>
                ) : (
                  <form action={recordCompletionCertificateAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="quote_id" value={quoteId} />
                    <input type="hidden" name="request_id" value={requestId} />
                    <input type="hidden" name="inspection_on" value={handover.inspection_on} />
                    <input type="hidden" name="expected_lock_version" value={handover.lock_version} />
                    <label className="text-[0.65rem] text-muted">
                      承諾書の写し
                      <select name="file_id" required defaultValue={handover.certificate_file_id ?? ''} className="input h-9 text-sm">
                        <option value="" disabled>
                          選んでください
                        </option>
                        {handoverFiles.map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.caption || file.file_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[0.65rem] text-muted">
                      署名日
                      <input type="date" name="signed_on" required max={today} defaultValue={handover.certificate_signed_on ?? today} className="input h-9 text-sm" />
                    </label>
                    <button type="submit" className="btn-secondary btn-sm">
                      承諾書を記録する
                    </button>
                  </form>
                )}
              </div>
            )}

            {canOperate && handover.status === 'ready' && handover.certificate_file_id && (
              <form action={completeHandoverAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3" data-testid="complete-handover-form">
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <input type="hidden" name="inspection_on" value={handover.inspection_on} />
                <input type="hidden" name="expected_lock_version" value={handover.lock_version} />
                <label className="text-[0.65rem] text-muted">
                  引渡し日
                  <input type="date" name="handed_over_on" required min={handover.inspection_on} max={today} defaultValue={today} className="input h-9 text-sm" />
                </label>
                <button type="submit" className="btn-primary btn-sm">
                  引渡しを完了する
                </button>
                <p className="w-full text-[0.65rem] text-muted">引渡し完了で、設置済みの個体を引渡し済みにし、お客様のマイページでアフターのご依頼ができるようになります。</p>
              </form>
            )}

            {canOperate && !handedOver && (
              <details className="text-xs">
                <summary className="cursor-pointer">完成確認をやり直す</summary>
                <div className="mt-2">
                  <HandoverInspectionForm quoteId={quoteId} requestId={requestId} handover={handover} today={today} />
                </div>
              </details>
            )}
          </div>
        )}
      </Section>

      <Section
        title="アフター（定期点検・問い合わせ・修理）"
        testId="after-service-panel"
        badge={<span className="text-[0.65rem] text-muted">保証の期間・内容は先方の確認待ちです</span>}
      >
        {afterService.length === 0 ? (
          <p className="text-xs text-muted">{handedOver ? 'アフターの記録はまだありません。' : 'アフターは引渡しの後に登録できます。'}</p>
        ) : (
          <ul className="space-y-2">
            {afterService.map((row) => {
              const options = AFTER_SERVICE_STATUSES.filter((status) => status === row.status || canUpdateAfterService(access, row, status));
              return (
                <li key={row.id} className="space-y-2 rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="neutral">{AFTER_SERVICE_KIND_LABELS[row.kind]}</Badge>
                    <Badge tone={row.status === 'resolved' ? 'success' : row.status === 'escalated' ? 'navy' : 'warn'}>{AFTER_SERVICE_STATUS_LABELS[row.status]}</Badge>
                    {row.requested_by_customer && <Badge tone="neutral">お客様から</Badge>}
                    <span className="text-muted">{formatDate(row.created_at)}</span>
                  </div>
                  <p className="font-semibold">{row.title}</p>
                  {row.body && <p className="whitespace-pre-wrap text-ink-soft">{row.body}</p>}
                  {row.response && <p className="whitespace-pre-wrap rounded bg-[#f7f8f8] p-2 text-xs">お客様への回答：{row.response}</p>}
                  {!readOnly && canUpdateAfterService(access, row, row.status) && (
                    <form action={updateAfterServiceRequestAction} className="space-y-2">
                      <input type="hidden" name="quote_id" value={quoteId} />
                      <input type="hidden" name="request_id" value={requestId} />
                      <input type="hidden" name="after_service_id" value={row.id} />
                      <input type="hidden" name="current_status" value={row.status} />
                      <input type="hidden" name="expected_lock_version" value={row.lock_version} />
                      <div className="flex flex-wrap items-center gap-2">
                        <select name="status" defaultValue={row.status} className="input h-8 text-xs" aria-label="状態">
                          {options.map((status) => (
                            <option key={status} value={status}>
                              {status === 'escalated' && row.status !== 'escalated' ? '製造の担当（総代理店）へ回す' : AFTER_SERVICE_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn-secondary btn-sm">
                          更新
                        </button>
                      </div>
                      <textarea name="response" rows={2} maxLength={2000} defaultValue={row.response ?? ''} className="input w-full text-xs" placeholder="お客様への回答（お客様にも表示されます）" aria-label="お客様への回答" />
                    </form>
                  )}
                  <CaseFileList files={afterFiles.filter((file) => file.context_id === row.id)} actor={actor} quoteId={quoteId} requestId={requestId} back={back} />
                  {!readOnly && access !== 'manufacturer' && (
                    <details>
                      <summary className="cursor-pointer text-xs">このアフターに写真を登録する</summary>
                      <div className="mt-2">
                        <CaseFileUploadForm quoteId={quoteId} requestId={requestId} context="after_service" contextId={row.id} allowCustomerVisible={canOperate} label="写真を登録" />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canOperate && handedOver && (
          <details className="rounded-lg bg-[#fbfcfb] p-3">
            <summary className="cursor-pointer text-sm font-semibold">アフターを登録する（定期点検の予定など）</summary>
            <div className="mt-3">
              <AfterServiceRequestForm quoteId={quoteId} requestId={requestId} forCustomer={false} />
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}

/**
 * 案件画面の「災害時提供」タブ：お客様の災害時提供の意思（フェーズ15）と、本部の全国ストック台帳の判定。
 * 意思はお客様がマイページで決める（承諾書の文面は本部が登録するまで表示しない）。総代理店には表示しない。
 */
export async function CaseDisasterPanel({ quoteId, actor }: { quoteId: string; actor: SessionUser }) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail) return null;
  const requestId = detail.quote.quote_request_id;
  const caseFlow = await getCaseFlowStore();
  const access: CaseAccess | null = await caseFlow.getCaseAccess(actor, requestId);
  if (access !== 'admin' && access !== 'staff') return null;

  const [handover, consents, texts, ledger] = await Promise.all([
    caseFlow.getHandover(actor, requestId),
    caseFlow.listDisasterConsents(actor, requestId),
    caseFlow.listDisasterConsentTexts(actor),
    access === 'admin' ? caseFlow.listStockLedger(actor) : Promise.resolve([]),
  ]);
  const latest = consents[0] ?? null;
  const rows = ledger.filter((row) => row.unit.quote_request_id === requestId);

  return (
    <div className="mt-2 space-y-2" id="case-flow-disaster">
      <Section
        title="災害時提供の意思"
        testId="disaster-consent-panel"
        badge={latest ? <Badge tone={latest.decision === 'declined' ? 'neutral' : 'success'}>{DISASTER_DECISION_LABELS[latest.decision]}</Badge> : <Badge tone="neutral">未設定</Badge>}
      >
        {texts.length === 0 ? (
          <p className="text-xs text-muted">
            承諾書の文面が未登録のため、お客様のマイページにはまだ表示していません（文面は先方の確認待ち。本部が「災害時提供の承諾書」で登録します）。
          </p>
        ) : handover?.status !== 'handed_over' ? (
          <p className="text-xs text-muted">お客様は、引渡しの後にマイページで意思を設定できます。</p>
        ) : !latest ? (
          <p className="text-xs text-muted">お客様はまだ意思を設定していません（マイページで設定します）。</p>
        ) : null}
        {consents.length > 0 && (
          <ul className="space-y-1 text-xs">
            {consents.map((consent, index) => (
              <li key={consent.id} className={index === 0 ? 'font-semibold' : 'text-muted'}>
                {formatDate(consent.created_at)}　{DISASTER_DECISION_LABELS[consent.decision]}
                {consent.conditions ? `（条件：${consent.conditions}）` : ''}
                {index === 0 ? '　← 今の意思' : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {access === 'admin' && (
        <Section title="全国ストック台帳（本部）" testId="case-stock-ledger-panel" badge={<Link href="/admin/stock-ledger" className="text-xs underline-offset-4 hover:underline">台帳を開く</Link>}>
          {rows.length === 0 ? (
            <p className="text-xs text-muted">引渡し済みの個体はまだありません。</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {rows.map((row) => (
                <li key={row.unit.id}>
                  {row.unit.seq} 棟目（{row.unit.unit_no ?? '個体番号は採番待ち'}・{UNIT_STATUS_LABELS[row.unit.status]}）：
                  {row.entry ? STOCK_REGISTRATION_STATUS_LABELS[row.entry.registration_status] : '台帳に未登録'}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
