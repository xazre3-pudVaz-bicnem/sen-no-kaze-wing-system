import { describe, expect, it } from 'vitest';
import { narrowZeroCostChoices, parseChoiceImportScope } from '@/lib/domain/cost-import-choice-scope';
import type { CostImportProduct } from '@/lib/data/option-cost-import';
import fs from 'node:fs';
import path from 'node:path';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const UUID3 = '00000000-0000-4000-8000-000000000003';
const mk = (id: string, amount: number, state: 'import' | 'por' | 'same') => ({
  id, name: '選択肢', groupName: '色', amount, currentAmount: state === 'same' ? amount : null, state,
});
const products: CostImportProduct[] = [
  {
    id: 'product-1', name: 'A商品',productNo:null,categoryName:'屋根',maker:'A',
    amount:10000,currentAmount:10000,state:'same',
    choices:[mk(UUID1,0,'import'),mk(UUID2,1200,'import'),mk(UUID3,0,'same')],
  },
  {
    id:'product-2',name:'別商品',productNo:null,categoryName:'別',maker:'B',
    amount:3000,currentAmount:null,state:'import',
    choices:[mk('00000000-0000-4000-8000-000000000004',0,'import')],
  },
];

describe('原価差額0円の限定取り込み：対象外の一括登録を遮断する',() => {
  it('絞り込み指定がない通常画面だけ全商品を表示し、不正指定は全面表示に戻さない',() => {
    expect(parseChoiceImportScope(undefined)).toBeNull();
    expect(parseChoiceImportScope('')).toEqual({valid:false,ids:[]});
    expect(parseChoiceImportScope(UUID1+','+UUID1)).toEqual({valid:false,ids:[]});
    expect(parseChoiceImportScope('bad')).toEqual({valid:false,ids:[]});
    expect(parseChoiceImportScope(UUID1)).toEqual({valid:true,ids:[UUID1]});
  });
  it('指定した0円未記録の選択肢だけが残り、商品本体と別商品の選択肢は残さない',() => {
    const scoped=narrowZeroCostChoices(products,[UUID1]);
    expect(scoped).toHaveLength(1);
    expect(scoped?.[0].id).toBe('product-1');
    expect(scoped?.[0].choices.map(c=>c.id)).toEqual([UUID1]);
  });
  it('指定が非0円・記録済み・別途見積・対象が消えた場合は失敗させる',() => {
    expect(narrowZeroCostChoices(products,[UUID2])).toBeNull();
    expect(narrowZeroCostChoices(products,[UUID3])).toBeNull();
    expect(narrowZeroCostChoices(products,['00000000-0000-4000-8000-000000000099'])).toBeNull();
    expect(narrowZeroCostChoices([{...products[0],choices:[mk(UUID1,0,'por')]}],[UUID1])).toBeNull();
  });
  it('限定画面では商品本体のチェックボックスを隠すが、既存の正式な取り込みRPCは変えない',() => {
    const page=fs.readFileSync(path.resolve('app/admin/options/cost-import/page.tsx'),'utf8');
    const action=fs.readFileSync(path.resolve('lib/actions/option-cost-import.ts'),'utf8');
    expect(page).toContain("parseChoiceImportScope(sp.choice_ids)");
    expect(page).toContain('!scopedChoiceOnly && selectable');
    expect(page).toContain('name="choice_scope"');
    expect(page).toContain('指定された選択肢のいずれかが未登録の0円ではなくなったか');
    expect(action).toContain("db.rpc('import_option_standard_costs'");
    expect(action).toContain("item.kind !== 'choice' || item.amount !== 0");
    expect(action).toContain('items.length !== scopeIds.length');
    expect(action).toContain('choice_ids=');
  });
});
