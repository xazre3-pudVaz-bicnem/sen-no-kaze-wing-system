import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandardEstimateV25ProductPicker, v25PickerChoicesValid, v25PickerEligibleCandidates, v25PickerReplacementCandidates, v25PickerStandardCostLabel } from '@/components/admin/standard-estimate-v25-product-picker';
import { readFileSync } from 'node:fs';
import type { V25WorkbenchCandidate } from '@/lib/domain/standard-estimate-v25-workbench';

const sample: V25WorkbenchCandidate = {
  id: 'sample', name: 'テスト用ドア', categoryId: 'door', categoryName: '玄関ドア',
  categoryCode: 'entrance', singleSelect: false, manufacturer: 'メーカーA',
  modelNo: 'X-1', imageUrl: 'https://example.com/sample.jpg', section: 'option',
  defaultChoices: { color: 'white' },
  variantGroups: [{ id: 'color', name: '扉色', choices: [{ id: 'white', name: 'ホワイト' }, { id: 'black', name: 'ブラック' }] }],
};

describe('v2.5商品選択のUI', () => {
  it('商品画像・メーカー・型番と、選択→仕様確認→明細反映の領域を示す', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', section: 'option', candidates: [sample], productCosts: { sample: 480000 },
      currentSlot: null, onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('data-testid="v25-wb-product-picker"');
    expect(html).toContain('data-testid="v25-wb-picker-candidate"');
    expect(html).toContain('sample.jpg');
    expect(html).toContain('メーカーA ／ X-1');
    expect(html).toContain('商品名・メーカー・型番');
    expect(html).toContain('明細に反映');
    expect(html).toContain('disabled=""');
    expect(html).toContain('商品標準原価（税別）');
    expect(html).toContain('¥480,000');
    expect(html).toContain('data-testid="v25-wb-picker-list-cost"');
  });

  it('同じ商品への切替では既存の仕様を保持する設計', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', section: 'option', candidates: [sample], productCosts: { sample: 480000 },
      currentSlot: { option_id: sample.id, variant_choices: { color: 'black' } },
      onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('現在：テスト用ドア');
    expect(html).toContain('現在の商品');
  });

  it('未登録は0円と誤表示せず、登録済0円・正の原価は区別する', () => {
    expect(v25PickerStandardCostLabel(null)).toBe('原価未設定');
    expect(v25PickerStandardCostLabel(undefined)).toBe('原価未設定');
    expect(v25PickerStandardCostLabel(Number.NaN)).toBe('原価未設定');
    expect(v25PickerStandardCostLabel(0)).toBe('¥0');
    expect(v25PickerStandardCostLabel(480000)).toBe('¥480,000');
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', section: 'option', candidates: [{ ...sample, id: 'not-priced' }],
      productCosts: {}, currentSlot: null, onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('原価未設定');
  });

  it('商品編集を別タブで開き、最新原価のみ表示し計算・保存処理を変えない', () => {
    const picker = readFileSync('components/admin/standard-estimate-v25-product-picker.tsx', 'utf8');
    const workbench = readFileSync('components/admin/standard-estimate-v25-workbench.tsx', 'utf8');
    expect(picker).toContain('data-testid="v25-wb-picker-detail-cost"');
    expect(picker).toContain('data-testid="v25-wb-picker-edit-product"');
    expect(picker).toContain('encodeURIComponent(selected.id)');
    expect(picker).toContain('target="_blank" rel="noopener noreferrer"');
    expect(picker).toContain('選択肢の原価差額・見積売価は含みません');
    expect(picker).toContain('未保存入力を保存してから画面を再読込');
    expect(workbench).toContain('productCosts={costs.currentProduct}');
    expect(workbench).toContain('onChoose={choose}');
  });

  it('選択肢の不正な値を拒否し、未選択は従来どおり許可する', () => {
    expect(v25PickerChoicesValid(sample, { color: 'white' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: 'black' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: '' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: 'invalid' })).toBe(false);
    expect(v25PickerChoicesValid({ variantGroups: [] }, {})).toBe(true);
  });
});

