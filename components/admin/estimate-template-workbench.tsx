'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

type SectionCode = 'interior_exterior' | 'option' | 'sitework';

export interface EstimateTemplateWorkbenchLine {
  id: string;
  section: SectionCode;
  groupLabel: string;
  name: string;
  quantity: number;
  unit: string;
  saleUnitPrice: number;
  remark: string;
  source: 'legacy' | 'product' | 'free';
  customerSelection: string;
}

export interface EstimateTemplateWorkbenchProduct {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  manufacturer: string;
  modelNo: string;
  sizeNote: string;
  price: number;
  priceOnRequest: boolean;
  imageUrl: string | null;
}

export interface EstimateTemplateWorkbenchSection {
  code: SectionCode;
  label: string;
  expenseLabel: string | null;
  expenseAmount: number;
}

export function EstimateTemplateWorkbench({
  templateId,
  role,
  baseLines,
  baseTotal,
  initialLines,
  sections,
  products,
  createdOptionId,
  returnSection,
  taxRate,
  adjustment,
  demoMode = false,
}: {
  templateId: string;
  role: 'admin' | 'master_dealer' | 'dealer' | 'customer';
  baseLines: Array<{
    id: string;
    section: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    remark: string;
  }>;
  baseTotal: number;
  initialLines: EstimateTemplateWorkbenchLine[];
  sections: EstimateTemplateWorkbenchSection[];
  products: EstimateTemplateWorkbenchProduct[];
  createdOptionId?: string;
  returnSection?: SectionCode;
  taxRate: number;
  adjustment: number;
  demoMode?: boolean;
}) {
  const createdProduct = createdOptionId ? products.find((product) => product.id === createdOptionId) : null;
  const [rows, setRows] = useState<EstimateTemplateWorkbenchLine[]>(() => {
    const base = [...initialLines];
    if (!createdProduct) return base;
    const section = returnSection ?? 'option';
    if (base.some((row) => row.source === 'product' && row.id === createdProduct.id)) return base;
    return [
      ...base,
      {
        id: createdProduct.id,
        section,
        groupLabel: createdProduct.categoryName,
        name: createdProduct.name,
        quantity: 1,
        unit: '式',
        saleUnitPrice: createdProduct.price,
        remark: '',
        source: 'product',
        customerSelection: '標準・変更可',
      },
    ];
  });
  const [showCost, setShowCost] = useState(false);
  const [pickerSection, setPickerSection] = useState<SectionCode | null>(null);
  const [pickerCategory, setPickerCategory] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');

  const expenseBySection = useMemo(
    () => new Map(sections.map((section) => [section.code, section.expenseAmount])),
    [sections]
  );

  const totals = useMemo(() => {
    const result: Record<SectionCode, number> = {
      interior_exterior: 0,
      option: 0,
      sitework: 0,
    };
    for (const row of rows) {
      result[row.section] += Math.round(row.quantity * row.saleUnitPrice);
    }
    for (const section of sections) result[section.code] += section.expenseAmount;
    return result;
  }, [rows, sections]);

  const subtotalRaw = baseTotal + totals.interior_exterior + totals.option + totals.sitework;
  const subtotal = Math.max(0, subtotalRaw + adjustment);
  const tax = Math.floor(subtotal * taxRate);
  const total = subtotal + tax;

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products) map.set(product.categoryId, product.categoryName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [products]);

  const pickerProducts = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    return products.filter((product) => {
      if (pickerCategory && product.categoryId !== pickerCategory) return false;
      if (!query) return true;
      return [
        product.name,
        product.manufacturer,
        product.modelNo,
        product.sizeNote,
        product.categoryName,
      ].join(' ').toLowerCase().includes(query);
    });
  }, [products, pickerCategory, pickerQuery]);

  const resetRows = () => {
    setRows([...initialLines]);
    setPickerSection(null);
    setPickerCategory('');
    setPickerQuery('');
  };

  const updateRow = (id: string, patch: Partial<EstimateTemplateWorkbenchLine>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addProduct = (product: EstimateTemplateWorkbenchProduct) => {
    if (!pickerSection) return;
    setRows((current) => [
      ...current,
      {
        id: 'product-' + product.id + '-' + Date.now(),
        section: pickerSection,
        groupLabel: product.categoryName,
        name: product.name,
        quantity: 1,
        unit: '式',
        saleUnitPrice: product.priceOnRequest ? 0 : product.price,
        remark: product.priceOnRequest ? '別途見積' : '',
        source: 'product',
        customerSelection: '標準・変更可',
      },
    ]);
    setPickerSection(null);
  };

  const addFreeLine = (section: SectionCode) => {
    setRows((current) => [
      ...current,
      {
        id: 'free-' + Date.now(),
        section,
        groupLabel: '',
        name: '新しい自由項目',
        quantity: 1,
        unit: '式',
        saleUnitPrice: 0,
        remark: '',
        source: 'free',
        customerSelection: '—',
      },
    ]);
  };

  const renderSection = (section: EstimateTemplateWorkbenchSection) => {
    const sectionRows = rows.filter((row) => row.section === section.code);
    return (
      <section key={section.code} className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">{section.label}</h2>
            <p className="mt-1 text-xs text-muted">
              {sectionRows.length}行
              {section.expenseAmount > 0 && '・' + (section.expenseLabel ?? '諸費用') + ' ' + formatYen(section.expenseAmount)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPickerSection(section.code)}>
              ＋ 商品から追加
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => addFreeLine(section.code)}>
              ＋ 自由項目を追加
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className={showCost ? 'w-full min-w-[82rem] text-sm' : 'w-full min-w-[66rem] text-sm'}>
            <thead className="bg-sand/60 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">種別</th>
                <th className="px-3 py-2 font-semibold">グループ</th>
                <th className="px-3 py-2 font-semibold">項目</th>
                <th className="px-2 py-2 text-right font-semibold">数量</th>
                <th className="px-2 py-2 font-semibold">単位</th>
                {showCost && <th className="px-3 py-2 text-right font-semibold">自組織原価</th>}
                {showCost && <th className="px-3 py-2 text-right font-semibold">原価金額</th>}
                <th className="px-3 py-2 text-right font-semibold">販売単価</th>
                <th className="px-3 py-2 text-right font-semibold">販売金額</th>
                <th className="px-3 py-2 font-semibold">備考</th>
                <th className="px-3 py-2 font-semibold">お客様選択</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {sectionRows.map((row) => (
                <tr key={row.id} className="bg-white">
                  <td className="px-3 py-2 text-xs text-muted">
                    {row.source === 'product' ? '商品' : row.source === 'free' ? '自由項目' : '移行明細'}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.groupLabel}
                      onChange={(event) => updateRow(row.id, { groupLabel: event.target.value })}
                      className="min-w-28"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.name}
                      onChange={(event) => updateRow(row.id, { name: event.target.value })}
                      className="min-w-48"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min={0.0001}
                      step={0.1}
                      value={row.quantity}
                      onChange={(event) => updateRow(row.id, { quantity: Number(event.target.value) })}
                      className="w-24 text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      value={row.unit}
                      onChange={(event) => updateRow(row.id, { unit: event.target.value })}
                      className="w-20"
                    />
                  </td>
                  {showCost && <td className="px-3 py-2 text-right text-muted">—</td>}
                  {showCost && <td className="px-3 py-2 text-right text-muted">—</td>}
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={row.saleUnitPrice}
                      onChange={(event) => updateRow(row.id, { saleUnitPrice: Number(event.target.value) })}
                      className="w-32 text-right"
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatYen(Math.round(row.quantity * row.saleUnitPrice))}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.remark}
                      onChange={(event) => updateRow(row.id, { remark: event.target.value })}
                      className="min-w-36"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row.source === 'product' ? (
                      <Select
                        value={row.customerSelection}
                        onChange={(event) => updateRow(row.id, { customerSelection: event.target.value })}
                        className="min-w-36"
                      >
                        <option>標準・変更可</option>
                        <option>標準・固定</option>
                        <option>任意オプション</option>
                        <option>お客様には表示しない</option>
                      </Select>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-danger underline underline-offset-4"
                      onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
              {sectionRows.length === 0 && (
                <tr>
                  <td colSpan={showCost ? 12 : 10} className="px-5 py-8 text-center text-sm text-muted">
                    明細はありません。「商品から追加」または「自由項目を追加」から登録できます。
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-ivory font-semibold">
                <td colSpan={showCost ? 8 : 6} className="px-3 py-3 text-right">{section.label} 計</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatYen(totals[section.code])}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6">
      {createdProduct && (
        <div className="rounded-xl border border-forest/30 bg-forest/5 px-4 py-3 text-sm">
          「{createdProduct.name}」を商品登録し、見積テンプレートへ戻りました。
          画面確認用として「{returnSection === 'interior_exterior' ? '内外装工事' : returnSection === 'sitework' ? '別途' : 'オプション'}」へ追加しています。
        </div>
      )}

      <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-semibold">{demoMode ? '操作確認用テンプレート' : '明細編集'}</p>
          <p className="mt-1 text-xs text-muted">
            {demoMode
              ? 'この画面の変更は保存されません。数量・単価・商品追加・自由項目追加・削除などを自由に試せます。'
              : '既存データを使ったUI確認版です。この画面での変更はまだDBへ保存されません。'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={showCost ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}
            onClick={() => setShowCost(false)}
          >
            販売価格のみ
          </button>
          <button
            type="button"
            className={showCost ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setShowCost(true)}
          >
            原価＋販売価格
          </button>
          {demoMode ? (
            <Button type="button" variant="secondary" onClick={resetRows}>最初の状態に戻す</Button>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled>下書きを保存</Button>
              <Button type="button" disabled>
                {role === 'master_dealer' ? '本部へ承認申請' : '公開内容を確認'}
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold">本体</h2>
          <p className="mt-1 text-xs text-muted">本体マスターの公開中の版を参照します。見積テンプレート上では直接変更しません。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-sand/60 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">工事区分</th>
                <th className="px-3 py-2 font-semibold">項目</th>
                <th className="px-3 py-2 text-right font-semibold">数量</th>
                <th className="px-3 py-2 font-semibold">単位</th>
                <th className="px-3 py-2 text-right font-semibold">販売単価</th>
                <th className="px-3 py-2 text-right font-semibold">販売金額</th>
                <th className="px-3 py-2 font-semibold">備考</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {baseLines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2">{line.section}</td>
                  <td className="px-3 py-2 font-medium">{line.name}</td>
                  <td className="px-3 py-2 text-right">{line.quantity}</td>
                  <td className="px-3 py-2">{line.unit}</td>
                  <td className="px-3 py-2 text-right">{formatYen(line.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatYen(line.amount)}</td>
                  <td className="px-3 py-2 text-xs text-muted">{line.remark}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-ivory font-semibold">
                <td colSpan={5} className="px-3 py-3 text-right">本体計</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatYen(baseTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {sections.map(renderSection)}

      <section className="card ml-auto max-w-xl space-y-2 p-5 text-sm">
        <div className="flex justify-between gap-4"><span>本体</span><strong>{formatYen(baseTotal)}</strong></div>
        <div className="flex justify-between gap-4"><span>内外装工事</span><strong>{formatYen(totals.interior_exterior)}</strong></div>
        <div className="flex justify-between gap-4"><span>オプション</span><strong>{formatYen(totals.option)}</strong></div>
        <div className="flex justify-between gap-4"><span>別途</span><strong>{formatYen(totals.sitework)}</strong></div>
        <div className="flex justify-between gap-4 border-t border-line pt-2"><span>税別小計</span><strong>{formatYen(subtotalRaw)}</strong></div>
        <div className="flex justify-between gap-4"><span>調整額</span><strong>{formatYen(adjustment)}</strong></div>
        <div className="flex justify-between gap-4"><span>消費税</span><strong>{formatYen(tax)}</strong></div>
        <div className="flex justify-between gap-4 border-t-2 border-ink pt-3 text-lg">
          <span>税込合計</span><strong>{formatYen(total)}</strong>
        </div>
      </section>

      {pickerSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="商品を追加">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">商品を追加</h2>
                <p className="mt-1 text-xs text-muted">
                  追加先：{pickerSection === 'interior_exterior' ? '内外装工事' : pickerSection === 'option' ? 'オプション' : '別途'}
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPickerSection(null)}>閉じる</button>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                <Select value={pickerCategory} onChange={(event) => setPickerCategory(event.target.value)}>
                  <option value="">すべてのカテゴリー</option>
                  {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </Select>
                <Input
                  type="search"
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.target.value)}
                  placeholder="メーカー・商品名・シリーズ・型番で検索"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {pickerProducts.map((product) => (
                  <article key={product.id} className="rounded-xl border border-line p-4">
                    <div className="flex gap-3">
                      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sand text-xs text-muted">
                        {product.imageUrl ? <span>画像登録済み</span> : <span>画像なし</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted">{product.manufacturer || product.categoryName}</p>
                        <h3 className="font-semibold">{product.name}</h3>
                        <p className="mt-1 text-xs text-muted">
                          {[product.modelNo, product.sizeNote].filter(Boolean).join(' ／ ') || '型番・サイズ未登録'}
                        </p>
                        <p className="mt-2 text-sm font-semibold">
                          {product.priceOnRequest ? '別途見積' : '追加金額 ' + formatYen(product.price)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button type="button" className="btn-primary btn-sm" onClick={() => addProduct(product)}>追加</button>
                    </div>
                  </article>
                ))}
              </div>

              {pickerProducts.length === 0 && (
                <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
                  条件に一致する商品がありません。
                </div>
              )}

              {!demoMode && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  <div>
                    <p className="font-semibold">商品が見つからない場合</p>
                    <p className="mt-1 text-xs text-muted">商品登録後、この見積テンプレートへ戻れます。</p>
                  </div>
                  <Link
                    href={'/admin/options/new?return_to=' + encodeURIComponent('/admin/estimate-templates/' + templateId + '?return_section=' + pickerSection)}
                    className="btn-secondary btn-sm"
                  >
                    ＋ 新しい商品を登録
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
