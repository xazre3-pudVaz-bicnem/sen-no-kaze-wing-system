import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
// 商品状態の欄は 20261020110000（販売停止・廃番）で専用の部品に切り出した
const panel = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-sales-status-panel.tsx'), 'utf8');

describe('商品台帳の商品状態UI', () => {
  it('一覧は下書き・登録済み・販売停止・廃番を正式な商品状態として表示する', () => {
    expect(client).toContain('<SortHeader label="商品"');
    expect(client).toContain('<SortHeader label="カテゴリー"');
    expect(client).toContain('<SortHeader label="商品価格（税別）"');
    expect(client).toContain('<SortHeader label="状態"');
    expect(client).toContain('<SortHeader label="更新日"');
    expect(client).toContain('data-product-handling-status={state}');
    expect(client).toContain('productLedgerStateLabel(option)');
    expect(client).not.toContain('data-product-handling-status-slot="pending-db"');
  });

  it('商品状態カードから販売停止・再開・廃番・取り消しを正式保存処理へ接続する（画面が読んだ版を渡し、機能が有効なときだけ出す）', () => {
    expect(client).toContain('<ProductSalesStatusPanel option={selected} canEdit={canEdit} lifecycleEnabled={lifecycleEnabled} discontinueEnabled={discontinueEnabled} canRestoreDiscontinued={canRestoreDiscontinued} />');
    expect(panel).toContain('>商品状態</h3>');
    expect(panel).toContain('setProductLifecycleAction');
    expect(panel).toContain('setProductDiscontinuedAction');
    expect(panel).toContain("const operable = canEdit && lifecycleEnabled && option.status === 'published';");
    expect(panel).toContain('name="action" value="retire"');
    expect(panel).toContain('name="action" value="resume"');
    expect(panel).toContain('name="mode" value="discontinue"');
    expect(panel).toContain('name="mode" value="restore"');
    expect(panel).toContain('name="expected_updated_at" value={option.updated_at}');
    expect(panel).toContain('販売を停止する');
    expect(panel).toContain('販売を再開する');
    expect(panel).toContain('廃番にする');
    expect(panel).toContain('廃番を取り消す（販売停止に戻す）');
    expect(panel).toContain('過去の保存内容や発行済み見積は変更しません。');
    expect(panel).toContain('シミュレーター表示設定は以前の値を保持します。');
  });

  it('販売の再開は仕様・供給・価格の確認のチェックが必要。廃番・取り消しは理由が必須で、取り消しは本部の管理者だけに出す', () => {
    expect(panel).toContain('name="resume_confirmed" value="1" required');
    expect(panel).toContain('仕様・供給・価格を確認しました');
    expect((panel.match(/name="reason"\n\s+required/g) ?? []).length).toBe(2);
    expect(panel).toContain('{operable && discontinueEnabled && canRestoreDiscontinued && (');
    expect(panel).toContain('廃番の商品は販売を再開できません。');
  });

  it('下書きは販売停止にせず、不要時は削除する方針を表示する', () => {
    expect(client).toContain("productLedgerState(selected) === 'retired'");
    expect(panel).toContain('下書きは販売停止にしません。不要なら参照状況を確認して削除します。');
  });

  it('見積での選択可否とシミュレーター表示設定を別項目として扱う', () => {
    expect(client).toContain('>シミュレーター表示</h3>');
    expect(client).toContain('canEdit && lifecycleEnabled && isQuoteSelectableProduct(selected)');
    expect(client).toContain('isQuoteSelectableProduct(selected)');
    expect(client).toContain('productSimulatorVisibleSetting(selected)');
    expect(client).toContain('label="対象モデル・仕様"');
    expect(client).toContain('selected.spec_codes.length ? selected.spec_codes.join');
    expect(client).toContain('name="action" value={productSimulatorVisibleSetting(selected) ? \'hide_from_simulator\' : \'show_in_simulator\'}');
    expect(client).toContain('シミュレーターに表示しない');
    expect(client).toContain('シミュレーターに表示する');
    expect(client).toContain('販売停止・廃番の間はシミュレーターに表示されません。');
  });

  it('既存表示値からお客様選択可否を推測しない', () => {
    expect(client).not.toContain("selected.preview_key || selected.affects_views.length ? '対象' : '対象外'");
    expect(client).not.toContain("owner_id ? 'お客様選択可'");
  });
});
