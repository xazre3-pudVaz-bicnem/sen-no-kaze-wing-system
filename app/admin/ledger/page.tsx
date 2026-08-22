import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import type { BaseModel, OptionCategory, ProductOption } from '@/lib/domain/types';
import { Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, FlashMessages } from '@/components/admin/ui';

/**
 * 商品台帳（先方指定の階層）
 *   本体 › 仕様 › 分類フォルダ › カテゴリー › 商品
 * 分類フォルダ・カテゴリーは管理画面から増やせる。
 */
export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getStore();
  const [models, categories, options] = await Promise.all([store.listModels({ includeDraft: true }), store.listCategories(), store.listOptions()]);

  const forModel = (m: BaseModel) => options.filter((o) => o.base_model_id === null || o.base_model_id === m.id);
  const forSpec = (list: ProductOption[], code: string) => list.filter((o) => o.spec_codes.length === 0 || o.spec_codes.includes(code));
  const groups = (list: ProductOption[]) => {
    const used = categories.filter((c) => list.some((o) => o.category_id === c.id));
    const byGroup = new Map<string, { name: string; sort: number; cats: OptionCategory[] }>();
    for (const c of used) {
      const g = byGroup.get(c.group_code) ?? { name: c.group_name, sort: c.group_sort, cats: [] };
      g.cats.push(c);
      byGroup.set(c.group_code, g);
    }
    return [...byGroup.entries()]
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([code, g]) => ({ code, ...g, cats: g.cats.sort((a, b) => a.sort_order - b.sort_order) }));
  };

  return (
    <AdminPage
      title="商品台帳"
      lead="本体 › 仕様 › 分類 › カテゴリー › 商品。分類フォルダとカテゴリーは「オプションカテゴリー」から追加できます。"
      actions={
        <>
          <Link href="/admin/categories" className="btn-secondary btn-sm">
            分類・カテゴリーを編集
          </Link>
          <Link href="/admin/options/new" className="btn-primary btn-sm">
            商品を追加
          </Link>
        </>
      }
    >
      <FlashMessages sp={sp} />

      {models.map((m) => (
        <section key={m.id} className="card overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line bg-sand/50 px-5 py-3">
            <h2 className="font-serif text-xl">
              {m.name}
              <span className="ml-2 text-xs font-normal text-muted">{m.slug}</span>
            </h2>
            <span className="text-xs text-muted">本体一式 {formatYen(m.base_price)}（諸費用 {Math.round((m.expense_rate ?? 0.15) * 100)}%）</span>
          </div>

          {(m.presets ?? []).map((p) => {
            const list = forSpec(forModel(m), p.code);
            return (
              <div key={p.code} className="border-b border-line last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-3 bg-ivory px-5 py-2.5">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-muted">{p.description}</span>
                  <Link href={`/simulator/${m.slug}`} target="_blank" className="ml-auto text-xs underline underline-offset-4">
                    シミュレーターで開く
                  </Link>
                </div>
                <div className="divide-y divide-line">
                  {groups(list).map((g) => (
                    <div key={g.code} className="px-5 py-3">
                      <p className="text-sm font-semibold text-forest">{g.name}</p>
                      <div className="mt-2 space-y-3">
                        {g.cats.map((c) => {
                          const items = list.filter((o) => o.category_id === c.id).sort((a, b) => a.sort_order - b.sort_order);
                          return (
                            <div key={c.id} className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                              <p className="text-xs text-muted">
                                {c.name}
                                <span className="ml-1">{c.selection_mode === 'single' ? '（1つ選択）' : '（複数可）'}</span>
                                {c.is_required && <span className="ml-1 text-warn">必須</span>}
                              </p>
                              <ul className="space-y-1">
                                {items.map((o) => (
                                  <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                                    {o.image_url ? (
                                      <span className="relative size-8 shrink-0 overflow-hidden rounded bg-sand">
                                        <SmartImage src={o.image_url} alt="" fill sizes="32px" className="object-cover" />
                                      </span>
                                    ) : (
                                      <span className="size-8 shrink-0 rounded bg-sand" aria-hidden="true" />
                                    )}
                                    <Link href={`/admin/options/${o.id}`} className="underline-offset-4 hover:underline">
                                      {o.name}
                                    </Link>
                                    <span className="text-xs text-muted">{o.price_on_request ? '要見積' : formatYen(o.price)}</span>
                                    {o.is_default && <Badge>初期選択</Badge>}
                                    {o.status !== 'published' && <Badge tone="warn">非公開</Badge>}
                                    {o.spec_codes.length > 0 && <span className="text-[0.65rem] text-muted">[{o.spec_codes.join('/')}]</span>}
                                  </li>
                                ))}
                                {items.length === 0 && <li className="text-xs text-muted">商品なし</li>}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </AdminPage>
  );
}
