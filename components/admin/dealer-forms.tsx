'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { assignQuoteDealerAction, createDealerRevisionAction, updateUserRoleAction } from '@/lib/actions/admin';
import { formatYen } from '@/lib/domain/pricing';
import { ROLE_LABELS, type Profile, type Quote, type QuoteItem, type RoleCode } from '@/lib/domain/types';
import type { RevisionItemKind } from '@/lib/data/store';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';

const initial = { ok: false } as const;

/** 管理者：見積の担当代理店を割り当てる */
export function AssignDealerForm({ quote, dealers }: { quote: Quote; dealers: Profile[] }) {
  const [state, action, pending] = useActionState(assignQuoteDealerAction, initial);
  return (
    <form action={action} className="card space-y-4 p-6" noValidate data-testid="assign-dealer-form">
      <input type="hidden" name="quote_id" value={quote.id} />
      <p className="font-semibold">担当代理店</p>
      <p className="text-xs text-muted">
        割り当てると、その代理店が別途工事・フリー商品を入力して確定見積（次の版）を発行できるようになります。
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
}

const KIND_LABELS: Record<RevisionItemKind, string> = {
  base: '本体',
  base_expense: '本体諸費用',
  option: 'オプション',
  option_expense: 'オプション諸費用',
  installation: '別途工事',
  free: 'フリー商品',
};
/** 本部・総代理店が追加できる区分 */
const FULL_KINDS: RevisionItemKind[] = ['base', 'base_expense', 'option', 'option_expense', 'installation', 'free'];

/**
 * 代理店：別途工事・フリー商品を入力して確定見積を発行する。
 * 本体・オプションの金額は編集できない（技術の杜のスナップショット）。
 */
export function DealerRevisionForm({
  quote,
  items,
  freeProducts,
  canEditAll,
}: {
  quote: Quote;
  items: QuoteItem[];
  freeProducts: { code: string; name: string; price: number }[];
  /** 本部・総代理店は本体・オプションの行も編集できる */
  canEditAll: boolean;
}) {
  const [state, action, pending] = useActionState(createDealerRevisionAction, initial);
  const editable = (k: QuoteItem['kind']): k is RevisionItemKind =>
    canEditAll ? FULL_KINDS.includes(k as RevisionItemKind) : k === 'installation' || k === 'free';

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
      }))
  );

  const sumOf = (...kinds: RevisionItemKind[]) =>
    rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.unit_price * Math.max(1, r.quantity), 0);
  // 本体・オプションを編集できないときは、元の版の金額をそのまま使う
  const baseTotal = canEditAll ? sumOf('base', 'base_expense') : quote.base_price + quote.base_expense;
  const optionTotal = canEditAll ? sumOf('option', 'option_expense') : quote.option_subtotal + quote.option_expense;
  const entered = sumOf('installation', 'free');
  const subRaw = baseTotal + optionTotal + entered;
  const subtotal = Math.floor(subRaw / 1000) * 1000;
  const tax = Math.floor(subtotal * quote.tax_rate);

  const update = (key: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (kind: Row['kind'], preset?: { name: string; price: number }) =>
    setRows((cur) => [
      ...cur,
      {
        key: `new-${cur.length}-${kind}-${preset?.name ?? ''}`,
        kind,
        name: preset?.name ?? '',
        description: '',
        unit: '式',
        remark: '',
        unit_price: preset?.price ?? 0,
        quantity: 1,
      },
    ]);

  return (
    <form
      id="quote-editor"
      action={action}
      className="card scroll-mt-6 space-y-5 p-6"
      noValidate
      data-testid="dealer-revision-form"
    >
      <input type="hidden" name="quote_id" value={quote.id} />
      <div>
        <p className="font-semibold">別途工事・フリー商品の入力</p>
        <p className="mt-1 text-xs text-muted">
          {canEditAll
            ? '項目・数量・単位・単価・備考を直接編集できます。行の追加・削除もできます。入力して発行すると'
            : '本体価格・オプション価格は変更できません（発行時のスナップショット）。入力して発行すると'}
          <strong className="mx-1">第{quote.revision + 1}版</strong>の確定見積が作られ、現在の版は履歴として残ります。
        </p>
      </div>
      <Status state={state} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="w-28 px-3 py-2 font-semibold">区分</th>
              <th className="px-3 py-2 font-semibold">項目</th>
              <th className="w-20 px-3 py-2 text-right font-semibold">数量</th>
              <th className="w-16 px-3 py-2 font-semibold">単位</th>
              <th className="w-32 px-3 py-2 text-right font-semibold">単価（売価）</th>
              <th className="w-32 px-3 py-2 text-right font-semibold">金額</th>
              <th className="w-40 px-3 py-2 font-semibold">備考</th>
              <th className="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`revision-row-${i}`}>
                <td className="px-3 py-2">
                  <input type="hidden" name={`items.${i}.kind`} value={r.kind} />
                  {canEditAll ? (
                    <Select
                      value={r.kind}
                      onChange={(e) => update(r.key, { kind: e.target.value as RevisionItemKind })}
                      aria-label={`${i + 1} 行目の区分`}
                      className="py-1 text-xs"
                    >
                      {FULL_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className={r.kind === 'free' ? 'text-brown' : 'text-muted'}>{KIND_LABELS[r.kind]}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Input
                    name={`items.${i}.name`}
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    aria-label={`${i + 1} 行目の項目名`}
                    required
                  />
                  <Input
                    name={`items.${i}.description`}
                    value={r.description}
                    onChange={(e) => update(r.key, { description: e.target.value })}
                    placeholder="摘要（任意）"
                    aria-label={`${i + 1} 行目の摘要`}
                    className="mt-1 text-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    name={`items.${i}.quantity`}
                    type="number"
                    min={1}
                    value={r.quantity}
                    onChange={(e) => update(r.key, { quantity: Number(e.target.value) })}
                    aria-label={`${i + 1} 行目の数量`}
                    className="text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    name={`items.${i}.unit`}
                    value={r.unit}
                    onChange={(e) => update(r.key, { unit: e.target.value })}
                    aria-label={`${i + 1} 行目の単位`}
                    placeholder="式"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    name={`items.${i}.unit_price`}
                    type="number"
                    min={0}
                    step={1000}
                    value={r.unit_price}
                    onChange={(e) => update(r.key, { unit_price: Number(e.target.value) })}
                    aria-label={`${i + 1} 行目の単価`}
                    className="text-right"
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.unit_price * Math.max(1, r.quantity))}</td>
                <td className="px-3 py-2">
                  <Input
                    name={`items.${i}.remark`}
                    value={r.remark}
                    onChange={(e) => update(r.key, { remark: e.target.value })}
                    aria-label={`${i + 1} 行目の備考`}
                    className="text-xs"
                  />
                </td>
                <td className="px-2 py-2">
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
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">
                  項目がありません。下のボタンから追加してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => addRow('installation')} data-testid="add-installation">
          <Plus className="size-4" aria-hidden="true" />
          別途工事を追加
        </Button>
        {canEditAll && (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow('base')} data-testid="add-base">
              <Plus className="size-4" aria-hidden="true" />
              本体の行を追加
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow('option')} data-testid="add-option">
              <Plus className="size-4" aria-hidden="true" />
              オプションの行を追加
            </Button>
          </>
        )}
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

      <Field label="お客様への申し送り（任意）" htmlFor="dealer_note" hint="現地条件・工期・注意事項など。見積書の備考に入ります">
        <Textarea id="dealer_note" name="dealer_note" rows={3} defaultValue={quote.dealer_note ?? ''} />
      </Field>

      <dl className="space-y-1 rounded-lg bg-ivory px-4 py-3 text-sm" data-testid="revision-preview">
        <div className="flex justify-between text-muted">
          <dt>本体価格計＋オプション価格計{canEditAll ? '' : '（変更不可）'}</dt>
          <dd className="tabular-nums">{formatYen(baseTotal + optionTotal)}</dd>
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

      <SubmitButton pending={pending} label={`第${quote.revision + 1}版として発行する`} />
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
