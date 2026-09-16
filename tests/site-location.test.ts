import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PREFECTURES } from '@/lib/domain/address';
import { isKnownMunicipality, municipalitiesFor } from '@/data/japan-municipalities';
import { saveConfigurationSchema } from '@/lib/validation';

const migrationSql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260916084500_configuration_site_location.sql'),
  'utf8'
);

describe('シミュレーター設置予定地', () => {
  it('47都道府県すべてに市区町村候補がある', () => {
    expect(PREFECTURES).toHaveLength(47);
    for (const prefecture of PREFECTURES) {
      expect(municipalitiesFor(prefecture).length).toBeGreaterThan(0);
    }
  });

  it('都道府県ごとに市区町村を絞り込める', () => {
    expect(municipalitiesFor('石川県')).toContain('金沢市');
    expect(isKnownMunicipality('石川県', '金沢市')).toBe(true);
    expect(isKnownMunicipality('東京都', '金沢市')).toBe(false);
  });

  it('設置予定地をConfiguration保存入力として受け付ける', () => {
    const parsed = saveConfigurationSchema.safeParse({
      id: null,
      base_model_id: '11111111-1111-4111-8111-111111111111',
      name: 'Wing の仕様',
      option_ids: [],
      preview_image_url: null,
      notes: null,
      finish_level: 'full',
      variant_choice_ids: [],
      spec_code: 'hotel',
      site_prefecture: '石川県',
      site_municipality: '金沢市',
      site_location_undecided: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('存在しない都道府県は保存入力で拒否する', () => {
    const parsed = saveConfigurationSchema.safeParse({
      id: null,
      base_model_id: '11111111-1111-4111-8111-111111111111',
      name: 'Wing の仕様',
      option_ids: [],
      preview_image_url: null,
      notes: null,
      finish_level: 'full',
      variant_choice_ids: [],
      spec_code: 'hotel',
      site_prefecture: '存在しない県',
      site_municipality: null,
      site_location_undecided: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('migrationは設置予定地のadditive columnだけを追加し、価格RPCを変更しない', () => {
    expect(migrationSql).toContain('add column if not exists site_prefecture text');
    expect(migrationSql).toContain('add column if not exists site_municipality text');
    expect(migrationSql).toContain('add column if not exists site_location_undecided boolean not null default false');
    expect(migrationSql).toContain('configurations_site_location_consistency');
    expect(migrationSql).not.toContain('create or replace function public.save_configuration');
    expect(migrationSql).not.toMatch(/update\s+public\.configurations/i);
  });
});
