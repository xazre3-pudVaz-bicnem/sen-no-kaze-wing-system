import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { ManualQuoteForm } from '@/components/admin/manual-quote-form';
import { CaseManagementNav } from '@/components/admin/case-management-nav';

/**
 * スタッフが管理画面から直接見積を作る（お客様のシミュレーター操作なしで）。
 * 先方要望「ログインしてから見積書を作成する登録画面をつけてほしい」に対応。
 */
export default async function AdminNewQuotePage() {
  const actor = await requireStaff();
  const store = await getStore();
  const models = await store.listModels();
  return (
    <AdminPage
      title="対面・電話・紹介の案件受付"
      lead="Web以外で受けた案件を登録し、概算見積を作成します。作成後はWeb経由の案件と同じ案件管理で進めます。"
    >
      <CaseManagementNav role={actor.role} active="cases" />
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
