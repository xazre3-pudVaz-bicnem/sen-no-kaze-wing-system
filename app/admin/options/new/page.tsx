import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';
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
  const catalogEditor = canEditCatalog(actor.role);
  const registrationCategories = allCategories.filter((c) => c.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE);
  const freeCategory = registrationCategories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const requestedFreeCategory = Boolean(sp.category && sp.category === freeCategory?.id);
  const freeRegistrationBlocked = requestedFreeCategory || !catalogEditor;
  const categories = registrationCategories.filter((c) => c.code !== FREE_PRODUCT_CATEGORY_CODE);
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

  const stepOneSections = [
    ['1', '基本情報', 'カテゴリー・メーカー・商品名・型番・サイズ'],
    ['2', '商品の詳細', '商品説明・メーカー記載の特徴'],
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
          見積テンプレートの商品追加から移動しています。まず基本情報を入力して「次へ：画像・資料」へ進み、STEP 2で登録内容を確認して「この内容で登録」した後に元の見積テンプレートへ戻って商品を追加します。
        </Alert>
      )}

      <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
        <h2 className="font-semibold">商品登録の2ステップ</h2>
        <p className="mt-1 text-xs text-muted">
          最初は基本情報だけ入力します。「次へ：画像・資料」で商品を作成し、そのままSTEP 1の画像・資料・お客様選択・価格設定へ進みます。最後にSTEP 2で登録内容とお客様表示を確認し、「この内容で登録」します。
        </p>
        <p className="mt-2 text-xs leading-5 text-ink-soft">
          STEP 1は1つの入力画面です。最初に基本情報を保存して下書きを作成すると、同じSTEP 1の続きとして残りの項目を入力できます。
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

      <section className="card p-4 sm:p-5" aria-label="STEP 1 商品情報の流れ" data-testid="option-registration-step1-outline">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">STEP 1 商品情報</h2>
            <p className="mt-1 text-xs text-muted">上から順に入力します。基本情報を保存すると、残りの項目を続けて入力できます。</p>
          </div>
          <span className="rounded-full bg-ivory px-3 py-1 text-xs font-semibold text-brown">現在：1 基本情報</span>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stepOneSections.map(([no, label, note], index) => (
            <li
              key={no}
              className={`rounded-xl border px-3 py-3 ${
                index === 0 ? 'border-brown bg-ivory/70' : 'border-line bg-sand/20 text-muted'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-brown">{no}</span>
                {index > 0 && <span className="text-[0.65rem] font-semibold">基本情報保存後</span>}
              </div>
              <span className="mt-1 block text-sm font-semibold text-ink">{label}</span>
              <span className="mt-1 block text-[0.7rem] leading-5">{note}</span>
              {index > 0 && <span className="mt-2 block text-[0.65rem]">基本情報を保存すると入力できます</span>}
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
        mode="create"
        returnTo={returnTo}
      />
    </AdminPage>
  );
}
