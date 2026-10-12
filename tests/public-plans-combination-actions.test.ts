import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');

describe('公開プランの組み合わせ例', () => {
  it('組み合わせ平面図も単体平面図と同じImageLightboxでページ内拡大する', () => {
    expect(plansPage).toContain('title={`${combination.name}の組み合わせ平面図`}');
    expect(plansPage).toContain('src={combination.image}');
    expect(plansPage).toContain('triggerImageClassName="object-contain p-2 transition hover:opacity-90"');
    expect(plansPage).not.toContain('target="_blank"');
  });

  it('各カード内にリンクを置かず、カード群の下に共通問い合わせ導線を置く', () => {
    expect(plansPage).toContain('<ButtonLink href="/contact" size="sm">');
    expect(plansPage).toContain('組み合わせについて問い合わせる');
    expect(plansPage).not.toContain('この組み合わせについて相談する');
    expect(plansPage).not.toContain('href={`#model-${slug}`}');
    expect(plansPage).not.toContain('この組み合わせで見積する');
  });
});
