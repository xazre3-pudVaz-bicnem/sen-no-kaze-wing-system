import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/base-masters/[id]/page.tsx'),
  'utf8'
);
const listPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/base-masters/page.tsx'),
  'utf8'
);
const editor = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-revision-form.tsx'),
  'utf8'
);
const lines = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-lines.tsx'),
  'utf8'
);
const form = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-form.tsx'),
  'utf8'
);
const demoPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/base-masters/demo/page.tsx'),
  'utf8'
);
const demo = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/base-master-excel-demo.tsx'),
  'utf8'
);

describe('本体マスター UI', () => {
  it('利用者向けに本体管理元・下書き・公開履歴の表現を使う', () => {
    expect(listPage + page + form + editor).toContain('本体管理元');
    expect(listPage + page + form + editor).toContain('下書き');
    expect(listPage + page + form + editor).toContain('公開履歴');
    expect(form).not.toContain('label="所有組織"');
    expect(editor).not.toContain('>Draftを保存<');
    expect(editor).not.toContain('>このDraftを公開<');
  });

  it('保存・公開の既存Action境界を維持する', () => {
    expect(editor).toContain('saveBaseMasterDraftAction');
    expect(editor).toContain('publishBaseMasterDraftAction');
    expect(editor).toContain('discardBaseMasterDraftAction');
    expect(editor).toContain('保存時点に戻す');
    expect(editor).toContain('この内容で公開');
  });

  it('Excel型のセル移動・折り畳み・行操作を持つ', () => {
    expect(lines).toContain('data-base-master-cell');
    expect(lines).toContain("event.key === 'Tab'");
    expect(lines).toContain("event.key === 'Enter'");
    expect(lines).toContain('event.nativeEvent.isComposing');
    expect(lines).toContain('event.keyCode === 229');
    expect(lines).toContain('toggleSection');
    expect(lines).toContain('行の操作');
    expect(lines).toContain('工事区分を追加');
    expect(lines).toContain('黄色＝入力');
  });

  it('公開履歴の明細も同じExcel型表示を使う', () => {
    expect(lines).toContain('export function BaseMasterReadOnlyLines');
    expect(page).toContain('<BaseMasterReadOnlyLines');
    expect(page).toContain('lineSubtotal={revision.line_subtotal}');
    expect(page).toContain('expenseAmount={revision.expense_amount}');
    expect(page).toContain('total={revision.total}');
  });

  it('正式明細の保存契約は既存の単価・金額1系統のままにする', () => {
    expect(lines).toContain('unit_price: row.unitPrice');
    expect(lines).toContain('単価');
    expect(lines).toContain('金額');
    expect(lines).not.toContain('cost_price');
    expect(lines).not.toContain('sale_price');
  });

  it('正式編集画面は保存・公開操作を維持し、画面確認サンプルは表示専用にする', () => {
    expect(page).not.toContain('card grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4');
    expect(page).toContain('modelName={model?.name');
    expect(page).toContain('ownerName={owner?.name');
    expect(editor).toContain('本体マスター編集');
    expect(editor).toContain('商品モデル');
    expect(editor).toContain('本体管理元');
    expect(editor).toContain('現在の公開版');
    expect(editor).toContain('form="base-master-save-form"');
    expect(editor).toContain('この内容で公開');
    expect(demoPage).not.toContain('操作確認用・DB非連動');
    expect(demo).toContain('画面確認用サンプル');
    expect(demo).toContain('表示のみ・操作未接続');
    expect(demo).not.toContain('この内容で公開');
  });

  it('工事区分見出しから明細を直接追加できる', () => {
    expect(lines).toContain('＋明細');
    expect(lines).toContain('onClick={() => addRow(section.key)}');
  });
});
