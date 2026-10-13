import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INITIAL_RATES, MAPPING_SHEET, buildRegistrationPlan } from '../scripts/initial-registration/plan.ts';
import { readXlsx, type CellValue, type Sheet } from '../scripts/lib/read-xlsx.ts';
import { baseLineMoney, lineMoney, revisionMoney, sectionMoney } from '@/lib/domain/standard-estimate-money';

const root = process.cwd();

/** 確定資料と同じ列の並び（A 元シート … V 元備考）の、検査用の小さなシート */
function sheet(rows: Array<Record<string, CellValue>>): Sheet[] {
  const header: Record<string, CellValue> = { A: '元シート', C: '本体', G: '初期対象', Q: '業務分類', T: '初期登録アクション' };
  return [{ name: MAPPING_SHEET, rows: Object.fromEntries([header, ...rows].map((cells, i) => [String(i + 1), cells])) }];
}

const combo = { A: 'ウィング【ホテルUB】', C: 'Wing', D: 'ホテル仕様', E: '3,640×4,550', F: '非防火', G: '初期登録対象' };

describe('初期登録の計画：確定資料の規則', () => {
  const plan = buildRegistrationPlan(
    sheet([
      { ...combo, H: '本体', I: '１．金物関係費用', J: '・単管パイプ2.5m', L: '・単管パイプ2.5m', M: 12, N: '本', O: 1349, P: 16188, Q: 'Base Master', T: '初期Revisionへ登録' },
      // 項目の見出しが無い行は直前の項目を引き継ぐ
      { ...combo, J: '・ジャッキベース', L: '・ジャッキベース', M: 12, N: '本', O: 2500, P: 30000, Q: 'Base Master', T: '初期Revisionへ登録' },
      { ...combo, H: '内外装', I: '１．サッシ木製建具工事', J: '・サッシ', K: '玄関ドア', L: '・サッシ / 玄関ドア', M: 1, N: '台', O: 180000, P: 180000, Q: '標準見積／内外装', T: '初期Revisionへ登録' },
      // 登録名が空の行は、直前の明細名と補助表記をつなぐ
      { ...combo, K: '勝手口ドア', M: 1, N: '台', O: 180000, P: 180000, Q: '標準見積／内外装', T: '初期Revisionへ登録' },
      // 0 円の内訳はそのまま登録する
      { ...combo, I: '２．屋根工事', J: '・屋根ガルバニュウム鋼板', L: '・屋根ガルバニュウム鋼板', M: 23.5, N: 'ｍ', O: 0, P: 0, Q: '標準見積／内外装', T: '初期Revisionへ登録' },
      // 登録しない行：数量 0・率計算の経費・集計・案件見積側・分類表 ×
      { ...combo, J: '・物入れ', L: '・物入れ', M: 0, O: 30000, P: 0, Q: '標準見積／内外装', T: '初期Revision登録しない（数量0）' },
      { ...combo, J: '本体諸費用', L: '本体諸費用', M: 1, P: 117622.05, Q: '登録しない', T: '率計算（本体経費）' },
      { ...combo, L: '【本体価格計】', P: 901769.05, Q: '登録しない', T: '集計・照合用' },
      { ...combo, J: '・現場運送', L: '・現場運送', M: 1, O: 50000, P: 50000, Q: '案件見積側', T: '標準見積へ登録しない' },
      { ...combo, J: '・下駄箱', L: '・下駄箱', M: 1, O: 30000, P: 30000, Q: '標準見積／オプション', T: '標準見積へ登録しない（分類表×）' },
      // 仮設定は備考に残す
      { ...combo, I: '３．本体電気配線工事', J: '・電気配線', L: '・電気配線', M: 2, N: '人', O: 30000, P: 60000, Q: '標準見積／オプション', T: '初期Revisionへ登録（仮設定）', U: '仮設定：Wing標準値に合わせて設定。BOX実績確認後に見直す。' },
      // 参考シート（初期対象ではない）は登録しない
      { ...combo, A: 'ウィング【本体】', G: 'Base Master参考', I: '１．金物関係費用', L: '・参考', M: 1, O: 1, P: 1, Q: 'Base Master', T: '初期Revisionへ登録' },
    ])
  );
  const [only] = plan.combos;

  it('初期対象・初期 Revision へ登録する行だけを、本体マスターと標準見積へ振り分ける', () => {
    expect(plan.issues).toEqual([]);
    expect(plan.combos).toHaveLength(1);
    expect(only).toMatchObject({ model_slug: 'wing-01', spec_code: 'hotel', size_code: '3640x4550', fire_spec_code: 'non_fire' });
    expect(only.base_lines.map((line) => [line.section, line.name, line.unit_price])).toEqual([
      ['１．金物関係費用', '・単管パイプ2.5m', 1349],
      ['１．金物関係費用', '・ジャッキベース', 2500],
    ]);
    expect(only.estimate_lines.map((line) => [line.section_code, line.name, line.cost_unit_price])).toEqual([
      ['interior_exterior', '・サッシ / 玄関ドア', 180000],
      ['interior_exterior', '・サッシ / 勝手口ドア', 180000],
      ['interior_exterior', '・屋根ガルバニュウム鋼板', 0],
      ['option', '・電気配線', 30000],
    ]);
  });

  it('単価は原価（案 A）として auto で登録し、仮設定の行は備考に残す', () => {
    expect(INITIAL_RATES).toEqual({ salesFeeRate: '1.0000', expenseRate: '0.1500', markupRate: '1.5000', taxRate: '0.10' });
    expect(only.estimate_lines.every((line) => line.price_mode === 'auto')).toBe(true);
    expect(only.estimate_lines.find((line) => line.name === '・電気配線')?.remark).toBe('仮設定：Wing標準値に合わせて設定。BOX実績確認後に見直す。');
    expect(only.estimate_lines.find((line) => line.name === '・屋根ガルバニュウム鋼板')?.remark).toBeNull();
  });

  it('計画の金額は、DB と同じ式（画面の試算）で計算している', () => {
    const rates = INITIAL_RATES;
    const base = sectionMoney([baseLineMoney(1349, '12', rates), baseLineMoney(2500, '12', rates)], 'rate', rates);
    const interior = sectionMoney(
      [180000, 180000, 0].map((cost, i) => lineMoney({ mode: 'auto', quantity: i === 2 ? '23.5' : '1', costUnitPrice: cost }, rates)),
      'rate',
      rates
    );
    const option = sectionMoney([lineMoney({ mode: 'auto', quantity: '2', costUnitPrice: 30000 }, rates)], 'rate', rates);
    const money = revisionMoney([base, interior, option, sectionMoney([], 'none', rates)], 0, rates);
    expect(only.expected).toEqual({
      base_cost_line_subtotal: base.costLineSubtotal,
      subtotal: money.subtotal,
      tax: money.tax,
      total: money.total,
      cost_total: money.costTotal,
    });
  });

  it('整数でない単価・判定できない仕様は問題として返し、登録しない', () => {
    const bad = buildRegistrationPlan(
      sheet([
        { ...combo, I: '１．金物', L: '・小数', M: 1, O: 1349.5, P: 1349.5, Q: 'Base Master', T: '初期Revisionへ登録' },
        { ...combo, D: '倉庫用', I: '１．金物', L: '・不明な仕様', M: 1, O: 100, P: 100, Q: 'Base Master', T: '初期Revisionへ登録' },
      ])
    );
    expect(bad.issues).toHaveLength(2);
    expect(bad.combos.flatMap((c) => c.base_lines)).toEqual([]);
  });
});

const xlsx = path.join(root, 'assets/source-docs/標準見積_初期登録候補整理_初期登録確認完了_20261008.xlsx');

describe.skipIf(!fs.existsSync(xlsx))('初期登録の計画：確定資料（手元にあるときだけ。CI には置かない）', () => {
  it('10 組み合わせ（統合版 §11-1）がそろい、問題が無い', () => {
    const plan = buildRegistrationPlan(readXlsx(xlsx));
    expect(plan.issues).toEqual([]);
    expect(plan.combos.map((c) => c.key)).toEqual([
      'box/hotel/2100x4550/non_fire',
      'box/water-kit/2100x4550/fire',
      'box/water-kit/2100x4550/non_fire',
      'flat/office/2100x4550/non_fire',
      'wing-01/hotel/3640x4550/fire',
      'wing-01/hotel/3640x4550/non_fire',
      'wing-01/office/3640x4550/fire',
      'wing-01/office/3640x4550/non_fire',
      'wing-01/residence/3640x4550/fire',
      'wing-01/residence/3640x4550/non_fire',
    ]);
  });
});
