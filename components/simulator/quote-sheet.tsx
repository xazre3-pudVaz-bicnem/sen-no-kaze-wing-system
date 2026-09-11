'use client';

import Link from 'next/link';
import { ArrowRight, Minus, Pencil, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatQty, formatYen } from '@/lib/domain/pricing';
import { FINISH_LEVEL_INFO, type FinishLevel, type OptionCategory, type PricingResult, type ProductOption } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

interface Props {
  modelName: string;
  specName: string;
  finishLevel: FinishLevel;
  pricing: PricingResult;
  categories: OptionCategory[];
  options: ProductOption[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
  /** お客様向け見積シミュレーターでだけ、代理店検索の導線を表示する */
  showDealerFinder?: boolean;
}

/** 表の列（項目／数量／単位／単価／金額／備考）を揃えるための共通セル */
const td = {
  name: 'px-3 py-1.5 leading-snug sm:px-4',
  qty: 'w-12 px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap sm:w-16 sm:px-2',
  unit: 'w-10 px-1.5 py-1.5 whitespace-nowrap text-muted sm:w-12 sm:px-2',
  price: 'w-24 px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap sm:w-28 sm:px-2',
  amount: 'w-28 px-2 py-1.5 text-right tabular-nums whitespace-nowrap sm:w-32 sm:px-3',
  remark: 'w-20 px-1.5 py-1.5 text-[0.68rem] leading-snug text-muted sm:w-24 sm:px-2 lg:w-32 lg:px-3 lg:text-[0.7rem]',
};

const th = {
  name: 'px-3 py-2 text-left font-semibold sm:px-4',
  qty: 'w-12 px-1.5 py-2 text-right font-semibold whitespace-nowrap sm:w-16 sm:px-2',
  unit: 'w-10 px-1.5 py-2 text-left font-semibold whitespace-nowrap sm:w-12 sm:px-2',
  price: 'w-24 px-1.5 py-2 text-right font-semibold whitespace-nowrap sm:w-28 sm:px-2',
  amount: 'w-28 px-2 py-2 text-right font-semibold whitespace-nowrap sm:w-32 sm:px-3',
  remark: 'w-20 px-1.5 py-2 text-left font-semibold sm:w-24 sm:px-2 lg:w-32 lg:px-3',
};

/** 工事区分の見出し行（１．金物関係費用 など） */
function SectionRow({
  label,
  tone = 'sand',
  action,
  expanded,
  onToggle,
  summary,
  toggleLabel = '明細',
}: {
  label: ReactNode;
  tone?: 'sand' | 'ivory';
  action?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  summary?: ReactNode;
  toggleLabel?: string;
}) {
  const collapsible = typeof expanded === 'boolean' && Boolean(onToggle);

  return (
    <tr className={tone === 'sand' ? 'border-y border-line bg-sand/60' : 'border-y border-line bg-ivory'}>
      <td colSpan={6} className="px-3 py-2 text-xs font-semibold tracking-wide text-ink-soft sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {collapsible && (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={`${toggleLabel}を${expanded ? '閉じる' : '開く'}`}
                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center border border-ink/35 bg-white text-ink-soft transition hover:border-brown hover:text-brown focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown/30"
              >
                {expanded ? <Minus className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              </button>
            )}
            <span className="min-w-0">{label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {summary !== undefined && <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-ink">{summary}</span>}
            {action}
          </div>
        </div>
      </td>
    </tr>
  );
}

/** 【本体価格計】のような小計行。明細と区別できるよう色を変える（先方指示） */
function SubtotalRow({ label, amount, amountColSpan = 1, testId }: { label: string; amount: ReactNode; amountColSpan?: 1 | 2; testId?: string }) {
  return (
    <tr className="border-y border-line bg-sand/70 font-semibold">
      <td colSpan={4} className="px-3 py-2 text-sm sm:px-4">{label}</td>
      <td colSpan={amountColSpan} className="px-3 py-2 text-right text-sm tabular-nums sm:px-4" data-testid={testId}>{amount}</td>
      {amountColSpan === 1 && <td></td>}
    </tr>
  );
}

function MobileSectionHeader({
  label,
  expanded,
  onToggle,
  summary,
  toggleLabel,
  action,
}: {
  label: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  summary?: ReactNode;
  toggleLabel: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-y border-line bg-ivory px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${toggleLabel}を${expanded ? '閉じる' : '開く'}`}
            className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center border border-ink/35 bg-white text-ink-soft"
          >
            {expanded ? <Minus className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
          </button>
          <div className="min-w-0 text-[0.78rem] font-semibold leading-snug text-ink-soft">{label}</div>
        </div>
        {summary !== undefined && (
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-ink">{summary}</span>
        )}
      </div>
      {action && <div className="mt-2 pl-7">{action}</div>}
    </div>
  );
}

function MobileQuoteLine({
  name,
  quantity,
  unitPrice,
  amount,
  remark,
  muted = false,
}: {
  name: ReactNode;
  quantity?: ReactNode;
  unitPrice?: ReactNode;
  amount: ReactNode;
  remark?: ReactNode;
  muted?: boolean;
}) {
  const showUnitPrice = unitPrice !== undefined && unitPrice !== null && unitPrice !== '';

  return (
    <div className={cn('border-b border-line/70 px-3 py-2.5', muted && 'text-ink-soft')}>
      <div className="text-[0.84rem] font-medium leading-snug text-ink">{name}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.7rem] leading-tight text-muted">
          {quantity !== undefined && quantity !== null && (
            <span className="whitespace-nowrap">{quantity}</span>
          )}
          {showUnitPrice && (
            <span className="whitespace-nowrap">単価 {unitPrice}</span>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap text-[0.78rem] font-semibold tabular-nums text-ink">{amount}</span>
      </div>
      {remark && <div className="mt-1.5 text-[0.68rem] leading-snug text-muted">{remark}</div>}
    </div>
  );
}

function MobileSubtotal({ label, amount }: { label: string; amount: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-sand/70 px-3 py-2.5 text-[0.8rem] font-semibold">
      <span>{label}</span>
      <span className="shrink-0 tabular-nums">{amount}</span>
    </div>
  );
}

/**
 * 先方の「ネット画面構成」シートの表示例に合わせた御見積書（エクセル形式・全行展開）。
 *   本体 →【内外装工事】→ オプション →【その他の工事】→【別途工事】→ 集計
 *   オプション（明細。クリックで変更＝方法③）→ オプション諸費用 →【オプション価格計】
 *   別途工事（9項目）→【別途工事計】／フリー商品
 *   小計 → 値引き等調整額 → 税抜請負額 → 消費税 → 合計
 */
export function QuoteSheet({
  modelName,
  specName,
  finishLevel,
  pricing,
  categories,
  options,
  readOnly,
  onPickCategory,
  showDealerFinder = false,
}: Props) {
  const levelInfo = FINISH_LEVEL_INFO[finishLevel];
  const [expandedSections, setExpandedSections] = useState({
    base: true,
    interiorExterior: true,
    options: true,
    otherConstruction: true,
    sitework: true,
    freeProducts: true,
  });
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const byOption = new Map(options.map((o) => [o.id, o]));
  // 防火仕様は上部の選択UIで扱うため、見積書の表示分類からは除外する。
  const fireproofCatId = categories.find((c) => c.code === 'fireproof')?.id ?? null;
  const isFire = (l: PricingResult['lines'][number]) => byOption.get(l.option_id)?.category_id === fireproofCatId;
  // 表示上の区分。正式な estimate_section が入るまで category_code だけで振り分ける。
  const interiorExteriorCategoryCodes = new Set([
    'floor',
    'flooring',
    'wall-ceiling',
    'interior-door',
    'exterior-wall',
    'roof',
    'sash',
    'entrance-door',
    'service-door',
    'carpentry',
  ]);
  const otherConstructionCategoryCodes = new Set(['other-construction', 'other_construction']);
  const isInteriorExterior = (l: PricingResult['lines'][number]) => interiorExteriorCategoryCodes.has(l.category_code);
  const isOtherConstruction = (l: PricingResult['lines'][number]) => otherConstructionCategoryCodes.has(l.category_code);
  const interiorExteriorLines = pricing.lines.filter((l) => !l.is_installation && !isFire(l) && isInteriorExterior(l));
  const isExteriorFaceLine = (line: PricingResult['lines'][number]) =>
    line.category_code === 'exterior-wall' && line.code.includes('__face_');
  const exteriorFaceLines = interiorExteriorLines.filter(isExteriorFaceLine);
  const exteriorFaceSignature = (line: PricingResult['lines'][number]) =>
    JSON.stringify({
      optionId: line.option_id,
      unitPrice: line.unit_price,
      priceOnRequest: line.price_on_request,
      variants: line.variants.map((variant) => [variant.group, variant.choice, variant.extra_price]),
    });
  const combineExteriorFaces =
    exteriorFaceLines.length === 4 &&
    exteriorFaceLines.every((line) => exteriorFaceSignature(line) === exteriorFaceSignature(exteriorFaceLines[0]));
  let displayInteriorExteriorLines = interiorExteriorLines;
  if (combineExteriorFaces) {
    const firstFace = exteriorFaceLines[0];
    const firstFaceIndex = interiorExteriorLines.findIndex(isExteriorFaceLine);
    const optionName = byOption.get(firstFace.option_id)?.name ?? firstFace.name.replace(/^外壁仕様（[^）]+）：/, '');
    const combinedFace = {
      ...firstFace,
      code: `${firstFace.code.split('__face_')[0]}__all_faces`,
      name: `外壁仕様：${optionName}`,
      quantity: 4,
      amount: exteriorFaceLines.reduce((sum, line) => sum + line.amount, 0),
    };
    displayInteriorExteriorLines = interiorExteriorLines.filter((line) => !isExteriorFaceLine(line));
    displayInteriorExteriorLines.splice(firstFaceIndex, 0, combinedFace);
  }
  const optionLines = pricing.lines.filter((l) => !l.is_installation && !isFire(l) && !isInteriorExterior(l) && !isOtherConstruction(l));
  const otherConstructionLines = pricing.lines.filter((l) => !l.is_installation && !isFire(l) && isOtherConstruction(l));
  const freeLines = pricing.lines.filter((l) => l.is_free_product);
  const sitework = pricing.lines.filter((l) => l.is_installation && !l.is_free_product);
  const siteworkTotal = sitework.reduce((s, l) => s + l.amount, 0);
  const freeTotal = pricing.free_subtotal;
  const sectionAmount = (lines: PricingResult['lines']) => lines.reduce((sum, line) => sum + line.amount, 0);
  const collapsedSectionSummary = (lines: PricingResult['lines']) => {
    const amount = sectionAmount(lines);
    const hasPriceOnRequest = lines.some((line) => line.price_on_request);
    if (hasPriceOnRequest) return amount > 0 ? `${formatYen(amount)}＋別途見積` : '別途見積';
    return formatYen(amount);
  };

  return (
    <section aria-labelledby="quote-sheet-heading" className="overflow-hidden border border-line bg-white shadow-soft" data-testid="quote-sheet">
      <div className="border-b-2 border-ink px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="quote-sheet-heading" className="font-serif text-2xl leading-none sm:text-3xl">
            御見積書
          </h2>
          <p className="text-xs text-muted sm:text-sm" data-testid="quote-scope">
            {modelName}（{specName}）／注文範囲：{levelInfo.name}／概算・税込
          </p>
        </div>
      </div>

      <div className="sm:hidden" data-testid="quote-sheet-mobile">
        <MobileSectionHeader
          label="本体"
          expanded={expandedSections.base}
          onToggle={() => toggleSection('base')}
          toggleLabel="本体の明細"
          summary={expandedSections.base ? undefined : formatYen(pricing.base_total)}
        />
        {expandedSections.base && (
          <MobileQuoteLine
            name={`${modelName} 本体一式`}
            quantity="1式"
            amount={formatYen(pricing.base_total)}
          />
        )}

        <MobileSectionHeader
          label={
            <>
              <span className="block">【内外装工事】</span>
              <span className="mt-0.5 block text-[0.68rem] font-normal text-muted">
                ※選択した商品には施工費も含んだ金額になります
              </span>
            </>
          }
          expanded={expandedSections.interiorExterior}
          onToggle={() => toggleSection('interiorExterior')}
          toggleLabel="内外装工事の明細"
          summary={expandedSections.interiorExterior ? undefined : collapsedSectionSummary(interiorExteriorLines)}
        />
        {expandedSections.interiorExterior && displayInteriorExteriorLines.map((line) => {
          const cat = categories.find((category) => category.id === byOption.get(line.option_id)?.category_id);
          const isExteriorFace =
            line.category_code === 'exterior-wall' && (line.code.includes('__face_') || line.code.endsWith('__all_faces'));
          const amountText = line.price_on_request
            ? '別途見積'
            : isExteriorFace && line.amount === 0
              ? '追加費用なし'
              : line.amount === 0
                ? '標準'
                : formatYen(line.amount);
          const unitPriceText = line.price_on_request
            ? '別途見積'
            : isExteriorFace && line.amount === 0
              ? undefined
              : formatYen(line.unit_price);
          return (
            <MobileQuoteLine
              key={line.code}
              name={
                <button
                  type="button"
                  disabled={readOnly || !cat}
                  onClick={() => cat && onPickCategory(cat.id)}
                  className="text-left hover:text-brown disabled:text-ink"
                >
                  {line.name}
                  {line.variants.length > 0 && (
                    <span className="mt-0.5 block text-[0.68rem] text-muted">
                      {line.variants.map((variant) => `${variant.group}：${variant.choice}`).join('／')}
                    </span>
                  )}
                </button>
              }
              quantity={`${formatQty(line.quantity)}${isExteriorFace ? '面' : '式'}`}
              unitPrice={unitPriceText}
              amount={amountText}
              remark={isExteriorFace ? '面別外壁仕様' : undefined}
            />
          );
        })}

        <MobileSectionHeader
          label={`オプション${readOnly ? '' : '（項目をクリックすると変更できます）'}`}
          expanded={expandedSections.options}
          onToggle={() => toggleSection('options')}
          toggleLabel="オプションの明細"
          summary={expandedSections.options ? undefined : formatYen(pricing.option_total)}
        />
        {expandedSections.options && optionLines.map((line) => {
          const cat = categories.find((category) => category.id === byOption.get(line.option_id)?.category_id);
          return (
            <MobileQuoteLine
              key={line.code}
              name={
                <button
                  type="button"
                  disabled={readOnly || !cat}
                  onClick={() => cat && onPickCategory(cat.id)}
                  className="text-left hover:text-brown disabled:text-ink"
                >
                  {line.name}
                  {line.variants.length > 0 && (
                    <span className="mt-0.5 block text-[0.68rem] text-muted">
                      {line.variants.map((variant) => `${variant.group}：${variant.choice}`).join('／')}
                    </span>
                  )}
                </button>
              }
              quantity={`${formatQty(line.quantity)}式`}
              unitPrice={line.price_on_request ? '別途見積' : formatYen(line.unit_price)}
              amount={line.price_on_request ? '別途見積' : line.amount === 0 ? '標準' : formatYen(line.amount)}
            />
          );
        })}
        {expandedSections.options && (
          <MobileQuoteLine
            name="オプション諸費用（交通費、労災、安全管理費等）"
            quantity="1式"
            amount={formatYen(pricing.option_expense)}
            remark={`${Math.round(pricing.expense_rate * 100)}%`}
            muted
          />
        )}
        {expandedSections.options && (
          <MobileSubtotal label="【オプション価格計】" amount={formatYen(pricing.option_total)} />
        )}

        <MobileSectionHeader
          label={
            <>
              <span className="block">【その他の工事】</span>
              <span className="mt-0.5 block text-[0.68rem] font-normal text-muted">
                ※選択した商品には施工費も含まれます
              </span>
            </>
          }
          expanded={expandedSections.otherConstruction}
          onToggle={() => toggleSection('otherConstruction')}
          toggleLabel="その他の工事の明細"
          summary={expandedSections.otherConstruction ? undefined : collapsedSectionSummary(otherConstructionLines)}
        />
        {expandedSections.otherConstruction && otherConstructionLines.map((line) => (
          <MobileQuoteLine
            key={line.code}
            name={line.name}
            quantity={`${formatQty(line.quantity)}式`}
            unitPrice={line.price_on_request ? '別途見積' : formatYen(line.unit_price)}
            amount={line.price_on_request ? '別途見積' : line.amount > 0 ? formatYen(line.amount) : '標準'}
          />
        ))}

        <MobileSectionHeader
          label={
            <>
              <span className="block">【別途工事】</span>
              <span className="mt-0.5 block text-[0.68rem] font-normal text-muted">
                ※主に現場施工になりますので、お近くの代理店にお問合せ下さい
              </span>
            </>
          }
          expanded={expandedSections.sitework}
          onToggle={() => toggleSection('sitework')}
          toggleLabel="別途工事の明細"
          summary={expandedSections.sitework ? undefined : siteworkTotal > 0 ? formatYen(siteworkTotal) : '−'}
          action={showDealerFinder ? (
            <Link
              href="/dealers"
              className="inline-flex items-center gap-1 rounded-full border border-brown px-3 py-1 text-[0.7rem] font-semibold text-brown"
            >
              近くの代理店を探す。
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          ) : undefined}
        />
        {expandedSections.sitework && sitework.map((line) => (
          <MobileQuoteLine
            key={line.code}
            name={line.name}
            quantity={`${formatQty(line.quantity)}式`}
            amount={line.amount > 0 ? formatYen(line.amount) : '−'}
          />
        ))}
        {expandedSections.sitework && (
          <MobileSubtotal
            label="【別途工事計】"
            amount={siteworkTotal > 0 ? formatYen(siteworkTotal) : '−'}
          />
        )}

        {freeLines.length > 0 && (
          <>
            <MobileSectionHeader
              label="フリー商品（代理店・工務店の取扱商品／諸費用なし）"
              expanded={expandedSections.freeProducts}
              onToggle={() => toggleSection('freeProducts')}
              toggleLabel="フリー商品の明細"
              summary={expandedSections.freeProducts ? undefined : formatYen(freeTotal)}
            />
            {expandedSections.freeProducts && freeLines.map((line) => (
              <MobileQuoteLine
                key={line.code}
                name={line.name}
                quantity={`${formatQty(line.quantity)}式`}
                unitPrice={line.price_on_request ? '別途見積' : formatYen(line.unit_price)}
                amount={line.price_on_request ? '別途見積' : formatYen(line.amount)}
              />
            ))}
            {expandedSections.freeProducts && (
              <MobileSubtotal label="【フリー商品計】" amount={formatYen(freeTotal)} />
            )}
          </>
        )}

        <div className="border-t-2 border-ink/70 bg-white px-3 py-3">
          <div className="space-y-1.5 text-[0.78rem]">
            <div className="flex items-center justify-between gap-3">
              <span>小計</span>
              <span className="tabular-nums">{formatYen(pricing.subtotal_raw)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-soft">
              <span>値引き等調整額（千円未満切捨て）</span>
              <span className="tabular-nums">{formatYen(pricing.adjustment)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>税抜請負額</span>
              <span className="tabular-nums">{formatYen(pricing.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-soft">
              <span>消費税（{Math.round(pricing.tax_rate * 100)}%）</span>
              <span className="tabular-nums">{formatYen(pricing.tax)}</span>
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-3">
            <span className="font-serif text-base">合計（税込）</span>
            <span className="font-serif text-xl tabular-nums">{formatYen(pricing.total)}</span>
          </div>
        </div>
      </div>

      <div className="hidden overflow-x-auto overscroll-x-contain sm:block">
        <table className="w-full min-w-[42rem] table-fixed text-sm">
          <colgroup>
            <col />
            <col className="w-12 sm:w-16" />
            <col className="w-10 sm:w-12" />
            <col className="w-24 sm:w-28" />
            <col className="w-28 sm:w-32" />
            <col className="w-20 sm:w-24 lg:w-32" />
          </colgroup>
          <thead className="bg-sand text-[0.7rem] text-muted sm:text-xs">
            <tr>
              <th className={th.name}>項目</th>
              <th className={th.qty}>数量</th>
              <th className={th.unit}>単位</th>
              <th className={th.price}>単価</th>
              <th className={th.amount}>金額</th>
              <th className={th.remark}>備考</th>
            </tr>
          </thead>

          {/* ---- 本体（エンドユーザーには計のみ。明細は本部・総代理店・代理店の管理画面で見る） ---- */}
          <tbody className="divide-y divide-line/70" data-testid="base-breakdown">
            <SectionRow
              label={<><span>本体</span><span className="sr-only">本体価格</span></>}
              tone="ivory"
              expanded={expandedSections.base}
              onToggle={() => toggleSection('base')}
              toggleLabel="本体の明細"
              summary={expandedSections.base ? undefined : formatYen(pricing.base_total)}
            />
            {expandedSections.base && <tr className="bg-white align-top">
              <td className={td.name}>
                {modelName} 本体一式
              </td>
              <td className={td.qty}>1</td>
              <td className={td.unit}>式</td>
              <td className={td.price}></td>
              <td className={td.amount}>{formatYen(pricing.base_total)}</td>
              <td className={td.remark}></td>
            </tr>}
          </tbody>

          {/* ---- 内外装工事（表示上の区分。価格計算は既存の pricing を使用） ---- */}
          <tbody className="divide-y divide-line/70">
            <SectionRow
              label={(
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>【内外装工事】</span>
                  <span className="font-normal tracking-normal text-muted">※選択した商品には施工費も含んだ金額になります</span>
                </span>
              )}
              tone="ivory"
              expanded={expandedSections.interiorExterior}
              onToggle={() => toggleSection('interiorExterior')}
              toggleLabel="内外装工事の明細"
              summary={expandedSections.interiorExterior ? undefined : collapsedSectionSummary(interiorExteriorLines)}
            />
            {expandedSections.interiorExterior && displayInteriorExteriorLines.map((l) => {
              const cat = categories.find((c) => c.id === byOption.get(l.option_id)?.category_id);
              const isExteriorFace =
                l.category_code === 'exterior-wall' && (l.code.includes('__face_') || l.code.endsWith('__all_faces'));
              return (
                <tr key={l.code} className="bg-white align-top">
                  <td className={td.name}>
                    <button
                      type="button"
                      disabled={readOnly || !cat}
                      onClick={() => cat && onPickCategory(cat.id)}
                      className="group inline-flex items-start gap-1.5 text-left hover:text-brown disabled:hover:text-ink"
                      data-testid={`quote-line-${l.code}`}
                    >
                      <span>
                        {l.name}
                        {l.variants.length > 0 && (
                          <span className="block text-[0.7rem] text-muted">
                            {l.variants.map((v) => `${v.group}：${v.choice}`).join('／')}
                          </span>
                        )}
                      </span>
                      {!readOnly && cat && <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
                    </button>
                  </td>
                  <td className={td.qty}>{formatQty(l.quantity)}</td>
                  <td className={td.unit}>{isExteriorFace ? '面' : '式'}</td>
                  <td className={td.price}>{l.price_on_request ? '別途見積' : isExteriorFace && l.amount === 0 ? '' : formatYen(l.unit_price)}</td>
                  <td className={td.amount}>{l.price_on_request ? '別途見積' : isExteriorFace && l.amount === 0 ? '追加費用なし' : l.amount === 0 ? '標準' : formatYen(l.amount)}</td>
                  <td className={td.remark}>{isExteriorFace ? '面別外壁仕様' : ''}</td>
                </tr>
              );
            })}
          </tbody>

          {/* ---- オプション（クリックで変更） ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow
              label={`オプション${readOnly ? '' : '（項目をクリックすると変更できます）'}`}
              tone="ivory"
              expanded={expandedSections.options}
              onToggle={() => toggleSection('options')}
              toggleLabel="オプションの明細"
              summary={expandedSections.options ? undefined : formatYen(pricing.option_total)}
            />
            {expandedSections.options && optionLines.map((l) => {
              const cat = categories.find((c) => c.id === byOption.get(l.option_id)?.category_id);
              const isExteriorFace = l.category_code === 'exterior-wall' && l.code.includes('__face_');
              return (
                <tr key={l.code} className="bg-white align-top">
                  <td className={td.name}>
                    <button
                      type="button"
                      disabled={readOnly || !cat}
                      onClick={() => cat && onPickCategory(cat.id)}
                      className="group inline-flex items-center gap-1.5 text-left hover:text-brown disabled:hover:text-ink"
                      data-testid={`quote-line-${l.code}`}
                    >
                      <span>
                        {l.name}
                        {l.variants.length > 0 && (
                          <span className="block text-[0.7rem] text-muted">
                            {l.variants.map((v) => `${v.group}：${v.choice}`).join('／')}
                          </span>
                        )}
                      </span>
                      {!readOnly && cat && <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
                    </button>
                  </td>
                  <td className={td.qty}>{formatQty(l.quantity)}</td>
                  <td className={td.unit}>{isExteriorFace ? '面' : '式'}</td>
                  <td className={td.price}>{l.price_on_request ? '別途見積' : isExteriorFace && l.amount === 0 ? '' : formatYen(l.unit_price)}</td>
                  <td className={td.amount}>{l.price_on_request ? '別途見積' : isExteriorFace && l.amount === 0 ? '追加費用なし' : l.amount === 0 ? '標準' : formatYen(l.amount)}</td>
                  <td className={td.remark}>{isExteriorFace ? '面別外壁仕様' : ''}</td>
                </tr>
              );
            })}
            {expandedSections.options && <tr className="bg-white text-xs text-ink-soft">
              <td className={td.name}>オプション諸費用（交通費、労災、安全管理費等）</td>
              <td className={td.qty}>1</td>
              <td className={td.unit}>式</td>
              <td className={td.price}></td>
              <td className={td.amount}>{formatYen(pricing.option_expense)}</td>
              <td className={td.remark}>{Math.round(pricing.expense_rate * 100)}%</td>
            </tr>}
            {expandedSections.options && <SubtotalRow label="【オプション価格計】" amount={formatYen(pricing.option_total)} />}
          </tbody>

          {/* ---- その他の工事（将来の estimate_section=other_construction 用） ---- */}
          <tbody className="divide-y divide-line/70">
            <SectionRow
              label={(
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>【その他の工事】</span>
                  <span className="font-normal tracking-normal text-muted">※選択した商品には施工費も含まれます</span>
                </span>
              )}
              tone="ivory"
              expanded={expandedSections.otherConstruction}
              onToggle={() => toggleSection('otherConstruction')}
              toggleLabel="その他の工事の明細"
              summary={expandedSections.otherConstruction ? undefined : collapsedSectionSummary(otherConstructionLines)}
            />
            {expandedSections.otherConstruction && otherConstructionLines.map((l) => (
              <tr key={l.code} className="bg-white text-xs align-top">
                <td className={td.name}>{l.name}</td>
                <td className={td.qty}>{formatQty(l.quantity)}</td>
                <td className={td.unit}>式</td>
                <td className={td.price}>{l.price_on_request ? '別途見積' : formatYen(l.unit_price)}</td>
                <td className={td.amount}>{l.price_on_request ? '別途見積' : l.amount > 0 ? formatYen(l.amount) : '標準'}</td>
                <td className={td.remark}></td>
              </tr>
            ))}
          </tbody>

          {/* ---- 別途工事（現地確認後に代理店が見積） ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow
              label={
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>【別途工事】</span>
                  <span className="font-normal tracking-normal text-muted">※ 主に現場施工になりますので、お近くの代理店にお問合せ下さい</span>
                </span>
              }
              tone="ivory"
              expanded={expandedSections.sitework}
              onToggle={() => toggleSection('sitework')}
              toggleLabel="別途工事の明細"
              summary={expandedSections.sitework ? undefined : siteworkTotal > 0 ? formatYen(siteworkTotal) : '−'}
              action={showDealerFinder ? (
                <Link
                  href="/dealers"
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-brown px-2.5 py-1 text-[0.68rem] font-semibold tracking-normal text-brown transition hover:bg-brown hover:text-white sm:px-3 sm:text-xs"
                  data-testid="nearby-dealers-heading-link"
                >
                  近くの代理店を探す。
                  <ArrowRight className="size-3" aria-hidden="true" />
                </Link>
              ) : undefined}
            />
            {expandedSections.sitework && sitework.map((l) => (
              <tr key={l.code} className="bg-white text-xs align-top">
                <td className={td.name}>{l.name}</td>
                <td className={td.qty}>{l.quantity}</td>
                <td className={td.unit}>式</td>
                <td className={td.price}></td>
                <td className={td.amount}>{l.amount > 0 ? formatYen(l.amount) : '−'}</td>
                <td className={td.remark}></td>
              </tr>
            ))}
            {expandedSections.sitework && (
              <SubtotalRow
                label="【別途工事計】"
                amount={siteworkTotal > 0 ? formatYen(siteworkTotal) : '−'}
              />
            )}
          </tbody>

          {/* ---- フリー商品（代理店・工務店の取扱商品／諸費用なし） ---- */}
          {freeLines.length > 0 && (
            <tbody className="divide-y divide-line/60">
              <SectionRow
                label="フリー商品（代理店・工務店の取扱商品／諸費用なし）"
                tone="ivory"
                expanded={expandedSections.freeProducts}
                onToggle={() => toggleSection('freeProducts')}
                toggleLabel="フリー商品の明細"
                summary={expandedSections.freeProducts ? undefined : formatYen(freeTotal)}
              />
              {expandedSections.freeProducts && freeLines.map((l) => (
                <tr key={l.code} className="bg-white text-xs">
                  <td className={td.name} data-testid={`quote-line-${l.code}`}>{l.name}</td>
                  <td className={td.qty}>{l.quantity}</td>
                  <td className={td.unit}>式</td>
                  <td className={td.price}>{l.price_on_request ? '別途見積' : formatYen(l.unit_price)}</td>
                  <td className={td.amount}>{l.price_on_request ? '別途見積' : formatYen(l.amount)}</td>
                  <td className={td.remark}></td>
                </tr>
              ))}
              {expandedSections.freeProducts && <SubtotalRow label="【フリー商品計】" amount={formatYen(freeTotal)} />}
            </tbody>
          )}

          {/* ---- 金額集計 ---- */}
          <tfoot className="border-t-2 border-ink/70 bg-white">
            <tr className="text-sm">
              <td colSpan={4} className="px-3 pt-4 pb-1 sm:px-4">小計</td>
              <td className="px-3 pt-4 pb-1 text-right tabular-nums sm:px-4">{formatYen(pricing.subtotal_raw)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1 sm:px-4">値引き等調整額（千円未満切捨て）</td>
              <td className="px-3 py-1 text-right tabular-nums sm:px-4">{formatYen(pricing.adjustment)}</td>
              <td></td>
            </tr>
            <tr className="text-sm">
              <td colSpan={4} className="px-3 py-1 sm:px-4">税抜請負額</td>
              <td className="px-3 py-1 text-right tabular-nums sm:px-4">{formatYen(pricing.subtotal)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1 sm:px-4">消費税（{Math.round(pricing.tax_rate * 100)}%）</td>
              <td className="px-3 py-1 text-right tabular-nums sm:px-4">{formatYen(pricing.tax)}</td>
              <td></td>
            </tr>
            <tr className="border-t border-line bg-ivory">
              <td colSpan={4} className="px-3 py-3 font-serif text-lg sm:px-4 sm:text-xl">合計（税込）</td>
              <td className="px-3 py-3 text-right sm:px-4">
                <span className="font-serif text-xl tabular-nums sm:text-2xl" data-testid="total-price">
                  {formatYen(pricing.total)}
                </span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-2 border-t border-line px-4 py-4 text-xs leading-relaxed text-ink-soft sm:px-6">
        <p>
          <strong className="font-semibold">注文範囲：{levelInfo.name}（{levelInfo.short}）</strong>
          — {levelInfo.lead}
        </p>
        <p>運搬、設置費など設置場所によって変動する費用は別途工事となっていて、現地の代理店、工務店にお問合せ下さい。</p>
        <Link href="/dealers" className={cn('inline-flex items-center gap-1 font-semibold text-brown underline underline-offset-4')} data-testid="dealers-link">
          代理店・工務店を探す／お問い合わせ
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
