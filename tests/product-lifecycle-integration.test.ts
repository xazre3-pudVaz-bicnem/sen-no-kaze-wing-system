import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8');

const migration = read('supabase/migrations/20261015100000_product_lifecycle_visibility.sql');
const publicCatalog = read('lib/data/public-catalog.ts');
const lifecycle = read('lib/domain/product-lifecycle.ts');
const newQuote = read('app/admin/quotes/new/page.tsx');
const quoteRevision = read('app/admin/quotes/[id]/edit/page.tsx');
const standardEstimate = read('app/admin/estimate-templates/page.tsx');
const newStandardEstimate = read('app/admin/estimate-templates/new/page.tsx');
const actions = read('lib/actions/product-lifecycle.ts');

describe('商品ライフサイクルの接続', () => {
  it('DBは取扱状態とシミュレーター表示を別項目で持つ', () => {
    expect(migration).toContain('simulator_visible boolean not null default true');
    expect(migration).toContain('archived_at timestamptz');
    expect(migration).toContain('options_archived_requires_published_chk');
  });

  it('顧客ConfigurationはUIを迂回しても非表示・取扱終了商品を新規保存・提出できない', () => {
    expect(migration).toContain('configuration_items_option_lifecycle_guard');
    expect(migration).toContain('configurations_exterior_face_lifecycle_guard');
    expect(migration).toContain('configurations_lifecycle_submit_guard');
    expect(migration).toContain('not coalesce(v_simulator_visible, true)');
    expect(migration).toContain('v_archived_at is not null');
    expect(migration).toContain('not coalesce(o.simulator_visible, true)');
    expect(migration).toContain('o.archived_at is not null');
  });

  it('お客様向け公開カタログはシミュレーター表示対象だけにする', () => {
    expect(publicCatalog).toContain('isOptionVisibleInSimulator');
    expect(publicCatalog).toContain('.filter((option) =>');
    expect(publicCatalog).toContain('isOptionVisibleInSimulator(option as ProductLifecycleOption)');
  });

  it('登録済み・取扱中の商品だけを見積の商品候補にする', () => {
    for (const source of [newQuote, quoteRevision, standardEstimate, newStandardEstimate]) {
      expect(source).toContain('isOptionAvailableForEstimate');
    }
  });

  it('現行標準・legacy標準・依存関係で使用中ならシミュレーターから外さない', () => {
    expect(actions).toContain('standard_estimate_revision_baseline_items');
    expect(actions).toContain('current_published_revision_id');
    expect(actions).toContain("from('estimate_templates').select('id, baseline_option_ids')");
    expect(actions).toContain("from('option_dependencies')");
    expect(actions).toContain("assertOptionCanLeaveSimulator(optionId, 'シミュレーター非表示に')");
    expect(actions).toContain("assertOptionCanLeaveSimulator(optionId, '取扱終了に')");
  });

  it('legacy Presetの古いcodeだけでは取扱終了を止めず、現在の候補集合から安全に読み飛ばす', () => {
    expect(actions).not.toContain("from('base_models').select('presets')");
    expect(lifecycle).toContain('Presetに古いoption codeが残っていても');
    expect(lifecycle).toContain('buildPresetSelection() はctx.optionsに無いcodeを読み飛ばす');
  });
});
