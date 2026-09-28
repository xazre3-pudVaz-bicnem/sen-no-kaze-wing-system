import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore, StoreError } from '@/lib/data/store';
import { canEditCatalog } from '@/lib/domain/types';
import { QuoteDraftEditor } from '@/components/admin/quote-draft-editor';
import { Alert } from '@/components/ui';

export default async function AdminQuoteDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();

  let detail;
  try {
    detail = await store.getQuoteDraft(id, actor);
  } catch (error) {
    if (error instanceof StoreError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (!detail) notFound();

  const model = await store.getModelById(detail.draft.base_model_id, { includeDraft: true });

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/quotes" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← 案件一覧へ戻る
        </Link>
        <span className="rounded-lg bg-[#edf3f6] px-3 py-2 text-xs font-semibold text-[#365467]">
          Draft編集中
        </span>
      </div>

      {sp.created && (
        <Alert tone="success">
          案件を登録しました。まだ見積Revisionは発行していません。Draftを編集・保存してください。
        </Alert>
      )}
      {sp.revisionDraft && (
        <Alert tone="success">
          現在の正式Revisionをコピーして改訂Draftを作成しました。Draft保存だけでは正式Revisionは増えません。
        </Alert>
      )}

      <QuoteDraftEditor
        detail={detail}
        modelName={model?.name ?? '商品モデル'}
        canEditBase={canEditCatalog(actor.role)}
      />
    </div>
  );
}
