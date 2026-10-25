import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileSchema, quoteRequestSchema, signUpSchema } from '@/lib/validation';

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const forms = source('components/auth/auth-forms.tsx');
const registerForm = forms.slice(forms.indexOf('export function RegisterForm('), forms.indexOf('export function ResetRequestForm('));
const profileForm = source('components/mypage/profile-form.tsx');
const quoteForm = source('components/mypage/quote-request-form.tsx');
const signUpActionSource = source('lib/actions/auth.ts');

describe('会員登録の最小入力と見積依頼での連絡先取得', () => {
  const minimalSignup = {
    email: 'customer@example.com',
    password: 'SamplePass123',
    full_name: '山田 太郎',
    company_name: '',
    agree: 'on',
  };

  it('氏名・メール・パスワード・同意だけで新規登録を検証できる', () => {
    const result = signUpSchema.safeParse(minimalSignup);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.company_name).toBeNull();
      expect(Object.keys(result.data)).not.toContain('phone');
      expect(Object.keys(result.data)).not.toContain('address');
    }
  });

  it('メール、パスワード、氏名、規約同意は引き続き必須', () => {
    for (const key of ['email', 'password', 'full_name', 'agree'] as const) {
      const bad: Record<string, unknown> = { ...minimalSignup };
      delete bad[key];
      expect(signUpSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('会員登録画面から住所・電話番号を撤去し、保存側も未入力に対応する', () => {
    for (const name of ['phone', 'postal_code', 'address']) {
      expect(registerForm).not.toContain(`name="${name}"`);
    }
    expect(registerForm).toContain('電話番号・ご住所は、見積依頼をする際に入力していただきます。');
    expect(signUpActionSource).toContain('phone: null, postal_code: null, address: null');
    expect(signUpActionSource).toContain("const keys = ['email', 'full_name', 'company_name'];");
  });

  it('プロフィールは連絡先が空欄でも氏名などを更新できる', () => {
    const result = profileSchema.safeParse({
      full_name: '山田 太郎',
      company_name: '',
      phone: '',
      postal_code: '',
      address: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeNull();
      expect(result.data.address).toBeNull();
    }
    expect(profileForm).toContain('label="電話番号（任意）"');
    expect(profileForm).toContain('label="住所（任意）"');
    expect(profileSchema.safeParse({
      full_name: '山田 太郎', company_name: '', phone: 'not-a-phone',
      postal_code: '', address: '',
    }).success).toBe(false);
  });

  it('見積依頼では電話番号と住所の両方を引き続き必須とする', () => {
    const quote = {
      configuration_id: '6be66554-a2e2-47cf-b4e2-1acc0de74ef7',
      full_name: '山田 太郎',
      company_name: '',
      email: 'customer@example.com',
      phone: '090-1234-5678',
      address: '東京都千代田区1-1',
      site_address: '',
      message: '',
      expected_lock_version: null,
    };
    expect(quoteRequestSchema.safeParse(quote).success).toBe(true);
    expect(quoteRequestSchema.safeParse({ ...quote, phone: '' }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...quote, address: '' }).success).toBe(false);
    expect(quoteForm).toContain('label="電話番号" htmlFor="phone" required');
    expect(quoteForm).toContain('label="お客様のご住所（連絡先）" htmlFor="address"');
    expect(quoteForm).toContain('name="address" defaultValue={v.address} autoComplete="street-address" required');
  });
});
