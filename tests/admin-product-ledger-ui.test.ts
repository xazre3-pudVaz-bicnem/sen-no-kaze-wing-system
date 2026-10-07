import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledger = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');

describe('商品台帳の入口', () => {
  it('商品識別情報で検索し、販売基準の導線を含めない', () => {
    expect(ledger).toContain('ProductLedgerClient');
    expect(ledger).not.toContain('/admin/base-breakdown');
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品名・メーカー・シリーズ・型番で検索');
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
    expect(client).not.toContain('要確認のみ');
    expect(client).toContain('aria-expanded={searchOpen}');
    expect(client).toContain('data-testid="ledger-collapsible-search"');
    expect(client).toContain('商品名・メーカー・シリーズ・型番で検索');
    expect(client).not.toContain('メーカー：すべて');
    expect(client).not.toContain('対象モデル：すべて');
    expect(client).not.toContain('hidden md:sticky md:top-4 md:block');
    expect(client).toContain('一覧表示');
    expect(client).toContain('画像表示');
    expect(client).toContain("useState<'list' | 'grid'>('list')");
    expect(client).toContain('data-testid="ledger-table-view"');
    expect(client).toContain('<table className="w-full table-fixed text-left text-[0.8125rem]">');
    expect(client).toContain('<div className="hidden md:block">');
    expect(client).not.toContain('hidden overflow-x-auto md:block');
    expect(client).not.toContain('min-w-[680px]');
    expect(client).not.toContain('商品番号未採番');
    expect(client).not.toContain('型番未設定');
    expect(client).not.toContain('<th className="w-[12%] px-3 py-2.5">対象モデル</th>');
    expect(client).toContain('data-testid="ledger-grid-view"');
    expect(client).toContain('space-y-2 p-3 md:hidden');
    expect(client).toContain("useState<LedgerSort>('updated-desc')");
    expect(client).not.toContain('aria-label="並び替え"');
    expect(client).not.toContain('商品管理番号順');
    expect(client).toContain('標準使用数が多い順（接続待ち）');
    expect(client).toContain('data-simulator-standard-usage-slot="pending-db"');
    expect(client).toContain('DB是正後、ここに「シミュレーター標準で使用中 ○件」を正式データから接続する。');
    expect(client).not.toContain('Ellipsis');
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

  it('一覧は商品・カテゴリー・価格・状態・更新日の5列構成にし、行全体から詳細を開く', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('<th className="w-[40%] px-2.5 py-1.5">');
    expect(client).toContain('<SortHeader label="商品"');
    expect(client).toContain('<th className="w-[16%] px-2.5 py-1.5">');
    expect(client).toContain('<SortHeader label="カテゴリー"');
    expect(client).toContain('<th className="w-[17%] px-2.5 py-1.5 text-right">');
    expect(client).toContain('<SortHeader label="商品価格（税別）"');
    expect(client).toContain('<th className="w-[15%] px-2.5 py-1.5">');
    expect(client).toContain('<SortHeader label="状態"');
    expect(client).toContain('<th className="w-[12%] px-2.5 py-1.5">');
    expect(client).toContain('<SortHeader label="更新日"');
    expect(client).not.toContain('>メーカー・型番</th>');
    expect(client).not.toContain('>操作</th>');
    expect(client).toContain('{itemCategory?.name ?? dash}');
    expect(client).toContain('[o.manufacturer, o.model_no].filter(Boolean)');
    expect(client).not.toContain('商品管理番号 {o.product_no || dash}');
    expect(client).toContain('line-clamp-2 text-[0.92rem] font-semibold');
    expect(client).toContain('text-xs leading-tight text-muted');
    expect(client).toContain('onClick={() => openDetail(o.id)}');
    expect(client).toContain("if (event.key === 'Enter' || event.key === ' ')");
  });

  it('各列見出しからExcel風に並び替え、正式データ未接続の標準使用数順は無効表示する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain("{ value: 'name-asc', label: '商品名 昇順' }");
    expect(client).toContain("{ value: 'name-desc', label: '商品名 降順' }");
    expect(client).toContain("{ value: 'category-asc', label: 'カテゴリー 昇順' }");
    expect(client).toContain("{ value: 'category-desc', label: 'カテゴリー 降順' }");
    expect(client).toContain("{ value: 'price-asc', label: '安い順' }");
    expect(client).toContain("{ value: 'price-desc', label: '高い順' }");
    expect(client).toContain("{ value: 'status-published-first', label: '公開中を先に表示' }");
    expect(client).toContain("{ value: 'status-draft-first', label: '下書きを先に表示' }");
    expect(client).toContain("{ value: 'updated-desc', label: '新しい順' }");
    expect(client).toContain("{ value: 'updated-asc', label: '古い順' }");
    expect(client).toContain("{ label: '標準使用数が多い順（接続待ち）', disabled: true }");
    expect(client).toContain('event.currentTarget.closest(\'details\')?.removeAttribute(\'open\')');
    expect(client).toContain("if (option.price_on_request) return 1");
    expect(client).toContain('if (!Number.isFinite(option.price)) return 2');
  });

  it('列メニューは枠外クリック・Esc・別列メニューを開いた時に閉じる', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('useRef<HTMLDetailsElement>(null)');
    expect(client).toContain('<details ref={detailsRef} data-ledger-sort-menu');
    expect(client).toContain("document.addEventListener('pointerdown', handlePointerDown)");
    expect(client).toContain("event.key !== 'Escape'");
    expect(client).toContain("document.querySelectorAll<HTMLDetailsElement>('[data-ledger-sort-menu]')");
    expect(client).toContain("details.querySelector<HTMLElement>('summary')?.focus()");
    expect(client).toContain("document.removeEventListener('pointerdown', handlePointerDown)");
  });

  it('商品価格は通常・別途見積・未設定を区別する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain("if (option.price_on_request) return '別途見積'");
    expect(client).toContain('if (!Number.isFinite(option.price)) return dash');
    expect(client).toContain('return formatYen(option.price)');
  });

  it('商品詳細を2タブのレスポンシブ2ペインで表示する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('xl:grid-cols-[minmax(0,1.35fr)_minmax(26rem,0.65fr)]');
    expect(client).toContain('id="ledger-product-detail-pane"');
    expect(client).toContain('data-testid="ledger-product-detail-pane"');
    expect(client).toContain('xl:sticky xl:top-4');
    expect(client).toContain('data-testid="ledger-product-detail-empty"');
    expect(client).toContain('商品を選択してください');
    expect(client).toContain('お客様表示');
    expect(client).toContain('管理情報');
    expect(client).toContain('role="tablist"');
    expect(client).toContain('ledger-customer-panel');
    expect(client).toContain('ledger-admin-panel');
    expect(client).toContain('選択中の商品');
    expect(client).toContain('商品詳細を閉じる');
    expect(client).toContain('前の商品');
    expect(client).toContain('次の商品');
    expect(client).toContain('商品情報を編集');
    expect(client).not.toContain('ledger-product-detail-modal');
    expect(client).not.toContain('aria-modal="true"');
    expect(client).not.toContain("document.body.style.overflow = 'hidden'");
  });

  it('一覧の行全体から詳細を開き、2ペイン未満では詳細位置へ移動する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('tabIndex={0}');
    expect(client).toContain('onClick={() => openDetail(o.id)}');
    expect(client).toContain("window.matchMedia('(min-width: 1280px)').matches");
    expect(client).toContain("document.getElementById('ledger-product-detail-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' })");
  });

  it('お客様表示はシミュレーター共通ProductDetailをそのまま使う', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain("import { ProductDetail } from '@/components/simulator/product-detail'");
    expect(client).toContain('シミュレーター画面と同じ商品詳細です。ここで変更した仕様は確認用で、保存されません。');
    expect(client).toContain('defaultVariantIdsFor');
    expect(client).toContain('pruneHiddenVariantChoices');
    expect(client).toContain('<ProductDetail key={selected.id} category={category} option={selected}');
    expect(client).toContain('compactMedia');
    expect(client).toContain('onVariantChange={onPreviewVariantChange}');
    const detail = fs.readFileSync(path.resolve(process.cwd(), 'components/simulator/product-detail.tsx'), 'utf8');
    expect(detail).toContain('compactMedia?: boolean');
    expect(detail).toContain("compactMedia ? 'h-[clamp(14rem,55vw,19rem)]' : 'aspect-[3/2]'");
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
