'use client';

import { useMemo, useState, useTransition } from 'react';
import { createMatrixRowAction, setMatrixRowStatusAction, updateMatrixRowAction } from '@/lib/actions/matrix';
import type { MatrixItem, MatrixRow, MatrixSize, MatrixSpec } from '@/lib/domain/types';
import { Alert, Button, Field, Select } from '@/components/ui';

export interface MatrixEditorRow extends MatrixRow {
  model_name: string;
  selectable_items: string[];
}

type Props = {
  rows: MatrixEditorRow[];
  items: MatrixItem[];
  specs: MatrixSpec[];
  sizes: MatrixSize[];
  models: { id: string; name: string }[];
};

type Notice = { tone: 'success' | 'danger'; text: string } | null;

function sameItems(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

export function MatrixEditor({ rows: initialRows, items, specs, sizes, models }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [drafts, setDrafts] = useState<Record<string, { fire: boolean; items: string[] }>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const specLabel = (code: string) => specs.find((spec) => spec.code === code)?.label ?? code;
  const sizeLabel = (code: string) => sizes.find((size) => size.code === code)?.label ?? code;

  const draftOf = (row: MatrixEditorRow) => drafts[row.id] ?? { fire: row.fire_selectable, items: row.selectable_items };
  const isDirty = (row: MatrixEditorRow) => {
    const draft = drafts[row.id];
    return Boolean(draft && (draft.fire !== row.fire_selectable || !sameItems(draft.items, row.selectable_items)));
  };

  const toggleItem = (row: MatrixEditorRow, code: string) => {
    const draft = draftOf(row);
    const next = draft.items.includes(code) ? draft.items.filter((item) => item !== code) : [...draft.items, code];
    setDrafts((current) => ({ ...current, [row.id]: { ...draft, items: next } }));
  };

  const saveRow = (row: MatrixEditorRow) => {
    const draft = draftOf(row);
    startTransition(async () => {
      const result = await updateMatrixRowAction({
        row_id: row.id,
        fire_selectable: draft.fire,
        selectable_items: draft.items,
        expected_lock_version: row.lock_version,
      });
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error });
        return;
      }
      setRows((current) => current.map((candidate) => (candidate.id === row.id ? { ...candidate, ...result.row, selectable_items: draft.items } : candidate)));
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setNotice({ tone: 'success', text: result.message });
    });
  };

  const setStatus = (row: MatrixEditorRow, status: 'active' | 'retired') => {
    startTransition(async () => {
      const result = await setMatrixRowStatusAction({ row_id: row.id, status, expected_lock_version: row.lock_version });
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error });
        return;
      }
      setRows((current) => current.map((candidate) => (candidate.id === row.id ? { ...candidate, ...result.row } : candidate)));
      setNotice({ tone: 'success', text: result.message });
    });
  };

  const [newRow, setNewRow] = useState({ base_model_id: models[0]?.id ?? '', spec_code: specs[0]?.code ?? '', size_code: sizes[0]?.code ?? '', fire_selectable: false });
  const addRow = () => {
    startTransition(async () => {
      const result = await createMatrixRowAction({ ...newRow, selectable_items: [] });
      if (!result.ok) {
        setNotice({ tone: 'danger', text: result.error });
        return;
      }
      const model = models.find((candidate) => candidate.id === result.row.base_model_id);
      setRows((current) => [...current, { ...result.row, model_name: model?.name ?? '', selectable_items: [] }]);
      setNotice({ tone: 'success', text: `${result.message}選択できる項目にチェックを入れて保存してください。` });
    });
  };

  return (
    <div className="space-y-4" data-testid="matrix-editor">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[72rem] text-left text-xs">
          <thead className="bg-[#f7f8f8] text-muted">
            <tr>
              <th className="sticky left-0 z-[1] bg-[#f7f8f8] px-3 py-2 font-semibold">機種・仕様・サイズ</th>
              <th className="px-2 py-2 text-center font-semibold">防火</th>
              {activeItems.map((item) => (
                <th key={item.code} className="px-2 py-2 text-center font-semibold">
                  {item.label}
                </th>
              ))}
              <th className="px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = draftOf(row);
              const retired = row.status === 'retired';
              return (
                <tr key={row.id} className={`border-t border-line ${retired ? 'bg-slate-50 text-muted' : ''}`} data-testid="matrix-editor-row">
                  <td className="sticky left-0 z-[1] bg-inherit px-3 py-2 font-semibold">
                    {row.model_name} / {specLabel(row.spec_code)} / {sizeLabel(row.size_code)}
                    {retired && <span className="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-[0.65rem]">停止中</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${row.model_name} ${specLabel(row.spec_code)} 防火を選べる`}
                      checked={draft.fire}
                      disabled={retired || pending}
                      onChange={() => setDrafts((current) => ({ ...current, [row.id]: { ...draft, fire: !draft.fire } }))}
                    />
                  </td>
                  {activeItems.map((item) => (
                    <td key={item.code} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${row.model_name} ${specLabel(row.spec_code)} ${item.label}`}
                        checked={draft.items.includes(item.code)}
                        disabled={retired || pending}
                        onChange={() => toggleItem(row, item.code)}
                      />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={!isDirty(row) || pending} onClick={() => saveRow(row)}>
                        保存
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setStatus(row, retired ? 'active' : 'retired')}>
                        {retired ? '再開' : '停止'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 rounded-lg border border-line bg-white p-4">
        <h3 className="font-semibold">行を追加</h3>
        <p className="text-xs text-muted">既存の仕様・サイズから選びます。追加した行は、選択できる項目が空の状態で作られます。</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="機種" htmlFor="matrix-new-model">
            <Select id="matrix-new-model" value={newRow.base_model_id} onChange={(e) => setNewRow({ ...newRow, base_model_id: e.target.value })}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="仕様" htmlFor="matrix-new-spec">
            <Select id="matrix-new-spec" value={newRow.spec_code} onChange={(e) => setNewRow({ ...newRow, spec_code: e.target.value })}>
              {specs.filter((spec) => spec.status === 'active').map((spec) => (
                <option key={spec.code} value={spec.code}>{spec.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="サイズ" htmlFor="matrix-new-size">
            <Select id="matrix-new-size" value={newRow.size_code} onChange={(e) => setNewRow({ ...newRow, size_code: e.target.value })}>
              {sizes.filter((size) => size.status === 'active').map((size) => (
                <option key={size.code} value={size.code}>{size.label}</option>
              ))}
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={newRow.fire_selectable} onChange={() => setNewRow({ ...newRow, fire_selectable: !newRow.fire_selectable })} />
            防火を選べる
          </label>
        </div>
        <Button type="button" variant="secondary" disabled={pending || !newRow.base_model_id} onClick={addRow}>
          行を追加する
        </Button>
      </div>
    </div>
  );
}
