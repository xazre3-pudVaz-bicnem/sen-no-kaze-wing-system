import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');

describe('Simulator 保存・見積依頼のレスポンシブ表示', () => {
  it('PCの操作ボタンを表示するまで下部操作バーを隠さない', () => {
    // Tailwind xl (1280px) を境に表示を引き継ぎ、1024〜1279pxでも操作可能にする。
    expect(source).toContain('className="hidden xl:block"');
    expect(source).toContain('className="sticky bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur xl:hidden"');
    expect(source).not.toContain('backdrop-blur lg:hidden');
  });

  it('どちらの表示でも保存と見積依頼の操作を維持する', () => {
    for (const id of ['save-button', 'quote-button', 'save-button-sp', 'quote-button-sp']) {
      expect(source).toContain(`data-testid="${id}"`);
    }
  });
});
