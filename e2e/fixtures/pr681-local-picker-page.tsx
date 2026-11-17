'use client';

import { useState } from 'react';
import { OptionPickerDialog } from '@/components/simulator/option-picker-dialog';
import { seedCategories, seedOptions } from '@/lib/seed/catalog';

/**
 * PR #681 受入検証専用：CI が WING_LOCAL_MODE=1 の使い捨て Next dev にだけ
 * app/pr681-e2e-picker/page.tsx としてコピーする。公開アプリの route には存在しない。
 * 公開 Revision・DB・価格スイッチ・見積データは一切読み書きしない。
 *
 * 商品・カテゴリーは本体の seed カタログを再利用し、位置枠だけテスト用。
 * 選択結果は React state のみに保存（本番の保存呼出しは一切行わない）。
 */
const sashCategory = seedCategories.find((cat) => cat.code === 'sash');
const toiletCategory = seedCategories.find((cat) => cat.code === 'toilet');
const sashOptions = seedOptions.filter((o) => o.category_id === sashCategory?.id && ['sash-standard', 'sash-resin'].includes(o.code));
const toiletOptions = seedOptions.filter((o) => o.category_id === toiletCategory?.id && o.code === 'toilet-washlet');
const standardSash = sashOptions.find((o) => o.code === 'sash-standard');
const resinSash = sashOptions.find((o) => o.code === 'sash-resin');
const standardToilet = toiletOptions[0];

type FixtureSlot = { code: string; label: string; category: 'sash' | 'toilet'; baselineId: string; selectableIds: string[] };
const slots: FixtureSlot[] = [
  { code: 'bedroom-fix', label: '寝室FIX窓', category: 'sash', baselineId: standardSash?.id ?? '', selectableIds: sashOptions.map((o) => o.id) },
  { code: 'entrance-window', label: '玄関脇サッシ', category: 'sash', baselineId: resinSash?.id ?? '', selectableIds: sashOptions.map((o) => o.id) },
  { code: 'toilet-room', label: 'トイレ設備', category: 'toilet', baselineId: standardToilet?.id ?? '', selectableIds: toiletOptions.map((o) => o.id) },
];

export default function Pr681LocalPickerFixture() {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [slotCode, setSlotCode] = useState<string | null>(null);
  const activeSlot = slots.find((slot) => slot.code === slotCode) ?? null;
  const category = activeSlot?.category === 'toilet' ? toiletCategory : sashCategory;
  const allOptions = activeSlot?.category === 'toilet' ? toiletOptions : sashOptions;
  const choices = activeSlot ? allOptions.filter((o) => activeSlot.selectableIds.includes(o.id)) : [];
  const current = activeSlot ? selections[activeSlot.code] ?? activeSlot.baselineId : null;
  const valid = Boolean(sashCategory && toiletCategory && standardSash && resinSash && standardToilet);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-5" data-testid="pr681-local-fixture">
      <h1 className="text-lg font-semibold">位置別商品・基本プラン表示の隔離受入試験</h1>
      <p className="text-sm">この画面はCIローカルモード専用のテスト用データです。価格計算・DB保存は行いません。</p>
      {!valid && <p role="alert">検証用の商品カタログが不足しています</p>}
      {valid && (
        <div className="space-y-3">
          {slots.map((slot) => {
            const option = allFor(slot.category).find((o) => o.id === (selections[slot.code] ?? slot.baselineId));
            const basic = allFor(slot.category).find((o) => o.id === slot.baselineId);
            return (
              <section key={slot.code} className="rounded-lg border p-3" data-testid={`fixture-slot-${slot.code}`}>
                <h2 className="text-sm font-semibold">{slot.label}</h2>
                <p data-testid={`fixture-current-${slot.code}`}>現在：{option?.name ?? '未選択'}</p>
                <p data-testid={`fixture-baseline-${slot.code}`}>基本：{basic?.name ?? '未選択'}</p>
                <button type="button" className="mt-2 border p-2" data-testid={`fixture-open-${slot.code}`} onClick={() => setSlotCode(slot.code)}>
                  この位置の商品を選ぶ
                </button>
              </section>
            );
          })}
        </div>
      )}
      {activeSlot && category && (
        <OptionPickerDialog
          key={activeSlot.code}
          category={category}
          slot={{ label: activeSlot.label }}
          options={choices}
          selectedIds={current ? [current] : []}
          baselineSelectedIds={[activeSlot.baselineId]}
          blocked={new Map()}
          variantGroups={[]}
          variantChoices={[]}
          selectedVariantIds={[]}
          baselineVariantIds={[]}
          onClose={() => setSlotCode(null)}
          onApply={(nextSelected) => {
            if (nextSelected[0]) setSelections((previous) => ({ ...previous, [activeSlot.code]: nextSelected[0] }));
            setSlotCode(null);
          }}
        />
      )}
    </main>
  );
}

function allFor(category: FixtureSlot['category']) {
  return category === 'toilet' ? toiletOptions : sashOptions;
}
