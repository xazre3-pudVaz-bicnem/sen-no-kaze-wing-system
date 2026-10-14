import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const action = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/unused-published-product-delete.ts'),
  'utf8'
);

describe('登録済み未使用商品の削除エラー表示', () => {
  it('後続の管理情報FKが削除を止めてもDB内部情報をブラウザへ出さない', () => {
    expect(action).toContain("error.code === '23503'");
    expect(action).toContain('DELETE_BLOCKED_BY_MANAGEMENT_DATA');
    expect(action).toContain('この商品には削除できない管理情報があります。登録済みのまま残してください。');
    expect(action).not.toContain('constraint_name');
    expect(action).not.toContain('option_hq_standard_costs');
  });

  it('保存などと重なったときは、rawのlock timeout・deadlockではなく再試行できる案内を出す', () => {
    expect(action).toContain("error.code === '55P03' || error.code === '40P01'");
    expect(action).toContain('現在ほかの処理で使用中のため削除できません。少し時間をおいて再度お試しください。');
    expect(action).toContain('VALIDATION|FORBIDDEN|NOT_FOUND|UNAUTHENTICATED|LOCKED');
  });
});
