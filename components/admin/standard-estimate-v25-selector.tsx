'use client';

import Link from 'next/link';
import { formatYen } from '@/lib/domain/pricing';
import type { StandardEstimateWorkspaceEntry } from '@/lib/data/standard-estimate-workspace';

type FireSpec = '非防火' | '防火' | 'その他';
export type V25SelectorRow = {
  entry: StandardEstimateWorkspaceEntry;
  product: string;
  productRank: number;
  purpose: string;
  purposeRank: number;
  size: string;
  fire: FireSpec;
};

const PRODUCT_ORDER = ['Wing', 'BOX', 'Flat'] as const;
const PURPOSES = ['ホテル', '住居', '住宅', '事務所', '水回り'];

/** 表示順だけ。仕様の名称、ID、公開／下書き、版には触れない。 */
export function v25SelectorRow(entry: StandardEstimateWorkspaceEntry): V25SelectorRow {
  const parts = entry.identity.split(/\s+\/\s+/).map((text) => text.trim());
  const model = parts.length >= 4 ? parts[0] : '';
  const purpose = parts.length >= 4 ? parts[1] : entry.identity;
  const size = parts.length >= 4 ? parts[2] : '';
  const fireLabel = parts.length >= 4 ? parts[3] : '';
  const matchName = model || entry.name;
  const productIndex = PRODUCT_ORDER.findIndex((item) => new RegExp(`\\b${item}\\b`, 'i').test(matchName) ||
    matchName.toLocaleLowerCase('ja-JP').startsWith(item.toLocaleLowerCase('ja-JP')));
  const product = productIndex >= 0 ? PRODUCT_ORDER[productIndex] : (model || 'その他');
  const purposeIndex = PURPOSES.findIndex((key) => purpose.includes(key));
  return {
    entry, product, productRank: productIndex >= 0 ? productIndex : PRODUCT_ORDER.length,
    purpose, purposeRank: purposeIndex >= 0 ? purposeIndex : PURPOSES.length,
    size, fire: fireLabel === '非防火' ? '非防火' : fireLabel === '防火' ? '防火' : 'その他',
  };
}

export function groupV25Selector(entries: readonly StandardEstimateWorkspaceEntry[]): Array<{
  product: string;
  sections: Array<{ purpose: string; sizes: Array<{ size: string; rows: V25SelectorRow[] }> }>;
}> {
  const sorted = entries.map(v25SelectorRow).sort((a, b) =>
    a.productRank - b.productRank || a.product.localeCompare(b.product, 'ja') ||
    a.purposeRank - b.purposeRank || a.purpose.localeCompare(b.purpose, 'ja') ||
    a.size.localeCompare(b.size, 'ja') ||
    ({ '非防火': 0, '防火': 1, 'その他': 2 }[a.fire] - { '非防火': 0, '防火': 1, 'その他': 2 }[b.fire]) ||
    a.entry.identity.localeCompare(b.entry.identity, 'ja')
  );
  const groups: ReturnType<typeof groupV25Selector> = [];
  for (const row of sorted) {
    let product = groups.find((group) => group.product === row.product);
    if (!product) { product = { product: row.product, sections: [] }; groups.push(product); }
    let section = product.sections.find((part) => part.purpose === row.purpose);
    if (!section) { section = { purpose: row.purpose, sizes: [] }; product.sections.push(section); }
    let sized = section.sizes.find((item) => item.size === row.size);
    if (!sized) { sized = { size: row.size, rows: [] }; section.sizes.push(sized); }
    sized.rows.push(row);
  }
  return groups;
}