describe('v2.5商品選択のカテゴリーと区分の保護', () => {
  const aircon = { ...sample, id: 'air-1', name: 'エアコン標準品', categoryId: 'air', categoryName: '空調' };
  const secondAircon = { ...aircon, id: 'air-2', name: 'エアコン変更品' };
  const toilet = { ...sample, id: 'toilet-1', name: 'トイレ商品', categoryId: 'toilet', categoryName: 'トイレ' };
  const sitework = { ...sample, id: 'site-1', name: '現場工事', categoryId: 'site', categoryName: '施工', section: 'sitework' as const };
  const retired = { ...aircon, id: 'air-old', name: '廃番エアコン', retired: true };
  const unavailable = { ...aircon, id: 'air-unavailable', name: '選択不可エアコン', unavailable: true };
  const catalog = [aircon, secondAircon, toilet, sitework, retired, unavailable];

  it('変更では元商品のカテゴリー以外を候補にせず、カテゴリー選択を表示しない', () => {
    const slot = { option_id: aircon.id };
    expect(v25PickerEligibleCandidates(catalog, 'option', slot, aircon).map((item) => item.id))
      .toEqual(['air-1', 'air-2']);
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', section: 'option', candidates: catalog, productCosts: {},
      currentSlot: { ...slot, variant_choices: {} }, originalProduct: aircon,
      onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('エアコン変更品');
    expect(html).not.toContain('トイレ商品');
    expect(html).not.toContain('現場工事');
    expect(html).not.toContain('廃番エアコン');
    expect(html).not.toContain('選択不可エアコン');
    expect(html).not.toContain('aria-label="カテゴリー"');
    expect(html).toContain('aria-label="商品を検索"');
  });

  it('廃番でも正確なカテゴリーIDがあれば同じカテゴリーだけを変更候補にできる', () => {
    expect(v25PickerEligibleCandidates(catalog, 'option', { option_id: retired.id }, retired).map((item) => item.id))
      .toEqual(['air-1', 'air-2']);
  });

  it('旧スナップショットなどで元商品のカテゴリー不明なら、別カテゴリーへの変更を遮断する', () => {
    const snapshot = { ...retired, id: 'missing', name: '旧商品', categoryId: '', unavailable: true };
    expect(v25PickerEligibleCandidates(catalog, 'option', { option_id: snapshot.id }, snapshot)).toEqual([]);
    expect(v25PickerEligibleCandidates(catalog, 'option', { option_id: 'missing' })).toEqual([]);
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', section: 'option', candidates: catalog, productCosts: {},
      currentSlot: { option_id: snapshot.id, variant_choices: {} }, originalProduct: snapshot,
      onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('現在：旧商品');
    expect(html).toContain('現在の商品のカテゴリーを確認できないため変更できません');
    expect(html).not.toContain('data-testid="v25-wb-picker-candidate"');
    expect(html).toContain('disabled=""');
  });

  it('新規追加はその区分で選択可能なカテゴリーと商品を表示し、販売停止・他区分を除く', () => {
    expect(v25PickerEligibleCandidates(catalog, 'option', null).map((item) => item.id))
      .toEqual(['air-1', 'air-2', 'toilet-1']);
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', section: 'option', candidates: catalog, productCosts: {},
      currentSlot: null, onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('aria-label="カテゴリー"');
    expect(html).toContain('空調');
    expect(html).toContain('トイレ');
    expect(html).not.toContain('現場工事');
    expect(html).not.toContain('廃番エアコン');
    expect(html).not.toContain('選択不可エアコン');
    expect(v25PickerEligibleCandidates(catalog, 'sitework', null).map((item) => item.id)).toEqual(['site-1']);
  });

  it('確定経路でも別カテゴリー・別区分・選択不可品を拒否する', () => {
    const workbench = readFileSync('components/admin/standard-estimate-v25-workbench.tsx', 'utf8');
    expect(workbench).toContain('candidate.section !== picker.section || candidate.retired || candidate.unavailable');
    expect(workbench).toContain('original.categoryId !== candidate.categoryId');
    expect(workbench).toContain('originalProduct={picker.targetKey');
    expect(workbench).toContain('onChoose={choose}');
  });
});

