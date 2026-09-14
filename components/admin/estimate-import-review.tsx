'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  activateEstimateImportAction,
  saveEstimateImportLineReviewAction,
} from '@/lib/actions/admin';
import type {
  EstimateImportBundle,
  EstimateImportLine,
  EstimateLinkPolicy,
  OptionCategory,
  ProductOption,
} from '@/lib/domain/types';
import {
  estimateLineSourceText,
  rankEstimateProductCandidates,
} from '@/lib/domain/estimate-product-matching';
import { formatYen } from '@/lib/domain/pricing';
import { SmartImage } from '@/components/ui/smart-image';

const POLICY_LABELS: Record<EstimateLinkPolicy, string> = {
  required: '必須',
  optional: '任意',
  none: '不要',
};

function matchLabel(line: EstimateImportBundle['lines'][number]) {
  if (line.link_policy === 'none') return { label: '紐付け不要', className: 'bg-sand text-ink-soft' };
  if (!line.product_link) {
    return line.link_policy === 'required'
      ? { label: '未照合', className: 'bg-red-50 text-danger' }
      : { label: '未照合（任意）', className: 'bg-amber-50 text-amber-800' };
  }
  if (line.product_link.match_type === 'automatic') return { label: '自動一致', className: 'bg-green-50 text-forest' };
  if (line.product_link.match_type === 'saved_rule') return { label: '前回照合を再利用', className: 'bg-blue-50 text-blue-800' };
  return { label: '確認済み', className: 'bg-green-50 text-forest' };
}

function sectionLabel(code: string) {
  if (code === 'base') return '本体';
  if (code === 'interior_exterior') return '内外装工事';
  if (code === 'option') return 'オプション';
  return '別途';
}

