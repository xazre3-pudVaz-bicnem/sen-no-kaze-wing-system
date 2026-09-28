import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulatorEstimateChoices } from '@/lib/domain/estimate-template';
import { pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import { isLegacyConfigurationSaveCompatible, isMissingColumn, isMissingNamedFunction } from '@/lib/data/schema-compat';
import type { EstimateTemplateBundle, OptionVariantChoice, OptionVariantGroup } from '@/lib/domain/types';
import { seedModels } from '@/lib/seed/catalog';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260928100000_configuration_atomic_save_corrective.sql'),
  'utf8'
);
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');
const exteriorAction = fs.readFileSync(path.join(root, 'lib/actions/exterior-configurations.ts'), 'utf8');
const exteriorFaces = fs.readFileSync(path.join(root, 'lib/data/exterior-faces.ts'), 'utf8');

function template(modelId: string, specCode: string): EstimateTemplateBundle {
  return {
    template: {
      id: `template-${specCode}`,
      base_model_id: modelId,
      spec_code: specCode,
      name: specCode,
      source_file_name: 'test.xlsx',
      source_sheet_name: 'test',
      source_sha256: 'test',
      baseline_option_ids: [],
      tax_rate: 0.1,
      subtotal_raw: 0,
      adjustment: 0,
      subtotal: 0,
      tax: 0,
      total: 0,
      imported_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:00:00.000Z',
    },
    sections: [],
    lines: [],
    base_breakdown_items: [],
    baseline_option_ids: [],
  };
}

