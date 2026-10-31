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
  const copyRequested = typeof sp.copy_from === 'string' && sp.copy_from.length > 0;
  const copySource = copyRequested
    ? options.find((option) => option.id === sp.copy_from && categories.some((category) => category.id === option.category_id))
    : null;
  const defaultCategoryId = copySource?.category_id ?? (requestedFreeCategory ? undefined : sp.category);
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

  if (copyRequested && !copySource) {
    return (
      <AdminPage title="商品を複製して追加" lead="コピー元の商品を確認できませんでした。">
        <BackLink href={returnTo ?? '/admin/ledger'} label={returnLabel} />
        <Alert tone="info">コピー元の商品が見つからないか、この商品は複製対象外です。商品台帳から選び直してください。</Alert>
      </AdminPage>
    );
  }

  const lockedSections = [
    ['2', '商品の詳細', 'サイズ・仕様・商品説明・メーカー記載の特徴'],
    ['3', '商品画像', 'メイン画像・必要なサブ画像'],
    ['4', 'メーカー資料', 'メーカー資料PDF（原則登録）'],
    ['5', 'お客様選択', '色・仕様など、お客様が選べる項目'],
    ['6', '価格・対象モデル', '商品価格・対象モデル・公開条件'],
    ['7', '登録前チェック', '公開に必要な項目と確認事項を整理'],
  ];

  return (
    <AdminPage
      title={copySource ? '商品を複製して追加' : '商品を追加'}
      lead="STEP 1の商品情報を1画面で入力し、STEP 2でお客様表示を確認してから登録します。"
    >
      <BackLink href={returnTo ?? '/admin/options'} label={returnLabel} />
      {copySource && (
        <Alert tone="info">
          「{copySource.name}」をもとに、新しい商品の下書きを作ります。基本情報・説明・表示用価格・対象モデルと仕様を引き継ぎます。
          商品管理番号・選択肢・原価Version・公開状態・商品間の条件設定は引き継ぎません。
          「基本情報を保存して続ける」の後で、千の風のStorage内のメイン画像・追加画像・メーカーPDFを新しいファイルとして複製します。
          外部URLやStorage外のファイルは複製されません。コピー後の画面で不足を確認し、内容・価格と合わせて確認してください。コピー元は変更しません。
        </Alert>
      )}
      {returnTo && !returnToLedger && (
        <Alert tone="info">
          見積テンプレートの商品追加から移動しています。まず「1. 基本情報」を保存し、続けて同じSTEP 1の画面で商品情報を入力します。STEP 2で登録内容を確認して「この内容で登録」した後に元の見積テンプレートへ戻って商品を追加します。
        </Alert>
      )}

      <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
        <h2 className="font-semibold">商品登録の2ステップ</h2>
        <p className="mt-1 text-xs text-muted">
          STEP 1で商品情報を入力し、STEP 2で実際のお客様表示を確認して登録します。
        </p>
        <p className="mt-2 text-xs leading-5 text-ink-soft">
          最初に「1. 基本情報」を保存して下書きを作成すると、同じSTEP 1の続きとして2〜7を入力できます。
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            ['1', '商品情報', '商品・画像・資料・選択項目・価格を入力'],
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
          <p className="mt-1 text-sm text-muted">上から順に入力します。1. 基本情報を保存すると、2〜7を続けて入力できます。</p>
        </div>

        <div className="registration-create-sections flex flex-col gap-6">
          <style>{`
            .registration-create-sections #product-identify .grid > *:has(#size_note-create) { display: none; }
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
            duplicateSource={copySource}
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