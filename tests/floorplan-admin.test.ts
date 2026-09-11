import { describe, expect, it } from 'vitest';
import { buildStandardFloorplanSlots } from '@/lib/domain/floorplan-admin';
import {
  BASE_FLOORPLAN_NOTE,
  enforceDedicatedBaseFloorplanFields,
  enforcePresetFloorplanFields,
  findDedicatedBaseFloorplanRule,
  isDedicatedBaseFloorplanRule,
  presetFloorplanInternalNote,
  previewRuleDisplayNote,
} from '@/lib/domain/preview-rule-meta';
import type { CatalogBundle, PreviewImageRule } from '@/lib/domain/types';
import { MODEL_BOX_ID, MODEL_WING01_ID, seedCatalog } from '@/lib/seed/catalog';
import { previewRuleSchema } from '@/lib/validation';

const wingModel = seedCatalog.models.find((model) => model.id === MODEL_WING01_ID)!;
const wingOptions = seedCatalog.options.filter(
  (option) => option.base_model_id === null || option.base_model_id === MODEL_WING01_ID
);
const wingRules = seedCatalog.previewRules.filter((rule) => rule.base_model_id === MODEL_WING01_ID);
const wingRuleIds = new Set(wingRules.map((rule) => rule.id));
const wingOptionIds = new Set(wingOptions.map((option) => option.id));

const wingBundle: CatalogBundle = {
  model: wingModel,
  images: seedCatalog.images.filter((image) => image.base_model_id === MODEL_WING01_ID),
  categories: seedCatalog.categories,
  options: wingOptions,
  dependencies: seedCatalog.dependencies.filter(
    (dependency) => wingOptionIds.has(dependency.option_id) || wingOptionIds.has(dependency.requires_option_id)
  ),
  conflicts: seedCatalog.conflicts.filter(
    (conflict) => wingOptionIds.has(conflict.option_id) || wingOptionIds.has(conflict.conflicts_with_option_id)
  ),
  previewRules: wingRules,
  hotspots: seedCatalog.hotspots.filter((hotspot) => wingRuleIds.has(hotspot.rule_id)),
  variantGroups: seedCatalog.variantGroups.filter((group) => wingOptionIds.has(group.option_id)),
  variantChoices: seedCatalog.variantChoices,
  baseBreakdowns: seedCatalog.baseBreakdownItems.filter((item) => item.base_model_id === MODEL_WING01_ID),
};

const boxModel = seedCatalog.models.find((model) => model.id === MODEL_BOX_ID)!;
const boxOptions = seedCatalog.options.filter(
  (option) => option.base_model_id === null || option.base_model_id === MODEL_BOX_ID
);
const boxRules = seedCatalog.previewRules.filter((rule) => rule.base_model_id === MODEL_BOX_ID);
const boxRuleIds = new Set(boxRules.map((rule) => rule.id));
const boxOptionIds = new Set(boxOptions.map((option) => option.id));

const boxBundle: CatalogBundle = {
  model: boxModel,
  images: seedCatalog.images.filter((image) => image.base_model_id === MODEL_BOX_ID),
  categories: seedCatalog.categories,
  options: boxOptions,
  dependencies: seedCatalog.dependencies.filter(
    (dependency) => boxOptionIds.has(dependency.option_id) || boxOptionIds.has(dependency.requires_option_id)
  ),
  conflicts: seedCatalog.conflicts.filter(
    (conflict) => boxOptionIds.has(conflict.option_id) || boxOptionIds.has(conflict.conflicts_with_option_id)
  ),
  previewRules: boxRules,
  hotspots: seedCatalog.hotspots.filter((hotspot) => boxRuleIds.has(hotspot.rule_id)),
  variantGroups: seedCatalog.variantGroups.filter((group) => boxOptionIds.has(group.option_id)),
  variantChoices: seedCatalog.variantChoices,
  baseBreakdowns: seedCatalog.baseBreakdownItems.filter((item) => item.base_model_id === MODEL_BOX_ID),
};

const dedicatedBaseRule = (): PreviewImageRule => ({
  id: '99999999-0000-4000-8000-000000000001',
  base_model_id: MODEL_WING01_ID,
  view: 'floorplan',
  kind: 'composite',
  preview_keys: [],
  url: '/images/plan/wing-base.png',
  alt: 'Wing 本体専用平面図',
  note: BASE_FLOORPLAN_NOTE,
  z_index: 0,
  status: 'published',
});

