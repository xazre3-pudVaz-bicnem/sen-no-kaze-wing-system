import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledger = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');

describe('商品台帳の入口', () => {
  it('商品識別情報で検索し、販売基準の導線を含めない', () => {
    expect(ledger).toContain('ProductLedgerClient');
    expect(ledger).not.toContain('/admin/base-breakdown');
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品名・メーカー・シリーズ・型番・商品番号');
    expect(client).toContain('商品価格（税別）');
  });

  it('フリー商品を正式な商品台帳へ混ぜない', () => {
    expect(ledger).toContain('FREE_PRODUCT_CATEGORY_CODE');
    expect(ledger).toContain('catalogOptions');
    expect(ledger).toContain('catalogCategories');
  });

  it('分類フォルダとカテゴリーを2階層で上部固定する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品一覧');
    expect(client).toContain('data-testid="ledger-sticky-category-bar"');
    expect(client).toContain('sticky top-0 z-30');
    expect(client).toContain('data-testid="ledger-category-groups"');
    expect(client).toContain('aria-label="商品分類"');
    expect(client).toContain('category.group_code');
    expect(client).toContain('category.group_name');
    expect(client).toContain('category.group_sort');
    expect(client).toContain('group.categories.reduce');
    expect(client).toContain('setGroupCode(group.code)');
    expect(client).toContain('data-testid="ledger-category-children"');
    expect(client).toContain("selectedGroup.name + 'のカテゴリー'");
    expect(client).toContain('selectedGroup.categories.map');
    expect(client).toContain('categoryCounts.get(item.id)');
    expect(client).toContain('すべて <span');
    expect(client).toContain('公開中 <span');
    expect(client).toContain('下書き <span');
    expect(client).toContain('要確認のみ');
    expect(client).toContain('aria-expanded={searchOpen}');
    expect(client).toContain('data-testid="ledger-collapsible-search"');
    expect(client).toContain('商品名・メーカー・シリーズ・型番・商品番号で検索');
    expect(client).not.toContain('メーカー：すべて');
    expect(client).not.toContain('対象モデル：すべて');
    expect(client).not.toContain('並び替え：更新が新しい順');
    expect(client).not.toContain('hidden md:sticky md:top-4 md:block');
    expect(client).toContain('一覧表示');
    expect(client).toContain('画像表示');
    expect(client).toContain("useState<'list' | 'grid'>('list')");
    expect(client).toContain('data-testid="ledger-table-view"');
    expect(client).toContain('<table className="w-full table-fixed text-left text-sm">');
    expect(client).toContain('<div className="hidden md:block">');
    expect(client).not.toContain('hidden overflow-x-auto md:block');
    expect(client).not.toContain('min-w-[680px]');
    expect(client).not.toContain('商品番号未採番');
    expect(client).not.toContain('型番未設定');
    expect(client).toContain('メーカー・型番');
    expect(client).not.toContain('<th className="w-[12%] px-3 py-2.5">対象モデル</th>');
    expect(client).toContain('data-testid="ledger-grid-view"');
    expect(client).toContain('hidden overflow-x-auto md:block');
    expect(client).toContain('space-y-2 p-3 md:hidden');
    expect(client).toContain("useState(50)");
    expect(client).toContain('表示件数');
    expect(client).toContain('25件');
    expect(client).toContain('50件');
    expect(client).toContain('100件');
    expect(client).toContain('前へ');
    expect(client).toContain('次へ');
    expect(client).not.toContain('ledger-empty-detail');

    expect(ledger).toContain("store.listModels({ includeDraft: true })");
    expect(ledger).toContain('models={models}');
  });

  it('商品詳細を2タブのレスポンシブモーダルで表示する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('ledger-product-detail-modal');
    expect(client).toContain('role="dialog"');
    expect(client).toContain('aria-modal="true"');
    expect(client).toContain('お客様表示');
    expect(client).toContain('管理情報');
    expect(client).toContain('role="tablist"');
    expect(client).toContain('ledger-customer-panel');
    expect(client).toContain('ledger-admin-panel');
    expect(client).toContain('選択中の商品');
    expect(client).toContain('商品詳細を閉じる');
    expect(client).toContain('前の商品');
    expect(client).toContain('次の商品');
    expect(client).toContain("event.key === 'Escape'");
    expect(client).toContain("event.key !== 'Tab'");
    expect(client).toContain("document.body.style.overflow = 'hidden'");
    expect(client).toContain('openerRef.current?.focus()');
    expect(client).not.toContain('data-testid="ledger-product-detail"');
  });

  it('お客様表示はシミュレーター共通ProductDetailをそのまま使う', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain("import { ProductDetail } from '@/components/simulator/product-detail'");
    expect(client).toContain('シミュレーター画面と同じ商品詳細です。ここで変更した仕様は確認用で、保存されません。');
    expect(client).toContain('defaultVariantIdsFor');
    expect(client).toContain('pruneHiddenVariantChoices');
    expect(client).toContain('<ProductDetail key={selected.id} category={category} option={selected}');
    expect(client).toContain('onVariantChange={onPreviewVariantChange}');
  });

  it('管理情報は正式に取得できる値と未取得の仕入情報を分離する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品基本情報');
    expect(client).toContain('商品管理番号');
    expect(client).toContain('シミュレーター・Web表示設定');
    expect(client).toContain('自社の仕入・発注情報');
    expect(client).toContain('未登録値を推測せず、取得可能になるまでは表示しません。');
    expect(client).toContain('登録・権限情報');
    expect(client).not.toContain('自社設定を編集');
    expect(client).toContain('min-[900px]:grid-cols-2');
  });
});
