import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const globals = fs.readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8');
const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-excel-demo.tsx'),
  'utf8'
);

describe('本体マスター仕様マトリクスの固定列', () => {
  it('PC幅では左5列をstickyにし、スマホでは固定しない', () => {
    expect(demo).toContain('min-w-[118rem]');
    expect(globals).toContain('@media (min-width: 1024px)');
    expect(globals).toContain("table[class*='min-w-[118rem]'] thead th:nth-child(-n + 5)");
    expect(globals).toContain("table[class*='min-w-[118rem]'] tbody td:nth-child(-n + 5)");
    expect(globals).toContain('position: sticky');
  });

  it('本体・用途・サイズ・非防火・防火の5列を重ならない位置へ固定する', () => {
    for (const [column, left] of [
      [1, '0'],
      [2, '6rem'],
      [3, '14rem'],
      [4, '22rem'],
      [5, '27rem'],
    ] as const) {
      expect(globals).toContain(`th:nth-child(${column})`);
      expect(globals).toContain(`td:nth-child(${column})`);
      expect(globals).toContain(`left: ${left};`);
    }

    expect(globals).toContain('box-shadow: 4px 0 6px -4px');
  });
});
