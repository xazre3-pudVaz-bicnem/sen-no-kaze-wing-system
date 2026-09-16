import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const editor = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-revision-form.tsx'),
  'utf8'
);
const lines = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-lines.tsx'),
  'utf8'
);

describe('本体マスター Excel風編集UI', () => {
  it('Draft保存と公開境界を維持したままExcel風編集を提供する', () => {
    expect(editor).toContain('saveBaseMasterDraftAction');
    expect(editor).toContain('publishBaseMasterDraftAction');
    expect(editor).toContain('保存時点に戻す');
    expect(editor).toContain('未保存の変更あり');
    expect(editor).toContain('Draftを保存');
    expect(editor).toContain('このDraftを公開');
  });

  it('Tab・Enter移動とIME変換中Enterの除外を持つ', () => {
    expect(lines).toContain('data-base-master-cell');
    expect(lines).toContain("event.key === 'Tab'");
    expect(lines).toContain("event.key === 'Enter'");
    expect(lines).toContain('event.nativeEvent.isComposing');
    expect(lines).toContain('event.keyCode === 229');
  });

  it('工事区分の折り畳みとExcel風のコンパクト明細を持つ', () => {
    expect(lines).toContain('toggleSection');
    expect(lines).toContain('＋明細');
    expect(lines).toContain('工事区分を追加');
    expect(lines).toContain('h-7 w-full');
    expect(lines).toContain('本体価格計');
  });

  it('見積専用の原価売価タブや掛率を本体マスターへ持ち込まない', () => {
    expect(editor + lines).not.toContain('原価表');
    expect(editor + lines).not.toContain('売価表');
    expect(editor + lines).not.toContain('原価・売価比較');
    expect(editor + lines).not.toContain('掛率から売価を再計算');
  });
});
