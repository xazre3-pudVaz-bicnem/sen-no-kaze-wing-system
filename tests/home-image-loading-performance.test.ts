import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const hero = fs.readFileSync(path.join(root, 'components/sections/home-hero.tsx'), 'utf8');
const foldingTech = fs.readFileSync(path.join(root, 'components/sections/folding-tech.tsx'), 'utf8');

describe('トップページ画像の初期表示最適化', () => {
  it('最初のヒーロー画像だけを優先し、後続画像は低優先度で遅延読込する', () => {
    expect(hero).toContain('fill priority sizes="100vw"');
    expect(hero).toContain('loading="lazy"');
    expect(hero).toContain('fetchPriority="low"');
    expect(hero).toContain('quality={75}');
    expect(hero.match(/\bpriority\b/g)).toHaveLength(1);
  });

  it('大型の折畳み図はNext Image最適化を無効化しない', () => {
    expect(foldingTech).not.toContain('unoptimized');
    expect(foldingTech).toContain('src="/images/elevation/wing-folded-composition.png"');
    expect(foldingTech).toContain('src="/images/transport/wing-expanded-composition.png"');
    expect(foldingTech.match(/quality=\{90\}/g)).toHaveLength(2);
  });
});