describe('本体専用平面図の管理', () => {
  it('preview_keys=[] の既存fallbackは本体専用と判定されない', () => {
    const wingFallback = wingRules.find(
      (rule) => rule.view === 'floorplan' && rule.preview_keys.length === 0
    );
    const boxFallback = seedCatalog.previewRules.find(
      (rule) =>
        rule.base_model_id === MODEL_BOX_ID &&
        rule.view === 'floorplan' &&
        rule.preview_keys.length === 0
    );

    expect(wingFallback?.url).toContain('wing-residence.png');
    expect(boxFallback?.url).toContain('box-office.jpg');
    expect(isDedicatedBaseFloorplanRule(wingFallback!)).toBe(false);
    expect(isDedicatedBaseFloorplanRule(boxFallback!)).toBe(false);
  });

  it('本体専用ルールだけが本体枠として選ばれる', () => {
    const fallback = wingRules.find(
      (rule) => rule.view === 'floorplan' && rule.preview_keys.length === 0
    )!;
    const dedicated = dedicatedBaseRule();

    expect(findDedicatedBaseFloorplanRule([fallback, dedicated])).toEqual(dedicated);
    expect(findDedicatedBaseFloorplanRule([fallback])).toBeNull();
  });

  it('本体専用ルールの内部マーカーは通常表示されない', () => {
    const dedicated = dedicatedBaseRule();
    expect(previewRuleDisplayNote(dedicated)).toBeNull();

    const ordinary = { ...dedicated, note: '管理者向けの通常補足' };
    expect(previewRuleDisplayNote(ordinary)).toBe('管理者向けの通常補足');
  });

  it('本体専用ルール編集時は model / view / keys / kind / 内部マーカーが固定される', () => {
    const existing = dedicatedBaseRule();
    const protectedFields = enforceDedicatedBaseFloorplanFields(
      existing,
      {
        base_model_id: '20000000-0000-4000-8000-000000000099',
        view: 'exterior',
        kind: 'layer',
        preview_keys: ['bath', 'aircon'],
        note: '書き換えようとした補足',
      },
      false
    );

    expect(protectedFields).toEqual({
      base_model_id: MODEL_WING01_ID,
      view: 'floorplan',
      kind: 'composite',
      preview_keys: [],
      note: BASE_FLOORPLAN_NOTE,
    });
  });

  it('補足が空欄でも preview rule の入力チェックを通る', () => {
    const parsed = previewRuleSchema.safeParse({
      id: null,
      base_model_id: MODEL_WING01_ID,
      view: 'floorplan',
      kind: 'composite',
      preview_keys: [],
      url: '/images/plan/office.jpg',
      alt: '',
      note: null,
      z_index: 0,
      status: 'published',
    });
    expect(parsed.success).toBe(true);
  });

  it('空キーの事務所presetは旧fallbackではなく専用マーカーの平面図へ紐付く', () => {
    const officeRule: PreviewImageRule = {
      id: '99999999-0000-4000-8000-000000000002',
      base_model_id: MODEL_WING01_ID,
      view: 'floorplan',
      kind: 'composite',
      preview_keys: [],
      url: '/images/plan/wing-office.jpg',
      alt: 'Wing 事務所・店舗用平面図',
      note: presetFloorplanInternalNote('office'),
      z_index: 0,
      status: 'published',
    };
    const slots = buildStandardFloorplanSlots({ ...wingBundle, previewRules: [...wingRules, officeRule] });
    const office = slots.find((slot) => slot.code === 'office');

    expect(office?.rule?.id).toBe(officeRule.id);
    expect(office?.rule?.url).toContain('wing-office.jpg');
  });

  it('事務所preset専用ルール編集時は識別条件が固定される', () => {
    const existing: PreviewImageRule = {
      id: '99999999-0000-4000-8000-000000000003',
      base_model_id: MODEL_WING01_ID,
      view: 'floorplan',
      kind: 'composite',
      preview_keys: [],
      url: '/images/plan/wing-office.jpg',
      alt: 'Wing 事務所・店舗用平面図',
      note: presetFloorplanInternalNote('office'),
      z_index: 0,
      status: 'published',
    };
    const protectedFields = enforcePresetFloorplanFields(
      existing,
      {
        base_model_id: '20000000-0000-4000-8000-000000000099',
        view: 'exterior',
        kind: 'layer',
        preview_keys: ['aircon'],
        note: '変更しようとした値',
      },
      null
    );

    expect(protectedFields).toEqual({
      base_model_id: MODEL_WING01_ID,
      view: 'floorplan',
      kind: 'composite',
      preview_keys: [],
      note: presetFloorplanInternalNote('office'),
    });
    expect(previewRuleDisplayNote(existing)).toBeNull();
  });

  it('BOXは標準見積に合わせてホテル・単身者用と水回りキットの平面図枠を出す', () => {
    const slots = buildStandardFloorplanSlots(boxBundle);

    expect(slots.map((slot) => [slot.code, slot.name])).toEqual([
      ['hotel-single', 'ホテル・単身者用'],
      ['water-kit', '水回りキット'],
    ]);
    expect(slots.every((slot) => slot.keys.length === 0)).toBe(true);
  });

  it('BOX水回りキットの専用マーカー平面図を登録枠へ紐付ける', () => {
    const waterKitRule: PreviewImageRule = {
      id: '99999999-0000-4000-8000-000000000004',
      base_model_id: MODEL_BOX_ID,
      view: 'floorplan',
      kind: 'composite',
      preview_keys: [],
      url: '/images/plan/box-water-kit.jpg',
      alt: 'BOX 水回りキット平面図',
      note: presetFloorplanInternalNote('water-kit'),
      z_index: 0,
      status: 'published',
    };
    const slots = buildStandardFloorplanSlots({ ...boxBundle, previewRules: [...boxRules, waterKitRule] });
    const waterKit = slots.find((slot) => slot.code === 'water-kit');

    expect(waterKit?.rule?.id).toBe(waterKitRule.id);
    expect(waterKit?.rule?.url).toContain('box-water-kit.jpg');
  });

  it('hotel / residence のpresetがそれぞれ対応する平面図へ紐付く', () => {
    const slots = buildStandardFloorplanSlots(wingBundle);
    const hotel = slots.find((slot) => slot.code === 'hotel');
    const residence = slots.find((slot) => slot.code === 'residence');

    expect(hotel?.rule?.url).toContain('wing-hotel.png');
    expect(residence?.rule?.url).toContain('wing-residence.png');
    expect(hotel?.rule?.id).not.toBe(residence?.rule?.id);
  });
});
