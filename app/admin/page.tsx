import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { findMissingPreviewCombos, previewKeyLabels } from '@/lib/domain/preview';
import { formatYen } from '@/lib/domain/pricing';
import { QUOTE_REQUEST_STATUS_LABELS, VIEW_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Stat, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminDashboard() {
  const store = await getStore();
  const [models, profiles, configurations, requests, contacts] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listProfiles(),
    store.listAllConfigurations(),
    store.listQuoteRequests(),
    store.listContactMessages(),
  ]);
  const warnings: { model: string; view: string; keys: string[] }[] = [];
  for (const m of models) {
    const b = await store.getCatalogBundle(m.id, { includeDraft: true });
    if (!b) continue;
    const labels = previewKeyLabels(b.options);
    const { missing } = findMissingPreviewCombos(b.previewRules.filter((r) => r.status === 'published'), b.options.filter((o) => o.status === 'published'));
    for (const mc of missing) warnings.push({ model: m.name, view: VIEW_LABELS[mc.view], keys: mc.keys.map((k) => labels.get(k) ?? k) });
  }

  return (
    <AdminPage title="ダッシュボード" lead="商品・オプション・画像の管理と、見積依頼の確認を行います。">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="公開中モデル" value={models.filter((m) => m.status === 'published').length} href="/admin/models" />
        <Stat label="顧客数" value={profiles.length} href="/admin/customers" />
        <Stat label="保存された仕様" value={configurations.length} href="/admin/configurations" />
        <Stat label="未対応の見積依頼" value={requests.filter((r) => r.status === 'new').length} href="/admin/quotes" />
        <Stat label="未対応のお問い合わせ" value={contacts.filter((c) => c.status === 'new').length} href="/admin/contacts" />
      </div>

      {warnings.length > 0 ? (
        <Alert tone="warn" title={`プレビュー画像が不足している組み合わせ：${warnings.length} 件`}>
          <p>該当する組み合わせでは「最も近い画像＋未反映表示」になります。<Link href="/admin/preview-rules" className="underline">プレビュー画像管理</Link>から登録してください。</p>
        </Alert>
      ) : (
        <Alert tone="success">すべてのオプション組み合わせにプレビュー画像が登録されています。</Alert>
      )}

      <section>
        <h2 className="mb-3 text-lg">最近の見積依頼</h2>
        <Table>
          <thead className="bg-sand/60"><tr><Th>受付日時</Th><Th>見積番号</Th><Th>顧客</Th><Th>状態</Th><Th></Th></tr></thead>
          <tbody className="divide-y divide-line">
            {requests.slice(0, 8).map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.created_at, true)}</Td>
                <Td className="font-mono">{r.quote_no ?? '—'}</Td>
                <Td>{r.contact.full_name}{r.contact.company_name ? `（${r.contact.company_name}）` : ''}<br /><span className="text-xs text-muted">{r.user_email}</span></Td>
                <Td><Badge tone={r.status === 'new' ? 'danger' : r.status === 'closed' ? 'success' : 'neutral'}>{QUOTE_REQUEST_STATUS_LABELS[r.status]}</Badge></Td>
                <Td right>{r.quote_id && <Link href={`/admin/quotes/${r.quote_id}`} className="btn-ghost btn-sm">詳細</Link>}</Td>
              </tr>
            ))}
            {requests.length === 0 && <tr><Td className="text-center text-muted">見積依頼はまだありません</Td></tr>}
          </tbody>
        </Table>
      </section>

      <section>
        <h2 className="mb-3 text-lg">最近保存された仕様</h2>
        <Table>
          <thead className="bg-sand/60"><tr><Th>更新日時</Th><Th>保存名</Th><Th>顧客</Th><Th right>合計（税込）</Th></tr></thead>
          <tbody className="divide-y divide-line">
            {configurations.slice(0, 8).map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.updated_at, true)}</Td>
                <Td><Link href={`/admin/configurations/${c.id}`} className="underline-offset-4 hover:underline">{c.name}</Link></Td>
                <Td>{c.user_name}<br /><span className="text-xs text-muted">{c.user_email}</span></Td>
                <Td right>{formatYen(c.total)}</Td>
              </tr>
            ))}
            {configurations.length === 0 && <tr><Td className="text-center text-muted">保存された仕様はまだありません</Td></tr>}
          </tbody>
        </Table>
      </section>
    </AdminPage>
  );
}
