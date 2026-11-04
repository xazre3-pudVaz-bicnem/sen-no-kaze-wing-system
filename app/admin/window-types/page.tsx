import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AdminPage } from '@/components/admin/ui';
import { Alert } from '@/components/ui';
import { WindowTypeCreateForm, WindowTypeRowForm } from '@/components/admin/window-type-forms';

/**
 * 窓タイプのマスター（本部だけ。v2.5 PR-S2）。サッシの商品の開閉形式（FIX窓・引違い窓など）を、商品登録で 1 商品 1 つ選ぶ。
 * 「掃出し窓」などの用途・形状は入れない（2026-10-30 先方回答）。使わなくなった窓タイプは消さずに「使わない」にする
 */
export default async function AdminWindowTypesPage() {
  await requireAdmin('/admin/window-types');
  const store = await getStore();
  const windowTypes = await store.listWindowTypes();
  const nextSortOrder = (windowTypes.reduce((max, row) => Math.max(max, row.sort_order), 0) || 0) + 10;

  return (
    <AdminPage
      title="窓タイプ"
      lead="サッシの商品の開閉形式です。商品登録で 1 商品に 1 つ選びます（窓タイプを使うカテゴリーの商品だけ）。「掃出し窓」などの位置・用途は、標準見積の位置・用途の選択枠で決めます。"
      actions={<Link href="/admin/ledger" className="btn-secondary btn-sm">← 商品台帳に戻る</Link>}
    >
      <div className="max-w-4xl space-y-5">
        {windowTypes.length === 0 ? (
          <Alert tone="warn">窓タイプの表がまだありません（DB の更新が済んでいない環境です）。</Alert>
        ) : (
          <section className="rounded-xl border border-line bg-white px-4 py-2" aria-label="登録済みの窓タイプ">
            <div className="hidden grid-cols-[9rem_minmax(0,1fr)_6rem_8rem_auto] gap-2 border-b border-line py-2 text-[0.7rem] text-muted sm:grid">
              <span>コード</span>
              <span>名前</span>
              <span>並び順</span>
              <span>使う／使わない</span>
              <span />
            </div>
            {windowTypes.map((windowType) => (
              <WindowTypeRowForm key={`${windowType.code}-${windowType.label}-${windowType.sort_order}-${windowType.status}`} windowType={windowType} />
            ))}
          </section>
        )}
        {windowTypes.length > 0 && <WindowTypeCreateForm nextSortOrder={nextSortOrder} />}
        <p className="text-xs text-muted">
          コードは商品が参照するので、足した後は変えられません。使わなくなった窓タイプは「使わない」にすると、新しく選べなくなります（設定済みの商品の表示は残ります）。
        </p>
      </div>
    </AdminPage>
  );
}