describe('Configuration atomic save corrective', () => {
  it('recognizes missing columns from PostgreSQL and the PostgREST schema cache', () => {
    expect(isMissingColumn({ code: '42703' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumn({ code: '42501' })).toBe(false);
  });

  it('falls back only when save_configuration_atomic itself is clearly missing', () => {
    for (const error of [
      {
        code: 'PGRST202',
        message: 'Could not find the function public.save_configuration_atomic(p_configuration_id) in the schema cache',
      },
      {
        code: '42883',
        message: 'function public.save_configuration_atomic(uuid, uuid, text) does not exist',
      },
    ]) {
      expect(isMissingNamedFunction(error, 'save_configuration_atomic')).toBe(true);
    }
  });

  it('does not treat atomic helper, auth, validation, or other SQL errors as a missing atomic RPC', () => {
    for (const error of [
      { code: '42883', message: 'function public.finish_level_rank(text) does not exist' },
      { code: '42883', message: 'function public.validate_configuration_items(uuid, uuid[], text) does not exist' },
      { code: '42883', message: 'function public.recalculate_configuration(uuid) does not exist' },
      { code: '42883', message: 'function public.configuration_pricing_json(uuid) does not exist' },
      { code: '42501', message: 'FORBIDDEN' },
      { code: 'P0001', message: 'VALIDATION: 選択できないオプションが含まれています' },
      { code: '23503', message: 'insert or update violates foreign key constraint' },
      {
        code: 'PGRST202',
        message: 'Could not find the function public.some_other_function() in the schema cache',
      },
    ]) {
      expect(isMissingNamedFunction(error, 'save_configuration_atomic')).toBe(false);
    }
  });

  it('creates one canonical, hardened RPC after the current pending migrations', () => {
    expect(Number('20260928100000')).toBeGreaterThan(Number('20260927150000'));
    expect(migration).toContain('create or replace function public.save_configuration_atomic(');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('v_uid uuid := auth.uid();');
    expect(migration).toContain('from public.configurations where id = v_id for update;');
    expect(migration).toContain("if v_cfg.status <> 'draft' then");
  });

  it('validates every price-bearing selection before changing the configuration', () => {
    for (const fragment of [
      'p_spec_code is not null',
      "o.status <> 'published'",
      'p_spec_code = any(o.spec_codes)',
      'perform public.validate_configuration_items(p_base_model_id, v_options, v_level);',
      "vc.status <> 'published'",
      "vg.status <> 'published'",
      '同じ選択項目から複数のバリエーションは選べません',
      '必須のバリエーションを選択してください',
      "c.code = 'exterior-wall'",
      '外壁は正面・右側面・背面・左側面を各1面指定してください',
      '設置予定地を未定にする場合',
    ]) {
      expect(migration).toContain(fragment);
    }
  });

  it('persists faces and location before one recalculation, then makes the saved snapshot last', () => {
    const parent = migration.indexOf('insert into public.configurations');
    const items = migration.indexOf('insert into public.configuration_items');
    const recalculate = migration.indexOf('v_cfg := public.recalculate_configuration(v_id);');
    const snapshot = migration.indexOf("values (v_id, 'saved', public.configuration_pricing_json(v_id));");
    expect(parent).toBeGreaterThan(-1);
    expect(items).toBeGreaterThan(parent);
    expect(recalculate).toBeGreaterThan(items);
    expect(snapshot).toBeGreaterThan(recalculate);
    expect(migration).toContain('exterior_faces, site_prefecture, site_municipality, site_location_undecided');
  });

  it('closes old public save helpers and table writers while granting only the atomic RPC to authenticated', () => {
    expect(migration).toContain('revoke insert, update on public.configurations from authenticated;');
    expect(migration).toContain('revoke insert, update, delete on public.configuration_items from authenticated;');
    for (const signature of [
      'public.save_configuration(uuid, uuid, text, uuid[], text, text)',
      'public.save_configuration(uuid, uuid, text, uuid[], text, text, text)',
      'public.save_configuration(uuid, uuid, text, uuid[], text, text, text, uuid[], text)',
      'public.recalculate_configuration(uuid)',
      'public.configuration_pricing_json(uuid)',
    ]) {
      expect(migration).toContain(`revoke execute on function ${signature}`);
    }
    expect(migration).toContain('grant execute on function public.save_configuration_atomic');
    expect(migration).not.toContain('grant execute on function public.recalculate_configuration');
  });

  it('uses the atomic RPC once from the application and only falls back for a missing function', () => {
    expect(supabaseStore).toContain("db.rpc('save_configuration_atomic', atomicInput)");
    expect(supabaseStore).toContain("if (!isMissingNamedFunction(atomic.error, 'save_configuration_atomic')) mapPgError(atomic.error);");
    expect(supabaseStore).toContain('Temporary deployment compatibility');
    expect(exteriorAction).toContain('return saveConfigurationAction(parsed.data);');
    expect(exteriorAction).not.toContain('saveExteriorFaces');
    expect(exteriorFaces).toMatch(/Production\s+\* saves must go through save_configuration_atomic/);
  });

  it('allows legacy fallback for a new four-face selection that is exactly one legacy exterior selection', () => {
    const faces = ['front', 'right', 'back', 'left'].map((face_code) => ({
      face_code,
      option_id: 'wall-a',
      variant_choice_ids: ['wall-plan-white', 'wall-color-white'],
    }));
    expect(
      isLegacyConfigurationSaveCompatible({
        site_prefecture: null,
        site_municipality: null,
        site_location_undecided: false,
        exterior_faces: faces,
        legacy_exterior_option_ids: ['wall-a'],
        legacy_exterior_variant_choice_ids: ['wall-color-white', 'wall-plan-white'],
      })
    ).toBe(true);
  });

  it('rejects non-representable exterior or site state before calling the legacy RPC', () => {
    const faces = ['front', 'right', 'back', 'left'].map((face_code) => ({
      face_code,
      option_id: 'wall-a',
      variant_choice_ids: ['wall-plan-white'],
    }));
    expect(
      isLegacyConfigurationSaveCompatible({
        site_prefecture: '東京都',
        site_municipality: null,
        site_location_undecided: false,
        exterior_faces: faces,
        legacy_exterior_option_ids: ['wall-a'],
        legacy_exterior_variant_choice_ids: ['wall-plan-white'],
      })
    ).toBe(false);
    expect(
      isLegacyConfigurationSaveCompatible({
        site_prefecture: null,
        site_municipality: null,
        site_location_undecided: false,
        exterior_faces: faces.map((face, index) => (index === 1 ? { ...face, option_id: 'wall-b' } : face)),
        legacy_exterior_option_ids: ['wall-a'],
        legacy_exterior_variant_choice_ids: ['wall-plan-white'],
      })
    ).toBe(false);
    expect(
      isLegacyConfigurationSaveCompatible({
        site_prefecture: null,
        site_municipality: null,
        site_location_undecided: false,
        exterior_faces: faces,
        legacy_exterior_option_ids: ['wall-a'],
        legacy_exterior_variant_choice_ids: ['wall-plan-accent'],
      })
    ).toBe(false);

    const saveMethod = supabaseStore.slice(
      supabaseStore.indexOf('async saveConfiguration('),
      supabaseStore.indexOf('async duplicateConfiguration')
    );
    const atomicMissingGuard = saveMethod.indexOf("isMissingNamedFunction(atomic.error, 'save_configuration_atomic')");
    const compatibilityGuard = saveMethod.indexOf('isLegacyConfigurationSaveCompatible({');
    const legacySave = saveMethod.indexOf("db.rpc('save_configuration', {");
    expect(atomicMissingGuard).toBeGreaterThan(-1);
    expect(compatibilityGuard).toBeGreaterThan(atomicMissingGuard);
    expect(legacySave).toBeGreaterThan(compatibilityGuard);
    expect(saveMethod).not.toContain(".from('configurations')\n      .update");
    expect(saveMethod).not.toContain("db.rpc('recalculate_configuration'");
  });

  it('uses the simulator formal spec sources instead of a preset-only allow-list', () => {
    const wing = seedModels.find((model) => model.slug === 'wing-01')!;
    const box = seedModels.find((model) => model.slug === 'box')!;
    const wingChoices = simulatorEstimateChoices(wing, [template(wing.id, 'admin-added-spec')]).map((choice) => choice.code);
    const boxChoices = simulatorEstimateChoices(box, []).map((choice) => choice.code);

    expect(wingChoices).toEqual(expect.arrayContaining(['base', 'hotel', 'admin-added-spec']));
    expect(boxChoices).toEqual(['base', 'hotel-single', 'water-kit']);
    expect(migration).toContain("p_spec_code <> 'base'");
    expect(migration).toContain('from public.estimate_templates t');
    expect(migration).toContain('t.base_model_id = p_base_model_id');
    expect(migration).toContain("raise exception 'VALIDATION: このモデルでは指定された仕様を選べません'");
  });

  it('limits empty exterior_faces to unchanged legacy data and blocks the old price bypass', () => {
    expect(migration).toContain("if v_id is null and exists (");
    expect(migration).toContain("c.code = 'exterior-wall'");
    expect(migration).toContain('新規Configurationの外壁は4面すべてを指定してください');
    expect(migration).toContain("jsonb_array_length(coalesce(v_cfg.exterior_faces, '[]'::jsonb)) = 4");
    expect(migration).toContain('4面化済みConfigurationを旧外壁方式へ戻すことはできません');
    expect(migration).toContain("coalesce(v_cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb");
    expect(migration).toContain('legacy外壁を変更する場合は4面すべてを指定してください');
    expect(migration).toContain('from public.configuration_items ci');
  });

  it('matches UI visibility for required variant groups with missing dependencies or empty choice conditions', () => {
    const groups: OptionVariantGroup[] = [
      { id: 'plan', option_id: 'wall', code: 'wall-plan', name: '壁プラン', note: null, sort_order: 1, is_required: false, status: 'published' },
      {
        id: 'missing-parent', option_id: 'wall', code: 'missing-parent-required', name: '親なし必須', note: null, sort_order: 2,
        is_required: true, status: 'published', depends_on_group_code: 'does-not-exist', depends_on_choice_codes: ['accent'],
      },
      {
        id: 'empty-condition', option_id: 'wall', code: 'empty-condition-required', name: '条件空必須', note: null, sort_order: 3,
        is_required: true, status: 'published', depends_on_group_code: 'wall-plan', depends_on_choice_codes: [],
      },
    ];
    expect(visibleVariantGroups(groups, [], []).map((group) => group.id)).toEqual(
      expect.arrayContaining(['missing-parent', 'empty-condition'])
    );

    expect(
      migration.match(/cardinality\(coalesce\(vg\.depends_on_choice_codes, '\{\}'::text\[\]\)\) = 0/g) ?? []
    ).toHaveLength(2);
    expect(
      migration.match(/or not exists \(\n\s+select 1\n\s+from public\.option_variant_groups dependency_group/g) ?? []
    ).toHaveLength(2);
  });

  it('rejects selected hidden variants in both configuration and exterior-face payloads', () => {
    const groups: OptionVariantGroup[] = [
      { id: 'plan', option_id: 'wall', code: 'wall-plan', name: '壁プラン', note: null, sort_order: 1, is_required: true, status: 'published' },
      {
        id: 'color', option_id: 'wall', code: 'wall-color', name: '壁色', note: null, sort_order: 2, is_required: false,
        status: 'published', depends_on_group_code: 'wall-plan', depends_on_choice_codes: ['accent'],
      },
    ];
    const choices: OptionVariantChoice[] = [
      { id: 'white', group_id: 'plan', code: 'white', name: '全面ホワイト', kind: 'standard', extra_price: 0, price_on_request: false, image_url: null, note: null, sort_order: 1, status: 'published' },
      { id: 'accent', group_id: 'plan', code: 'accent', name: 'アクセント', kind: 'option', extra_price: 0, price_on_request: false, image_url: null, note: null, sort_order: 2, status: 'published' },
      { id: 'paid-hidden', group_id: 'color', code: 'paid-hidden', name: '追加色', kind: 'option', extra_price: 50000, price_on_request: false, image_url: null, note: null, sort_order: 1, status: 'published' },
    ];

    expect(pruneHiddenVariantChoices(groups, choices, ['white', 'paid-hidden'])).toEqual(['white']);
    expect(migration).toContain('VALIDATION: 非表示のバリエーションは保存できません');
    expect(migration).toContain('VALIDATION: 非表示の外壁バリエーションは保存できません');
  });
});
