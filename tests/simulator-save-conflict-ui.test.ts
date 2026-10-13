import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dialog = fs.readFileSync(path.join(root, 'components/simulator/save-dialog.tsx'), 'utf8');

describe('Simulator 保存競合UI', () => {
  it('Configuration同時編集の競合だけを専用表示として判定する', () => {
    expect(dialog).toContain("const CONFIGURATION_CONFLICT_MESSAGE = '他の画面でこのプランが更新されています';");
    expect(dialog).toContain('error?.includes(CONFIGURATION_CONFLICT_MESSAGE)');
    expect(dialog).toContain("error?.replace(/^LOCKED:\\s*/, '')");
  });

  it('競合時に上書きされていないことと再読み込み手順を案内する', () => {
    expect(dialog).toContain('この画面からは上書きしていません。');
    expect(dialog).toContain('最新の内容を再読み込みして確認し、必要な変更をもう一度行ってください。');
    expect(dialog).toContain('data-testid="save-conflict-reload"');
    expect(dialog).toContain('onClick={() => window.location.reload()}');
    expect(dialog).toContain('最新の内容を再読み込み');
  });

  it('その他の保存エラーは従来どおりdanger表示を維持する', () => {
    expect(dialog).toContain('<Alert tone="danger" className="mt-4">{error}</Alert>');
  });
});
