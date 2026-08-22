'use client';

import { ArrowRight, ImageOff, Pencil, Save } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { RuleIssue } from '@/lib/domain/rules';
import type { BaseModel, OptionCategory, PricingResult, ProductOption } from '@/lib/domain/types';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { Button, Spinner } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';

interface Props {
  model: BaseModel;
  pricing: PricingResult;
  issues: RuleIssue[];
  categories: OptionCategory[];
  options: ProductOption[];
  name: string;
  configId: string | null;
  dirty: boolean;
  readOnly: boolean;
  saving: boolean;
  onSave: () => void;
  onQuote: () => void;
  /** 見積項目クリック → 商品選択ポップアップ */
  onPickCategory: (categoryId: string) => void;
}

export function SummaryPanel({ model, pricing, issues, categories, options, name, configId, dirty, readOnly, saving, onSave, onQuote, onPickCategory }: Props) {
  const byOption = new Map(options.map((o) => [o.id, o]));
  const optionLines = pricing.lines.filter((l) => !l.is_installation);
  const siteworkLines = pricing.lines.filter((l) => l.is_installation);
  const pickable = categories.filter((c) => c.code !== 'sitework');
  const selectedWithImages = optionLines.map((l) => byOption.get(l.option_id)).filter((o): o is ProductOption => Boolean(o));

  return (
    <section aria-labelledby="summary-heading" className="card">
      <div className="border-b border-line px-5 py-4">
        <h2 id="summary-heading" className="text-lg">お見積り内容</h2>
        <p className="mt-0.5 truncate text-xs text-muted" title={name}>
          {name}
          {configId ? (dirty ? '（未保存の変更あり）' : '（保存済み）') : '（未保存）'}
        </p>
      </div>

      <dl className="max-h-[36vh] space-y-1 overflow-y-auto px-5 py-4 text-sm lg:max-h-[40vh]">
        <p className="text-xs font-semibold text-muted">本体（工場生産分）</p>
        <Row label={`${model.name} 本体一式`} value={formatYen(pricing.base_price)} strong />
        <Row label={`本体諸費用（${Math.round(pricing.expense_rate * 100)}%）`} value={formatYen(pricing.base_expense)} muted />

        <p className="pt-3 text-xs font-semibold text-muted">オプション（項目をクリックして商品を選び直せます）</p>
        {pickable.map((cat) => {
          const lines = optionLines.filter((l) => byOption.get(l.option_id)?.category_id === cat.id);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => !readOnly && onPickCategory(cat.id)}
              disabled={readOnly}
              className="group -mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left hover:bg-sand disabled:hover:bg-transparent"
              data-testid={`summary-${cat.code}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-1 text-ink-soft">
                  {cat.name}
                  {!readOnly && <Pencil className="size-3 opacity-0 transition group-hover:opacity-60" aria-hidden="true" />}
                </span>
                {lines.length === 0 && <span className="text-xs text-muted">なし</span>}
              </span>
              {lines.map((l) => (
                <span key={l.option_id} className="flex items-baseline justify-between gap-3 pl-3">
                  <span>{l.name}</span>
                  <span className="shrink-0 tabular-nums">{l.price_on_request ? '別途' : l.amount === 0 ? '—' : formatYen(l.amount)}</span>
                </span>
              ))}
            </button>
          );
        })}
        <Row label={`オプション諸費用（${Math.round(pricing.expense_rate * 100)}%）`} value={formatYen(pricing.option_expense)} muted />

        {siteworkLines.length > 0 && (
          <>
            <p className="pt-3 text-xs font-semibold text-muted">別途工事（設置場所確認後に代理店が見積）</p>
            {siteworkLines.map((l) => (
              <Row key={l.option_id} label={l.name} value="別途" muted />
            ))}
          </>
        )}
      </dl>

      <div className="space-y-1 border-t border-line px-5 py-4 text-sm">
        <Row label="本体価格計" value={formatYen(pricing.base_total)} />
        <Row label="オプション価格計" value={formatYen(pricing.option_total)} />
        <Row label="別途工事計" value={pricing.installation_subtotal ? formatYen(pricing.installation_subtotal) : '別途'} />
        <Row label="値引き等調整額" value={formatYen(pricing.adjustment)} muted />
        <Row label="税抜請負額" value={formatYen(pricing.subtotal)} />
        <Row label="消費税（10%）" value={formatYen(pricing.tax)} />
        <div className="flex items-baseline justify-between gap-3 pt-2">
          <span className="font-semibold">概算合計（税込）</span>
          <span className="font-serif text-3xl" data-testid="total-price">{formatYen(pricing.total)}</span>
        </div>
        <p className="pt-1 text-xs text-muted">{PRICE_DISCLAIMER}</p>
      </div>

      {selectedWithImages.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <p className="text-xs font-semibold text-muted">選択した商品</p>
          <ul className="mt-2 grid grid-cols-4 gap-2" data-testid="selected-images">
            {selectedWithImages.map((o) => (
              <li key={o.id} className="text-center">
                <span className="relative block aspect-square overflow-hidden rounded-lg bg-sand">
                  {o.image_url ? (
                    <SmartImage src={o.image_url} alt={o.name} fill sizes="80px" className="object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-muted"><ImageOff className="size-4" aria-hidden="true" /></span>
                  )}
                </span>
                <span className="mt-1 line-clamp-2 block text-[0.65rem] leading-tight text-ink-soft">{o.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="mx-5 mb-3 space-y-1 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn" role="alert">
          {issues.map((i, idx) => (
            <li key={idx}>{i.message}</li>
          ))}
        </ul>
      )}
      <div className="hidden flex-col gap-2 px-5 pb-5 lg:flex">
        <Button variant="secondary" onClick={onSave} disabled={saving || readOnly} data-testid="save-button">
          {saving ? <Spinner /> : <Save className="size-4" aria-hidden="true" />}
          一時保存
        </Button>
        <Button onClick={onQuote} disabled={saving} data-testid="quote-button">
          この仕様で見積を依頼する
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? 'text-muted' : strong ? 'font-semibold' : 'text-ink-soft'}>{label}</dt>
      <dd className={`shrink-0 tabular-nums ${muted ? 'text-muted' : ''}`}>{value}</dd>
    </div>
  );
}
