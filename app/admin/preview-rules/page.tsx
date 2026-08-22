import Link from 'next/link';
import { deletePreviewRuleAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import { findMissingPreviewCombos, previewKeyLabels } from '@/lib/domain/preview';
import { VIEW_KEYS, VIEW_LABELS } from '@/lib/domain/types';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';

export default async function AdminPreviewRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });
  const bundles = (await Promise.all(models.map((m) => store.getCatalogBundle(m.id, { includeDraft: true })))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof store.getCatalogBundle>>>[];

  return (
    <AdminPage title="プレビュー画像" lead="選択状態（プレビューキーの組み合わせ）と完成イメージの対応を管理します。完全一致の画像がない組み合わせは警告として表示されます。" actions={<Link href="/admin/preview-rules/new" className="btn-primary btn-sm">画像ルールを追加</Link>}>
      <FlashMessages sp={sp} />
      {bundles.map((b) => {
        const labels = previewKeyLabels(b.options);
        const label = (k: string) => labels.get(k) ?? k;
        const published = b.previewRules.filter((r) => r.status === 'published');
        const { missing, truncated } = findMissingPreviewCombos(published, b.options.filter((o) => o.status === 'published'));
        return (
          <section key={b.model.id} className="space-y-5">
            <h2 className="text-xl">{b.model.name}</h2>
            {missing.length > 0 ? (
              <Alert tone="warn" title={`画像が不足している組み合わせ：${missing.length} 件`}>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2" data-testid="missing-combos">
                  {missing.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span>
                        <span className="font-semibold">{VIEW_LABELS[m.view]}</span>：{m.keys.length ? m.keys.map(label).join(' + ') : '標準（キーなし）'}
                      </span>
                      <Link href={`/admin/preview-rules/new?model=${b.model.id}&view=${m.view}&keys=${m.keys.join(',')}`} className="shrink-0 underline">登録</Link>
                    </li>
                  ))}
                </ul>
                {truncated.length > 0 && <p className="mt-2 text-xs">※ キー数が多いため {truncated.map((v) => VIEW_LABELS[v]).join('・')} は先頭6キーまでの組み合わせのみ表示しています。</p>}
                <p className="mt-2 text-xs">不足分は docs/required-preview-assets.md の仕様で撮影・作成してください。</p>
              </Alert>
            ) : (
              <Alert tone="success">すべての組み合わせに画像が登録されています。</Alert>
            )}

            {VIEW_KEYS.map((view) => {
              const rules = b.previewRules.filter((r) => r.view === view).sort((a, c) => a.preview_keys.length - c.preview_keys.length);
              return (
                <div key={view}>
                  <h3 className="mb-2 font-semibold">{VIEW_LABELS[view]}（{rules.length}）</h3>
                  {rules.length === 0 ? (
                    <p className="text-sm text-muted">未登録</p>
                  ) : (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {rules.map((r) => (
                        <li key={r.id} className="card overflow-hidden" data-testid="preview-rule-card">
                          <div className="relative aspect-[16/10] bg-sand">
                            <SmartImage src={r.url} alt={r.alt} fill sizes="33vw" className={view === 'floorplan' ? 'object-contain' : 'object-cover'} />
                            <span className="absolute top-2 left-2 flex gap-1">
                              <Badge tone={r.kind === 'layer' ? 'navy' : 'neutral'}>{r.kind === 'layer' ? 'レイヤー' : '完成画像'}</Badge>
                              {r.status !== 'published' && <Badge tone="warn">非公開</Badge>}
                            </span>
                          </div>
                          <div className="p-3 text-xs">
                            <p className="font-semibold">{r.preview_keys.length ? r.preview_keys.map(label).join(' + ') : '標準（キーなし）'}</p>
                            <p className="truncate text-muted">{r.url}</p>
                            <div className="mt-2 flex gap-3">
                              <Link href={`/admin/preview-rules/${r.id}`} className="underline">編集</Link>
                              <form action={deletePreviewRuleAction}>
                                <input type="hidden" name="id" value={r.id} />
                                <ConfirmSubmit message="このルールを削除しますか？" className="text-danger underline">削除</ConfirmSubmit>
                              </form>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </AdminPage>
  );
}
