import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const controls = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-lifecycle-controls.tsx'), 'utf8');

describe('商品台帳の商品状態UI', () => {
  it('下書き・登録済み・取扱終了を一覧で分けて表示できる', () => {
    expect(client).toContain("type LifecycleFilter = '' | 'published' | 'draft' | 'archived'");
    expect(client).toContain('登録済み <span');
    expect(client).toContain('下書き <span');
    expect(client).toContain('取扱終了 <span');
    expect(client).toContain("isOptionArchived(lifecycleOption(option))");
  });

  it('取扱終了商品も商品台帳から選択・編集できる', () => {
    expect(client).toContain('取扱終了の商品も履歴用として残し、一覧から確認・編集できます。');
    expect(client).toContain('状態・商品情報を編集');
    expect(client).toContain('商品情報を編集');
    expect(client).toContain('商品情報画面から取扱を再開できます。');
  });

  it('登録済みは見積で選択可とし、シミュレーター表示だけを別設定にする', () => {
    expect(client).toContain('label="見積"');
    expect(client).toContain("? '選択可' : '新規選択不可'");
    expect(client).toContain('label="シミュレーター"');
    expect(client).toContain("lifecycleOption(selected).simulator_visible !== false");
    expect(controls).toContain('登録済みの商品は見積で選択できます。シミュレーター表示だけを別に設定できます。');
    expect(controls).toContain('シミュレーターに表示する');
  });

  it('取扱終了と再開の操作を商品情報画面から行える', () => {
    expect(controls).toContain('取扱を終了する');
    expect(controls).toContain('取扱を再開する');
    expect(controls).toContain('過去の案件・見積・履歴はそのまま残ります。');
  });

  it('旧来の複雑な取扱状態シェルを残さない', () => {
    for (const obsolete of [
      '自組織の取扱',
      '本部判断で停止',
      'メーカー状況',
      '廃番にする',
      '廃番訂正',
    ]) {
      expect(client).not.toContain(obsolete);
    }
  });
});
