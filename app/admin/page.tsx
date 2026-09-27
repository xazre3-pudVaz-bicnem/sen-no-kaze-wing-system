import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { CaseManagementNav } from '@/components/admin/case-management-nav';

function ActionCard({
  title,
  count,
  reason,
  href,
  action,
}: {
  title: string;
  count: number;
  reason: string;
  href: string;
  action: string;
}) {
  return (
    <article className="rounded-xl border border-line bg-white p-4 shadow-sm" data-testid="dashboard-action-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-ink-soft">{reason}</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#fff1d7] px-2.5 py-1 text-sm font-semibold tabular-nums text-[#8a5a20]">
          {count}件
        </span>
      </div>
      <div className="mt-3">
        <Link href={href} className="inline-flex items-center rounded-lg bg-[#2f6b4f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#285d45]">
          {action}
        </Link>
      </div>
    </article>
  );
}

function caseHref(quoteId: string, tab?: 'estimate' | 'site' | 'documents', edit = false) {
  const query = new URLSearchParams({ case: quoteId });
  if (tab) query.set('tab', tab);
  if (edit) query.set('edit', '1');
  return `/admin/quotes?${query.toString()}#case-workspace`;
}

function requestHref(request: { id: string; quote_id: string | null }) {
  return request.quote_id
    ? caseHref(request.quote_id)
    : `/admin/quotes?request=${encodeURIComponent(request.id)}#pending-quote-request`;
}

