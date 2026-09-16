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
  const categories = catalogEditor ? allCategories : allCategories.filter((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const freeCategory = allCategories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const defaultCategoryId = sp.category ?? (catalogEditor ? undefined : freeCategory?.id);
  const isFree = defaultCategoryId && defaultCategoryId === freeCategory?.id;
  const returnTo = typeof sp.return_to === 'string' && sp.return_to.startsWith('/admin/') ? sp.return_to : undefined;

  return (
    <AdminPage
      title={isFree ? 'フリー商品を追加' : '商品を追加'}
      lead="既存の商品マスターを使い、7つのSTEPで商品登録を整理します。まず商品を作成し、保存後に画像・PDF・色仕様・最終確認を続けられます。"
    >
      <BackLink href={returnTo ?? (isFree ? '/admin/free-products' : '/admin/options')} label={returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る'} />
      {returnTo && (
        <Alert tone="info">
          見積テンプレートの商品追加から移動しています。下の保存ボタンは「登録して見積テンプレートへ戻る」と表示され、既存の return_to 導線で元の画面へ戻ります。
        </Alert>
      )}

      <section className="card p-4 sm:p-5" aria-label="商品登録の流れ">
        <h2 className="font-semibold">商品登録の7ステップ</h2>
        <p className="mt-1 text-xs text-muted">
          新規作成では、まず商品を特定して基本情報を保存します。保存後の商品編集画面では各STEPを個別に開いて設定できます。
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            ['1', '商品特定'],
            ['2', '商品の詳細'],
            ['3', 'お客様資料'],
            ['4', 'お客様選択'],
            ['5', '価格設定'],
            ['6', '発注内容確認'],
            ['7', 'お客様画面最終確認'],
          ].map(([no, label], index) => (
            <li key={no} className={`rounded-xl border px-3 py-3 ${index < 2 ? 'border-brown bg-ivory/70' : 'border-line bg-white'}`}>
              <span className="text-xs font-semibold text-brown">STEP {no}</span>
              <span className="mt-1 block text-sm font-semibold">{label}</span>
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
