import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { ROLE_LABELS, type RoleCode } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { UserRoleForm } from '@/components/admin/dealer-forms';
import { Button, Checkbox, Input, Select } from '@/components/ui';

const ROLE_CODES: RoleCode[] = ['admin', 'master_dealer', 'dealer', 'customer'];
const ROLE_ORDER: Record<RoleCode, number> = { admin: 0, master_dealer: 1, dealer: 2, customer: 3 };

function isRoleCode(value: string | undefined): value is RoleCode {
  return ROLE_CODES.includes(value as RoleCode);
}

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const store = await getStore();
  const profiles = await store.listProfiles();

  const requestedRole = isRoleCode(sp.role) ? sp.role : '';
  const includeCustomers = sp.include_customers === '1' || requestedRole === 'customer';
  const query = (sp.q ?? '').trim().toLocaleLowerCase('ja-JP');

  const staffProfiles = profiles.filter((profile) => profile.role_code !== 'customer');
  const targetProfiles = includeCustomers ? profiles : staffProfiles;
  const shown = targetProfiles
    .filter((profile) => !requestedRole || profile.role_code === requestedRole)
    .filter((profile) => {
      if (!query) return true;
      return [profile.full_name, profile.company_name, profile.email, profile.phone, profile.address]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ja-JP').includes(query));
    })
    .sort((a, b) => ROLE_ORDER[a.role_code] - ROLE_ORDER[b.role_code] || a.full_name.localeCompare(b.full_name, 'ja'));

  const byRole = (role: RoleCode) => profiles.filter((profile) => profile.role_code === role).length;

  return (
    <AdminPage
      title="ユーザー・担当者"
      lead={`担当者 ${staffProfiles.length} 名（管理者 ${byRole('admin')}／総代理店 ${byRole('master_dealer')}／代理店 ${byRole('dealer')}）・顧客アカウント ${byRole('customer')} 名`}
    >
      <details className="card p-4 text-xs text-ink-soft">
        <summary className="cursor-pointer font-semibold text-ink">権限の説明を見る</summary>
        <div className="mt-3 border-t border-line pt-3">
          <ul className="space-y-1">
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
      </details>

      <form method="get" className="card p-4" aria-label="ユーザー・担当者の絞り込み">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">氏名・法人・メールで検索</span>
            <Input name="q" defaultValue={sp.q ?? ''} placeholder="氏名・法人名・メール・電話" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">権限</span>
            <Select name="role" defaultValue={requestedRole}>
              <option value="">すべての担当者</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
              <option value="master_dealer">{ROLE_LABELS.master_dealer}</option>
              <option value="dealer">{ROLE_LABELS.dealer}</option>
              {includeCustomers && <option value="customer">{ROLE_LABELS.customer}</option>}
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary">絞り込む</Button>
            <Link href="/admin/customers" className="text-sm text-ink-soft underline-offset-4 hover:underline">解除</Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <Checkbox
            name="include_customers"
            value="1"
            defaultChecked={includeCustomers}
            label="顧客アカウントを含める"
          />
          <span className="text-xs text-muted">表示 {shown.length} 件</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          通常は本部・総代理店・代理店の担当者だけを表示します。正式な所属組織・招待／停止状態は、組織管理の正式接続後に追加します。
        </p>
      </form>

      <Table minWidth="48rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>氏名 / 法人</Th>
            <Th>連絡先</Th>
            <Th>現在の権限</Th>
            <Th>登録日</Th>
            <Th>権限変更</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-sm text-muted">条件に一致する担当者はいません。</Td>
            </tr>
          ) : shown.map((profile) => (
            <tr key={profile.id} data-testid={`user-row-${profile.email}`}>
              <Td className="font-semibold">
                {profile.full_name}
                {profile.company_name && <span className="block text-xs font-normal text-muted">{profile.company_name}</span>}
                {profile.id === admin.id && <span className="block text-xs font-normal text-muted">（自分）</span>}
              </Td>
              <Td>
                <span className="block">{profile.email}</span>
                <span className="mt-1 block text-xs text-muted">{profile.phone ?? '電話未登録'}</span>
              </Td>
              <Td className="whitespace-nowrap">{ROLE_LABELS[profile.role_code]}</Td>
              <Td className="whitespace-nowrap">{formatDate(profile.created_at)}</Td>
              <Td>
                <UserRoleForm profile={profile} isSelf={profile.id === admin.id} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </AdminPage>
  );
}
