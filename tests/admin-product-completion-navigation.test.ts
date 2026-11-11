import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const optionPage = read('app/admin/options/[id]/page.tsx');
const editFlow = read('components/admin/registered-option-edit-flow.tsx');
const ledgerPage = read('app/admin/ledger/page.tsx');
const ledgerClient = read('components/admin/product-ledger-client.tsx');
const actions = read('lib/actions/admin.ts');

describe('商品公開・編集完了後の商品台帳への移動', () => {
  it('新規商品の途中保存は既存STEP1への遷移を維持し、STEP2公開成功だけ台帳へ戻す', () => {
    expect(actions).toContain("step: 'info'");
    expect(actions).toContain("redirect('/admin/options/' + createdId");
    expect(optionPage).toContain('action={publishOptionAction}');
    expect(optionPage).toContain('name="return_to" value="/admin/ledger"');
    expect(actions).toContain("returnUrl.searchParams.set('created_option', id)");
    expect(actions).toContain("redirect(previewUrl({ error:");
    expect(optionPage).toContain('name="return_to" value={returnTo}');
  });

  it('登録済み商品の正式反映が成功した場合だけ台帳へ戻り、失敗・競合時は確認画面に残る', () => {
    const applyChanges = editFlow.slice(editFlow.indexOf('  const applyChanges = async () => {'), editFlow.indexOf('\n  return (', editFlow.indexOf('  const applyChanges = async () => {')));
    expect(applyChanges).toContain('saveOptionAction(initialState, review.formData)');
    expect(applyChanges).toContain('setState(result)');
    expect(applyChanges).toMatch(/if \(result\.ok\) \{\s+router\.push\(`\/admin\/ledger\?updated_option=/);
    expect(applyChanges).not.toContain('router.refresh()');
    expect(editFlow).toContain('反映に成功すると商品台帳一覧へ戻ります');
    expect(editFlow).toContain('価格単位・本部基準原価の個別保存とは別の操作');
  });

  it('台帳に成功メッセージと操作対象の強調表示を付け、従来の絞り込み・並び替えは残す', () => {
    expect(ledgerPage).toContain('商品を公開しました。');
    expect(ledgerPage).toContain('商品を更新しました。');
    expect(ledgerPage).toContain('catalogOptions.some((option) => option.id === id)');
    expect(ledgerPage).toContain('recentlyChangedId={recentlyChangedId}');
    expect(ledgerClient).toContain("recentlyChangedId === o.id");
    expect(ledgerClient).toContain('data-recently-changed=');
    expect(ledgerClient).toContain('completionFocusHandled.current');
    expect(ledgerClient).toContain('setPage(Math.floor(index / pageSize) + 1)');
    expect(ledgerClient).toContain('optionMatchesLedgerFilters');
    expect(ledgerClient).toContain('compareOptions(a, b, sort, categoryMap)');
    expect(ledgerClient).toContain('initiallySelectedId={selected}');
  });
});
