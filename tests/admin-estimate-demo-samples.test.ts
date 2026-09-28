import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const index = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-demo-samples.ts'),
  'utf8'
);
const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/estimate-template-excel-demo.tsx'),
  'utf8'
);
const page = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/page.tsx'),
  'utf8'
);

const sampleFiles = [
  'estimate-template-demo-sample-wing-hotel.ts',
  'estimate-template-demo-sample-wing-single.ts',
  'estimate-template-demo-sample-wing-office.ts',
  'estimate-template-demo-sample-box-hotel-single.ts',
  'estimate-template-demo-sample-flat-office.ts',
].map((name) => fs.readFileSync(path.resolve(process.cwd(), 'components/admin', name), 'utf8'));

describe('見積書作成画面のExcelサンプル', () => {
  it('添付Excelから選んだ5件を作成済み見積書として選べる', () => {
    expect(index).toContain('WingHotelSample');
    expect(index).toContain('WingSingleSample');
    expect(index).toContain('WingOfficeSample');
    expect(index).toContain('BoxHotelSingleSample');
    expect(index).toContain('FlatOfficeSample');
    expect(page).toContain('EXCELサンプル');
    expect(page).toContain('sampleEstimateHref(sample.id)');
    expect(page).toContain('Badge tone="neutral">サンプル');
  });

  it('5件とも添付Excel名・シート名・税込合計を保持する', () => {
    const joined = sampleFiles.join('\n');
    expect(joined).toContain('20260901修正分類表見積書(20260928-231007).xlsx');
    expect(joined).toContain('"sourceSheet":"ウィング【ホテルUB】"');
    expect(joined).toContain('"sourceTotal":7389800.1');
    expect(joined).toContain('"sourceSheet":"ウィング【単身者用】"');
    expect(joined).toContain('"sourceTotal":6139099.9');
    expect(joined).toContain('"sourceSheet":"ウィング【事務所】"');
    expect(joined).toContain('"sourceTotal":3181200.3');
    expect(joined).toContain('"sourceSheet":"BOX（ホテル単身者）"');
    expect(joined).toContain('"sourceTotal":3812600');
    expect(joined).toContain('"sourceSheet":"フラット (物置事務所)"');
    expect(joined).toContain('"sourceTotal":1732500');
  });

  it('画面確認用の集約行を明示し、DB保存しないことを表示する', () => {
    const joined = sampleFiles.join('\n');
    expect(joined).toContain('その他明細（Excel原本');
    expect(joined).toContain('画面確認用にExcel原本の残り明細を集約');
    expect(demo).toContain('DBには保存されません');
    expect(demo).toContain('Excel原本 税込合計');
    expect(demo).toContain("sample ? 0 : 15");
  });
});
