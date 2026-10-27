import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');

describe('商品台帳の商品状態UI', () => {
  it('一覧は下書き・登録済み・取扱終了を正式な商品状態として表示する', () => {
    expect(client).toContain('<SortHeader label="商品"');
    expect(client).toContain('<SortHeader label="カテゴリー"');
    expect(client).toContain('<SortHeader label="商品標準原価（税別）"');
    expect(client).toContain('<SortHeader label="状態"');
    expect(client).toContain('<SortHeader label="更新日"');
    expect(client).toContain('data-product-handling-status={state}');
    expect(client).toContain('productLedgerStateLabel(option)');
    expect(client).not.toContain('data-product-handling-status-slot="pending-db"');
  });

  it('商品状態カードから取扱終了と再開を正式保存処理へ接続する（画面が読んだ版を渡し、機能が有効なときだけ出す）', () => {
    expect(client).toContain('>商品状態</h3>');
    expect(client).toContain('setProductLifecycleAction');
    expect(client).toContain('selected.status === \'published\'');
    expect(client).toContain('name="action" value="retire"');
    expect(client).toContain('name="action" value="resume"');
    expect(client).toContain('name="expected_updated_at" value={selected.updated_at}');
    expect(client).toContain('canEdit && lifecycleEnabled && selected.status === \'published\'');
    expect(client).toContain('取扱を終了する');
    expect(client).toContain('取扱を再開する');
    expect(client).toContain('過去の保存内容や発行済み見積は変更しません。');
    expect(client).toContain('シミュレーター表示設定は以前の値を保持します。');
  });

  it('下書きは取扱終了にせず、不要時は削除する方針を表示する', () => {
    expect(client).toContain("productLedgerState(selected) === 'retired'");
    expect(client).toContain('下書きは取扱終了にしません。不要なら参照状況を確認して削除します。');
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
    expect(client).toContain('取扱終了中はシミュレーターに表示されません。');
  });

  it('既存表示値からお客様選択可否を推測しない', () => {
    expect(client).not.toContain("selected.preview_key || selected.affects_views.length ? '対象' : '対象外'");
    expect(client).not.toContain("owner_id ? 'お客様選択可'");
  });
});
