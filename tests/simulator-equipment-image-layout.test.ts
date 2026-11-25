import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'components/simulator/equipment-board.tsx'),
  'utf8'
);

describe('シミュレーター商品カードの画像表示', () => {
  it('通常商品と位置別商品の両方で画像全体を切り抜かずに表示する', () => {
    expect(source.match(/<SmartImage\b/g)).toHaveLength(2);
    expect(source.match(/className="object-contain p-1\.5"/g)).toHaveLength(2);
    expect(source).not.toContain('className="object-cover"');
    expect(source.match(/alt=\{main\.name\}/g)).toHaveLength(2);
  });

  it('PC・スマートフォンで両カードの画像枠と余白を揃える', () => {
    const frameClass = 'relative block h-24 w-full overflow-hidden rounded border border-line/60 bg-white sm:h-28';
    expect(source.split(frameClass)).toHaveLength(3);
    expect(source.match(/className="block min-h-24 w-full p-1\.5 sm:p-2"/g)).toHaveLength(2);
  });

  it('商品選択と標準・変更済の表示を維持する', () => {
    expect(source).toContain('onClick={() => onPickSlot?.(tile.slotCode)}');
    expect(source).toContain('onClick={() => onPickCategory(cat.id)}');
    expect(source).toContain("label: '標準'");
    expect(source).toContain("label: '変更済'");
    expect(source).toContain('data-testid={`equip-slot-state-${tile.slotCode}`}');
    expect(source).toContain('data-testid={`equip-state-${cat.code}`}');
  });
});
