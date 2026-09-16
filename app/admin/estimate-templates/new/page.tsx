import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Alert, Input, Select } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';

export default async function NewEstimateTemplatePage() {
  await requireCatalogEditor('/admin/estimate-templates/new');
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });

  return (
    <AdminPage
      title="見積テンプレートを新規作成"
      lead="商品・仕様・防火区分・参照本体・利用地域を決めて、下書き版を作成します。"
    >
      <BackLink href="/admin/estimate-templates" label="見積テンプレート一覧へ戻る" />

      <Alert tone="info">
        この画面はUI確認版です。作成処理は、本部／総代理店の承認ルールと版管理のDB設計を確定した後に接続します。
      </Alert>

      <section className="card space-y-6 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="label">商品モデル</span>
            <Select className="mt-1 w-full" defaultValue={models[0]?.id ?? ''}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="label">用途・仕様</span>
            <Select className="mt-1 w-full" defaultValue="hotel">
              <option value="hotel">ホテル</option>
              <option value="residence">住宅・単身者</option>
              <option value="office">事務所・店舗</option>
              <option value="hotel-single">ホテル・単身者</option>
              <option value="water-kit">水回りキット</option>
            </Select>
          </label>

          <label className="block">
            <span className="label">防火仕様</span>
            <Select className="mt-1 w-full" defaultValue="non_fire">
              <option value="non_fire">非防火</option>
              <option value="fire">防火</option>
            </Select>
          </label>

          <label className="block">
            <span className="label">利用地域</span>
            <Select className="mt-1 w-full" defaultValue="all">
              <option value="all">全国</option>
              <option value="hokuriku">北陸ブロック</option>
              <option value="custom">指定地域</option>
            </Select>
          </label>

          <label className="block sm:col-span-2">
            <span className="label">テンプレート名</span>
            <Input className="mt-1 w-full" defaultValue="Wing ホテル 非防火" />
          </label>

          <label className="block sm:col-span-2">
            <span className="label">参照本体</span>
            <Select className="mt-1 w-full" disabled>
              <option>公開中の本体マスターから選択（次工程で接続）</option>
            </Select>
            <span className="mt-1 block text-xs text-muted">
              実装時は、選択した商品モデル・防火区分に合う公開中の本体だけを候補にします。
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <button type="button" className="btn-primary btn-sm" disabled>
            下書き版を作成
          </button>
          <span className="self-center text-xs text-muted">
            作成処理は画面確認後に有効化します。
          </span>
        </div>
      </section>
    </AdminPage>
  );
}
