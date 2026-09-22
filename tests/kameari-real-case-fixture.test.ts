import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalog } from '../lib/seed/catalog';

const root = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function seedFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-kameari-case-'));
  tempDirs.push(dir);
  execFileSync(process.execPath, ['scripts/seed-kameari-case.ts'], {
    cwd: root,
    env: { ...process.env, WING_LOCAL_DIR: dir },
    stdio: 'pipe',
  });
  return JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
}

describe('亀有実受注案件ローカルfixture', () => {
  it('受注済みBOX 2台案件を案件管理用データとして作成する', () => {
    const db = seedFixture();
    expect(db.quotes).toHaveLength(1);
    const quote = db.quotes[0];
    expect(quote.quote_no).toBe('TEST-KAMEARI-20260920');
    expect(quote.status).toBe('accepted');
    expect(quote.customer_company).toBe('株式会社 パパマハロ');
    expect(quote.customer_name).toBe('伊藤 史織');
    expect(quote.base_model_name).toBe('BOX');
    expect(quote.total).toBe(9_196_000);
    expect(quote.subtotal).toBe(8_360_000);
    expect(quote.tax).toBe(836_000);
    expect(quote.adjustment).toBe(-9_798);
  });

  it('原見積の4分類と2台合計が内部でも一致する', () => {
    const db = seedFixture();
    const sum = (kind: string) =>
      db.quoteItems.filter((item: { kind: string }) => item.kind === kind)
        .reduce((total: number, item: { amount: number }) => total + item.amount, 0);

    expect(sum('base')).toBe(1_205_898);
    expect(sum('base_expense')).toBe(180_884);
    expect(sum('interior_exterior')).toBe(2_202_588);
    expect(sum('interior_exterior_expense')).toBe(330_388);
    expect(sum('option')).toBe(1_904_000);
    expect(sum('option_expense')).toBe(285_600);
    expect(sum('installation')).toBe(2_260_440);

    const raw =
      sum('base') +
      sum('base_expense') +
      sum('interior_exterior') +
      sum('interior_exterior_expense') +
      sum('option') +
      sum('option_expense') +
      sum('installation');
    expect(raw).toBe(8_369_798);
  });

  it('保存Configurationへ防火・設備・外壁4面・設置地を持たせる', () => {
    const db = seedFixture();
    const configuration = db.configurations[0];
    expect(configuration.base_model_id).toBe('10000000-0000-4000-8000-000000000002');
    expect(configuration.spec_code).toBe('hotel-single');
    expect(configuration.status).toBe('closed');
    expect(configuration.site_prefecture).toBe('東京都');
    expect(configuration.site_municipality).toBe('葛飾区');
    expect(configuration.exterior_faces).toHaveLength(4);

    const selectedCodes = new Set(
      db.configurationItems.map((item: { option_id: string }) =>
        seedCatalog.options.find((option) => option.id === item.option_id)?.code
      )
    );
    expect(selectedCodes).toContain('fire-proof');
    expect(selectedCodes).toContain('shower-unit-1116');
    expect(selectedCodes).toContain('mini-kitchen');
    expect(selectedCodes).toContain('exterior-galnote');
  });

  it('案件依頼に実際の設置地と都市計画条件を保持する', () => {
    const db = seedFixture();
    const request = db.quoteRequests[0];
    expect(request.status).toBe('closed');
    expect(request.contact.site_address).toBe('東京都葛飾区亀有2丁目39-8');
    expect(request.message).toContain('第一種住居地域');
    expect(request.message).toContain('準防火地域');
    expect(request.message).toContain('建蔽率60%');
    expect(request.message).toContain('容積率200%');
  });

  it('切り出した平面図・立面図4面と元資料情報を案件資料として保持する', () => {
    const db = seedFixture();
    expect(db.caseDocuments).toHaveLength(9);
    const previews = db.caseDocuments.filter((row: { preview_url: string | null }) => row.preview_url);
    expect(previews).toHaveLength(5);
    expect(previews.map((row: { title: string }) => row.title)).toEqual([
      '1階・2階 平面図',
      '南側立面図',
      '東側立面図',
      '西側立面図',
      '北側立面図',
    ]);
    expect(previews.every((row: { url: string | null }) => row.url?.startsWith('/images/cases/kameari-test/'))).toBe(true);

    const latestEstimate = db.caseDocuments.find(
      (row: { kind: string; is_latest: boolean; title: string }) => row.kind === 'estimate' && row.is_latest
    );
    expect(latestEstimate.title).toBe('見積書');
    expect(latestEstimate.document_date).toBe('2026-09-20');
    expect(latestEstimate.url).toBeNull();

    const siteDocs = db.caseDocuments.filter((row: { kind: string }) => row.kind === 'site');
    expect(siteDocs.map((row: { title: string }) => row.title)).toEqual(['配置・敷地図', '都市計画情報']);
  });

  it('担当者と顧客を実案件名で表示できる', () => {
    const db = seedFixture();
    const customer = db.profiles.find((profile: { role_code: string }) => profile.role_code === 'customer');
    const dealer = db.profiles.find((profile: { role_code: string }) => profile.role_code === 'master_dealer');
    expect(customer.full_name).toBe('伊藤 史織');
    expect(customer.company_name).toBe('株式会社 パパマハロ');
    expect(dealer.full_name).toBe('千代川');
    expect(dealer.company_name).toBe('株式会社 技術の杜');
    expect(db.quotes[0].dealer_id).toBe(dealer.id);
  });
});
