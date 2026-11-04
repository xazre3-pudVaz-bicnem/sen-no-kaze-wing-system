import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const shell = read('components/auth/auth-shell.tsx');

describe('会員向け認証画面の共通レイアウト', () => {
  it('写真を使わず、画面幅を問わずフォームを中央に配置する', () => {
    expect(shell).not.toContain("next/image");
    expect(shell).not.toContain('bedroom-seaview.webp');
    expect(shell).not.toContain('lg:grid-cols-2');
    expect(shell).toContain('flex min-h-[60vh] justify-center');
    expect(shell).toContain('w-full max-w-md');
    expect(shell).toContain('{children}');
  });

  it('会員登録・ログイン・パスワード再設定の全画面に共通のレイアウトを使う', () => {
    for (const page of [
      'app/(site)/register/page.tsx',
      'app/(site)/login/page.tsx',
      'app/(site)/reset-password/page.tsx',
      'app/(site)/reset-password/update/page.tsx',
    ]) {
      expect(read(page)).toContain('<AuthShell');
    }
  });
});
