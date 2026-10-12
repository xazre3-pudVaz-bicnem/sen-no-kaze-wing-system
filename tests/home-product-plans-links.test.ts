import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const productShowcase = fs.readFileSync(path.join(root, 'components/sections/product-showcase.tsx'), 'utf8');
const estimateCta = fs.readFileSync(path.join(root, 'components/sections/estimate-cta.tsx'), 'utf8');

describe('トップの商品導線', () => {
  it('Wing・BOX・Flatの商品ボタンを仕様・間取りページの該当モデルへつなぐ', () => {
    expect(productShowcase).toContain("p.slug === 'wing-01' ? 'Wing' : p.slug === 'box' ? 'BOX' : 'Flat'");
    expect(productShowcase).toContain('href={`/plans#model-${p.slug}`}');
    expect(productShowcase).toContain('の仕様・間取りを見る');
    expect(productShowcase).not.toContain('href={`/simulator/${p.slug}`}');
  });

  it('共通の概算見積導線は各モデルのシミュレーター直行を維持する', () => {
    expect(estimateCta).toContain('href={`/simulator/${b.slug}`}');
  });
});
