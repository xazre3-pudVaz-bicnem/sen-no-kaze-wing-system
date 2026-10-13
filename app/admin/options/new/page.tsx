import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';
import { productRegistrationCategoryDisplay } from '@/lib/domain/product-registration-category-display';
import { Alert } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';
import { OptionRegistrationUiEnhancer } from '@/components/admin/option-registration-ui-enhancer';

export default async function NewOptionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const [allCategories, models, options] = await Promise.all([
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    store.listOptions(),
  ]);
  const catalogEditor = canEditCatalog(actor.role);
  const registrationCategories = allCategories.filter((c) => c.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE);
  const freeCategory = registrationCategories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const requestedFreeCategory = Boolean(sp.category && sp.category === freeCategory?.id);
  const freeRegistrationBlocked = requestedFreeCategory || !catalogEditor;
  const categories = productRegistrationCategoryDisplay(
    registrationCategories.filter((c) => c.code !== FREE_PRODUCT_CATEGORY_CODE)
  );
  const defaultCategoryId = requestedFreeCategory ? undefined : sp.category;
  const returnTo = typeof sp.return_to === 'string' && sp.return_to.startsWith('/admin/') ? sp.return_to : undefined;
  const returnToLedger = returnTo?.startsWith('/admin/ledger') ?? false;
  const returnLabel = returnToLedger ? '商品台帳へ戻る' : returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る';

  if (freeRegistrationBlocked) {
    return (
      <AdminPage
        title="フリー商品の新規登録は終了しました"
        lead="既存のフリー商品は履歴互換のため残しますが、新しいfree-productは作成できません。"
      >
        <BackLink href="/admin/free-products" label="フリー商品一覧へ戻る" />
        <Alert tone="info">
          フリー商品を通常商品へ自動変換して登録することはありません。現在の権限で新しい通常商品を登録できない場合も、この画面から権限を広げることはありません。
        </Alert>
      </AdminPage>
    );
  }

  const lockedSections = [
    ['2', '商品の詳細', 'サイズ・仕様・商品説明・メーカー記載の特徴'],
    ['3', '画像・資料', 'メイン画像・サブ画像・メーカー資料'],
    ['4', 'お客様選択', '色・仕様など、お客様が選べる項目'],
    ['5', '価格・対象モデル', '商品価格・対象モデル・公開条件'],
    ['6', '登録前チェック', '重複・画像・価格・選択項目を確認'],
  ];

  return (
    <AdminPage
      title="商品を追加"
      lead="STEP 1の商品情報を1画面で入力し、STEP 2でお客様表示を確認してから登録します。"
    >
      <BackLink href={returnTo ?? '/admin/options'} label={returnLabel} />
      {returnTo && !returnToLedger && (
        <Alert tone="info">
          見積テンプレートの商品追加から移動しています。まず「1. 基本情報」を保存し、続けて同じSTEP 1の画面で商品情報を入力します。STEP 2で登録内容を確認して「この内容で登録」した後に元の見積テンプレートへ戻って商品を追加します。
        </Alert>
      )}

      <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
        <h2 className="font-semibold">商品登録の2ステップ</h2>
        <p className="mt-1 text-xs text-muted">
          STEP 1で商品情報を上から順に入力し、STEP 2で登録内容と実際のお客様表示を確認してから登録します。
        </p>
        <p className="mt-2 text-xs leading-5 text-ink-soft">
          最初に「1. 基本情報」を保存して下書きを作成すると、同じSTEP 1の続きとして2〜6の項目を入力できます。
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            ['1', '商品情報', '商品・資料・選択項目・価格を入力'],
            ['2', '登録内容確認', '登録内容と実際のお客様表示を確認'],
          ].map(([no, label, note], index) => (
            <li key={no} className={`rounded-xl border px-3 py-3 ${index === 0 ? 'border-brown bg-ivory/70' : 'border-line bg-white'}`}>
              <span className="text-xs font-semibold text-brown">STEP {no}</span>
              <span className="mt-1 block text-sm font-semibold">{label}</span>
              <span className="mt-1 block text-[0.7rem] leading-5 text-muted">{note}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3" aria-label="STEP 1 商品情報">
        <div>
          <h2 className="text-xl font-semibold">STEP 1 商品情報</h2>
          <p className="mt-1 text-sm text-muted">上から順に入力します。1. 基本情報を保存すると、2〜6を続けて入力できます。</p>
        </div>

        <div className="registration-create-sections flex flex-col gap-6">
          <style>{`
            .registration-create-sections #product-identify > div:first-child > p:first-child::before { content: '1. '; }
            .registration-create-sections #product-identify [data-testid="admin-submit"] { font-size: 0; }
            .registration-create-sections #product-identify [data-testid="admin-submit"]::after { content: '基本情報を保存して続ける'; font-size: 0.875rem; }
          `}</style>
          <OptionRegistrationUiEnhancer hideCreateSize />

          <OptionForm
            option={null}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={[]}
            conflicts={[]}
            defaultCategoryId={defaultCategoryId}
            mode="create"
            returnTo={returnTo}
          />

          {lockedSections.map(([no, label, note]) => (
            <section key={no} className="card border-dashed bg-sand/10 p-5 opacity-70 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{no}. {label}</h2>
                  <p className="mt-1 text-sm text-muted">{note}</p>
                </div>
                <span className="rounded-full bg-ivory px-3 py-1 text-xs font-semibold text-muted">基本情報保存後</span>
              </div>
              <p className="mt-4 text-xs text-muted">1. 基本情報を保存すると、このまま同じSTEP 1の続きとして入力できます。</p>
            </section>
          ))}
        </div>
      </section>
    </AdminPage>
  );
}
