import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { Alert } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';

export default async function NewOptionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const [allCategories, models, options] = await Promise.all([
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    store.listOptions(),
  ]);
  // 代理店が登録できるのはフリー商品だけ（サーバーアクション側でも拒否している）
  const catalogEditor = canEditCatalog(actor.role);
  const freeCategory = allCategories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const requestedFreeCategory = Boolean(sp.category && sp.category === freeCategory?.id);
  const categories = catalogEditor
    ? (requestedFreeCategory ? allCategories : allCategories.filter((c) => c.code !== FREE_PRODUCT_CATEGORY_CODE))
    : allCategories.filter((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const defaultCategoryId = sp.category ?? (catalogEditor ? undefined : freeCategory?.id);
  const isFree = defaultCategoryId && defaultCategoryId === freeCategory?.id;
  const returnTo = typeof sp.return_to === 'string' && sp.return_to.startsWith('/admin/') ? sp.return_to : undefined;

  return (
    <AdminPage
      title={isFree ? 'フリー商品を追加' : '商品を追加'}
      lead="商品情報を登録し、登録済みの内容を確認します。"
    >
      <BackLink href={returnTo ?? (isFree ? '/admin/free-products' : '/admin/options')} label={returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る'} />
      {returnTo && (
        <Alert tone="info">
          見積テンプレートの商品追加から移動しています。下の保存ボタンは「下書き登録して見積テンプレートへ戻る」と表示され、既存の return_to 導線で元の画面へ戻ります。
        </Alert>
      )}

      <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
        <h2 className="font-semibold">商品登録の2ステップ</h2>
        <p className="mt-1 text-xs text-muted">
          まず下書きを作成し、続くSTEP 1でサブ画像・メーカー資料・お客様選択まで整えます。その後、STEP 2で実際のお客様表示を確認してから公開します。
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            ['1', '商品情報', '商品・資料・選択項目・価格を入力'],
            ['2', '登録内容確認', '実際のお客様表示を確認して公開'],
          ].map(([no, label, note], index) => (
            <li key={no} className={`rounded-xl border px-3 py-3 ${index === 0 ? 'border-brown bg-ivory/70' : 'border-line bg-white'}`}>
              <span className="text-xs font-semibold text-brown">STEP {no}</span>
              <span className="mt-1 block text-sm font-semibold">{label}</span>
              <span className="mt-1 block text-[0.7rem] leading-5 text-muted">{note}</span>
            </li>
          ))}
        </ol>
      </section>

      <OptionForm
        option={null}
        categories={categories}
        models={models}
        allOptions={options}
        dependencies={[]}
        conflicts={[]}
        defaultCategoryId={defaultCategoryId}
        returnTo={returnTo}
      />
    </AdminPage>
  );
}
