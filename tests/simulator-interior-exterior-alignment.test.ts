import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const equipmentBoard = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/equipment-board.tsx'),
  'utf8'
);

describe('シミュレーターの内外装工事分類', () => {
  it('屋根・外壁・建具・床・壁天井を内外装工事として扱う', () => {
    for (const code of [
      'roof',
      'exterior-wall',
      'entrance-door',
      'sash',
      'interior-door',
      'carpentry',
      'floor',
      'wall-ceiling',
    ]) {
      expect(equipmentBoard).toContain(`'${code}'`);
    }
    expect(equipmentBoard).toContain("sectionHeader('interior-exterior-heading', '内外装工事')");
    expect(equipmentBoard).not.toContain('既存の内部建具・サッシカテゴリーだけを表示する');
  });
});
