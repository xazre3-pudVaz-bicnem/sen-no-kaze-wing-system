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

  it('旧外壁はDraftだけ既存1商品を4面へ複製し正式履歴は変更しない', () => {
    expect(exteriorSql).toContain("cfg.status = 'draft'");
    expect(exteriorSql).toContain("cat.code = 'exterior-wall'");
    expect(exteriorSql).toContain("cfg.exterior_faces = '[]'::jsonb");
    for (const face of ['front', 'right', 'back', 'left']) {
      expect(exteriorSql).toContain(`'face_code', '${face}'`);
    }
    expect(exteriorSql).not.toMatch(/cfg\.status\s+in\s*\([^)]*(quote_requested|closed)/i);
  });

  it('複数旧外壁があるDraftは勝手に1つへ決めずmigrationを停止する', () => {
    expect(exteriorSql).toContain('having count(*) > 1');
    expect(exteriorSql).toContain('MIGRATION_BLOCKED: 1つのDraftに複数の旧外壁商品');
  });

  it('保存済みConfigurationはlegacy外壁を復元し、新規選択候補だけcurrentへ限定する', () => {
    expect(simulatorSource).toContain('const initialExteriorWallOptions = initial ? allExteriorWallOptions : exteriorWallOptions;');
    expect(simulatorSource).toContain('options={allExteriorWallOptions}');
    expect(simulatorSource).toContain('selectableOptions={exteriorWallOptions}');
    expect(dialogSource).toContain('const availableOptions = selectableOptions ?? options;');
    expect(dialogSource).toContain('options={availableOptions}');
  });
});
