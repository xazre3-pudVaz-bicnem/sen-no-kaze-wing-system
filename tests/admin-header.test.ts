import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const shell = fs.readFileSync(path.join(root, 'components/admin/admin-shell.tsx'), 'utf8');
const dismissibleDetails = fs.readFileSync(
  path.join(root, 'components/admin/dismissible-details.tsx'),
  'utf8',
);
const layout = fs.readFileSync(path.join(root, 'app/admin/layout.tsx'), 'utf8');
const session = fs.readFileSync(path.join(root, 'lib/auth/session.ts'), 'utf8');
const localAuth = fs.readFileSync(path.join(root, 'lib/auth/local-auth.ts'), 'utf8');

describe('管理画面共通ヘッダー', () => {
  it('既存プロフィールの氏名と会社名を表示情報として渡す', () => {
    expect(session).toContain(".select('role_code, full_name, company_name, email')");
    expect(session).toContain('company_name: profile?.company_name ?? null');
    expect(localAuth).toContain('company_name: profile.company_name');
    expect(layout).toContain('fullName={user.full_name}');
    expect(layout).toContain('companyName={user.company_name}');
  });

  it('ヘッダー専用の業務ロール名を使い、既存ROLE_LABELSはfallbackに残す', () => {
    expect(shell).toContain("admin: '本部'");
    expect(shell).toContain("master_dealer: '総代理店'");
    expect(shell).toContain("dealer: '代理店'");
    expect(shell).toContain('ADMIN_HEADER_ROLE_LABELS[role] ?? ROLE_LABELS[role]');
  });

  it('氏名・会社名の未登録時にも自然に表示できる', () => {
    expect(shell).toContain("const displayName = fullName.trim() || '氏名未登録';");
    expect(shell).toContain('const displayCompany = companyName?.trim() || null;');
    expect(shell).toContain('{displayCompany &&');
  });

  it('通知をヘッダーに残し、補助操作をアカウントメニューへまとめる', () => {
    expect(shell).toContain('href="/admin/notifications"');
    expect(shell).toContain('アカウントメニュー');
    expect(shell).toContain('href="/admin/manual"');
    expect(shell).toContain('操作マニュアル');
    expect(shell).toContain('href="/"');
    expect(shell).toContain('公開サイト');
    expect(shell).toContain('action={signOutAction}');
    expect(shell).toContain('ログアウト');
  });

  it('中幅PCでは氏名を残し、会社名は広い画面で表示する', () => {
    expect(shell).toContain('hidden min-w-0 max-w-64 text-right md:block');
    expect(shell).toContain('hidden truncate text-[0.68rem] leading-4 text-muted lg:block');
    expect(shell).toContain('w-[min(18rem,calc(100vw-2rem))]');
    expect(shell).toContain('{roleLabel}');
    expect(shell).toContain('<span>アカウント</span>');
  });

  it('アカウントメニューは枠外クリックで閉じる', () => {
    expect(shell).toContain('<DismissibleDetails className="group relative shrink-0">');
    expect(dismissibleDetails).toContain("document.addEventListener('pointerdown', handlePointerDown)");
    expect(dismissibleDetails).toContain('!details.contains(event.target)');
    expect(dismissibleDetails).toContain('details.open = false');
  });
});
