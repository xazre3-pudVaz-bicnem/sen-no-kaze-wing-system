import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { ROLE_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { UserRoleForm } from '@/components/admin/dealer-forms';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';
import { RegionFilter } from '@/components/admin/region-filter';

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const store = await getStore();
  const [profiles, configurations] = await Promise.all([store.listProfiles(), store.listAllConfigurations()]);

  // 地域で抽出（登録住所で判定）
  const filter = readRegionFilter(sp);
  const cityPool = filter.pref
    ? [...new Set(
        profiles
          .map((p) => parseAddress(p.address))
          .filter((a) => a.prefecture === filter.pref && a.city)
          .map((a) => a.city as string)
      )].sort()
    : [];
  const shown = profiles.filter((p) => matchesRegion(p.address, filter));
  const countByUser = new Map<string, number>();
  for (const c of configurations) countByUser.set(c.user_id, (countByUser.get(c.user_id) ?? 0) + 1);
  const byRole = (role: string) => profiles.filter((p) => p.role_code === role).length;

  return (
    <AdminPage
      title="ユーザー・権限"
      lead={`登録 ${profiles.length} 名（管理者 ${byRole('admin')}／総代理店 ${byRole('master_dealer')}／代理店 ${byRole('dealer')}／顧客 ${byRole('customer')}）`}
    >
      <div className="card p-4 text-xs text-ink-soft">
        <p className="font-semibold text-ink">権限でできること</p>
        <ul className="mt-2 space-y-1">
          <li>
            <strong>{ROLE_LABELS.master_dealer}</strong>：商品台帳への商品登録・価格編集（本体・カテゴリー・商品・画像・プレビュー）
          </li>
          <li>
            <strong>{ROLE_LABELS.dealer}</strong>：商品台帳の閲覧、自社フリー商品の登録、担当見積の別途工事入力と確定見積の発行
          </li>
          <li>
            <strong>{ROLE_LABELS.admin}</strong>：上記すべてと、顧客・見積・お問い合わせの管理
          </li>
        </ul>
        <p className="mt-2 text-muted">変更は即時に反映されます（対象の方は再読み込みが必要な場合があります）。自分自身の権限は変更できません。</p>
      </div>

      <RegionFilter value={filter} cities={cityPool} total={profiles.length} matched={shown.length} />
      <Table minWidth="60rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>氏名 / 法人</Th>
            <Th>メール</Th>
            <Th>電話</Th>
            <Th>住所</Th>
            <Th right>保存仕様</Th>
            <Th>登録日</Th>
            <Th>権限</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((p) => (
            <tr key={p.id} data-testid={`user-row-${p.email}`}>
              <Td className="font-semibold">
                {p.full_name}
                {p.company_name && <span className="block text-xs font-normal text-muted">{p.company_name}</span>}
                {p.id === admin.id && <span className="block text-xs font-normal text-muted">（自分）</span>}
              </Td>
              <Td>{p.email}</Td>
              <Td>{p.phone ?? '—'}</Td>
              <Td className="text-xs">{[p.postal_code, p.address].filter(Boolean).join(' ') || '—'}</Td>
              <Td right>{countByUser.get(p.id) ?? 0}</Td>
              <Td>{formatDate(p.created_at)}</Td>
              <Td>
                <UserRoleForm profile={p} isSelf={p.id === admin.id} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </AdminPage>
  );
}
