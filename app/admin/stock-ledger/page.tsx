import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { saveStockLedgerEntryAction } from '@/lib/actions/case-flow';
import { DISASTER_DECISION_LABELS, STOCK_REGISTRATION_STATUS_LABELS, UNIT_STATUS_LABELS, canRegisterStock } from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: '全国ストック台帳 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const yesNo = (value: boolean | undefined) => (value ? '○' : '—');

/**
 * 全国ストック台帳（フェーズ15・本部だけ）。引渡し済みの個体について、本部が登録状態・稼働状況・即時提供・輸送・72 時間／7 日の供給可否を判定する。
 * 「登録中」にできるのは、お客様の今の意思が承諾か条件付き承諾の個体だけ（DB でも確かめる）。災害時パートナー・供給指揮システムとの連携は仕様の確認待ち。
 */
export default async function StockLedgerPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const actor = await requireAdmin('/admin/stock-ledger');
  const sp = await searchParams;
  const caseFlow = await getCaseFlowStore();
  const rows = await caseFlow.listStockLedger(actor);
  const registered = rows.filter((row) => row.entry?.registration_status === 'registered');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

  return (
    <AdminPage
      title="全国ストック台帳"
      lead="引渡し済みの個体の、災害時に提供できるかの判定です。お客様の意思（承諾・条件付き承諾）がある個体だけ「登録中」にできます。"
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.done === 'saved' && <Alert tone="success">台帳を保存しました。</Alert>}
      <dl className="grid gap-2 sm:grid-cols-4" data-testid="stock-ledger-summary">
        {[
          ['登録中', registered.length],
          ['即時提供できる', registered.filter((row) => row.entry?.immediate_available).length],
          ['72 時間以内に供給できる', registered.filter((row) => row.entry?.supply_72h).length],
          ['7 日以内に供給できる', registered.filter((row) => row.entry?.supply_7d).length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-white p-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{value} 棟</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        承諾書の文面は <Link href="/admin/disaster-consent" className="underline-offset-4 hover:underline">災害時提供の承諾書</Link> で登録します（登録するまで、お客様には意思の設定を表示しません）。
        災害時パートナーの管理・供給指揮システムとの連携は仕様の確認待ちです。
      </p>
      <Table minWidth="72rem">
        <thead>
          <tr>
            <Th>案件・個体</Th>
            <Th>お客様の意思</Th>
            <Th>登録状態</Th>
            <Th>稼働状況・所在地</Th>
            <Th>即時・輸送・72h・7日</Th>
            <Th>判定</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const entry = row.entry;
            const consent = row.latest_consent;
            const canRegister = canRegisterStock(consent?.decision ?? null);
            return (
              <tr key={row.unit.id} data-testid="stock-ledger-row" className="align-top">
                <Td>
                  {row.case_quote_id ? (
                    <Link href={`/admin/quotes/${row.case_quote_id}?tab=disaster`} className="underline-offset-4 hover:underline">
                      {row.case_label}
                    </Link>
                  ) : (
                    row.case_label
                  )}
                  <p className="text-xs text-muted">
                    {row.unit.seq} 棟目・{row.unit.unit_no ?? '個体番号は採番待ち'}・{UNIT_STATUS_LABELS[row.unit.status]}
                    {row.unit.handed_over_on ? `（引渡し ${row.unit.handed_over_on}）` : ''}
                  </p>
                </Td>
                <Td>
                  {consent ? (
                    <>
                      <Badge tone={consent.decision === 'declined' ? 'neutral' : 'success'}>{DISASTER_DECISION_LABELS[consent.decision]}</Badge>
                      {consent.conditions && <p className="mt-1 text-xs text-ink-soft">条件：{consent.conditions}</p>}
                      <p className="text-[0.65rem] text-muted">{formatDate(consent.created_at)}</p>
                    </>
                  ) : (
                    <span className="text-xs text-muted">未回答</span>
                  )}
                </Td>
                <Td>{entry ? <Badge tone={entry.registration_status === 'registered' ? 'success' : 'neutral'}>{STOCK_REGISTRATION_STATUS_LABELS[entry.registration_status]}</Badge> : <span className="text-xs text-muted">未登録</span>}</Td>
                <Td>
                  <p className="text-xs">{entry?.operating_status ?? '—'}</p>
                  <p className="text-xs text-muted">{[entry?.location_prefecture, entry?.location_municipality].filter(Boolean).join(' ') || '所在地未登録'}</p>
                  {entry?.last_inspection_on && <p className="text-[0.65rem] text-muted">最終点検 {entry.last_inspection_on}</p>}
                </Td>
                <Td className="tabular-nums">
                  {yesNo(entry?.immediate_available)} / {yesNo(entry?.transportable)} / {yesNo(entry?.supply_72h)} / {yesNo(entry?.supply_7d)}
                </Td>
                <Td>
                  {entry && <p className="mb-1 text-[0.65rem] text-muted">判定 {formatDate(entry.judged_at)}</p>}
                  <details>
                    <summary className="cursor-pointer text-xs">{entry ? '判定を更新する' : '台帳に載せる'}</summary>
                    <form action={saveStockLedgerEntryAction} className="mt-2 w-72 space-y-2 text-xs">
                      <input type="hidden" name="unit_id" value={row.unit.id} />
                      <input type="hidden" name="expected_lock_version" value={entry?.lock_version ?? ''} />
                      <select name="registration_status" defaultValue={entry?.registration_status ?? (canRegister ? 'registered' : 'suspended')} className="input h-8 w-full text-xs" aria-label="登録状態">
                        <option value="registered" disabled={!canRegister}>
                          登録中{canRegister ? '' : '（お客様の承諾が必要）'}
                        </option>
                        <option value="suspended">登録停止</option>
                      </select>
                      <input name="operating_status" defaultValue={entry?.operating_status ?? ''} maxLength={200} className="input h-8 w-full text-xs" placeholder="稼働状況（例：住居として使用中）" aria-label="稼働状況" />
                      <div className="grid grid-cols-2 gap-1">
                        <input name="location_prefecture" defaultValue={entry?.location_prefecture ?? ''} maxLength={10} className="input h-8 text-xs" placeholder="都道府県" aria-label="所在地（都道府県）" />
                        <input name="location_municipality" defaultValue={entry?.location_municipality ?? ''} maxLength={60} className="input h-8 text-xs" placeholder="市区町村" aria-label="所在地（市区町村）" />
                      </div>
                      <label className="block text-[0.65rem] text-muted">
                        最終点検日
                        <input type="date" name="last_inspection_on" max={today} defaultValue={entry?.last_inspection_on ?? ''} className="input h-8 w-full text-xs" />
                      </label>
                      <div className="grid grid-cols-2 gap-1">
                        {(
                          [
                            ['immediate_available', '即時提供できる'],
                            ['transportable', '輸送できる'],
                            ['supply_72h', '72 時間以内に供給できる'],
                            ['supply_7d', '7 日以内に供給できる'],
                          ] as const
                        ).map(([name, label]) => (
                          <label key={name} className="flex items-center gap-1">
                            <input type="checkbox" name={name} defaultChecked={entry?.[name] ?? false} />
                            {label}
                          </label>
                        ))}
                      </div>
                      <textarea name="note" rows={2} maxLength={1000} defaultValue={entry?.note ?? ''} className="input w-full text-xs" placeholder="メモ（輸送の条件など）" aria-label="メモ" />
                      <button type="submit" className="btn-secondary btn-sm">
                        保存
                      </button>
                    </form>
                  </details>
                </Td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={6} className="py-8 text-center text-muted">引渡し済みの個体はまだありません。</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
