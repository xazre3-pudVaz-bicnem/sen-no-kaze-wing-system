'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { createMatrixRowAction, setMatrixRowStatusAction, updateMatrixRowAction } from '@/lib/actions/matrix';
import type { MatrixItem, MatrixSize, MatrixSpec, OptionCategory, OptionCategoryMatrixItem } from '@/lib/domain/types';
import type { MatrixEditorRow } from '@/components/admin/matrix-editor';
import { Alert, Button, Field, Select } from '@/components/ui';
import { restoreMatrixSettingsDrafts, serializeMatrixSettingsDrafts, type MatrixSettingsDraft } from '@/lib/domain/matrix-settings-draft-cache';

type Props = {
  rows: MatrixEditorRow[];
  items: MatrixItem[];
  specs: MatrixSpec[];
  sizes: MatrixSize[];
  models: { id: string; name: string }[];
  categories: OptionCategory[];
  categoryItems: OptionCategoryMatrixItem[];
  canEdit: boolean;
  actorId: string;
};

type Notice = { tone: 'success' | 'danger'; text: string } | null;

// 初回はSSR/ハイドレーションともプレースホルダーを表示し、復元後にチェック欄を描画する。
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function sameItems(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const first = [...a].sort();
  const second = [...b].sort();
  return first.every((value, index) => value === second[index]);
}