describe('v2.5現在商品の固定表示と仕様変更', () => {
  const current = { ...sample, id: 'current-door', name: '現在の勝手口ドア' };
  const alternative = { ...sample, id: 'new-door', name: '変更候補ドア' };
  const slot = { option_id: current.id, variant_choices: { color: 'black' } };
  const pickerProps = {
    sectionLabel: 'オプション', section: 'option' as const,
    candidates: [current, alternative],
    productCosts: { 'current-door': 102000, 'new-door': 94000 },
    currentSlot: slot, originalProduct: current,
    onChoose: () => {}, onClose: () => {},
  };

  it('現在商品は一覧より上に固定され、候補リストに重複表示しない', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, pickerProps));
    expect(html).toContain('data-testid="v25-wb-current-product"');
    expect(html).toContain('data-testid="v25-wb-current-variant"');
    expect(html).toContain('現在の勝手口ドア');
    expect(html).toContain('変更候補ドア');
    expect(html).toContain('¥102,000');
    expect(html).toContain('¥94,000');
    expect(html).toContain('仕様を変更');
    expect(html.indexOf('data-testid="v25-wb-current-product"'))
      .toBeLessThan(html.indexOf('data-testid="v25-wb-picker"'));
    expect(v25PickerReplacementCandidates([current, alternative], slot).map((product) => product.id))
      .toEqual(['new-door']);
    expect(html).not.toContain('aria-label="カテゴリー"');
  });

  it('固定欄の仕様変更は元の仕様を引き継ぎ、選択中の間は見積を書き換えない', () => {
    const source = readFileSync('components/admin/standard-estimate-v25-product-picker.tsx', 'utf8');
    expect(source).toContain('onClick={() => { if (currentSelectable) inspect(currentSelectable); }}');
    expect(source).toContain('candidate.id === currentSlot?.option_id ? currentSlot.variant_choices : candidate.defaultChoices');
    expect(source).toContain('selected.id === currentSlot?.option_id');
    expect(source).toContain('const selected = eligibleCandidates.find((candidate) => candidate.id === selectedId) ?? null;');
    expect(source).toContain('onChoose(selected, { ...choices })');
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, pickerProps));
    expect(html).toContain('disabled=""'); // 確定は商品未選択の初期状態では不可
  });

  it('廃番・取扱終了の商品は固定表示するが仕様変更できず、代替品は表示', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      ...pickerProps, candidates: [alternative], originalProduct: { ...current, retired: true },
    }));
    expect(html).toContain('現在の勝手口ドア');
    expect(html).toContain('現在の商品は廃番・取扱終了');
    expect(html).toContain('変更候補ドア');
    expect(html).toMatch(/data-testid="v25-wb-current-variant"[^>]*disabled=""/);
  });

  it('カテゴリー不明なら固定欄も操作不可として候補を遮断', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      ...pickerProps, candidates: [alternative], originalProduct: { ...current, categoryId: '', unavailable: true },
    }));
    expect(html).toContain('現在の勝手口ドア');
    expect(html).toContain('現在の商品のカテゴリーを確認できないため変更できません');
    expect(html).not.toContain('data-testid="v25-wb-picker-candidate"');
    expect(html).toMatch(/data-testid="v25-wb-current-variant"[^>]*disabled=""/);
  });

  it('新規商品追加時は固定欄なしで従来のカテゴリー検索を維持', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      ...pickerProps, currentSlot: null, originalProduct: null,
    }));
    expect(html).not.toContain('data-testid="v25-wb-current-product"');
    expect(html).toContain('aria-label="カテゴリー"');
    expect(v25PickerReplacementCandidates([current, alternative], null).map((product) => product.id))
      .toEqual(['current-door', 'new-door']);
  });
});
