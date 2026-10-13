import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Alert } from '@/components/ui';
import { MatrixEditor, type MatrixEditorRow } from '@/components/admin/matrix-editor';

export const metadata: Metadata = { title: '本体仕様マトリクス | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * 本体仕様マトリクス（機種 × 仕様 × サイズ → 項目ごとの選択可否・防火の可否）。本部だけが変更できる。
 * 変更はシミュレーターの選択肢・Configuration の保存と見積依頼の検査・本体マスターの作成画面に反映される。
 */
export default async function MatrixPage() {
  const actor = await requireAdmin('/admin/matrix');
  const store = await getStore();
  const [matrix, models] = await Promise.all([store.getSpecMatrix(), store.listModels({ includeDraft: true })]);

  if (!matrix) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl">本体仕様マトリクス</h1>
        <Alert tone="warn">本体仕様マトリクスの表がまだありません（データベースの更新が未適用です）。</Alert>
      </div>
    );
  }

  const rows: MatrixEditorRow[] = matrix.rows.map((row) => ({
    ...row,
    model_name: models.find((model) => model.id === row.base_model_id)?.name ?? '不明な機種',
    selectable_items: matrix.cells.filter((cell) => cell.matrix_row_id === row.id && cell.selectable).map((cell) => cell.matrix_item_code),
  }));

  return (
    <div className="space-y-4" data-actor={actor.id}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">本体仕様マトリクス</h1>
          <p className="mt-1 text-sm text-muted">
            機種・仕様・サイズごとに、お客様が選べる項目と防火の可否を決めます。チェックの無い項目は選べません。
          </p>
        </div>
        <Link href="/admin/base-masters" className="text-sm underline-offset-4 hover:underline">
          本体マスターへ
        </Link>
      </div>
      <Alert tone="info">
        保存すると、シミュレーターの選択肢と、Configuration の保存・見積依頼の検査に反映されます。発行済みの見積・承諾済みの内容は変わりません。
      </Alert>
      <MatrixEditor
        rows={rows}
        items={matrix.items}
        specs={matrix.specs}
        sizes={matrix.sizes}
        models={models.map((model) => ({ id: model.id, name: model.name }))}
      />
    </div>
  );
}
