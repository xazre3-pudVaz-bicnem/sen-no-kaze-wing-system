import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const simulatorPage = fs.readFileSync(path.join(root, 'app/(site)/simulator/[slug]/page.tsx'), 'utf8');
const entryHelper = fs.readFileSync(path.join(root, 'lib/domain/simulator-entry.ts'), 'utf8');

describe('平面図からシミュレーターへの仕様指定導線', () => {
  it('spec queryを受け取り、保存済みConfigurationがない場合だけ新規初期状態へ使う', () => {
    // plan は、ログインなしの一時保存（URL）から開くとき（フェーズ2）
    expect(simulatorPage).toContain("type Search = Promise<{ c?: string; resume?: string; spec?: string; preview?: string; plan?: string }>");
    expect(simulatorPage).toContain('const [{ slug }, { c, resume, spec, preview, plan }]');
    expect(simulatorPage).toContain('if (c) {');
    expect(simulatorPage).toContain('} else if (spec) {');
    // v2.5 の売価を使う間は、標準の選択肢を標準見積の選択枠の選択肢にする（v2.5 PR-C1）
    expect(simulatorPage).toContain('const entry = buildSimulatorEntryState(');
    expect(simulatorPage).toContain('? (specCode, optionIds) =>');
    expect(simulatorPage.indexOf('if (c) {')).toBeLessThan(simulatorPage.indexOf('} else if (spec) {'));
    expect(simulatorPage.indexOf('if (c) {')).toBeLessThan(simulatorPage.indexOf('} else if (plan) {'));
  });

  it('仕様指定は既存の標準構成ロジックを再利用し、未知のspecは無視する', () => {
    expect(entryHelper).toContain('simulatorEstimateChoices(model, estimateTemplates).find');
    expect(entryHelper).toContain('if (!choice) return null');
    expect(entryHelper).toContain('buildEstimateBaselineSelection');
    expect(entryHelper).toContain('buildPresetSelection');
    expect(entryHelper).toContain('buildEstimateSpecSelection');
    expect(entryHelper).toContain('finishLevelForEstimateSpec');
    expect(entryHelper).toContain('normalizeWashbasinSelection');
    expect(entryHelper).toContain('defaultVariantIdsFor');
    expect(entryHelper).toContain('normalizeExteriorFaces');
  });

  it('URL指定の初期状態は保存済みIDを持たない新規Draftとして渡す', () => {
    expect(simulatorPage).toContain('id: null as never');
    expect(simulatorPage).toContain("status: 'draft'");
    expect(simulatorPage).toContain('spec_code: entry.spec_code');
    expect(simulatorPage).toContain('option_ids: entry.option_ids');
    expect(simulatorPage).toContain('variant_choice_ids: entry.variant_choice_ids');
    expect(simulatorPage).toContain('exterior_faces: entry.exterior_faces');
  });
});
