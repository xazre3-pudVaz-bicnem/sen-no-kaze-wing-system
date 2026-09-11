import { describe, expect, it } from 'vitest';
import type { Sheet } from '@/lib/import/archive';
import { parseStandardEstimateWorkbook } from '@/lib/import/estimate-template-import';

function workbookSheet(name = 'ウィング【ホテルUB】'): Sheet {
  const rows: string[][] = Array.from({ length: 40 }, () => []);
  const set = (r: number, col: number, value: string | number) => {
    rows[r - 1][col - 1] = String(value);
  };

  // J1 = 経費率
  set(1, 10, 0.15);

  // 本体: 1,000 + 150 = 1,150
  set(15, 13, '本体');
  set(15, 3, '１．本体工事');
  set(15, 5, '・本体材料');
  set(15, 19, 1);
  set(15, 20, '式');
  set(15, 21, 1000);
  set(15, 22, 1000);
  set(16, 13, '本体諸費用（交通費、労災、安全管理費等）');
  set(16, 22, 150);
  set(17, 13, '【本体価格計】');
  set(17, 22, 1150);

  // 内外装: 2,000 + 300 = 2,300
  set(18, 13, '内外装');
  set(18, 3, '１．内外装工事');
  set(18, 5, '・外壁工事');
  set(18, 19, 1);
  set(18, 20, '式');
  set(18, 21, 2000);
  set(18, 22, 2000);
  set(19, 13, '内外装工事経費');
  set(19, 22, 300);
  set(20, 13, '【内外装価格計】');
  set(20, 22, 2300);

  // オプション: 3,000 + 450 = 3,450
  set(21, 13, 'ｵﾌﾟｼｮﾝ');
  set(21, 3, '１．設備機器');
  set(21, 5, '・ユニットバス');
  set(21, 19, 1);
  set(21, 20, '台');
  set(21, 21, 3000);
  set(21, 22, 3000);
  set(22, 13, 'ｵﾌﾟｼｮﾝ');
  set(22, 3, 'オプション諸費用（交通費、労災、安全管理費等）');
  set(22, 22, 450);
  set(23, 13, '【オプション価格計】');
  set(23, 22, 3450);

  // 別途: 400
  set(24, 13, '別途');
  set(24, 3, '１．運送費');
  set(24, 19, 1);
  set(24, 20, '式');
  set(24, 21, 400);
  set(24, 22, 400);
  set(25, 13, '【別途工事計】');
  set(25, 22, 400);

  // 集計
  set(26, 19, '小　計');
  set(26, 22, 7300);
  set(27, 19, '値引き等調整額');
  set(27, 22, -300);
  set(27, 23, 7000);
  set(28, 19, '消費税');
  set(28, 21, 0.1);
  set(28, 22, 700);
  set(29, 19, '合　計');
  set(29, 22, 7700);

  return { name, rows };
}

describe('標準見積Excelの取込・検算', () => {
  it('4分類を維持し、本体明細だけ base_breakdown_items に分離する', () => {
    const parsed = parseStandardEstimateWorkbook([workbookSheet()]);
    const template = parsed.templates[0];

    expect(template.sections.map((x) => x.code)).toEqual([
      'base',
      'interior_exterior',
      'option',
      'sitework',
    ]);
    expect(template.sections.map((x) => x.total)).toEqual([1150, 2300, 3450, 400]);

    expect(template.base_breakdown_items).toHaveLength(1);
    expect(template.base_breakdown_items[0]).toMatchObject({
      section: '１．本体工事',
      name: '・本体材料',
      unit_price: 1000,
      amount: 1000,
    });
    expect((template.lines.map((x) => x.section_code) as string[])).not.toContain('base');
    expect(template.lines.map((x) => x.section_code)).toEqual([
      'interior_exterior',
      'option',
      'sitework',
    ]);
  });

  it('preset や商品価格に依存せず、Excelの集計値だけで最終金額を検算する', () => {
    const template = parseStandardEstimateWorkbook([workbookSheet()]).templates[0];
    expect(template.subtotal_raw).toBe(7300);
    expect(template.adjustment).toBe(-300);
    expect(template.subtotal).toBe(7000);
    expect(template.tax_rate).toBe(0.1);
    expect(template.tax).toBe(700);
    expect(template.total).toBe(7700);
  });

  it('15%由来の小数金額を切り捨てずExcel記載値のまま保持する', () => {
    const sheet = workbookSheet();
    // 本体明細 1,001円 × 15% = 150.15円。Excel記載値をそのまま正本にする。
    sheet.rows[14][20] = '1001';
    sheet.rows[14][21] = '1001';
    sheet.rows[15][21] = '150.15';
    sheet.rows[16][21] = '1151.15';
    sheet.rows[25][21] = '7301.15';
    sheet.rows[26][21] = '-301.15';
    sheet.rows[26][22] = '7000';

    const template = parseStandardEstimateWorkbook([sheet]).templates[0];
    const base = template.sections.find((row) => row.code === 'base')!;

    expect(base.line_subtotal).toBe(1001);
    expect(base.expense_amount).toBe(150.15);
    expect(base.total).toBe(1151.15);
    expect(template.subtotal_raw).toBe(7301.15);
    expect(template.adjustment).toBe(-301.15);
    expect(template.subtotal).toBe(7000);
    expect(template.total).toBe(7700);
  });

  it('本体明細に1円未満がある場合は暗黙に丸めず登録を止める', () => {
    const sheet = workbookSheet();
    sheet.rows[14][20] = '1000.5';
    sheet.rows[14][21] = '1000.5';
    sheet.rows[15][21] = '150.075';
    sheet.rows[16][21] = '1150.575';

    expect(() => parseStandardEstimateWorkbook([sheet])).toThrow('Excel記載値を保持できないため登録を中止しました');
  });

  it('防火シートは今回の対象外として読み飛ばす', () => {
    const parsed = parseStandardEstimateWorkbook([
      workbookSheet(),
      workbookSheet('【防火】ウィング【ホテルUB】'),
    ]);
    expect(parsed.templates).toHaveLength(1);
    expect(parsed.ignoredSheets).toContain('【防火】ウィング【ホテルUB】');
  });

  it('分類合計がExcelの小計と一致しない場合は登録前に止める', () => {
    const sheet = workbookSheet();
    sheet.rows[25][21] = '7301';
    expect(() => parseStandardEstimateWorkbook([sheet])).toThrow('4分類の合計が小計と一致しません');
  });
});
