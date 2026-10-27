import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const ledgerMenu = read('components/admin/product-ledger-actions-menu.tsx');
const newPage = read('app/admin/options/new/page.tsx');
const form = read('components/admin/forms.tsx');
const adminActions = read('lib/actions/admin.ts');
const ledgerActions = read('lib/actions/product-ledger.ts');

describe('商品台帳：元商品を維持した下書き複製', () => {
  it('商品台帳の操作メニューから新規登録の複製導線を開ける', () => {
    expect(ledgerMenu).toContain('この商品をもとに新規登録');
    expect(ledgerMenu).toContain('/admin/options/new?copy_from=${encodeURIComponent(optionId)}&return_to=%2Fadmin%2Fledger');
    expect(ledgerMenu).toContain('href={duplicateHref}');
  });

  it('新規登録画面でコピー元を台帳の登録対象に限定し、見つからない場合は保存フォームを出さない', () => {
    expect(newPage).toContain("typeof sp.copy_from === 'string'");
    expect(newPage).toContain('options.find((option) => option.id === sp.copy_from && categories.some((category) => category.id === option.category_id))');
    expect(newPage).toContain('if (copyRequested && !copySource)');
    expect(newPage).toContain('duplicateSource={copySource}');
    expect(newPage).toContain('商品管理番号・選択肢・画像・メーカーPDF・原価Version');
  });

  it('複製元を表示用初期値にのみ使用し、商品ID・Storageメディア・公開状態を引き継がない', () => {
    expect(form).toContain("const copySource = mode === 'create' && !option ? duplicateSource : null;");
    expect(form).toContain('name="id" value={option?.id ?? \'\'}');
    expect(form).toContain('name="owner_id" value={option?.owner_id ?? \'\'}');
    expect(form).toContain('name="image_url" value=""');
    expect(form).toContain('name="status" value="draft"');
    expect(form).not.toContain('name="manufacturer_document_url" value={copySource');
    expect(form).not.toContain('name="code" value={copySource');
    expect(adminActions).toContain('const internalCode = existingOption?.code ?? `opt-${randomUUID()}`');
    expect(adminActions).toContain("if (!parsed.data.id) createdId = o.id;");
    expect(adminActions).toContain("redirect('/admin/options/' + createdId + '?step=info&created=1')");
  });

  it('説明・表示用価格・対象モデルを引き継ぎ、選択肢と関係設定はコピーしない', () => {
    expect(form).toContain('name="description" value={copySource?.description ?? \'\'}');
    expect(form).toContain('name="highlight" value={copySource?.highlight ?? \'\'}');
    expect(form).toContain('name="price" value={copySource.price}');
    expect(form).toContain('name="price" value="0"');
    expect(form).toContain('name="selection_type" value={copySource.selection_type}');
    expect(form).toContain('name="selection_type" value="radio"');
    expect(form).toContain('name="list_price" value={copySource?.list_price ?? \'\'}');
    expect(form).toContain('name="base_model_id" value={copySource?.base_model_id ?? \'\'}');
    expect(form).toContain('copySource?.spec_codes.map');
    expect(newPage).toContain('dependencies={[]}');
    expect(newPage).toContain('conflicts={[]}');
    expect(form).toContain('name="preview_key" value=""');
  });

  it('複製した新規下書きは既存の未使用下書き削除処理で削除できる', () => {
    expect(ledgerMenu).toContain('deleteDraftProductFromLedgerAction');
    expect(ledgerMenu).toContain('下書きを削除');
    expect(ledgerActions).toContain("if (option.status !== 'draft')");
    expect(ledgerActions).toContain('await store.deleteOption(id)');
  });
});
