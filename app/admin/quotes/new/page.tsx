import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { ManualQuoteForm } from '@/components/admin/manual-quote-form';

/**
 * スタッフが管理画面から直接見積を作る（お客様のシミュレーター操作なしで）。
 * 先方要望「ログインしてから見積書を作成する登録画面をつけてほしい」に対応。
 */
export default async function AdminNewQuotePage() {
  await requireStaff();
  const store = await getStore();
  const models = await store.listModels();
  return (
    <AdminPage
      title="新規案件／見積作成"
      lead="電話・来店・紹介など、スタッフ起点で新しい案件の見積を作成します。既存の見積作成処理をそのまま利用します。"
    >
      <BackLink href="/admin/quotes" label="案件一覧へ戻る" />
      <ManualQuoteForm
        models={models.map((m) => ({
          id: m.id,
          name: m.name,
          presets: (m.presets ?? []).map((p) => ({ code: p.code, name: p.name, description: p.description })),
        }))}
      />
    </AdminPage>
  );
}
