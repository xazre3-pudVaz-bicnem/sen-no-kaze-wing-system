import { describe, it, expect } from 'vitest';
import { parseProductImportScope, narrowProductImport } from '@/lib/domain/cost-import-product-scope';
import type { CostImportProduct } from '@/lib/data/option-cost-import';
import { readFileSync } from 'node:fs';

const ID = '3348c055-7121-4799-8c65-d111a2d2dcb9';
const OTHER = '00000000-0000-4000-8000-000000000002';
const data: CostImportProduct[] = [
  { id: ID, productNo: 'PRD-000163', name: 'エアコン', categoryName: 'エアコン', maker: '三菱',
    amount: 480000, currentAmount: null, state: 'import',
    choices: [{ id:'00000000-0000-4000-8000-000000000003', name:'色',groupName:'色',amount:0,currentAmount:null,state:'import' }] },
  { id: OTHER, productNo:'PRD-000164',name:'他の商品',categoryName:'その他',maker:'他',
    amount:100000,currentAmount:null,state:'import',choices:[] },
];

describe('商品本体の原価Version限定取り込み', () => {
  it('IDと金額のどちらかが欠落・不正なら止める', () => {
    expect(parseProductImportScope(undefined,undefined)).toBeNull();
    for (const [id,amount] of [[ID,undefined],[undefined,'480000'],['not-uuid','480000'],[ID,'0'],[ID,'-100'],[ID,'480000.5'],[ID,'100000001']]) {
      expect(parseProductImportScope(id,amount)).toEqual({valid:false});
    }
    expect(parseProductImportScope(ID.toUpperCase(),'480000')).toEqual({valid:true,id:ID,amount:480000});
  });

  it('商品1件だけに限定して、選択肢をすべて除外する', () => {
    const narrowed=narrowProductImport(data,{id:ID,amount:480000});
    expect(narrowed).toHaveLength(1);
    expect(narrowed?.[0].id).toBe(ID);
    expect(narrowed?.[0].choices).toEqual([]);
  });

  it('金額変更・Version登録済み・対象外・別途見積の場合は停止する', () => {
    expect(narrowProductImport(data,{id:ID,amount:490000})).toBeNull();
    expect(narrowProductImport(data,{id:'00000000-0000-4000-8000-000000000009',amount:480000})).toBeNull();
    expect(narrowProductImport([{...data[0],currentAmount:480000,state:'same'}],{id:ID,amount:480000})).toBeNull();
    expect(narrowProductImport([{...data[0],state:'por'}],{id:ID,amount:480000})).toBeNull();
  });

  it('専用フォームでは商品1件だけを許可し、従来のDB RPC・本部認証・選択肢限定も保持する', () => {
    const page=readFileSync('app/admin/options/cost-import/page.tsx','utf8');
    const action=readFileSync('lib/actions/option-cost-import.ts','utf8');
    expect(page).toContain('narrowProductImport(candidates.products, productScope)');
    expect(page).toContain('productOnly &&');
    expect(page).toContain('!productOnly && <ChoiceRows product={product} />');
    expect(page).toContain('name="product_scope_id"');
    expect(page).toContain('name="product_scope_amount"');
    expect(action).toContain('items.length !== 1');
    expect(action).toContain("items[0].kind !== 'option'");
    expect(action).toContain('items[0].id !== singleProduct.id');
    expect(action).toContain('items[0].amount !== singleProduct.amount');
    expect(action).toContain("db.rpc('import_option_standard_costs'");
    expect(action).toContain('await requireAdmin(PAGE)');
    expect(action).toContain("item.kind !== 'choice' || item.amount !== 0");
  });
});
