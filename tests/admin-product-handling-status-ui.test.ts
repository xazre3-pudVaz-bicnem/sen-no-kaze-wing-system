import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');

describe('商品台帳の取扱状況UI', () => {
  it('一覧の5列構成を維持し、未接続の取扱状態を推測しない', () => {
    expect(client).toContain('<SortHeader label="商品"');
    expect(client).toContain('<SortHeader label="カテゴリー"');
    expect(client).toContain('<SortHeader label="商品価格（税別）"');
    expect(client).toContain('<SortHeader label="状態"');
    expect(client).toContain('<SortHeader label="更新日"');
    expect(client).toContain('data-product-handling-status-slot="pending-db"');
    expect(client).toContain('お客様選択可 / 取扱停止 / 本部判断で停止 / 廃番');
  });

  it('登録状態とは別に3つの取扱要因を独立表示する', () => {
    expect(client).toContain('data-product-handling-status-shell="pending-db"');
    expect(client).toContain('>取扱状況</h3>');
    expect(client).toContain('label="自組織の取扱" value={<PendingDbValue />}');
    expect(client).toContain('label="本部判断" value={<PendingDbValue />}');
    expect(client).toContain('label="メーカー状況" value={<PendingDbValue />}');
    expect(client).toContain('登録状態とは別に、自組織・本部判断・メーカー状況を独立して確認します。');
  });

  it('将来操作は保存処理へ接続せず無効なUIシェルにする', () => {
    for (const label of [
      '取扱停止にする',
      '取扱再開',
      '本部判断で停止',
      '本部判断による停止を解除',
      '廃番にする',
      '廃番訂正',
    ]) {
      expect(client).toContain(`disabled>${label}</button>`);
    }
    expect(client).toContain('client側だけで状態を保存しません。');
  });

  it('お客様選択とシミュレーター標準使用を別項目として接続待ちにする', () => {
    expect(client).toContain('data-customer-simulator-status-shell="pending-db"');
    expect(client).toContain('>お客様のシミュレーター</h3>');
    expect(client).toContain('label="お客様選択" value={<PendingDbValue />}');
    expect(client).toContain('label="対象モデル・仕様"');
    expect(client).toContain('selected.spec_codes.length ? selected.spec_codes.join');
    expect(client).toContain('label="シミュレーター標準での使用状況" value={<PendingDbValue />}');
    expect(client).toContain('「お客様選択」と「シミュレーター標準での使用状況」は別の情報です。');
  });

  it('既存表示値からお客様選択可否を推測しない', () => {
    expect(client).not.toContain("selected.preview_key || selected.affects_views.length ? '対象' : '対象外'");
    expect(client).not.toContain("owner_id ? 'お客様選択可'");
  });
});
