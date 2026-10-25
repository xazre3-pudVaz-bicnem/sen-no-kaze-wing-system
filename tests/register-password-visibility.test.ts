import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forms = fs.readFileSync(path.join(process.cwd(), 'components/auth/auth-forms.tsx'), 'utf8');
const registration = forms.slice(forms.indexOf('export function RegisterForm('), forms.indexOf('export function ResetRequestForm('));
const login = forms.slice(forms.indexOf('export function LoginForm('), forms.indexOf('export function RegisterForm('));
const passwordReset = forms.slice(forms.indexOf('export function UpdatePasswordForm('));

describe('会員登録のパスワード表示切替', () => {
  it('初期状態は伏せ字で、表示／非表示ボタンで入力タイプを切り替える', () => {
    expect(registration).toContain('const [showPassword, setShowPassword] = useState(false);');
    expect(registration).toContain("type={showPassword ? 'text' : 'password'}");
    expect(registration).toContain('onClick={() => setShowPassword((visible) => !visible)}');
    expect(registration).toContain('aria-pressed={showPassword}');
  });

  it('切替ボタンはフォームを送信せず、入力補助と必須条件を維持する', () => {
    expect(registration).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => setShowPassword/);
    expect(registration).toContain("aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}");
    expect(registration).toContain('data-testid="register-password-visibility"');
    expect(registration).toContain('autoComplete="new-password"');
    expect(registration).toContain('minLength={8}');
    expect(registration).toContain('name="password"');
    expect(registration).toContain('useActionState(signUpAction, initial)');
  });

  it('ログインとパスワード再設定の動作は変更しない', () => {
    expect(login).toContain('type="password" autoComplete="current-password"');
    expect(passwordReset).toContain('type="password" autoComplete="new-password"');
    expect(login).not.toContain('register-password-visibility');
    expect(passwordReset).not.toContain('register-password-visibility');
  });
});
