import Link from 'next/link';
import { deleteProductImageAction, deletePreviewRuleAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import { findMissingPreviewCombos, previewKeyLabels } from '@/lib/domain/preview';
import { VIEW_LABELS, type PreviewImageRule, type ProductImage, type ViewKey } from '@/lib/domain/types';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { ProductImageForm } from '@/components/admin/forms';

function PreviewCard({
  rule,
  label,
  keyLabel,
}: {
  rule: PreviewImageRule;
  label: string;
  keyLabel: (key: string) => string;
}) {
  return (
    <li className="card overflow-hidden" data-testid="preview-rule-card">
      <div className="relative aspect-[16/10] bg-sand">
        <SmartImage src={rule.url} alt={rule.alt} fill sizes="33vw" className={rule.view === 'floorplan' ? 'object-contain' : 'object-cover'} />
        <span className="absolute top-2 left-2 flex gap-1">
          <Badge tone="neutral">{label}</Badge>
          {rule.status !== 'published' && <Badge tone="warn">非公開</Badge>}
        </span>
      </div>
      <div className="space-y-2 p-3 text-xs">
        <p className="font-semibold">{rule.preview_keys.length ? rule.preview_keys.map(keyLabel).join(' + ') : '標準状態'}</p>
        {rule.note && <p className="line-clamp-2 text-muted">{rule.note}</p>}
        <div className="flex gap-3">
          <Link href={`/admin/preview-rules/${rule.id}`} className="font-semibold underline">画像を変更</Link>
          <form action={deletePreviewRuleAction}>
            <input type="hidden" name="id" value={rule.id} />
            <ConfirmSubmit message="この画像ルールを削除しますか？" className="text-danger underline">削除</ConfirmSubmit>
          </form>
        </div>
      </div>
    </li>
  );
}

function ProductImageCard({
  image,
  modelId,
}: {
  image: ProductImage;
  modelId: string;
}) {
  return (
    <li className="card overflow-hidden">
      <div className="relative aspect-[16/10] bg-sand">
        <SmartImage src={image.url} alt={image.alt} fill sizes="33vw" className={image.kind === 'elevation' ? 'object-contain' : 'object-cover'} />
      </div>
      <div className="space-y-2 p-3 text-xs">
        <p className="font-semibold">{image.caption || image.alt || '（説明なし）'}</p>
        <form action={deleteProductImageAction}>
          <input type="hidden" name="id" value={image.id} />
          <input type="hidden" name="base_model_id" value={modelId} />
          <input type="hidden" name="redirect_to" value="/admin/preview-rules" />
          <ConfirmSubmit message="この画像を削除しますか？" className="text-danger underline">削除して差し替える</ConfirmSubmit>
        </form>
      </div>
    </li>
  );
}

const COMPLETION_VIEWS: ViewKey[] = ['exterior', 'interior', 'water'];

export default async function AdminPreviewRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });
  const bundles = (await Promise.all(models.map((m) => store.getCatalogBundle(m.id, { includeDraft: true })))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof store.getCatalogBundle>>>[];

  return (
    <AdminPage
      title="シミュレーター画像"
      lead="シミュレーターに表示する平面図・完成イメージ・立面図・施工事例を本体ごとに管理します。通常は画像の追加・差し替えだけで運用できます。"
    >
      <FlashMessages sp={sp} />

      <div className="space-y-10">
        {bundles.map((b) => {
          const labels = previewKeyLabels(b.options);
          const keyLabel = (key: string) => labels.get(key) ?? key;
          const floorplans = b.previewRules.filter((r) => r.view === 'floorplan').sort((a, c) => a.preview_keys.length - c.preview_keys.length);
          const elevations = b.images.filter((i) => i.kind === 'elevation').sort((a, c) => a.sort_order - c.sort_order);
          const cases = b.images.filter((i) => i.kind === 'case').sort((a, c) => a.sort_order - c.sort_order);
          const published = b.previewRules.filter((r) => r.status === 'published');
          const { missing, truncated } = findMissingPreviewCombos(published, b.options.filter((o) => o.status === 'published'));

          return (
            <section key={b.model.id} className="space-y-7 border-b border-line pb-10 last:border-b-0">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">ベースコンテナ</p>
                  <h2 className="text-2xl">{b.model.name}</h2>
                </div>
                <Link href={`/simulator/${b.model.slug}`} target="_blank" className="btn-secondary btn-sm">シミュレーターを見る</Link>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">平面図</h3>
                    <p className="text-xs text-muted">仕様・設備の組み合わせに応じてシミュレーター左側に表示します。</p>
                  </div>
                  <Link href={`/admin/preview-rules/new?model=${b.model.id}&view=floorplan`} className="btn-secondary btn-sm">平面図を追加</Link>
                </div>
                {floorplans.length > 0 ? (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {floorplans.map((rule) => <PreviewCard key={rule.id} rule={rule} label="平面図" keyLabel={keyLabel} />)}
                  </ul>
                ) : <p className="text-sm text-muted">平面図は未登録です。</p>}
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold">完成イメージ</h3>
                  <p className="text-xs text-muted">外観・室内・その他（水まわり）を、選択内容に応じて切り替えます。</p>
                </div>
                <div className="space-y-5">
                  {COMPLETION_VIEWS.map((view) => {
                    const rules = b.previewRules.filter((r) => r.view === view).sort((a, c) => a.preview_keys.length - c.preview_keys.length);
                    return (
                      <div key={view}>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-semibold">{VIEW_LABELS[view]}</h4>
                          <Link href={`/admin/preview-rules/new?model=${b.model.id}&view=${view}`} className="text-xs font-semibold underline">画像を追加</Link>
                        </div>
                        {rules.length > 0 ? (
                          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {rules.map((rule) => <PreviewCard key={rule.id} rule={rule} label={VIEW_LABELS[view]} keyLabel={keyLabel} />)}
                          </ul>
                        ) : <p className="text-sm text-muted">未登録です。</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold">立面図</h3>
                  <p className="text-xs text-muted">正面・右側面・背面・左側面など、シミュレーターの立面図欄に表示します。</p>
                </div>
                {elevations.length > 0 && (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {elevations.map((image) => <ProductImageCard key={image.id} image={image} modelId={b.model.id} />)}
                  </ul>
                )}
                <ProductImageForm modelId={b.model.id} allowedKinds={['elevation']} title="立面図を追加" />
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold">施工事例</h3>
                  <p className="text-xs text-muted">完成イメージ内の「施工事例」タブに表示する写真です。</p>
                </div>
                {cases.length > 0 && (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {cases.map((image) => <ProductImageCard key={image.id} image={image} modelId={b.model.id} />)}
                  </ul>
                )}
                <ProductImageForm modelId={b.model.id} allowedKinds={['case']} title="施工事例を追加" />
              </div>

              <details className="card p-5">
                <summary className="cursor-pointer font-semibold">画像ルールの詳細・不足チェック</summary>
                <div className="mt-4 space-y-3">
                  {missing.length > 0 ? (
                    <Alert tone="warn" title={`画像が不足している組み合わせ：${missing.length}件`}>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                        {missing.map((m, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 text-xs">
                            <span><span className="font-semibold">{VIEW_LABELS[m.view]}</span>：{m.keys.length ? m.keys.map(keyLabel).join(' + ') : '標準状態'}</span>
                            <Link href={`/admin/preview-rules/new?model=${b.model.id}&view=${m.view}&keys=${m.keys.join(',')}`} className="shrink-0 underline">登録</Link>
                          </li>
                        ))}
                      </ul>
                      {truncated.length > 0 && <p className="mt-2 text-xs">※ 組み合わせ数が多いビューは一部のみチェックしています。</p>}
                    </Alert>
                  ) : (
                    <Alert tone="success">現在の公開ルールでは不足警告はありません。</Alert>
                  )}
                  <p className="text-xs text-muted">composite / layer、プレビューキー、重ね順などの高度な設定は各画像の「画像を変更」から編集できます。</p>
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </AdminPage>
  );
}
