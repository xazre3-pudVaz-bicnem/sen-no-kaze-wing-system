import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { MANUFACTURER_PRODUCT_URL_PATTERN, MANUFACTURER_PRODUCT_URL_PATTERN_SOURCE, normalizeManufacturerProductUrl } from '@/lib/domain/manufacturer-product-url';
import { optionSchema } from '@/lib/validation';

const source = (file: string) => readFileSync(file, 'utf8');
const field = optionSchema.shape.manufacturer_product_url;

describe('メーカー公式商品ページの任意リンク', () => {
  it('既存商品・未入力ではNULLとなり、既存の保存経路を壊さない', () => {
    expect(field.parse(undefined)).toBeNull();
    expect(field.parse(null)).toBeNull();
    expect(field.parse('')).toBeNull();
    expect(field.parse('  ')).toBeNull();
  });

  it('HTTPSのメーカー商品ページURLをトリムして保持する', () => {
    expect(field.parse(' https://www.lixil.co.jp/lineup/entrance/giesta/ ')).toBe(
      'https://www.lixil.co.jp/lineup/entrance/giesta/'
    );
  });

  it('日本語のパス・空白は %エンコードした形で保存する（DB の ASCII の決まりに合わせる。ブラウザが開く URL と同じ）', () => {
    expect(field.parse('https://www.example.co.jp/商品/ドア A')).toBe('https://www.example.co.jp/%E5%95%86%E5%93%81/%E3%83%89%E3%82%A2%20A');
    expect(field.parse('HTTPS://WWW.EXAMPLE.COM/P')).toBe('https://www.example.com/P');
    expect(normalizeManufacturerProductUrl(' https://www.example.com/a\u00a0b ')).toBe('https://www.example.com/a%C2%A0b');
  });

  it('誤りは 1 つだけ返す（URL の形・1000 文字のどちらか）', () => {
    expect(field.safeParse('not a URL').error?.issues).toHaveLength(1);
    expect(field.safeParse('https://www.lixil.co.jp/' + 'a'.repeat(1000)).error?.issues.map((issue) => issue.message)).toEqual([
      'URLは1000文字以内で入力してください（日本語などは%エンコードした長さで数えます）',
    ]);
  });

  it('非HTTPS・不正URL・認証情報つきURL・1000文字超過を拒否する', () => {
    const invalid = [
      'http://www.lixil.co.jp/product',
      'javascript:alert(1)',
      'data:text/html,test',
      'https://user:pass@www.lixil.co.jp/',
      'not a URL',
      'https://www.lixil.co.jp/' + 'a'.repeat(1000),
      'https://exa<mple.com/p',
      'https://a%40b/',
    ];
    for (const url of invalid) expect(field.safeParse(url).success).toBe(false);
  });

  it('STEP1フォーム・保存・共通商品詳細が同じ項目を利用する', () => {
    const form = source('components/admin/forms.tsx');
    const actions = source('lib/actions/admin.ts');
    const detail = source('components/simulator/product-detail.tsx');
    const registered = source('components/admin/registered-option-edit-flow.tsx');
    const preview = source('components/admin/option-customer-preview.tsx');
    expect(form).toContain('name="manufacturer_product_url"');
    expect(form).toContain('value={option.manufacturer_product_url ??');
    expect(actions).toContain("manufacturer_product_url: formData.get('manufacturer_product_url')");
    expect(registered).toContain('name="manufacturer_product_url"');
    expect(registered).toContain('return url === null ? null : normalizeManufacturerProductUrl(url);');
    // 入力欄は文字数で黙って切らない（1000 文字を超えたら保存の検査で知らせる）
    expect(form).not.toMatch(/name="manufacturer_product_url"[^>]*maxLength/);
    expect(registered).not.toContain('maxLength={1000}');
    // 商品の複製では URL を引き継ぐ
    expect(form).toContain("<input type=\"hidden\" name=\"manufacturer_product_url\" value={copySource?.manufacturer_product_url ?? ''} />");
    expect(registered).toContain("key: 'manufacturer_product_url'");
    expect(detail).toContain('safeManufacturerProductUrl(option.manufacturer_product_url)');
    expect(detail).toContain('data-testid="manufacturer-product-link"');
    expect(detail).toContain('target="_blank"');
    expect(detail).toContain('rel="noopener noreferrer"');
    expect(preview).toContain('<ProductDetail');
    // 保存・DB と同じ決まり（lib/domain/manufacturer-product-url）を、確認画面へ進む前とリンクの表示にも使う
    expect(registered).toContain('isValidManufacturerProductUrl(next.option.manufacturer_product_url)');
    expect(detail).toContain('isValidManufacturerProductUrl(trimmed)');
    // STEP 2 で止まったサーバーの項目エラーを、まとめて出す（無言で失敗しない）
    expect(registered).toContain('{fieldErrorMessages.length > 0 && <Alert tone="danger">');
  });

  it('migrationはNULL可で、画像/PDF・金額・権限の構造を変更しない', () => {
    const sql = source('supabase/migrations/20261111160000_manufacturer_product_url.sql');
    expect(sql).toContain('add column manufacturer_product_url text;');
    expect(sql).toContain('manufacturer_product_url is null');
    expect(sql).toContain('options_manufacturer_product_url_https_check');
    expect(sql).not.toMatch(/(drop table|drop column|delete from|update public\.)/i);
  });

  it('migrationは代理店・総代理店の拡張の後ろの番号で、旧番号のファイルを残さない（2026-11-04 の先方回答 C-4）', () => {
    const files = readdirSync('supabase/migrations');
    expect(files).toContain('20261111160000_manufacturer_product_url.sql');
    expect(files).not.toContain('20261020140000_manufacturer_product_url.sql');
    const later = files.filter((file) => file.endsWith('.sql') && file < '20261111160000_manufacturer_product_url.sql' && file.includes('manufacturer_product_url'));
    expect(later).toEqual([]);
  });

  it('DBでもhttps・認証情報なし・空白なし・1000文字以内に限り、列ごとの読み取り許可と読む列の一覧に足す（v2.5 PR-C1b）', () => {
    const sql = source('supabase/migrations/20261111160000_manufacturer_product_url.sql');
    // DB とアプリは同じ正規表現（ASCII の範囲だけで書き、PostgreSQL と JavaScript の解釈を分けない）
    expect(sql).toContain(`manufacturer_product_url ~* '${MANUFACTURER_PRODUCT_URL_PATTERN_SOURCE}'`);
    expect(MANUFACTURER_PRODUCT_URL_PATTERN.flags).toBe('i');
    expect(sql).toContain('char_length(manufacturer_product_url) <= 1000');
    expect(sql).toContain('grant select (manufacturer_product_url) on public.options to anon, authenticated;');
    const columns = JSON.parse(source('lib/data/legacy-price-columns.json')) as Record<string, { select: string[]; price: string[] }>;
    expect(columns.options.select).toContain('manufacturer_product_url');
    expect(columns.options.price).not.toContain('manufacturer_product_url');
    // 実 DB の実行時検査（MPU-1〜30）をリハーサルに登録している
    const check = source('scripts/db-rehearsal/check.mjs');
    expect(check).toContain("import { runtimeManufacturerProductUrl } from './runtime-manufacturer-product-url.mjs';");
    expect(check).toContain('runtime = mergeRuntime(runtime, await runtimeManufacturerProductUrl(client));');
  });

  it('アプリが保存する値は DB の検査を通り、アプリが拒む値は DB でも通らない（保存の前の %エンコードの後で比べる）', () => {
    // migration に書いた正規表現は ASCII の範囲だけなので、そのまま JavaScript の正規表現として DB と同じに読める
    const sql = source('supabase/migrations/20261111160000_manufacturer_product_url.sql');
    const sqlPattern = sql.match(/manufacturer_product_url ~\* '([^']+)'/)?.[1];
    expect(sqlPattern).toBe(MANUFACTURER_PRODUCT_URL_PATTERN_SOURCE);
    const pattern = new RegExp(sqlPattern!, 'i');
    const db = (value: string) => value.length <= 1000 && pattern.test(value);
    const samples = [
      'https:///path',
      'https:example.com',
      'https://www.example.com/a\tb',
      'https://www.lixil.co.jp/lineup/entrance/giesta/',
      'https://example.com/@maker/product?color=white#spec',
      'HTTPS://WWW.EXAMPLE.COM/P',
      'https://example.com:8443/products/1',
      'http://www.example.com/',
      'https://user:pass@www.example.com/',
      'https://user@www.example.com/',
      'https://www.example.com/a b',
      'javascript:alert(1)',
      'https://',
      'https://example.com/' + 'a'.repeat(981),
    ];
    for (const value of [...samples, 'https://www.example.com/a\u00a0b', 'https://www.example.co.jp/商品', 'https://exa<mple.com/p']) {
      const parsed = field.safeParse(value);
      expect(parsed.success ? db(String(parsed.data)) : false, value).toBe(parsed.success);
      // DB が通す（すでに ASCII の）値は、アプリも通す
      if (db(value)) expect(parsed.success, value).toBe(true);
    }
  });
});