export function EstimateImportReview({
  bundle,
  categories,
  options,
  modelName,
}: {
  bundle: EstimateImportBundle;
  categories: OptionCategory[];
  options: ProductOption[];
  modelName: string;
}) {
  const [onlyReview, setOnlyReview] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [policy, setPolicy] = useState<EstimateLinkPolicy>('none');
  const [optionId, setOptionId] = useState('');
  const [query, setQuery] = useState('');

  const optionById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const editing = bundle.lines.find((line) => line.id === editingId) ?? null;

  const unresolvedRequired = bundle.lines.filter(
    (line) => line.link_policy === 'required' && !line.product_link
  ).length;
  const automatic = bundle.lines.filter((line) => line.product_link?.match_type === 'automatic').length;
  const confirmed = bundle.lines.filter(
    (line) => line.product_link && line.product_link.match_type !== 'automatic'
  ).length;
  const noLinkNeeded = bundle.lines.filter((line) => line.link_policy === 'none').length;
  const optionalUnresolved = bundle.lines.filter(
    (line) => line.link_policy === 'optional' && !line.product_link
  ).length;

  const visibleLines = bundle.lines.filter((line) => {
    if (!onlyReview) return true;
    return line.link_policy !== 'none' && !line.product_link;
  });

  const openEditor = (line: EstimateImportBundle['lines'][number]) => {
    setEditingId(line.id);
    setCategoryId(line.category_id ?? '');
    setPolicy(line.link_policy);
    setOptionId(line.product_link?.option_id ?? '');
    setQuery('');
  };

  const categoryOptions = options.filter(
    (option) =>
      (!categoryId || option.category_id === categoryId) &&
      (!option.base_model_id || option.base_model_id === bundle.import.base_model_id) &&
      option.status === 'published'
  );
  const sourceText = editing
    ? estimateLineSourceText({
        section_code: editing.section_code,
        group_label: editing.group_label,
        name: editing.original_name,
        unit: editing.unit,
        remark: editing.remark,
      })
    : '';
  const candidates = editing
    ? rankEstimateProductCandidates({
        sourceText,
        options,
        categoryId: categoryId || null,
        baseModelId: bundle.import.base_model_id,
        limit: 5,
      })
    : [];
  const candidateIds = new Set(candidates.map((row) => row.option.id));
  const normalizedQuery = query.trim().toLowerCase();
  const remainingOptions = categoryOptions.filter((option) => {
    if (candidateIds.has(option.id)) return false;
    if (!normalizedQuery) return true;
    return [option.name, option.manufacturer, option.model_no, option.size_note]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });

  const ready = bundle.import.status === 'ready' && unresolvedRequired === 0;
  const statusLabel =
    bundle.import.status === 'activated'
      ? '有効'
      : bundle.import.status === 'superseded'
        ? '過去版'
        : ready
          ? '有効化できます'
          : '照合確認中';

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted">{modelName}／{bundle.import.name}</p>
            <h2 className="mt-1 text-xl font-semibold">標準見積 v{bundle.import.version}</h2>
            <p className="mt-1 text-xs text-muted">
              {bundle.import.source_file_name} ／ {bundle.import.source_sheet_name}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
            bundle.import.status === 'activated'
              ? 'bg-green-50 text-forest'
              : bundle.import.status === 'superseded'
                ? 'bg-sand text-muted'
                : ready
                  ? 'bg-blue-50 text-blue-800'
                  : 'bg-amber-50 text-amber-800'
          }`}>
            {statusLabel}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg bg-ivory p-3">
            <p className="text-xs text-muted">税込合計</p>
            <p className="mt-1 font-serif text-xl">{formatYen(bundle.import.total)}</p>
          </div>
          <div className="rounded-lg bg-green-50 p-3">
            <p className="text-xs text-muted">自動一致</p>
            <p className="mt-1 text-xl font-semibold text-forest">{automatic}</p>
          </div>
          <div className="rounded-lg bg-green-50 p-3">
            <p className="text-xs text-muted">確認済み</p>
            <p className="mt-1 text-xl font-semibold text-forest">{confirmed}</p>
          </div>
          <div className={`rounded-lg p-3 ${unresolvedRequired > 0 ? 'bg-red-50' : 'bg-ivory'}`}>
            <p className="text-xs text-muted">必須・未照合</p>
            <p className={`mt-1 text-xl font-semibold ${unresolvedRequired > 0 ? 'text-danger' : 'text-forest'}`}>
              {unresolvedRequired}
            </p>
          </div>
          <div className="rounded-lg bg-ivory p-3">
            <p className="text-xs text-muted">紐付け不要</p>
            <p className="mt-1 text-xl font-semibold">{noLinkNeeded}</p>
          </div>
        </div>

        {unresolvedRequired > 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">
            必須商品が {unresolvedRequired} 件未照合のため、まだシミュレーターへ反映できません。
          </div>
        ) : bundle.import.status === 'activated' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-forest">
            このバージョンが現在のシミュレーター標準見積として有効です。
          </div>
        ) : bundle.import.status === 'superseded' ? (
          <div className="rounded-lg border border-line bg-sand/50 px-4 py-3 text-sm text-muted">
            このバージョンは過去版です。現在の標準見積には使用されていません。
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-semibold text-forest">すべての必須商品を確認しました。</p>
            <form action={activateEstimateImportAction}>
              <input type="hidden" name="import_id" value={bundle.import.id} />
              <button type="submit" className="btn-primary btn-sm">
                この見積を有効にする
              </button>
            </form>
          </div>
        )}
        {optionalUnresolved > 0 && (
          <p className="text-xs text-muted">
            任意の商品が {optionalUnresolved} 件未照合です。任意項目は未照合でも有効化できます。
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Excel明細と商品マスターの照合</h2>
            <p className="mt-1 text-xs text-muted">
              必要な商品だけ商品IDを確定します。工事費・経費などは「不要」のままで構いません。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyReview}
              onChange={(event) => setOnlyReview(event.target.checked)}
            />
            要確認だけ表示
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[70rem] text-sm">
            <thead className="bg-sand/60 text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3">区分</th>
                <th className="px-4 py-3">Excel明細</th>
                <th className="px-4 py-3">カテゴリ</th>
                <th className="px-4 py-3">要否</th>
                <th className="px-4 py-3">照合状態</th>
                <th className="px-4 py-3">紐付け商品</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleLines.map((line) => {
                const badge = matchLabel(line);
                const option = line.product_link ? optionById.get(line.product_link.option_id) : null;
                return (
                  <tr key={line.id}>
                    <td className="px-4 py-3 text-xs text-muted">
                      {sectionLabel(line.section_code)}
                      {line.source_row ? <span className="block">Excel {line.source_row}行</span> : null}
                    </td>
                    <td className="max-w-[24rem] px-4 py-3">
                      <p className="font-semibold">{line.original_name}</p>
                      {line.group_label && <p className="mt-0.5 text-xs text-muted">{line.group_label}</p>}
                      {line.remark && <p className="mt-0.5 text-xs text-muted">{line.remark}</p>}
                    </td>
                    <td className="px-4 py-3">{categoryById.get(line.category_id ?? '')?.name ?? '未判定'}</td>
                    <td className="px-4 py-3">{POLICY_LABELS[line.link_policy]}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badge.className}`}>
                        {badge.label}
                      </span>
                      {line.product_link?.match_reason && (
                        <p className="mt-1 text-[0.68rem] text-muted">{line.product_link.match_reason}</p>
                      )}
                    </td>
                    <td className="max-w-[24rem] px-4 py-3">
                      {option ? (
                        <>
                          <p className="font-semibold">{option.name}</p>
                          <p className="text-xs text-muted">
                            {[option.manufacturer, option.model_no, option.size_note].filter(Boolean).join(' ／ ') || option.code}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {['review', 'ready'].includes(bundle.import.status) ? (
                        <button type="button" onClick={() => openEditor(line)} className="btn-secondary btn-sm">
                          {line.product_link ? '変更' : '商品を選択'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {visibleLines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
                    要確認の明細はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
              <div>
                <p className="text-xs text-muted">Excel明細</p>
                <h3 className="mt-1 text-lg font-semibold">{editing.original_name}</h3>
                <p className="mt-1 text-xs text-muted">{editing.group_label}</p>
              </div>
              <button type="button" onClick={() => setEditingId(null)} className="btn-ghost btn-sm">閉じる</button>
            </div>

            <form action={saveEstimateImportLineReviewAction} className="space-y-5 p-5">
              <input type="hidden" name="import_id" value={bundle.import.id} />
              <input type="hidden" name="line_id" value={editing.id} />
              <input type="hidden" name="option_id" value={policy === 'none' ? '' : optionId} />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">カテゴリ</span>
                  <select
                    name="category_id"
                    value={categoryId}
                    onChange={(event) => {
                      setCategoryId(event.target.value);
                      setOptionId('');
                    }}
                    className="input"
                  >
                    <option value="">未判定</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">商品紐付け</span>
                  <select
                    name="link_policy"
                    value={policy}
                    onChange={(event) => {
                      const next = event.target.value as EstimateLinkPolicy;
                      setPolicy(next);
                      if (next === 'none') setOptionId('');
                    }}
                    className="input"
                  >
                    <option value="required">必須</option>
                    <option value="optional">任意</option>
                    <option value="none">不要</option>
                  </select>
                </label>
              </div>

              {policy !== 'none' && (
                <>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-semibold">登録済み商品から選択</h4>
                        <p className="mt-1 text-xs text-muted">
                          {categoryId
                            ? `${categoryById.get(categoryId)?.name ?? '選択カテゴリ'}の商品だけ表示しています。`
                            : 'カテゴリを選ぶと候補を絞り込めます。'}
                        </p>
                      </div>
                      <Link
                        href={`/admin/options/new${categoryId ? `?category=${categoryId}` : ''}`}
                        target="_blank"
                        className="btn-secondary btn-sm"
                      >
                        新しい商品を登録
                      </Link>
                    </div>

                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="メーカー・シリーズ・型番・サイズで検索"
                      className="input mt-3 w-full"
                    />
                  </div>

                  {candidates.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-muted">候補</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {candidates.map((candidate) => (
                          <ProductChoiceCard
                            key={candidate.option.id}
                            option={candidate.option}
                            selected={optionId === candidate.option.id}
                            note={candidate.reasons.join('・')}
                            onSelect={() => setOptionId(candidate.option.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-semibold text-muted">商品一覧</p>
                    <div className="grid max-h-80 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                      {remainingOptions.map((option) => (
                        <ProductChoiceCard
                          key={option.id}
                          option={option}
                          selected={optionId === option.id}
                          onSelect={() => setOptionId(option.id)}
                        />
                      ))}
                      {remainingOptions.length === 0 && candidates.length === 0 && (
                        <div className="col-span-full rounded-lg border border-dashed border-line p-5 text-center text-sm text-muted">
                          該当する登録済み商品がありません。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg bg-ivory p-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="save_rule" />
                      次回以降もこの照合を使用する
                    </label>
                    <label className="mt-3 block text-xs text-muted">
                      再利用範囲
                      <select name="rule_scope" defaultValue="spec" className="input mt-1 block w-full max-w-sm">
                        <option value="spec">このプランだけ（推奨）</option>
                        <option value="model">この本体すべて</option>
                        <option value="global">全体共通</option>
                      </select>
                    </label>
                  </div>
                </>
              )}

              <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => setEditingId(null)} className="btn-secondary btn-sm">キャンセル</button>
                <button
                  type="submit"
                  disabled={policy !== 'none' && policy === 'required' && !optionId}
                  className="btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  この内容で保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductChoiceCard({
  option,
  selected,
  note,
  onSelect,
}: {
  option: ProductOption;
  selected: boolean;
  note?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex gap-3 rounded-xl border p-3 text-left transition ${
        selected ? 'border-forest bg-green-50 ring-1 ring-forest' : 'border-line bg-white hover:border-ink/30'
      }`}
    >
      <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-sand">
        {option.image_url ? (
          <SmartImage src={option.image_url} alt="" fill sizes="80px" className="object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-[0.65rem] text-muted">画像なし</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{option.name}</p>
        <p className="mt-1 text-xs text-muted">
          {[option.manufacturer, option.model_no, option.size_note].filter(Boolean).join(' ／ ') || option.code}
        </p>
        <p className="mt-1 text-xs tabular-nums">{formatYen(option.price)}</p>
        {note && <p className="mt-1 text-[0.68rem] font-semibold text-forest">{note}</p>}
      </div>
      <span className={`mt-1 size-4 shrink-0 rounded-full border ${selected ? 'border-forest bg-forest' : 'border-line'}`} />
    </button>
  );
}
