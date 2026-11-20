import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const profile = read('app/(site)/mypage/profile/page.tsx');
const page = read('app/(site)/mypage/withdrawal/page.tsx');
const detail = read('app/admin/customer-management/[id]/page.tsx');
const action = read('lib/actions/customer-account-lifecycle.ts');

describe('会員退会/削除UI：バックエンド未接続時の安全境界', () => {
  it('本人のアカウント画面から退会申請へ進み、即時削除と誤認させない', () => {
    expect(profile).toContain("user.role === 'customer'");
    expect(profile).toContain('href="/mypage/withdrawal"');
    expect(page).toContain('requestCustomerWithdrawalAction');
    expect(page).toContain('申請の受付であり、アカウント削除・ログイン停止の完了を意味しません');
    expect(page).toContain('name="confirmed"');
  });
  it('顧客管理の削除操作はadminにだけ表示し、明示確認を挟む', () => {
    expect(detail).toContain("actor.role === 'admin'");
    expect(detail).toContain('deleteUnusedCustomerAccountAction');
    expect(detail).toContain('ConfirmSubmit');
    expect(detail).toContain('表示中の案件件数だけで未使用と判定しません');
  });
  it('本人/本部をサーバーで検証し、RPCが未適用なら削除しない', () => {
    expect(action).toContain("user.role !== 'customer'");
    expect(action).toContain('await requireAdmin(');
    expect(action).toContain("profile.role_code !== 'customer'");
    expect(action).toContain('actor.id === customerId');
    expect(action).toContain('isDemoFallback() || isLocalMode()');
    expect(action).toContain("error.code === 'PGRST202'");
    expect(action).toContain("db.rpc('request_customer_account_withdrawal')");
    expect(action).toContain("db.rpc('delete_unused_customer_account'");
    expect(action).not.toContain('auth.admin.deleteUser');
    expect(action).not.toContain(".from('profiles').delete()");
    expect(action).not.toContain('service_role');
  });
});
