'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createMatrixRowAction, setMatrixRowStatusAction, updateMatrixRowAction } from '@/lib/actions/matrix';
import type { MatrixItem, MatrixSize, MatrixSpec, OptionCategory, OptionCategoryMatrixItem } from '@/lib/domain/types';
import type { MatrixEditorRow } from '@/components/admin/matrix-editor';
import { Alert, Button, Field, Select } from '@/components/ui';

type Props = {
  rows: MatrixEditorRow[];
  items: MatrixItem[];
  specs: MatrixSpec[];
  sizes: MatrixSize[];
  models: { id: string; name: string }[];
  categories: OptionCategory[];
  categoryItems: OptionCategoryMatrixItem[];
  canEdit: boolean;
};

type Notice = { tone: 'success' | 'danger'; text: string } | null;
type RowDraft = { fire: boolean; items: string[] };

function sameItems(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const first = [...a].sort();
  const second = [...b].sort();
  return first.every((value, index) => value === second[index]);
}

export function SelectionMatrixPanel({
  rows: initialRows, items, specs, sizes, models, categories, categoryItems, canEdit,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState(initialRows.find((row) => row.status === 'active')?.id ?? initialRows[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const [newRow, setNewRow] = useState({
    base_model_id: models[0]?.id ?? '',
    spec_code: specs.find((spec) => spec.status === 'active')?.code ?? '',
    size_code: sizes.find((size) => size.status === 'active')?.code ?? '',
    fire_selectable: false,
  });

  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const draftOf = (row: MatrixEditorRow): RowDraft =>
    drafts[row.id] ?? { fire: row.fire_selectable, items: row.selectable_items };
  const isDirty = (row: MatrixEditorRow) => {
    const draft = drafts[row.id];
    return Boolean(draft && (draft.fire !== row.fire_selectable || !sameItems(draft.items, row.selectable_items)));
  };

  useEffect(() => {
    if (!rows.some((row) => {
      const draft = drafts[row.id];
      return draft && (draft.fire !== row.fire_selectable || !sameItems(draft.items, row.selectable_items));
    })) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, rows]);

  const chooseRow = (id: string) => {
    if (selected && selected.id !== id && isDirty(selected)) {
      if (!window.confirm('未保存の変更があります。破棄して別の仕様を表示しますか？')) return;
      setDrafts((current) => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
    }
    setSelectedId(id);
    setNotice(null);
  };

  const modelRows = selected ? rows.filter((row) => row.base_model_id === selected.base_model_id) : [];
  const specRows = selected ? modelRows.filter((row) => row.spec_code === selected.spec_code) : [];
  const modelIds = [...new Set(rows.map((row) => row.base_model_id))];
  const specCodes = [...new Set(modelRows.map((row) => row.spec_code))];
  const draft = selected ? draftOf(selected) : null;
  const retired = selected?.status === 'retired';

  const save = (row: MatrixEditorRow) => {
    const changes = draftOf(row);
    startTransition(async () => {
      const result = await updateMatrixRowAction({
        row_id: row.id,
        fire_selectable: changes.fire,
        selectable_items: changes.items,
        expected_lock_version: row.lock_version,
      });
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error });
        return;
      }
      setRows((current) => current.map((value) =>
        value.id === row.id ? { ...value, ...result.row, selectable_items: changes.items } : value
      ));
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setNotice({ tone: 'success', text: result.message });
    });
  };

  const changeStatus = (row: MatrixEditorRow, status: 'active' | 'retired') => {
    if (!window.confirm(status === 'retired' ? 'この仕様の行を停止しますか？' : 'この仕様の行を再開しますか？')) return;
    startTransition(async () => {
      const result = await setMatrixRowStatusAction({
        row_id: row.id,
        status,
        expected_lock_version: row.lock_version,
      });
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error });
        return;
      }
      setRows((current) => current.map((value) => value.id === row.id ? { ...value, ...result.row } : value));
      setNotice({ tone: 'success', text: result.message });
    });
  };

  const addRow = () => {
    if (!window.confirm('新しい仕様行を追加します。既存と同じ機種・仕様でサイズ違いの行を増やすと、お客様の選択肢に影響する可能性があります。続行しますか？')) return;
    startTransition(async () => {
      const result = await createMatrixRowAction({ ...newRow, selectable_items: [] });
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error });
        return;
      }
      const modelName = models.find((model) => model.id === result.row.base_model_id)?.name ?? '不明な機種';
      setRows((current) => [...current, { ...result.row, model_name: modelName, selectable_items: [] }]);
      setSelectedId(result.row.id);
      setNotice({ tone: 'success', text: result.message + '選択項目を設定して保存してください。' });
    });
  };

  const labelSpec = (code: string) => specs.find((spec) => spec.code === code)?.label ?? code;
  const labelSize = (code: string) => sizes.find((size) => size.code === code)?.label ?? code;
  const related = (code: string) =>
    categories.filter((category) => categoryItems.some(
      (entry) => entry.matrix_item_code === code && entry.category_id === category.id
    ));

  return (
    <div className="space-y-4" data-testid="selection-matrix-panel">
      <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-lg font-semibold">機種・仕様・サイズごとの選択可否</h2>
        <p className="mt-1 text-sm text-muted">
          ここでは仕様別に選べる設備・工事項目を設定します。項目の下には対応カテゴリーの共通表示状態を併記しています。
        </p>
        {!canEdit && <p className="mt-2 text-sm font-medium text-ink-soft">閲覧のみ：変更できるのは本部管理者です。</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="機種" htmlFor="selection-matrix-model">
            <Select
              id="selection-matrix-model"
              value={selected?.base_model_id ?? ''}
              disabled={pending || modelIds.length === 0}
              onChange={(event) => chooseRow(rows.find((row) => row.base_model_id === event.target.value)?.id ?? '')}
            >
              {modelIds.map((id) => <option key={id} value={id}>{models.find((model) => model.id === id)?.name ?? id}</option>)}
            </Select>
          </Field>
          <Field label="仕様" htmlFor="selection-matrix-spec">
            <Select
              id="selection-matrix-spec"
              value={selected?.spec_code ?? ''}
              disabled={pending || !selected}
              onChange={(event) => chooseRow(modelRows.find((row) => row.spec_code === event.target.value)?.id ?? '')}
            >
              {specCodes.map((code) => <option key={code} value={code}>{labelSpec(code)}</option>)}
            </Select>
          </Field>
          <Field label="サイズ" htmlFor="selection-matrix-size">
            <Select
              id="selection-matrix-size"
              value={selected?.size_code ?? ''}
              disabled={pending || !selected}
              onChange={(event) => chooseRow(specRows.find((row) => row.size_code === event.target.value)?.id ?? '')}
            >
              {specRows.map((row) => (
                <option key={row.id} value={row.size_code}>
                  {labelSize(row.size_code)}{row.status === 'retired' ? '（停止中）' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {selected && draft ? (
        <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5" aria-label="仕様別の設定">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">{selected.model_name} / {labelSpec(selected.spec_code)} / {labelSize(selected.size_code)}</h3>
              <p className="mt-1 text-xs text-muted">{retired ? '停止中の行です。' : '選択可否を変更してから、この仕様の設定だけ保存します。'}</p>
            </div>
            {retired && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-ink-soft">停止中</span>}
          </div>
          <label className="flex items-center gap-3 rounded-lg border border-line bg-sand/30 px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={draft.fire}
              disabled={!canEdit || retired || pending}
              onChange={(event) => setDrafts((current) => ({
                ...current, [selected.id]: { ...draft, fire: event.target.checked },
              }))}
              aria-label="この仕様で防火を選べる"
            />
            <span className="font-medium">防火仕様を選択可能にする</span>
          </label>
          <div className="divide-y divide-line rounded-lg border border-line">
            {activeItems.map((item) => {
              const mapped = related(item.code);
              const checked = draft.items.includes(item.code);
              return (
                <label key={item.code} className="flex items-start gap-3 px-3 py-3 sm:px-4" data-testid="matrix-item-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEdit || retired || pending}
                    onChange={() => setDrafts((current) => ({
                      ...current,
                      [selected.id]: {
                        ...draft,
                        items: checked ? draft.items.filter((code) => code !== item.code) : [...draft.items, item.code],
                      },
                    }))}
                    aria-label={item.label + ' を選択可能にする'}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block text-xs text-muted">
                      {mapped.length ? mapped.map((category) =>
                        category.name + '（共通表示：' + (category.customer_visible ? '表示' : '非表示') + '）'
                      ).join(' / ') : '対応カテゴリーの登録なし'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">{checked ? '選択可' : '不可'}</span>
                </label>
              );
            })}
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button type="button" disabled={!isDirty(selected) || pending || retired} onClick={() => save(selected)}>この仕様を保存</Button>
                <Button type="button" variant="ghost" disabled={!isDirty(selected) || pending} onClick={() => setDrafts((current) => {
                  const next = { ...current };
                  delete next[selected.id];
                  return next;
                })}>変更を破棄</Button>
              </div>
              <Button type="button" size="sm" variant="ghost" disabled={pending || isDirty(selected)} onClick={() => changeStatus(selected, retired ? 'active' : 'retired')}>
                {retired ? '行を再開' : '行を停止'}
              </Button>
            </div>
          )}
        </section>
      ) : <Alert tone="warn">表示できる仕様行がありません。</Alert>}
      {canEdit && (
        <details className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-semibold">＋ 仕様行を追加</summary>
          <p className="mt-3 text-xs text-muted">
            既存の機種・仕様・サイズを使用します。行追加時点では選択項目が空です。サイズ違いの有効行を増やすと、お客様の選択判定に影響する場合があります。
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="機種" htmlFor="matrix-add-model">
              <Select id="matrix-add-model" value={newRow.base_model_id} onChange={(event) => setNewRow({ ...newRow, base_model_id: event.target.value })}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </Select>
            </Field>
            <Field label="仕様" htmlFor="matrix-add-spec">
              <Select id="matrix-add-spec" value={newRow.spec_code} onChange={(event) => setNewRow({ ...newRow, spec_code: event.target.value })}>
                {specs.filter((spec) => spec.status === 'active').map((spec) => <option key={spec.code} value={spec.code}>{spec.label}</option>)}
              </Select>
            </Field>
            <Field label="サイズ" htmlFor="matrix-add-size">
              <Select id="matrix-add-size" value={newRow.size_code} onChange={(event) => setNewRow({ ...newRow, size_code: event.target.value })}>
                {sizes.filter((size) => size.status === 'active').map((size) => <option key={size.code} value={size.code}>{size.label}</option>)}
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={newRow.fire_selectable} onChange={(event) => setNewRow({ ...newRow, fire_selectable: event.target.checked })} />
              防火を選べる
            </label>
          </div>
          <div className="mt-4">
            <Button type="button" variant="secondary" disabled={pending || !newRow.base_model_id} onClick={addRow}>行を追加する</Button>
          </div>
        </details>
      )}
      <p className="text-xs text-muted">
        「共通表示」は別タブで管理します。この画面の選択可否とは別の設定です。保存するとシミュレーターや見積依頼の選択判定に影響します。
      </p>
    </div>
  );
}