export function SelectionMatrixPanel({
  rows: initialRows, items, specs, sizes, models, categories, categoryItems, canEdit, actorId,
}: Props) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const draftKey = 'wing:matrix-settings:draft:v1:' + actorId;
  const [restoration] = useState(() => {
    const empty = { selectedId: '', drafts: {} as Record<string, MatrixSettingsDraft> };
    if (!canEdit || typeof window === 'undefined') return { cache: empty, failed: false };
    try {
      return {
        cache: restoreMatrixSettingsDrafts(window.sessionStorage.getItem(draftKey), initialRows),
        failed: false,
      };
    } catch {
      return { cache: empty, failed: true };
    }
  });

  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState(
    restoration.cache.selectedId || initialRows.find((row) => row.status === 'active')?.id || initialRows[0]?.id || ''
  );
  const [drafts, setDrafts] = useState<Record<string, MatrixSettingsDraft>>(restoration.cache.drafts);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const [newRow, setNewRow] = useState({
    base_model_id: models[0]?.id ?? '',
    spec_code: specs.find((spec) => spec.status === 'active')?.code ?? '',
    size_code: sizes.find((size) => size.status === 'active')?.code ?? '',
    fire_selectable: false,
  });

  const [modelFilter, setModelFilter] = useState('all');
  const [specFilter, setSpecFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [showRetired, setShowRetired] = useState(false);

  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  // クライアント側で復元できてから書き込むため、ハイドレーション中に原本を消さない。
  useEffect(() => {
    if (!canEdit || !hydrated) return;
    try {
      if (Object.keys(drafts).length) {
        window.sessionStorage.setItem(draftKey, serializeMatrixSettingsDrafts({ drafts, selectedId }));
      } else {
        window.sessionStorage.removeItem(draftKey);
      }
    } catch {
      // ストレージ利用不可の場合もbeforeunloadの警告は維持する。
    }
  }, [canEdit, drafts, hydrated, selectedId, draftKey]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const draftOf = (row: MatrixEditorRow): MatrixSettingsDraft =>
    drafts[row.id] ?? { fire: row.fire_selectable, items: row.selectable_items, lockVersion: row.lock_version };
  const isDirty = (row: MatrixEditorRow) => {
    const draft = drafts[row.id];
    return Boolean(draft && (draft.fire !== row.fire_selectable || !sameItems(draft.items, row.selectable_items) || draft.lockVersion !== row.lock_version));
  };

  useEffect(() => {
    if (!rows.some((row) => {
      const draft = drafts[row.id];
      return draft && (draft.fire !== row.fire_selectable || !sameItems(draft.items, row.selectable_items) || draft.lockVersion !== row.lock_version);
    })) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, rows]);

  // Excel型一覧では仕様の切替で他行の未保存変更を捨てず、行単位で保持する。
  const modelIds = [...new Set(rows.map((row) => row.base_model_id))];
  const specCodes = [...new Set(rows.filter((row) => modelFilter === 'all' || row.base_model_id === modelFilter)
    .map((row) => row.spec_code))];
  const sizeCodes = [...new Set(rows.filter((row) =>
    (modelFilter === 'all' || row.base_model_id === modelFilter) &&
    (specFilter === 'all' || row.spec_code === specFilter))
    .map((row) => row.size_code))];
  const visibleRows = rows.filter((row) =>
    (showRetired || row.status === 'active') &&
    (modelFilter === 'all' || row.base_model_id === modelFilter) &&
    (specFilter === 'all' || row.spec_code === specFilter) &&
    (sizeFilter === 'all' || row.size_code === sizeFilter)
  );
  const staleDrafts = rows.filter((row) => {
    const draft = drafts[row.id];
    return draft && draft.lockVersion !== row.lock_version;
  });
  const dirtyCount = rows.filter(isDirty).length;

  const save = (row: MatrixEditorRow) => {
    const changes = draftOf(row);
    if (changes.lockVersion !== row.lock_version) {
      setNotice({ tone: 'danger', text: '他の画面で仕様行が更新されています。未保存変更を破棄し、最新の設定を確認してから編集してください。' });
      return;
    }
    startTransition(async () => {
      const result = await updateMatrixRowAction({
        row_id: row.id,
        fire_selectable: changes.fire,
        selectable_items: changes.items,
        expected_lock_version: changes.lockVersion,
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
    if (rows.some(isDirty)) {
      setNotice({ tone: 'danger', text: '未保存の仕様設定があります。保存または変更を破棄してから行を追加してください。' });
      return;
    }
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

  if (!hydrated) {
    return <p className="text-sm text-muted" data-testid="selection-matrix-loading">設定を読み込んでいます…</p>;
  }

  return (
    <div className="space-y-4" data-testid="selection-matrix-panel">
      <section className="rounded-xl border border-line bg-white p-3 sm:p-5" aria-label="仕様別の選択可否一覧">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">機種・仕様・サイズごとの選択可否</h2>
            <p className="mt-1 text-xs text-muted">元のExcelと同じ一覧表です。横方向にスクロールして、各仕様の選択可否を確認できます。</p>
          </div>
          <div className="text-xs text-ink-soft" data-testid="matrix-unsaved-count">
            表示 {visibleRows.length} / {rows.length} 行
            {dirtyCount > 0 && <span className="ml-2 font-semibold text-amber-800">未保存 {dirtyCount} 行</span>}
          </div>
        </div>
        {!canEdit && <p className="mt-2 text-sm font-medium text-ink-soft">閲覧のみ：仕様別設定を変更できるのは本部管理者です。</p>}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="matrix-grid-filters">
          <Field label="機種" htmlFor="selection-matrix-model">
            <Select id="selection-matrix-model" value={modelFilter} onChange={(event) => {
              setModelFilter(event.target.value);
              setSpecFilter('all');
              setSizeFilter('all');
            }}>
              <option value="all">すべて</option>
              {modelIds.map((id) => <option key={id} value={id}>{models.find((model) => model.id === id)?.name ?? id}</option>)}
            </Select>
          </Field>
          <Field label="仕様" htmlFor="selection-matrix-spec">
            <Select id="selection-matrix-spec" value={specFilter} onChange={(event) => {
              setSpecFilter(event.target.value);
              setSizeFilter('all');
            }}>
              <option value="all">すべて</option>
              {specCodes.map((code) => <option key={code} value={code}>{labelSpec(code)}</option>)}
            </Select>
          </Field>
          <Field label="サイズ" htmlFor="selection-matrix-size">
            <Select id="selection-matrix-size" value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}>
              <option value="all">すべて</option>
              {sizeCodes.map((code) => <option key={code} value={code}>{labelSize(code)}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end rounded-md border border-line px-3 py-2 text-sm">
            <input type="checkbox" checked={showRetired} onChange={(event) => setShowRetired(event.target.checked)} />
            停止中も表示
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">「防火」は商品カテゴリーではなく仕様の条件です。設備{activeItems.length}項目の選択可否は仕様別、下部の「お客様への共通表示」は全仕様共通です。変更した行だけ個別に保存します。</p>
        <div className="mt-3 max-h-[70vh] overflow-auto overscroll-contain rounded-lg border border-line" data-testid="matrix-grid-scroll" tabIndex={0} aria-label="仕様別の選択可否表（横スクロール可能）">
          <table className="w-full min-w-[122rem] border-collapse text-left text-xs" data-testid="matrix-excel-grid">
            <thead className="sticky top-0 z-30 bg-[#f7f8f8]">
              <tr>
                <th scope="col" className="sticky left-0 z-40 w-[120px] min-w-[120px] border-b border-r border-line bg-[#f7f8f8] px-2 py-3">機種</th>
                <th scope="col" className="z-40 w-[130px] min-w-[130px] border-b border-r border-line bg-[#f7f8f8] px-2 py-3 md:sticky md:left-[120px]">仕様</th>
                <th scope="col" className="z-40 w-[125px] min-w-[125px] border-b border-r border-line bg-[#f7f8f8] px-2 py-3 md:sticky md:left-[250px]">サイズ</th>
                <th scope="col" className="min-w-[78px] border-b border-line px-2 py-3 text-center">防火</th>
                {activeItems.map((item) => {
                  const mapped = related(item.code);
                  return (
                    <th scope="col" key={item.code} className="min-w-[96px] max-w-[116px] border-b border-line px-2 py-2 text-center">
                      <span className="block font-semibold">{item.label}</span>
                      <details className="mt-1 text-left font-normal">
                        <summary className="cursor-pointer text-center text-[10px] text-ink-soft">対応 {mapped.length} 件</summary>
                        <div className="mt-1 rounded border border-line bg-white p-1.5 text-[10px] font-normal text-ink-soft">
                          {mapped.length ? mapped.map((category) => (
                            <p key={category.id}>{category.name}（共通表示：{category.customer_visible ? '表示' : '非表示'}）</p>
                          )) : <p>対応カテゴリーなし</p>}
                        </div>
                      </details>
                    </th>
                  );
                })}
                <th scope="col" className="min-w-[175px] border-b border-l border-line bg-[#f7f8f8] px-2 py-3 text-center lg:sticky lg:right-0 lg:z-40">操作（行単位）</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const draft = draftOf(row);
                const dirty = isDirty(row);
                const retired = row.status === 'retired';
                const staleDraft = draft.lockVersion !== row.lock_version;
                const locked = !canEdit || retired || pending || staleDraft;
                const rowBg = retired ? 'bg-slate-50 text-muted' : 'bg-white';
                return (
                  <tr key={row.id} data-testid="matrix-excel-row" data-row-id={row.id}
                    className={('border-b border-line last:border-b-0 ' + rowBg)}>
                    <th scope="row" className={('sticky left-0 z-20 w-[120px] min-w-[120px] border-r border-line px-2 py-2 text-xs font-semibold ' + rowBg)}>
                      {row.model_name}
                      {dirty && <span className="mt-1 block text-[10px] text-amber-800">未保存</span>}
                      {retired && <span className="mt-1 block text-[10px]">停止中</span>}
                    </th>
                    <td className={('w-[130px] min-w-[130px] border-r border-line px-2 py-2 md:sticky md:left-[120px] md:z-20 ' + rowBg)}>{labelSpec(row.spec_code)}</td>
                    <td className={('w-[125px] min-w-[125px] border-r border-line px-2 py-2 md:sticky md:left-[250px] md:z-20 ' + rowBg)}>{labelSize(row.size_code)}</td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={draft.fire} disabled={locked}
                        aria-label={row.model_name + ' ' + labelSpec(row.spec_code) + ' ' + labelSize(row.size_code) + ' の防火を選択可能にする'}
                        onChange={(event) => {
                          setSelectedId(row.id);
                          setDrafts((current) => ({ ...current, [row.id]: { ...draft, fire: event.target.checked } }));
                        }} />
                    </td>
                    {activeItems.map((item) => (
                      <td key={item.code} className="px-2 py-2 text-center" data-testid="matrix-excel-cell">
                        <input type="checkbox" checked={draft.items.includes(item.code)} disabled={locked}
                          aria-label={row.model_name + ' ' + labelSpec(row.spec_code) + ' ' + labelSize(row.size_code) + ' ' + item.label + ' を選択可能にする'}
                          onChange={(event) => {
                            setSelectedId(row.id);
                            setDrafts((current) => ({
                              ...current,
                              [row.id]: {
                                ...draft,
                                items: event.target.checked
                                  ? [...draft.items, item.code]
                                  : draft.items.filter((code) => code !== item.code),
                              },
                            }));
                          }} />
                      </td>
                    ))}
                    <td className={('border-l border-line px-2 py-2 lg:sticky lg:right-0 lg:z-20 ' + rowBg)}>
                      {canEdit && (
                        <div className="flex min-w-[160px] flex-wrap gap-1">
                          <Button type="button" size="sm" disabled={!dirty || pending || retired || staleDraft} onClick={() => save(row)}>
                            保存
                          </Button>
                          <Button type="button" size="sm" variant="ghost" disabled={!dirty || pending} onClick={() => {
                            setDrafts((current) => {
                              const next = { ...current };
                              delete next[row.id];
                              return next;
                            });
                          }}>破棄</Button>
                          <Button type="button" size="sm" variant="ghost" disabled={pending || dirty}
                            onClick={() => changeStatus(row, retired ? 'active' : 'retired')}>
                            {retired ? '再開' : '停止'}
                          </Button>
                        </div>
                      )}
                      {staleDraft && <p className="mt-1 text-[10px] text-red-700">版が更新されています。破棄して再編集してください。</p>}
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr><td colSpan={activeItems.length + 5} className="px-4 py-6 text-center text-sm text-muted">該当する仕様行はありません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">横スクロールできます。ヘッダーと左側の機種名を固定しています。行の保存・破棄・停止／再開はそれぞれ独立した操作です。</p>
      </section>
      {restoration.failed && <Alert tone="warn">このブラウザでは一時保管を利用できません。移動前に設定を保存してください。</Alert>}
      {Object.keys(restoration.cache.drafts).length > 0 && Object.keys(drafts).length > 0 && <Alert tone="info">このブラウザタブの未保存変更を復元しました。保存または破棄するまで保持します。</Alert>}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {staleDrafts.length > 0 && <Alert tone="warn">別の画面で仕様が更新されています。復元した変更は自動保存されません。該当行の変更を破棄してから再編集してください。</Alert>}
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
            <Button type="button" variant="secondary" disabled={pending || !hydrated || !newRow.base_model_id || rows.some(isDirty)} onClick={addRow}>行を追加する</Button>
          </div>
        </details>
      )}
      <p className="text-xs text-muted">
        「お客様への共通表示」は、このページ下部でカテゴリーごとに個別保存します。仕様別の選択可否とは別設定です。変更はシミュレーターや見積依頼の選択判定に影響します。
      </p>
    </div>
  );
}
