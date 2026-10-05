import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledgerPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
const ledgerClient = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const newOptionPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'), 'utf8');
const editOptionPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'), 'utf8');
const adminActions = fs.readFileSync(path.resolve(process.cwd(), 'lib/actions/admin.ts'), 'utf8');

describe('商品台帳の商品登録・編集の戻り導線', () => {
  it('商品台帳から新規登録と編集へreturn_toを渡す', () => {
    expect(ledgerPage).toContain('/admin/options/new?return_to=%2Fadmin%2Fledger');
    expect(ledgerClient).toContain('/admin/options/${selected.id}?return_to=%2Fadmin%2Fledger');
  });

  it('商品台帳から来た場合だけ戻る文言を商品台帳に合わせる', () => {
    for (const page of [newOptionPage, editOptionPage]) {
      expect(page).toContain("returnTo?.startsWith('/admin/ledger')");
      expect(page).toContain("'商品台帳へ戻る'");
      expect(page).toContain("'見積テンプレートへ戻る'");
      expect(page).toContain("'一覧へ戻る'");
    }
    expect(newOptionPage).toContain('returnTo && !returnToLedger');
    expect(newOptionPage).toContain('見積テンプレートの商品追加から移動しています。');
  });

  it('保存・STEP2・公開までreturn_toを維持する', () => {
    expect(newOptionPage).toContain('returnTo={returnTo}');
    expect(editOptionPage).toContain("params.set('return_to', returnTo)");
    expect(editOptionPage).toContain('returnTo={returnTo}');
    expect(editOptionPage).toContain('name="return_to" value={returnTo}');
    expect(adminActions).toContain('return_to: returnTo');
    expect(adminActions).toContain("if (returnTo) search.set('return_to', returnTo)");
    expect(adminActions).toContain("returnUrl.searchParams.set('created_option', id)");
  });
});
