import { notFound } from 'next/navigation';
import { deleteOptionAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import type { OptionConflict, OptionDependency } from '@/lib/domain/types';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';

export default async function EditOptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) notFound();
  const [categories, models, options] = await Promise.all([store.listCategories(), store.listModels({ includeDraft: true }), store.listOptions()]);
  // 関連（前提・競合）は全モデルのバンドルから集める
  const deps: OptionDependency[] = [];
  const confs: OptionConflict[] = [];
  for (const m of models) {
    const b = await store.getCatalogBundle(m.id, { includeDraft: true });
    if (!b) continue;
    for (const d of b.dependencies) if (d.option_id === id && !deps.some((x) => x.id === d.id)) deps.push(d);
    for (const c of b.conflicts) if (c.option_id === id && !confs.some((x) => x.id === c.id)) confs.push(c);
  }
  return (
    <AdminPage
      title={option.name}
      lead={option.code}
      actions={
        <form action={deleteOptionAction}>
          <input type="hidden" name="id" value={option.id} />
          <ConfirmSubmit message={`「${option.name}」を削除しますか？保存済みの仕様で使用中の場合は削除できません。`} className="btn-ghost btn-sm text-danger">削除</ConfirmSubmit>
        </form>
      }
    >
      <BackLink href="/admin/options" label="一覧へ戻る" />
      <FlashMessages sp={sp} />
      <OptionForm option={option} categories={categories} models={models} allOptions={options} dependencies={deps} conflicts={confs} />
    </AdminPage>
  );
}
