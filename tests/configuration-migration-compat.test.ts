import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const insulationSql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260830041000_independent_insulation.sql'),
  'utf8'
);
const exteriorSql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260830091000_exterior_four_faces.sql'),
  'utf8'
);
const simulatorSource = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/simulator-app.tsx'),
  'utf8'
);
const dialogSource = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/exterior-wall-faces-dialog.tsx'),
  'utf8'
);

describe('本番migration前のConfiguration互換', () => {
  it('旧有料断熱を選択したWing Draftがあれば自動変換せずmigrationを停止する', () => {
    expect(insulationSql).toContain("cfg.status = 'draft'");
    expect(insulationSql).toContain("o.code = 'insulation-upgrade-wing'");
    expect(insulationSql).toContain('MIGRATION_BLOCKED: Wing Draftに旧有料断熱');
  });

  it('Wing Draftだけに仕様別の標準0円断熱3項目を補完する', () => {
    expect(insulationSql).toContain("b.slug = 'wing-01'");
    expect(insulationSql).toContain("cfg.status = 'draft'");
    expect(insulationSql).toContain("b.presets -> 0 ->> 'code'");
    expect(insulationSql).toContain("'insulation-floor-mirafoam-90'");
    expect(insulationSql).toContain("'insulation-wall-styrofoam-90-hotel-base'");
    expect(insulationSql).toContain("'insulation-wall-glasswool-90-standard'");
    expect(insulationSql).toContain("'insulation-ceiling-styrofoam-90-hotel-base'");
    expect(insulationSql).toContain("'insulation-ceiling-glasswool-90-standard'");
    expect(insulationSql).not.toMatch(/update\s+public\.configurations[\s\S]*set\s+(base_price|subtotal|total)/i);
    expect(insulationSql).not.toContain('configuration_snapshots');
  });

  it('判定不能なWing Draft specは推測せずmigrationを停止する', () => {
    expect(insulationSql).toContain("not in ('hotel', 'residence', 'office')");
    expect(insulationSql).toContain('MIGRATION_BLOCKED: Wing Draftに断熱標準を自動判定できないspec_code');
  });

  it('外壁migrationは既存Configurationを4面へ自動変換しない', () => {
    expect(exteriorSql).toContain("add column if not exists exterior_faces jsonb not null default '[]'::jsonb");
    expect(exteriorSql).not.toMatch(/update\s+public\.configurations[\s\S]*set\s+exterior_faces/i);
    expect(exteriorSql).not.toMatch(/insert\s+into\s+public\.configuration_snapshots/i);
  });

  it('spec未設定の旧Configurationでも保存済みoption_idsを初期選択として維持する', () => {
    expect(simulatorSource).toContain('const preserveLegacyInitialSelection =');
    expect(simulatorSource).toContain('Boolean(initial) && (Boolean(validInitialSpecCode) || !initial?.spec_code);');
    expect(simulatorSource).toContain('? (initial?.option_ids ?? initialBaselineIds)');
  });

  it('保存済みexterior_faces=[]は明示変更まで[]を維持する', () => {
    expect(simulatorSource).toContain('if (initial.exterior_faces.length === 0) return [];');
    expect(simulatorSource).toContain('外壁を明示変更するまで [] を維持');
  });

  it('保存済みlegacy外壁は復元可能だが、新規選択候補はcurrentだけに限定する', () => {
    expect(simulatorSource).toContain('options={allExteriorWallOptions}');
    expect(simulatorSource).toContain('selectableOptions={exteriorWallOptions}');
    expect(dialogSource).toContain('const availableOptions = selectableOptions ?? options;');
    expect(dialogSource).toContain('normalizeExteriorFaces(current, options');
    expect(dialogSource).toContain('options={availableOptions}');
  });
});
