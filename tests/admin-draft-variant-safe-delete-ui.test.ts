import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
const ui = read('components/admin/option-variant-manager.tsx');
const action = read('lib/actions/unused-draft-variant-delete.ts');

describe('未使用の下書き選択肢・選択項目の削除（DB適用待ち）', () => {
  it('編集フォームと削除フォームを分け、明示確認がある', () => {
    expect(ui).toContain('data-testid="delete-unused-variant-choice"');
    expect(ui).toContain('data-testid="delete-unused-variant-group"');
    expect(ui).toContain('ConfirmSubmit');
    expect(ui).toContain('未使用とDBが確認できた場合だけ削除');
  });

  it('削除のボタンは下書きの商品にだけ出す（DB も下書きだけを削除する）', () => {
    expect(ui).toContain("deletable={option.status === 'draft'}");
    expect(ui).toContain("{option.status === 'draft' && (");
    expect(ui).toContain('登録済みの商品の選択項目・選択肢は削除できません');
  });

  it('STEP 1 の短い案内も、登録済みの商品では「削除できません」にする（CSS が本文を置き換えるため）', () => {
    const css = read('app/admin/product-registration-refinements.css');
    expect(ui).toContain('className="card space-y-4 p-4 sm:p-5 scroll-mt-6" data-option-status={option.status}>');
    expect(css.replace(/\r\n/g, '\n')).toContain(
      ".registration-step1-sections #customer-selection:not([data-option-status='draft']) > p.text-xs.text-muted::after {\n  content: '登録済みの商品の選択項目・選択肢は削除できません。「お客様に表示する」をOFFにして管理します。';"
    );
  });

  it('商品全体の削除経路を流用しない', () => {
    expect(action).not.toContain('delete_unused_published_option');
    expect(action).toContain("target === 'choice'");
    expect(action).toContain('delete_unused_variant_choice');
    expect(action).toContain('delete_unused_variant_group');
  });

  it('DB未適用・デモ・ローカルでは削除せず、DBの権限と履歴を前提にする', () => {
    expect(action).toContain('await requireCatalogEditor()');
    expect(action).toContain("option.status !== 'draft'");
    expect(action).toContain('isDemoFallback() || isLocalMode()');
    expect(action).toContain('variantDeleteErrorMessage(result.error)');
    expect(action).not.toContain(".from('option_variant_choices').delete()");
    expect(action).not.toContain(".from('option_variant_groups').delete()");
  });
});
