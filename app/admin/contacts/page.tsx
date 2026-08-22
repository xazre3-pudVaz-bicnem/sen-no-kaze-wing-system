import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, FlashMessages, Table, Td, Th } from '@/components/admin/ui';
import { ContactStatusForm } from '@/components/admin/forms';

export default async function AdminContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getStore();
  const messages = await store.listContactMessages();
  const newCount = messages.filter((m) => m.status === 'new').length;

  return (
    <AdminPage title="お問い合わせ" lead={`全 ${messages.length} 件（未対応 ${newCount} 件）`}>
      <FlashMessages sp={sp} />
      <Table minWidth="60rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>受付日時</Th>
            <Th>種類</Th>
            <Th>お名前</Th>
            <Th>連絡先</Th>
            <Th>内容</Th>
            <Th>添付</Th>
            <Th>状態</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {messages.map((m) => (
            <tr key={m.id} data-testid="contact-row">
              <Td>{formatDate(m.created_at, true)}</Td>
              <Td className="text-xs">{m.topic}</Td>
              <Td className="font-semibold">{m.full_name}</Td>
              <Td className="text-xs">
                <a href={`mailto:${m.email}`} className="underline-offset-4 hover:underline">
                  {m.email}
                </a>
                {m.phone && (
                  <>
                    <br />
                    {m.phone}
                  </>
                )}
              </Td>
              <Td className="max-w-md text-xs whitespace-pre-wrap">{m.message}</Td>
              <Td className="text-xs">{m.attachment_name ?? '—'}</Td>
              <Td>
                <div className="space-y-2">
                  <Badge tone={m.status === 'new' ? 'danger' : 'success'}>{m.status === 'new' ? '未対応' : '対応済み'}</Badge>
                  <ContactStatusForm id={m.id} status={m.status} />
                </div>
              </Td>
            </tr>
          ))}
          {messages.length === 0 && (
            <tr>
              <Td className="text-center text-muted">お問い合わせはまだありません</Td>
            </tr>
          )}
        </tbody>
      </Table>
      <p className="text-xs text-muted">
        添付ファイルは非公開ストレージ（contact-attachments）に保存されます。ダウンロードが必要な場合は Supabase ダッシュボードから取得してください。
      </p>
    </AdminPage>
  );
}
