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
const planBoard = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/plan-board.tsx'),
  'utf8'
);
const previewStage = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/preview-stage.tsx'),
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

  it('768px以上では平面図と完成イメージを横並びにする', () => {
    expect(simulatorApp).toContain('md:grid-cols-2 md:items-stretch md:gap-0');
    expect(adminPreview).toContain('md:grid-cols-2 md:items-stretch md:gap-0');
    expect(previewStage).toContain('md:-ml-px md:rounded-none');
    expect(planBoard).toContain('md:rounded-none');
  });

  it('768px以上では立面図4面を1列に並べる', () => {
    expect(planBoard).toContain('md:grid-cols-2');
    expect(planBoard).toContain('md:border-t-0 md:border-l');
    expect(planBoard).toContain('md:-mt-px md:rounded-none');
  });
});
