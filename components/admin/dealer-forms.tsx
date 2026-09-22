'use client';

import { Fragment, useActionState, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { assignQuoteDealerAction, createDealerRevisionAction, updateUserRoleAction } from '@/lib/actions/admin';
import { formatYen } from '@/lib/domain/pricing';
import { ROLE_LABELS, type Profile, type Quote, type QuoteItem, type RoleCode } from '@/lib/domain/types';
import type { RevisionItemKind } from '@/lib/data/store';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';
import { CatalogPickerDialog, type CatalogPickerItem } from './catalog-picker';

const initial = { ok: false } as const;

/** 管理者：見積の担当代理店を割り当てる */
export function AssignDealerForm({ quote, dealers }: { quote: Quote; dealers: Profile[] }) {
  const [state, action, pending] = useActionState(assignQuoteDealerAction, initial);
  return (
    <form action={action} className="card space-y-4 p-6" noValidate data-testid="assign-dealer-form">
      <input type="hidden" name="quote_id" value={quote.id} />
      <p className="font-semibold">担当代理店</p>
      <p className="text-xs text-muted">
        割り当てると、その代理店は本体を閲覧しながら、オプション・別途工事等を編集して確定見積（次の版）を発行できます。
      </p>
      <Status state={state} />
      <Field label="代理店・工務店" htmlFor="dealer_id">
        <Select id="dealer_id" name="dealer_id" defaultValue={quote.dealer_id ?? ''} data-testid="dealer-select">
          <option value="">未割り当て</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.company_name || d.full_name}（{d.email}）
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton pending={pending} label="割り当てる" />
    </form>
  );
}

interface Row {
  key: string;
  kind: RevisionItemKind;
  name: string;
  description: string;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
  /** 元の明細から引き継ぐ商品画像（見積書下部の画像一覧用） */
  image_url: string | null;
}

const KIND_LABELS: Record<RevisionItemKind, string> = {
  base: '本体',
  base_expense: '本体諸費用',
  interior_exterior: '内外装工事',
  interior_exterior_expense: '内外装工事経費',
  option: 'オプション',
  option_expense: 'オプション諸費用',
  installation: '別途工事',
  free: 'フリー商品',
};
/** 案件見積で編集できる区分 */
const FULL_KINDS: RevisionItemKind[] = [
  'base',
  'base_expense',
  'interior_exterior',
  'interior_exterior_expense',
  'option',
  'option_expense',
  'installation',
  'free',
];
const DEALER_KINDS: RevisionItemKind[] = [
  'interior_exterior',
  'interior_exterior_expense',
  'option',
  'option_expense',
  'installation',
  'free',
];

/**
 * 案件見積の編集。標準見積そのものは変更せず、発行済み案件をコピーした次版を作る。
 * 代理店は本体を閲覧のみ、オプション・別途等を編集可能。
 * 総代理店・本部は本体を含めて編集可能。
 */