export default async function AdminDashboard() {
  const actor = await requireStaff();
  const store = await getStore();
  const notifications = await store.listNotifications(actor, { limit: 30 });
  const unread = notifications.filter((n) => !n.read_at);

  // 代理店・総代理店は従来どおり、自分に割り当てられた案件だけを見る。
  if (actor.role !== 'admin') {
    const mineAll = await store.listDealerQuotes(actor.id);
    const mine = mineAll.filter((q) => q.status !== 'superseded');
    const siteWork = mine.filter((q) => q.status === 'issued' && q.revision === 1);
    const acceptedPreliminary = mine.filter((q) => q.status === 'accepted' && q.revision === 1);
    const finalQuoteReview = mine.filter((q) => q.status === 'issued' && q.revision > 1);
    const accepted = mine.filter((q) => q.status === 'accepted' && q.revision > 1);

    const actions = [
      siteWork[0] && {
        title: '現地確認・施工金額確認',
        count: siteWork.length,
        reason: '第1版の概算見積が発行済みです。現地条件を確認し、必要な施工金額を見積へ反映します。',
        href: caseHref(siteWork[0].id, 'site'),
        action: '現地確認を開く',
      },
      acceptedPreliminary[0] && {
        title: '概算見積の承諾記録あり／現地確認・確定見積が必要',
        count: acceptedPreliminary.length,
        reason: '第1版の概算見積に承諾記録がありますが、契約工程には進めません。現地条件を確認し、施工金額を反映した確定見積を作成します。',
        href: caseHref(acceptedPreliminary[0].id, 'site'),
        action: '現地確認を開く',
      },
      finalQuoteReview[0] && {
        title: '確定見積の確認・案内',
        count: finalQuoteReview.length,
        reason: '第2版以降の見積が発行済みです。施工金額や変更内容を確認し、お客様への案内に進みます。',
        href: caseHref(finalQuoteReview[0].id, 'estimate', true),
        action: '見積内容を確認する',
      },
      accepted[0] && {
        title: 'お客様が見積を承諾',
        count: accepted.length,
        reason: '見積の承諾を確認できます。正式な契約状態はまだ保存されないため、契約条件と資料を確認します。',
        href: caseHref(accepted[0].id, 'documents'),
        action: '契約・資料を確認する',
      },
      unread[0] && {
        title: '未読のお知らせ',
        count: unread.length,
        reason: '担当案件に関する新しいお知らせがあります。内容を確認してください。',
        href: '/admin/notifications',
        action: 'お知らせを確認する',
      },
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    return (
      <AdminPage title="案件管理" lead="担当案件のうち、今確認・対応が必要なものを上から表示します。">
        <CaseManagementNav role={actor.role} active="cases" />

        <section aria-labelledby="today-actions">
          <div className="mb-3">
            <h2 id="today-actions" className="text-lg font-semibold">まず確認すること</h2>
            <p className="mt-1 text-sm text-muted">件数だけでなく、次に何をするかまで確認できます。</p>
          </div>
          {actions.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {actions.map((item) => <ActionCard key={item.title} {...item} />)}
            </div>
          ) : (
            <Alert tone="success">既存データから、今すぐ対応が必要と判断できる担当案件はありません。</Alert>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg">最近のお知らせ</h2>
          <ul className="space-y-2">
            {notifications.slice(0, 8).map((n) => (
              <li key={n.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span>
                  {!n.read_at && <Badge tone="danger">未読</Badge>} {n.title}
                  <span className="block text-xs text-muted">{formatDate(n.created_at, true)}</span>
                </span>
                {n.link && <Link href={n.link} className="btn-ghost btn-sm">開く</Link>}
              </li>
            ))}
            {notifications.length === 0 && <li className="card p-6 text-center text-sm text-muted">お知らせはまだありません</li>}
          </ul>
        </section>
      </AdminPage>
    );
  }

  const [requests, quotes, contacts] = await Promise.all([
    store.listQuoteRequests(),
    store.listAllQuotes(),
    store.listContactMessages(),
  ]);

  const newRequests = requests.filter((request) => request.status === 'new');
  const newRequestQuoteIds = new Set(newRequests.flatMap((request) => (request.quote_id ? [request.quote_id] : [])));
  const activeQuotes = quotes.filter((quote) => quote.status !== 'superseded' && !newRequestQuoteIds.has(quote.id));
  const unassigned = activeQuotes.filter((quote) => quote.status === 'issued' && quote.revision === 1 && !quote.dealer_id);
  const siteWork = activeQuotes.filter((quote) => quote.status === 'issued' && quote.revision === 1 && Boolean(quote.dealer_id));
  const acceptedPreliminary = activeQuotes.filter((quote) => quote.status === 'accepted' && quote.revision === 1);
  const finalQuoteReview = activeQuotes.filter((quote) => quote.status === 'issued' && quote.revision > 1);
  const accepted = activeQuotes.filter((quote) => quote.status === 'accepted' && quote.revision > 1);
  const newContacts = contacts.filter((contact) => contact.status === 'new');

  const actions = [
    newRequests[0] && {
      title: '新しい見積依頼',
      count: newRequests.length,
      reason: '未対応の見積依頼です。依頼内容とお客様情報を確認し、案件対応を始めます。',
      href: requestHref(newRequests[0]),
      action: '見積依頼を確認する',
    },
    unassigned[0] && {
      title: '担当代理店が未割当',
      count: unassigned.length,
      reason: '第1版の概算見積は発行済みですが、現地確認を進める担当代理店がまだ設定されていません。',
      href: caseHref(unassigned[0].id),
      action: '担当を確認する',
    },
    siteWork[0] && {
      title: '現地確認・施工金額確認',
      count: siteWork.length,
      reason: '第1版の概算見積が発行済みで、担当代理店が割り当てられています。施工金額の確認・反映が次の作業です。',
      href: caseHref(siteWork[0].id, 'site'),
      action: '現地確認を開く',
    },
    acceptedPreliminary[0] && {
      title: '概算見積の承諾記録あり／現地確認・確定見積が必要',
      count: acceptedPreliminary.length,
      reason: '第1版の概算見積に承諾記録がありますが、契約工程には進めません。現地条件を確認し、施工金額を反映した確定見積を作成します。',
      href: caseHref(acceptedPreliminary[0].id, 'site'),
      action: '現地確認を開く',
    },
    finalQuoteReview[0] && {
      title: '確定見積の確認・案内',
      count: finalQuoteReview.length,
      reason: '第2版以降の見積が発行済みです。施工金額や変更内容を確認し、お客様への案内に進みます。',
      href: caseHref(finalQuoteReview[0].id, 'estimate', true),
      action: '見積内容を確認する',
    },
    accepted[0] && {
      title: 'お客様が見積を承諾',
      count: accepted.length,
      reason: '見積の承諾を確認できます。正式な契約状態はまだ保存されないため、契約条件と資料を確認します。',
      href: caseHref(accepted[0].id, 'documents'),
      action: '契約・資料を確認する',
    },
    newContacts[0] && {
      title: '未対応のお問い合わせ',
      count: newContacts.length,
      reason: 'まだ対応済みになっていないお問い合わせがあります。内容を確認して対応します。',
      href: '/admin/contacts',
      action: '問い合わせを確認する',
    },
    unread[0] && {
      title: '未読のお知らせ',
      count: unread.length,
      reason: '新しいお知らせがあります。案件の割当や更新内容を確認してください。',
      href: '/admin/notifications',
      action: 'お知らせを確認する',
    },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <AdminPage title="案件管理" lead="今確認・対応が必要なものを上から表示します。">
      <CaseManagementNav role={actor.role} active="cases" inquiryCount={newContacts.length} />

      <section aria-labelledby="today-actions">
        <div className="mb-3">
          <h2 id="today-actions" className="text-lg font-semibold">まず確認すること</h2>
          <p className="mt-1 text-sm text-muted">既存の案件・見積・問い合わせ・通知データから、次の作業を整理しています。</p>
        </div>
        {actions.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {actions.map((item) => <ActionCard key={item.title} {...item} />)}
          </div>
        ) : (
          <Alert tone="success">既存データから、今すぐ対応が必要と判断できる項目はありません。</Alert>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg">最近の案件受付</h2>
        <Table>
          <thead className="bg-sand/60"><tr><Th>受付日時</Th><Th>見積番号</Th><Th>顧客</Th><Th>状態</Th><Th></Th></tr></thead>
          <tbody className="divide-y divide-line">
            {requests.slice(0, 8).map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.created_at, true)}</Td>
                <Td className="font-mono">{r.quote_no ?? '—'}</Td>
                <Td>{r.contact.full_name}{r.contact.company_name ? `（${r.contact.company_name}）` : ''}<br /><span className="text-xs text-muted">{r.user_email}</span></Td>
                <Td><Badge tone={r.status === 'new' ? 'danger' : r.status === 'closed' ? 'success' : 'neutral'}>{QUOTE_REQUEST_STATUS_LABELS[r.status]}</Badge></Td>
                <Td right>
                  {r.quote_id ? (
                    <Link href={`/admin/quotes/${r.quote_id}`} className="btn-ghost btn-sm">案件を開く</Link>
                  ) : (
                    <Link href={`/admin/quotes?request=${encodeURIComponent(r.id)}#pending-quote-request`} className="btn-ghost btn-sm">
                      依頼を開く
                    </Link>
                  )}
                </Td>
              </tr>
            ))}
            {requests.length === 0 && <tr><Td colSpan={5} className="text-center text-muted">見積依頼はまだありません</Td></tr>}
          </tbody>
        </Table>
      </section>
    </AdminPage>
  );
}
