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
  const newCount = messages.filter((message) => message.status === 'new').length;

  return (
    <AdminPage title="問い合わせ受付" lead={`全 ${messages.length} 件（未対応 ${newCount} 件）`}>
      <FlashMessages sp={sp} />
      <ContactInbox messages={messages} />
    </AdminPage>
  );
}
