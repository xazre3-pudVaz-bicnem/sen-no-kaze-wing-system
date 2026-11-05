import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 独自ドメイン（www.sen-no-kaze.com）への内部設定の統一（2026-10-29 先方の回答）。
 * URL はすべて NEXT_PUBLIC_SITE_URL から作り、コードに vercel.app を書かない。本番の設定の値は docs/custom-domain-settings.md。
 */
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('独自ドメインへの内部設定の統一', () => {
  it('Supabase Auth の Site URL は www。Redirect URLs に www を足し、切り替え前のメールのため vercel.app と localhost は残す', () => {
    const config = read('supabase/config.toml');
    expect(config).toContain('site_url = "https://www.sen-no-kaze.com"');
    expect(config).toContain('"https://www.sen-no-kaze.com/auth/callback"');
    expect(config).toContain('"https://www.sen-no-kaze.com/**"');
    expect(config).toContain('"https://sen-no-kaze-wing-system.vercel.app/auth/callback"');
    expect(config).toContain('"http://localhost:3000/auth/callback"');
    expect(config).not.toContain('site_url = "https://sen-no-kaze-wing-system.vercel.app"');
  });

  it('アプリのコードは vercel.app を直接書かない（URL は NEXT_PUBLIC_SITE_URL から作る）', () => {
    const sources = ['lib/site.ts', 'lib/seo.ts', 'app/layout.tsx', 'app/robots.ts', 'app/sitemap.ts', 'lib/mail/send.ts', 'lib/actions/auth.ts'];
    for (const file of sources) expect(read(file)).not.toContain('vercel.app');
    expect(read('lib/site.ts')).toContain('process.env.NEXT_PUBLIC_SITE_URL');
  });

  it('README と .env.example の本番の URL は www', () => {
    expect(read('README.md')).toContain('本番: https://www.sen-no-kaze.com');
    expect(read('.env.example')).toContain('https://www.sen-no-kaze.com');
  });

  it('本番の設定（Vercel・Supabase・SMTP）の今の値と変更の内容を docs にまとめる', () => {
    const doc = read('docs/custom-domain-settings.md');
    expect(doc).toContain('NEXT_PUBLIC_SITE_URL');
    expect(doc).toContain('Site URL');
    expect(doc).toContain('Redirect URLs');
    expect(doc).toContain('SMTP');
  });
});
