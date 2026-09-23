import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const simulatorApp = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/simulator-app.tsx'),
  'utf8'
);
const adminPreview = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/standard-estimate-simulator-preview.tsx'),
  'utf8'
);

describe('プランボード表示幅', () => {
  it('シミュレーターのプランボードと設備表を読みやすい最大幅に揃える', () => {
    expect(simulatorApp).toContain('container-x max-w-5xl pt-6 pb-2');
    expect(simulatorApp).toContain('container-x max-w-5xl space-y-4 pt-3 pb-2');
  });

  it('標準見積管理画面のプランボードも同じ最大幅に揃える', () => {
    expect(adminPreview).toContain('card mx-auto w-full max-w-5xl overflow-hidden');
  });
});