function SelectorEntry({ row, active, showSize }: { row: V25SelectorRow; active: boolean; showSize: boolean }) {
  const entry = row.entry;
  // The group heading owns the model and common dimensions; keep per-card details focused.
  const title = row.size ? row.purpose + '・' + row.fire : entry.identity;
  return (
    <Link
      href={'/admin/estimate-templates?master=' + entry.masterId}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        // Next.jsの仕様切替はクライアント遷移。beforeunloadに頼らず未保存の入力を保護する。
        if (!active && document.querySelector('[data-testid="v25-wb-unsaved-position"]') &&
          !window.confirm('下書きに保存していない変更があります。保存せずに仕様を変更しますか？')) {
          event.preventDefault();
        }
      }}
      data-testid="v25-selector-entry"
      className={'block min-w-0 rounded-md border px-3 py-2.5 text-sm leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ' +
        (active
          ? 'border-emerald-800 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-800'
          : 'border-slate-300 bg-white text-slate-900 hover:border-slate-500 hover:bg-slate-50')}
      title={entry.identity}
    >
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-semibold">{title}</span>
        {active && <span className="shrink-0 rounded bg-emerald-800 px-1.5 py-0.5 text-sm font-medium text-white">選択中</span>}
      </span>
      {showSize && row.size && <span className="mt-1 block text-sm text-slate-700">{row.size}</span>}
      <span className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {entry.published ? (
          <>
            <span className="font-medium text-slate-700">公開価格（税込）</span>
            <span className="break-words text-lg font-bold leading-6 tabular-nums text-slate-950" data-testid="v25-selector-published-total">
              {formatYen(entry.published.total)}
            </span>
            {entry.published.hasPor && <span className="font-medium text-amber-900">＋別途見積</span>}
          </>
        ) : (
          <span className="font-medium text-slate-700">公開価格未設定</span>
        )}
      </span>
      <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-200 pt-1 text-sm text-slate-700">
        <span>{entry.published ? '公開 第' + entry.published.version + '版' : '未公開'}</span>
        {entry.draft && <span className="font-semibold text-amber-900">下書き 第{entry.draft.version}版</span>}
      </span>
    </Link>
  );
}

/** Wing / BOX / Flatごとに折り畳む。選択中だけ初期展開し、明細への距離を固定する。 */
export function StandardEstimateV25Selector({ entries, selectedId }: {
  entries: readonly StandardEstimateWorkspaceEntry[];
  selectedId: string | null;
}) {
  const groups = groupV25Selector(entries);
  const selectedGroup = groups.find((group) =>
    group.sections.some((section) =>
      section.sizes.some((sized) => sized.rows.some((row) => row.entry.masterId === selectedId))
    )
  )?.product ?? groups[0]?.product;

  return (
    <nav aria-label="標準見積の一覧" className="w-full min-w-0 max-w-[400px] space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-2"
      data-testid="standard-estimate-selector">
      {entries.length === 0 && (
        <p className="px-2 py-4 text-sm text-slate-800">
          標準見積がまだありません。「新しい標準見積を作る」で、本体マスターの公開版から作成してください。
        </p>
      )}
      {groups.map((group) => {
        const rows = group.sections.flatMap((section) => section.sizes.flatMap((sized) => sized.rows));
        const sizes = [...new Set(rows.map((row) => row.size).filter(Boolean))];
        return (
          <details key={group.product} name="v25-spec-product" open={group.product === selectedGroup}
            data-testid="v25-selector-product" className="min-w-0 rounded-md border border-slate-300 bg-white">
            <summary className="flex min-h-[42px] cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm font-semibold text-slate-900 marker:text-slate-700">
              <span>{group.product}</span>
              {sizes.length === 1 && <span className="font-normal text-slate-700">{sizes[0]}</span>}
              <span className="ml-auto font-normal text-slate-700">{rows.length}仕様</span>
            </summary>
            <div className="max-h-[22rem] space-y-2 overflow-y-auto overscroll-contain border-t border-slate-200 bg-slate-50 p-2"
              data-testid="v25-selector-list">
              {rows.map((row) => (
                <SelectorEntry key={row.entry.masterId} row={row}
                  active={row.entry.masterId === selectedId} showSize={sizes.length > 1} />
              ))}
            </div>
          </details>
        );
      })}
      {entries.some((entry) => entry.published?.hasPor) && (
        <p className="px-1 text-sm leading-5 text-slate-700" data-testid="v25-selector-por-note">
          ※別途見積の費用は上記価格に含まれません。
        </p>
      )}
    </nav>
  );
}
