import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchLine,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';

const BASE_LINES = [
  { id: 'demo-base-1', section: '木造躯体', name: '木造躯体一式', quantity: 1, unit: '式', unitPrice: 1500000, amount: 1500000, remark: '' },
  { id: 'demo-base-2', section: '金物', name: '構造金物一式', quantity: 1, unit: '式', unitPrice: 350000, amount: 350000, remark: '' },
  { id: 'demo-base-3', section: '折畳み構造', name: '折畳み機構一式', quantity: 1, unit: '式', unitPrice: 450000, amount: 450000, remark: '' },
  { id: 'demo-base-4', section: '断熱', name: '断熱材一式', quantity: 1, unit: '式', unitPrice: 250000, amount: 250000, remark: '' },
  { id: 'demo-base-5', section: '天井', name: '天井ラワンベニア', quantity: 1, unit: '式', unitPrice: 150000, amount: 150000, remark: '' },
];

const INITIAL_LINES: EstimateTemplateWorkbenchLine[] = [
  { id: 'demo-ie-1', section: 'interior_exterior', groupLabel: '屋根', name: 'ガルバリウム鋼板屋根', quantity: 1, unit: '式', saleUnitPrice: 250000, remark: '', source: 'free', customerSelection: '—' },
  { id: 'demo-ie-2', section: 'interior_exterior', groupLabel: '外壁', name: 'ガルバリウム外壁＋木部仕上げ', quantity: 1, unit: '式', saleUnitPrice: 420000, remark: '', source: 'free', customerSelection: '—' },
  { id: 'demo-ie-3', section: 'interior_exterior', groupLabel: 'サッシ', name: 'サッシ一式', quantity: 1, unit: '式', saleUnitPrice: 320000, remark: '', source: 'free', customerSelection: '—' },
  { id: 'demo-ie-4', section: 'interior_exterior', groupLabel: '玄関ドア', name: '玄関ドア', quantity: 1, unit: '枚', saleUnitPrice: 180000, remark: '', source: 'product', customerSelection: '標準・変更可' },

  { id: 'demo-op-1', section: 'option', groupLabel: 'ユニットバス', name: 'ユニットバス 1216', quantity: 1, unit: '台', saleUnitPrice: 350000, remark: '', source: 'product', customerSelection: '標準・変更可' },
  { id: 'demo-op-2', section: 'option', groupLabel: 'トイレ', name: '温水洗浄便座付トイレ', quantity: 1, unit: '台', saleUnitPrice: 120000, remark: '', source: 'product', customerSelection: '標準・変更可' },
  { id: 'demo-op-3', section: 'option', groupLabel: '洗面', name: '洗面化粧台', quantity: 1, unit: '台', saleUnitPrice: 100000, remark: '', source: 'product', customerSelection: '標準・変更可' },
  { id: 'demo-op-4', section: 'option', groupLabel: '給湯器', name: '16号給湯器', quantity: 1, unit: '台', saleUnitPrice: 150000, remark: '', source: 'product', customerSelection: '標準・固定' },
  { id: 'demo-op-5', section: 'option', groupLabel: 'エアコン', name: 'ルームエアコン', quantity: 1, unit: '台', saleUnitPrice: 120000, remark: '', source: 'product', customerSelection: '標準・変更可' },
  { id: 'demo-op-6', section: 'option', groupLabel: 'スマートキー', name: 'スマートキー', quantity: 1, unit: '式', saleUnitPrice: 45000, remark: '', source: 'product', customerSelection: '任意オプション' },

  { id: 'demo-site-1', section: 'sitework', groupLabel: '運搬', name: '運搬費', quantity: 1, unit: '式', saleUnitPrice: 180000, remark: '設置場所により変動', source: 'free', customerSelection: '—' },
  { id: 'demo-site-2', section: 'sitework', groupLabel: '基礎', name: '基礎工事', quantity: 1, unit: '式', saleUnitPrice: 250000, remark: '', source: 'free', customerSelection: '—' },
  { id: 'demo-site-3', section: 'sitework', groupLabel: '設置', name: '現地設置費', quantity: 1, unit: '式', saleUnitPrice: 150000, remark: '', source: 'free', customerSelection: '—' },
  { id: 'demo-site-4', section: 'sitework', groupLabel: '浄化槽', name: '浄化槽工事', quantity: 1, unit: '式', saleUnitPrice: 0, remark: '別途見積', source: 'free', customerSelection: '—' },
];

const SECTIONS: EstimateTemplateWorkbenchSection[] = [
  { code: 'interior_exterior', label: '内外装工事', expenseLabel: null, expenseAmount: 0 },
  { code: 'option', label: 'オプション', expenseLabel: null, expenseAmount: 0 },
  { code: 'sitework', label: '別途', expenseLabel: null, expenseAmount: 0 },
];

export default async function EstimateTemplateDemoPage() {
  const actor = await requireCatalogEditor('/admin/estimate-templates/demo');
  const store = await getStore();
  const [options, categories] = await Promise.all([
    store.listOptions(),
    store.listCategories(),
  ]);
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));

  const products = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      id: option.id,
      categoryId: option.category_id,
      categoryName: categoryMap.get(option.category_id) ?? '未分類',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      sizeNote: option.size_note ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
      imageUrl: option.image_url,
    }));

  const baseTotal = BASE_LINES.reduce((sum, row) => sum + row.amount, 0);

  return (
    <AdminPage
      title="操作確認用 Wing ホテル仕様 非防火"
      lead="見積テンプレート編集の操作感を確認するためのサンプルです。変更内容は保存されません。"
    >
      <BackLink href="/admin/estimate-templates" label="見積テンプレート一覧へ戻る" />

      <section className="card grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted">商品</p>
          <p className="mt-1 font-semibold">Wing</p>
        </div>
        <div>
          <p className="text-xs text-muted">仕様</p>
          <p className="mt-1 font-semibold">ホテル仕様</p>
        </div>
        <div>
          <p className="text-xs text-muted">防火仕様</p>
          <p className="mt-1 font-semibold">非防火</p>
        </div>
        <div>
          <p className="text-xs text-muted">状態</p>
          <p className="mt-1"><Badge tone="neutral">操作確認用</Badge></p>
        </div>
      </section>

      <EstimateTemplateWorkbench
        templateId="demo"
        role={actor.role}
        baseLines={BASE_LINES}
        baseTotal={baseTotal}
        initialLines={INITIAL_LINES}
        sections={SECTIONS}
        products={products}
        taxRate={0.1}
        adjustment={0}
        demoMode
      />
    </AdminPage>
  );
}
