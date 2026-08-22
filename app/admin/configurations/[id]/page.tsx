import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { computePricing, formatYen } from '@/lib/domain/pricing';
import { CONFIGURATION_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminConfigurationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const store = await getStore();
  const found = await store.getConfiguration(id, admin);
  if (!found) notFound();
  const { configuration: c, items } = found;
  const [bundle, profile] = await Promise.all([store.getCatalogBundle(c.base_model_id, { includeDraft: true }), store.getProfile(c.user_id)]);
  if (!bundle) notFound();
  const current = computePricing(bundle.model, bundle.options, bundle.categories, items.map((i) => ({ option_id: i.option_id, quantity: i.quantity })));
  const priceChanged = current.total !== c.total;

  return (
    <AdminPage title={c.name} lead={`${bundle.model.name}｜${CONFIGURATION_STATUS_LABELS[c.status]}`} actions={<Link href={`/simulator/${bundle.model.slug}?c=${c.id}`} target="_blank" className="btn-secondary btn-sm">シミュレーターで開く</Link>}>
      <BackLink href="/admin/configurations" label="一覧へ戻る" />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Table>
            <thead className="bg-sand/60"><tr><Th>オプション</Th><Th>カテゴリー</Th><Th right>単価（現在）</Th></tr></thead>
            <tbody className="divide-y divide-line">
              <tr><Td className="font-semibold">{bundle.model.name} 本体</Td><Td>—</Td><Td right>{formatYen(current.base_price)}</Td></tr>
              {current.lines.map((l) => (
                <tr key={l.option_id}><Td>{l.name}</Td><Td>{l.category_name}</Td><Td right>{l.price_on_request ? '要見積' : formatYen(l.unit_price)}</Td></tr>
              ))}
            </tbody>
          </Table>
          <div className="card p-5 text-sm">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-muted">保存時の合計（税込）</dt><dd className="text-right tabular-nums">{formatYen(c.total)}</dd>
              <dt className="text-muted">現在のマスターで再計算</dt><dd className="text-right tabular-nums">{formatYen(current.total)}</dd>
            </dl>
            {priceChanged && <Alert tone="warn" className="mt-3">保存後にマスター価格が変更されています。次回保存時に再計算されます。発行済みの見積書には影響しません。</Alert>}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="card overflow-hidden">
            {c.preview_image_url && (
              <div className="relative aspect-[16/10] bg-sand"><SmartImage src={c.preview_image_url} alt="" fill sizes="20rem" className="object-cover" /></div>
            )}
            <dl className="space-y-1 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">状態</dt><dd><Badge>{CONFIGURATION_STATUS_LABELS[c.status]}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-muted">作成</dt><dd>{formatDate(c.created_at, true)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">更新</dt><dd>{formatDate(c.updated_at, true)}</dd></div>
            </dl>
          </div>
          <div className="card p-4 text-sm">
            <p className="font-semibold">顧客</p>
            <p className="mt-1">{profile?.full_name}{profile?.company_name && `（${profile.company_name}）`}</p>
            <p className="text-muted">{profile?.email}</p>
            <p className="text-muted">{profile?.phone}</p>
            <p className="text-muted">{profile?.address}</p>
          </div>
        </aside>
      </div>
    </AdminPage>
  );
}
