import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const menu = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-actions-menu.tsx'), 'utf8');
const action = fs.readFileSync(path.resolve(process.cwd(), 'lib/actions/product-ledger.ts'), 'utf8');

describe('商品台帳の一覧操作', () => {
  it('PC一覧は更新日の右に専用操作列を置き、スマホ・画像表示でも操作を維持する', () => {
    expect(client).toContain("import { ProductLedgerActionsMenu } from '@/components/admin/product-ledger-actions-menu'");
    expect(client).toContain('<span className="sr-only">操作</span>');
    expect(client).toContain('optionId={o.id}');
    expect(client).toContain('configurationUsageCount={usageCountFor(o.id)}');
    expect(client).toContain('<ProductStatus option={o} configurationUsageCount={usageCountFor(o.id)} />');
    expect(client).toContain('ledger-mobile-option-');
    expect(client).toContain('data-testid="ledger-grid-view"');
  });

  it('操作メニューは文字なしの見やすい三点ボタンで、未使用の下書きだけ削除できる', () => {
    expect(menu).not.toContain('<span>操作</span>');
    expect(menu).toContain('inline-flex size-9');
    expect(menu).toContain('<EllipsisVertical className="size-5"');
    expect(menu).toContain('商品情報を編集');
    expect(menu).toContain("const isDraft = status === 'draft'");
    expect(menu).toContain('const canDelete = isDraft && configurationUsageCount === 0');
    expect(menu).toContain('下書きを削除');
    expect(menu).toContain('削除できません（保存プラン');
    expect(menu).toContain('削除可否を確認できません');
    expect(menu).toContain('deleteDraftProductFromLedgerAction');
    expect(menu).toContain("event.stopPropagation()");
  });

  it('削除確認はブラウザconfirmではなく中央モーダルで商品名と不可逆性を示す', () => {
    expect(menu).toContain("import { createPortal } from 'react-dom'");
    expect(menu).toContain('role="dialog"');
    expect(menu).toContain('aria-modal="true"');
    expect(menu).toContain('fixed inset-0 z-[100] flex items-center justify-center');
    expect(menu).toContain('下書きを削除しますか');
    expect(menu).toContain('この操作は元に戻せません。');
    expect(menu).toContain('キャンセル');
    expect(menu).toContain('削除する');
    expect(menu).not.toContain('window.confirm');
    expect(menu).not.toContain('ConfirmSubmit');
  });

  it('一覧からの削除はサーバー側でも下書きだけに限定する', () => {
    expect(action).toContain("await requireCatalogEditor(ledgerPath)");
    expect(action).toContain('const option = await store.getOption(id)');
    expect(action).toContain("if (option.status !== 'draft')");
    expect(action).toContain('登録済み商品は完全削除できません。');
    expect(action).toContain('await store.deleteOption(id)');
    expect(action).toContain("ledgerRedirect({ deleted: '1' })");
  });
});