describe('メーカー公式商品ページURL：ローカル検証モード（DB の検査と同じ判定）', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'wing-product-url-'));
    process.env.WING_LOCAL_DIR = dir;
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('https の URL を保存して読み直せ、DB が拒否する URL は保存せず前の値を残す', async () => {
    const store = new LocalStore();
    const source = (await store.listOptions())[0];
    expect(source).toBeTruthy();
    const { created_at: _createdAt, updated_at: _updatedAt, gallery_images: _galleryImages, ...base } = source;
    const url = 'https://www.lixil.co.jp/lineup/entrance/giesta/';
    await store.upsertOption({ ...base, manufacturer_product_url: url });
    expect((await store.getOption(source.id))?.manufacturer_product_url).toBe(url);

    for (const invalid of ['http://www.example.com/', 'https://user:pass@www.example.com/', 'https://www.example.com/a b', 'https://example.com/' + 'a'.repeat(981)]) {
      await expect(store.upsertOption({ ...base, manufacturer_product_url: invalid }), invalid).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect((await store.getOption(source.id))?.manufacturer_product_url).toBe(url);

    // 空にすると NULL に戻る
    await store.upsertOption({ ...base, manufacturer_product_url: null });
    expect((await store.getOption(source.id))?.manufacturer_product_url ?? null).toBeNull();
  });
});
