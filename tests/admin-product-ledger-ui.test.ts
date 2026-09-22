import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledger = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');

describe('商品台帳の入口', () => {
  it('商品識別情報で検索し、販売基準の導線を含めない', () => {
    expect(ledger).toContain('ProductLedgerClient');
    expect(ledger).not.toContain('/admin/base-breakdown');
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品名・メーカー・型番');
    expect(client).toContain('商品価格（税別）');
  });

  it('フリー商品を正式な商品台帳へ混ぜない', () => {
    expect(ledger).toContain('FREE_PRODUCT_CATEGORY_CODE');
    expect(ledger).toContain('catalogOptions');
    expect(ledger).toContain('catalogCategories');
  });

  it('一覧を主役にし、未選択時は余分な詳細カードを出さない', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品一覧');
    expect(client).toContain('商品名・メーカー・型番を検索');
    expect(client).toContain('カテゴリー：すべて');
    expect(client).toContain('状態：すべて');
    expect(client).toContain('並び替え：更新が新しい順');
    expect(client).toContain('SmartImage');
    expect(client).toContain('Ellipsis');
    expect(client).toContain('商品を種類から絞り込み');
    expect(client).toContain('md:grid-cols-[11rem_minmax(0,1fr)]');
    expect(client).toContain('hidden md:sticky md:top-4 md:block');
    expect(client).toContain('min-w-0 md:hidden');
    expect(client).toContain('sticky top-0');
    expect(client).toContain('md:sticky md:top-[8.5rem]');
    expect(client).toContain('hidden px-4 py-3 xl:table-cell');
    expect(client).toContain("useState(50)");
    expect(client).toContain('表示件数');
    expect(client).toContain('25件');
    expect(client).toContain('50件');
    expect(client).toContain('100件');
    expect(client).toContain('前へ');
    expect(client).toContain('次へ');
    expect(client).not.toContain('ledger-empty-detail');
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
    expect(client).toContain('<ProductDetail category={category} option={selected}');
    expect(client).toContain('onVariantChange={onPreviewVariantChange}');
  });

  it('管理情報は正式に取得できる値と未取得の仕入情報を分離する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品基本情報');
    expect(client).toContain('シミュレーター・Web表示設定');
    expect(client).toContain('自社の仕入・発注情報');
    expect(client).toContain('未登録値を推測せず、取得可能になるまでは表示しません。');
    expect(client).toContain('登録・権限情報');
    expect(client).not.toContain('自社設定を編集');
    expect(client).toContain('min-[900px]:grid-cols-2');
  });
});
