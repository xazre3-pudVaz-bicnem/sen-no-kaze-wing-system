import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { ContactInbox } from '@/components/admin/contact-inbox';

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getStore();
  const messages = await store.listContactMessages();
  const classificationReady = messages.every((message) => message.classification !== undefined);
  const newCount = messages.filter((message) => message.status === 'new' && (message.classification ?? 'normal') === 'normal').length;
  // Storageの内部パスはClient Componentへ渡さない。表示には添付の有無だけあればよい。
  const inboxMessages = messages.map(({ attachment_path, ...message }) => ({
    ...message,
    has_attachment: Boolean(attachment_path && message.attachment_name),
  }));

  return (
    <AdminPage title="問い合わせ受付" lead={`全 ${messages.length} 件（未対応 ${newCount} 件）`}>
      <FlashMessages sp={sp} />
      <ContactInbox messages={inboxMessages} classificationReady={classificationReady} />
    </AdminPage>
  );
}