export function DealerRevisionForm({
  quote,
  items,
  freeProducts,
  catalog = [],
  canEditBase,
  sheetMode = false,
  onCancel,
}: {
  quote: Quote;
  items: QuoteItem[];
  freeProducts: { code: string; name: string; price: number }[];
  /** 商品台帳（公開中の商品）。行の追加時に呼び出して選べる */
  catalog?: CatalogPickerItem[];
  /** 本体まで編集できるのは総代理店・本部。代理店は本体を閲覧のみ */
  canEditBase: boolean;
  /** 見積書の位置でExcel風に編集する表示 */
  sheetMode?: boolean;
  /** sheetMode時の編集終了 */
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(createDealerRevisionAction, initial);
  const editable = (k: QuoteItem['kind']): k is RevisionItemKind =>
    (canEditBase ? FULL_KINDS : DEALER_KINDS).includes(k as RevisionItemKind);

  const [rows, setRows] = useState<Row[]>(() =>
    items
      .filter((i) => editable(i.kind))
      .map((i, n) => ({
        key: `${i.id}-${n}`,
        kind: i.kind as RevisionItemKind,
        name: i.name,
        description: i.description ?? '',
        unit: i.unit ?? '式',
        remark: i.remark ?? '',
        unit_price: i.unit_price,
        quantity: i.quantity,
        image_url: i.image_url ?? null,
      }))
  );

  const amountOf = (r: Row) => Math.round(r.unit_price * Math.max(0.01, r.quantity || 0));
  const sumOf = (...kinds: RevisionItemKind[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + amountOf(r), 0);
  // 代理店は本体を変更できないため親見積の本体金額を固定で使う。オプションは代理店でも編集できる。
  const baseTotal = canEditBase ? sumOf('base', 'base_expense') : quote.base_price + quote.base_expense;
  const interiorExteriorTotal = sumOf('interior_exterior', 'interior_exterior_expense');
  const optionTotal = sumOf('option', 'option_expense');
  const entered = sumOf('installation', 'free');
  const subRaw = baseTotal + interiorExteriorTotal + optionTotal + entered;
  const subtotal = Math.floor(subRaw / 1000) * 1000;
  const tax = Math.floor(subtotal * quote.tax_rate);

  const update = (key: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (kind: Row['kind'], preset?: { name: string; price: number; description?: string; unit?: string; image_url?: string | null }) =>
    setRows((cur) => [
      ...cur,
      {
        key: `new-${cur.length}-${Date.now()}-${kind}`,
        kind,
        name: preset?.name ?? '',
        description: preset?.description ?? '',
        unit: preset?.unit ?? '式',
        remark: '',
        unit_price: preset?.price ?? 0,
        quantity: 1,
        image_url: preset?.image_url ?? null,
      },
    ]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const cellInputClass = sheetMode
    ? 'h-7 rounded-none border-transparent bg-transparent px-1.5 py-0.5 text-xs shadow-none focus:border-[#6d9480] focus:bg-white focus:ring-1 focus:ring-[#6d9480]/30'
    : '';
  const cellSelectClass = sheetMode
    ? 'h-7 rounded-none border-transparent bg-transparent py-0.5 pl-1.5 pr-7 text-[0.68rem] shadow-none focus:border-[#6d9480] focus:bg-white focus:ring-1 focus:ring-[#6d9480]/30'
    : 'py-1 text-xs';
  const cellClass = sheetMode ? 'border-r border-line/70 p-0 align-middle' : 'px-3 py-2';

  return (
    <form
      id="quote-editor"
      action={action}
      className={
        sheetMode
          ? 'scroll-mt-6 overflow-hidden rounded-lg border border-line bg-white shadow-sm'
          : 'card scroll-mt-6 space-y-5 p-6'
      }
      noValidate
      data-testid="dealer-revision-form"
      data-sheet-mode={sheetMode ? 'true' : undefined}
    >
      <input type="hidden" name="quote_id" value={quote.id} />
      <div className={sheetMode ? 'flex flex-wrap items-start justify-between gap-2 border-b border-line bg-[#f7f9f8] px-3 py-2' : ''}>
        <div>
          <p className={sheetMode ? 'text-xs font-semibold text-[#315745]' : 'font-semibold'}>
            {sheetMode ? '見積書を編集中' : '案件見積の編集'}
          </p>
          <p className={sheetMode ? 'mt-0.5 text-[0.67rem] text-muted' : 'mt-1 text-xs text-muted'}>
            {canEditBase
              ? '標準見積の原本は変更せず、この案件の各セルを編集します。'
              : '本体は変更せず、オプション・別途工事等をこの案件用に編集します。'}
            <strong className="mx-1">第{quote.revision + 1}版</strong>として発行すると、現在の版は履歴として残ります。
            {sheetMode && <span className="ml-1">Tabキーで次の入力セルへ移動できます。</span>}
          </p>
        </div>
        {sheetMode && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[0.68rem] font-semibold text-ink-soft hover:bg-sand/50"
            data-testid="quote-edit-cancel"
          >
            <X className="size-3.5" aria-hidden="true" />
            編集をやめる
          </button>
        )}
      </div>
      <div className={sheetMode ? 'px-3 pt-2' : ''}>
        <Status state={state} />
      </div>

      <div className={sheetMode ? 'max-h-[40rem] overflow-auto border-y border-line [scrollbar-width:thin]' : 'overflow-x-auto'}>
        <table className={sheetMode ? 'w-full min-w-[64rem] border-collapse text-xs' : 'w-full min-w-[58rem] text-sm'}>
          <thead className={sheetMode ? 'sticky top-0 z-10 bg-[#eef3f2] text-left text-[0.68rem] text-[#536771]' : 'bg-sand/60 text-left text-xs text-muted'}>
            <tr>
              {sheetMode && <th className="w-9 border-r border-line px-1 py-1.5 text-center font-semibold">#</th>}
              <th className={sheetMode ? 'w-28 border-r border-line px-2 py-1.5 font-semibold' : 'w-28 px-3 py-2 font-semibold'}>区分</th>
              <th className={sheetMode ? 'border-r border-line px-2 py-1.5 font-semibold' : 'px-3 py-2 font-semibold'}>項目</th>
              <th className={sheetMode ? 'w-20 border-r border-line px-2 py-1.5 text-right font-semibold' : 'w-20 px-3 py-2 text-right font-semibold'}>数量</th>
              <th className={sheetMode ? 'w-16 border-r border-line px-2 py-1.5 font-semibold' : 'w-16 px-3 py-2 font-semibold'}>単位</th>
              <th className={sheetMode ? 'w-28 border-r border-line px-2 py-1.5 text-right font-semibold' : 'w-32 px-3 py-2 text-right font-semibold'}>単価（売価）</th>
              <th className={sheetMode ? 'w-28 border-r border-line px-2 py-1.5 text-right font-semibold' : 'w-32 px-3 py-2 text-right font-semibold'}>金額</th>
              <th className={sheetMode ? 'w-40 border-r border-line px-2 py-1.5 font-semibold' : 'w-40 px-3 py-2 font-semibold'}>備考</th>
              <th className={sheetMode ? 'w-8 px-1 py-1.5' : 'w-10 px-2 py-2'}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <Fragment key={r.key}>
                {sheetMode && (i === 0 || rows[i - 1]?.kind !== r.kind) && (
                  <tr className="bg-[#f7f4ec]">
                    <td colSpan={9} className="px-2 py-1 text-[0.66rem] font-semibold text-[#5c635f]">
                      {KIND_LABELS[r.kind]}
                    </td>
                  </tr>
                )}
              <tr data-testid={`revision-row-${i}`} className={sheetMode ? 'bg-white hover:bg-[#fbfcfb]' : ''}>
                {sheetMode && <td className="border-r border-line/70 px-1 py-1 text-center text-[0.62rem] text-muted">{i + 1}</td>}
                <td className={cellClass}>
                  <input type="hidden" name={`items.${i}.kind`} value={r.kind} />
                  <input type="hidden" name={`items.${i}.image_url`} value={r.image_url ?? ''} />
                  <Select
                    value={r.kind}
                    onChange={(e) => update(r.key, { kind: e.target.value as RevisionItemKind })}
                    aria-label={`${i + 1} 行目の区分`}
                    className={cellSelectClass}
                  >
                    {(canEditBase ? FULL_KINDS : DEALER_KINDS).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className={cellClass}>
                  <Input
                    name={`items.${i}.name`}
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    aria-label={`${i + 1} 行目の項目名`}
                    className={cellInputClass}
                    onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}
                    required
                  />
                  <Input
                    name={`items.${i}.description`}
                    value={r.description}
                    onChange={(e) => update(r.key, { description: e.target.value })}
                    placeholder="摘要（任意）"
                    aria-label={`${i + 1} 行目の摘要`}
                    className={sheetMode ? `${cellInputClass} border-t border-line/50` : 'mt-1 text-xs'}
                    onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}
                  />
                </td>
                <td className={cellClass}>
                  <Input
                    name={`items.${i}.quantity`}
                    type="number"
                    min={0.01}
                    step="any"
                    value={r.quantity}
                    onChange={(e) => update(r.key, { quantity: Number(e.target.value) })}
                    aria-label={`${i + 1} 行目の数量`}
                    className={sheetMode ? `${cellInputClass} text-right` : 'text-right'}
                    onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}
                  />
                </td>
                <td className={cellClass}>
                  <Input
                    name={`items.${i}.unit`}
                    value={r.unit}
                    onChange={(e) => update(r.key, { unit: e.target.value })}
                    aria-label={`${i + 1} 行目の単位`}
                    placeholder="式"
                    className={cellInputClass}
                    onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}
                  />
                </td>
                <td className={cellClass}>
                  <Input
                    name={`items.${i}.unit_price`}
                    type="number"
                    min={r.name === '選択商品の変更差額' ? undefined : 0}
                    step={1000}
                    value={r.unit_price}
                    onChange={(e) => update(r.key, { unit_price: Number(e.target.value) })}
                    aria-label={`${i + 1} 行目の単価`}
                    className={sheetMode ? `${cellInputClass} text-right` : 'text-right'}
                    onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}
                  />
                </td>
                <td className={sheetMode ? 'border-r border-line/70 bg-[#fafbf9] px-2 py-1 text-right tabular-nums' : 'px-3 py-2 text-right tabular-nums'}>{formatYen(amountOf(r))}</td>
                <td className={cellClass}>
                  <Input
                    name={`items.${i}.remark`}
                    value={r.remark}
                    onChange={(e) => update(r.key, { remark: e.target.value })}
                    aria-label={`${i + 1} 行目の備考`}
                    className={sheetMode ? cellInputClass : 'text-xs'}
                    onFocus={sheetMode ? (event) => event.currentTarget.select() : undefined}
                  />
                </td>
                <td className={sheetMode ? 'px-1 py-0.5 text-center' : 'px-2 py-2'}>
                  <button
                    type="button"
                    onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                    className="rounded p-1 text-muted hover:bg-sand hover:text-warn"
                    aria-label={`${i + 1} 行目を削除`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={sheetMode ? 9 : 8} className="px-3 py-6 text-center text-sm text-muted">
                  項目がありません。下のボタンから追加してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={sheetMode ? 'flex flex-wrap gap-1.5 border-b border-line bg-[#fafbf9] px-3 py-2' : 'flex flex-wrap gap-2'}>
        {catalog.length > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)} data-testid="open-catalog-picker">
            <Plus className="size-4" aria-hidden="true" />
            商品台帳から追加
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => addRow('installation')} data-testid="add-installation">
          <Plus className="size-4" aria-hidden="true" />
          別途工事を追加
        </Button>
        {canEditBase && (
          <Button type="button" variant="secondary" size="sm" onClick={() => addRow('base')} data-testid="add-base">
            <Plus className="size-4" aria-hidden="true" />
            本体の行を追加
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => addRow('interior_exterior')} data-testid="add-interior-exterior">
          <Plus className="size-4" aria-hidden="true" />
          内外装工事の行を追加
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => addRow('option')} data-testid="add-option">
          <Plus className="size-4" aria-hidden="true" />
          オプションの行を追加
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => addRow('free')} data-testid="add-free">
          <Plus className="size-4" aria-hidden="true" />
          フリー商品を追加
        </Button>
        {freeProducts.map((f) => (
          <Button
            key={f.code}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => addRow('free', { name: f.name, price: f.price })}
            data-testid={`add-free-${f.code}`}
          >
            ＋ {f.name}（{formatYen(f.price)}）
          </Button>
        ))}
      </div>

      <div className={sheetMode ? 'grid gap-3 border-b border-line px-3 py-3 lg:grid-cols-[minmax(0,1fr)_22rem]' : 'space-y-5'}>
        <Field label="お客様への申し送り（任意）" htmlFor="dealer_note" hint="現地条件・工期・注意事項など。見積書の備考に入ります">
          <Textarea
            id="dealer_note"
            name="dealer_note"
            rows={sheetMode ? 4 : 3}
            defaultValue={quote.dealer_note ?? ''}
            className={sheetMode ? 'min-h-24 text-xs' : undefined}
          />
        </Field>

      <dl className={sheetMode ? 'space-y-1 rounded-lg bg-ivory px-3 py-2 text-xs' : 'space-y-1 rounded-lg bg-ivory px-4 py-3 text-sm'} data-testid="revision-preview">
        <div className="flex justify-between text-muted">
          <dt>本体価格計{canEditBase ? '' : '（変更不可）'}</dt>
          <dd className="tabular-nums">{formatYen(baseTotal)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>内外装工事計</dt>
          <dd className="tabular-nums">{formatYen(interiorExteriorTotal)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>オプション価格計</dt>
          <dd className="tabular-nums">{formatYen(optionTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>別途工事・フリー商品</dt>
          <dd className="tabular-nums">{formatYen(entered)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>値引き等調整額（千円未満切捨て）</dt>
          <dd className="tabular-nums">{formatYen(subtotal - subRaw)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>消費税</dt>
          <dd className="tabular-nums">{formatYen(tax)}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-1 font-semibold">
          <dt>確定見積の合計（税込）</dt>
          <dd className="font-serif text-lg tabular-nums" data-testid="revision-total">
            {formatYen(subtotal + tax)}
          </dd>
        </div>
      </dl>
      </div>

      <div className={sheetMode ? 'flex flex-wrap items-center justify-between gap-2 bg-[#f7f9f8] px-3 py-2' : ''}>
        {sheetMode && <p className="text-[0.67rem] text-muted">発行すると現在の版は上書きされず、履歴として残ります。</p>}
        <SubmitButton pending={pending} label={`第${quote.revision + 1}版として発行する`} />
      </div>

      {pickerOpen && (
        <CatalogPickerDialog
          catalog={catalog}
          kinds={canEditBase ? FULL_KINDS : DEALER_KINDS}
          kindLabels={KIND_LABELS}
          onPick={(item, kind) =>
            addRow(kind, {
              name: item.name,
              price: item.price_on_request ? 0 : item.price,
              description: item.category,
              unit: item.unit ?? '式',
              image_url: item.image_url,
            })
          }
          onClose={() => setPickerOpen(false)}
        />
      )}
    </form>
  );
}

/** 管理者：ユーザーの権限を変更する（顧客一覧の各行） */
export function UserRoleForm({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const [state, action, pending] = useActionState(updateUserRoleAction, initial);
  return (
    <form action={action} className="flex items-center gap-1" noValidate data-testid={`role-form-${profile.id}`}>
      <input type="hidden" name="user_id" value={profile.id} />
      <Select
        name="role_code"
        defaultValue={profile.role_code}
        disabled={isSelf}
        aria-label={`${profile.full_name} さんの権限`}
        className="min-w-[9rem] py-1 text-xs"
        data-testid={`role-select-${profile.email}`}
      >
        {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" size="sm" disabled={pending || isSelf} title={isSelf ? '自分自身の権限は変更できません' : undefined}>
        {pending ? '…' : '変更'}
      </Button>
      {state.error && <span className="text-xs text-warn">{state.error}</span>}
      {state.ok && state.message && <span className="text-xs text-forest">保存しました</span>}
    </form>
  );
}
