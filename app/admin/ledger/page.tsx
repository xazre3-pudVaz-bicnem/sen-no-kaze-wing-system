import Link from 'next/link';
import { ProductLedgerClient } from '@/components/admin/product-ledger-client';
import { ProductLedgerOverlayDismiss } from '@/components/admin/product-ledger-overlay-dismiss';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { requireStaff } from '@/lib/auth/session';
import { getProductConfigurationUsageCounts } from '@/lib/data/product-ledger-usage';
import { getOptionHqStandardCostMap } from '@/lib/data/option-hq-standard-cost';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';

const LEDGER_DISPLAY_GROUPS = [
  { code: 'performance', name: '性能・仕様', sort: 1, categories: ['fireproof', 'insulation', 'insulation-floor', 'insulation-wall', 'insulation-ceiling'] },
  { code: 'exterior', name: '外まわり', sort: 2, categories: ['roof', 'exterior-wall', 'exterior-parts'] },
  { code: 'openings', name: '窓・ドア', sort: 3, categories: ['entrance-door', 'sash', 'service-door', 'smartlock'] },
  { code: 'interior', name: '室内', sort: 4, categories: ['floor', 'wall-ceiling', 'carpentry', 'interior-door'] },
  { code: 'equipment', name: '水回り・設備', sort: 5, categories: ['ub', 'kitchen', 'washbasin', 'toilet', 'boiler', 'aircon'] },
  { code: 'electrical', name: '電気・照明', sort: 6, categories: ['lighting'] },
  { code: 'furniture', name: '家具・収納', sort: 7, categories: ['entrance-storage', 'closet', 'bed', 'furniture', 'appliances', 'office-supplies'] },
  { code: 'sitework', name: '別途工事', sort: 8, categories: ['sitework'] },
] as const;

const ledgerDisplayGroupByCategoryCode = new Map(
  LEDGER_DISPLAY_GROUPS.flatMap((group) => group.categories.map((categoryCode) => [categoryCode, group] as const))
);

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const editor = canEditCatalog(actor.role);
  const [options, categories, models, configurationUsageCounts] = await Promise.all([
    store.listOptions(),
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    editor ? getProductConfigurationUsageCounts() : Promise.resolve(null),
  ]);
  const catalogCategories = categories.filter((category) => category.code !== FREE_PRODUCT_CATEGORY_CODE && category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE);
  const ledgerCategories = catalogCategories.map((category) => {
    const displayGroup = ledgerDisplayGroupByCategoryCode.get(category.code as (typeof LEDGER_DISPLAY_GROUPS)[number]['categories'][number]);
    return {
      ...category,
      group_code: displayGroup?.code ?? 'other',
      group_name: displayGroup?.name ?? 'その他',
      group_sort: displayGroup?.sort ?? 9,
    };
  });
  const catalogCategoryIds = new Set(catalogCategories.map((category) => category.id));
  const catalogOptions = options.filter((option) => catalogCategoryIds.has(option.category_id));
  const [rows, hqStandardCosts] = await Promise.all([
    Promise.all(catalogOptions.map(async (option) => [option.id, await store.getOptionVariants(option.id)] as const)),
    getOptionHqStandardCostMap(catalogOptions.map((option) => option.id)),
  ]);
  const selected = typeof sp.product === 'string' && catalogOptions.some((option) => option.id === sp.product) ? sp.product : undefined;

  return <AdminPage
    title="商品台帳"
    lead="UB・キッチン・サッシ・外壁・床・構造用面材など、見積で使う商品を登録・管理します。見積書のどの区分へ入れるかは、見積作成時に決めます。"
    notice={<><span className="font-semibold text-ink">商品台帳：</span> 商品そのものを登録する場所です。商品を「本体用」「オプション用」などに固定せず、見積書の各区分で「手入力」または「商品台帳から選択」して使います。</>}
    actions={<>{editor && <Link href="/admin/import" className="btn-secondary btn-sm">管理用：商品一括登録</Link>}{editor && <Link href="/admin/options/new?return_to=%2Fadmin%2Fledger" className="btn-primary btn-sm">＋ 商品を登録</Link>}</>}
  >
    <style>{`
      [data-testid="ledger-table-view"] thead th:nth-child(1) { width: 35%; }
      [data-testid="ledger-table-view"] thead th:nth-child(2) { width: 14%; }
      [data-testid="ledger-table-view"] thead th:nth-child(3) { width: 15%; }
      [data-testid="ledger-table-view"] thead th:nth-child(4) { width: 18%; }
      [data-testid="ledger-table-view"] thead th:nth-child(5) { width: 12%; }
      [data-testid="ledger-table-view"] thead th:nth-child(6) { width: 6%; }

      @media (max-width: 1279px) {
        [data-testid="ledger-product-detail-pane"] {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: flex;
          height: 100dvh;
          max-height: 100dvh;
          min-height: 0;
          flex-direction: column;
          overflow: hidden;
          border: 0;
          border-radius: 0;
          padding-left: max(0px, calc(100vw - 46rem));
          background: rgb(0 0 0 / 0.35);
          box-shadow: none;
          overscroll-behavior: contain;
        }

        [data-testid="ledger-product-detail-pane"] > header,
        [data-testid="ledger-product-detail-pane"] > [role="tablist"],
        [data-testid="ledger-product-detail-pane"] > div:last-child {
          border-left: 1px solid rgb(95 82 68 / 0.16);
        }

        [data-testid="ledger-product-detail-pane"] > div:last-child {
          min-height: 0;
          flex: 1;
          overflow-y: auto;
          background: rgb(249 247 241 / 0.98);
          overscroll-behavior: contain;
        }
      }

      @media (max-width: 639px) {
        [data-testid="ledger-product-detail-pane"] {
          padding-left: 0;
        }

        [data-testid="ledger-product-detail-pane"] > header,
        [data-testid="ledger-product-detail-pane"] > [role="tablist"],
        [data-testid="ledger-product-detail-pane"] > div:last-child {
          border-left: 0;
        }
      }
    `}</style>
    <ProductLedgerOverlayDismiss />
    <FlashMessages sp={sp} />
    <ProductLedgerClient
      canEdit={editor}
      categories={ledgerCategories}
      options={catalogOptions}
      models={models}
      variantsByOptionId={Object.fromEntries(rows)}
      configurationUsageCounts={configurationUsageCounts}
      hqStandardCosts={hqStandardCosts}
      initiallySelectedId={selected}
    />
  </AdminPage>;
}
