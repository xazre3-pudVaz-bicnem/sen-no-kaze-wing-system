import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const menu = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-actions-menu.tsx'), 'utf8');
const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
const draftAction = fs.readFileSync(path.resolve(process.cwd(), 'lib/actions/product-ledger.ts'), 'utf8');
const publishedDeleteAction = fs.readFileSync(path.resolve(process.cwd(), 'lib/actions/unused-published-product-delete.ts'), 'utf8');

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

  it('商品価格を左へ寄せる列幅にして、状態・更新日・操作へ必要な幅を配分する', () => {
    expect(page).toContain('thead th:nth-child(1) { width: 35%; }');
    expect(page).toContain('thead th:nth-child(2) { width: 14%; }');
    expect(page).toContain('thead th:nth-child(3) { width: 15%; }');
    expect(page).toContain('thead th:nth-child(4) { width: 18%; }');
    expect(page).toContain('thead th:nth-child(5) { width: 12%; }');
    expect(page).toContain('thead th:nth-child(6) { width: 6%; }');
  });

  it('操作メニューは下書き削除を維持し、登録済み商品は既存の未使用safe-deleteへ接続する', () => {
    expect(menu).not.toContain('<span>操作</span>');
    expect(menu).toContain('inline-flex size-9');
    expect(menu).toContain('<EllipsisVertical className="size-5"');
    expect(menu).toContain('商品情報を編集');
    expect(menu).toContain("import { deleteUnusedPublishedOptionAction } from '@/lib/actions/unused-published-product-delete'");
    expect(menu).toContain("const isDraft = status === 'draft'");
    expect(menu).toContain("const isPublished = status === 'published'");
    expect(menu).toContain('const canDeleteDraft = isDraft && configurationUsageCount === 0');
    expect(menu).toContain('const deleteAction = isDraft ? deleteDraftProductFromLedgerAction : deleteUnusedPublishedOptionAction');
    expect(menu).toContain('下書きを削除');
    expect(menu).toContain('この商品を削除（未使用のみ）');
    expect(menu).toContain('name="return_to" value="/admin/ledger"');
    expect(menu).toContain('削除できません（保存プラン');
    expect(menu).toContain('削除可否を確認できません');
    expect(menu).toContain("event.stopPropagation()");
  });

  it('削除確認は中央モーダルで下書きと登録済み商品の違いを明示する', () => {
    expect(menu).toContain("import { createPortal } from 'react-dom'");
    expect(menu).toContain('role="dialog"');
    expect(menu).toContain('aria-modal="true"');
    expect(menu).toContain('fixed inset-0 z-[100] flex items-center justify-center');
    expect(menu).toContain("isDraft ? '下書きを削除しますか' : '登録済み商品を削除しますか'");
    expect(menu).toContain('一度も使われていない場合だけ完全に削除します');
    expect(menu).toContain('使用済みの場合は削除されません');
    expect(menu).toContain('この操作は元に戻せません。');
    expect(menu).toContain('キャンセル');
    expect(menu).toContain('削除する');
    expect(menu).not.toContain('window.confirm');
    expect(menu).not.toContain('ConfirmSubmit');
  });

  it('削除後の位置は独自保存・強制スクロールを行わず従来の画面遷移に任せる', () => {
    expect(menu).not.toContain('sessionStorage');
    expect(menu).not.toContain('PRODUCT_LEDGER_SCROLL_STORAGE_KEY');
    expect(page).not.toContain('ProductLedgerScrollRestore');
    expect(fs.existsSync(path.resolve(process.cwd(), 'components/admin/product-ledger-scroll-restore.tsx'))).toBe(false);
  });

  it('下書きは従来の制限を維持し、登録済みは台帳return_toを固定値だけ受け付けて専用RPCへ渡す', () => {
    expect(draftAction).toContain("await requireCatalogEditor(ledgerPath)");
    expect(draftAction).toContain('const option = await store.getOption(id)');
    expect(draftAction).toContain("if (option.status !== 'draft')");
    expect(draftAction).toContain('登録済み商品は完全削除できません。');
    expect(draftAction).toContain('await store.deleteOption(id)');
    expect(draftAction).toContain("ledgerRedirect({ deleted: '1' })");

    expect(publishedDeleteAction).toContain("const ledgerPath = '/admin/ledger'");
    expect(publishedDeleteAction).toContain("String(formData.get('return_to') ?? '') === ledgerPath ? ledgerPath : null");
    expect(publishedDeleteAction).toContain("option.status !== 'published'");
    expect(publishedDeleteAction).toContain("db.rpc('delete_unused_published_option'");
    expect(publishedDeleteAction).toContain("redirect(returnTo === ledgerPath ? `${ledgerPath}?deleted=1` : '/admin/options?deleted=1')");
  });
});
