import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import type { SessionUser } from '@/lib/data/store';
import {
  documentFileError,
  galleryChangesOf,
  galleryEditError,
  galleryImageFileError,
  hasOptionMediaChanges,
  optionMediaExpectedOf,
  optionMediaVersionOf,
  SERVER_ACTION_UPLOAD_MAX_BYTES,
} from '@/lib/domain/option-media-changes';
import { AUDIT_ACTION_LABELS, type OptionImage } from '@/lib/domain/types';

// 登録済み商品の追加画像・メーカー資料PDFの正式保存（PR #563。2026-11-04 の先方回答 C-4）

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20261105110000_option_media_changes.sql');
const actions = read('lib/actions/option-media.ts');
const flow = read('components/admin/registered-option-edit-flow.tsx');

const image = (id: string, caption: string | null, sortOrder: number): OptionImage => ({
  id,
  option_id: 'o',
  url: `/api/local-files/option-o/gallery/${id}.png`,
  alt: '',
  caption,
  sort_order: sortOrder,
  created_at: '2026-11-05T00:00:00.000Z',
});

describe('追加画像・メーカー資料の変更の判定', () => {
  const gallery = [image('a', '正面', 10), image('b', null, 20)];

  it('編集案から削除と説明・表示順の変更を作り、前後の空白だけの違いは変更にしない', () => {
    expect(
      galleryChangesOf(gallery, {
        a: { removed: false, caption: '  正面  ', order: '10' },
        b: { removed: true, caption: '', order: '20' },
      })
    ).toEqual({ delete: ['b'], update: [] });
    expect(galleryChangesOf(gallery, { a: { removed: false, caption: '', order: '5' } })).toEqual({
      delete: [],
      update: [{ id: 'a', caption: null, sort_order: 5 }],
    });
  });

  it('説明・表示順・ファイルの誤りは DB と同じ範囲で止める', () => {
    expect(galleryEditError({ removed: false, caption: 'a'.repeat(201), order: '1' })).toContain('200 文字以内');
    expect(galleryEditError({ removed: false, caption: '', order: '100001' })).toContain('100000 以下');
    expect(galleryEditError({ removed: false, caption: '', order: '-1' })).toContain('0 以上');
    expect(galleryEditError({ removed: true, caption: 'a'.repeat(300), order: 'x' })).toBeNull();
    expect(galleryImageFileError({ type: 'image/png', size: 1 })).toBeNull();
    expect(galleryImageFileError({ type: 'image/gif', size: 1 })).not.toBeNull();
    expect(galleryImageFileError({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).not.toBeNull();
    expect(documentFileError({ name: 'catalog.PDF', type: '', size: 1 })).toBeNull();
    expect(documentFileError({ name: 'catalog.pdf', type: 'text/html', size: 1 })).not.toBeNull();
    expect(documentFileError({ name: 'catalog.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 })).not.toBeNull();
    // サーバーアクションの送信上限 4MB（next.config）より小さい大きさまでをサーバーアクションで送る
    expect(SERVER_ACTION_UPLOAD_MAX_BYTES).toBeLessThan(4 * 1024 * 1024);
    expect(read('next.config.ts')).toContain("bodySizeLimit: '4mb'");
  });

  it('画面を開いた時点の状態と、画面を作り直すための印', () => {
    const expected = optionMediaExpectedOf({ gallery_images: gallery, manufacturer_document_url: null });
    expect(expected).toEqual({
      gallery: [
        { id: 'a', url: gallery[0].url, caption: '正面', sort_order: 10 },
        { id: 'b', url: gallery[1].url, caption: null, sort_order: 20 },
      ],
      manufacturer_document_url: null,
    });
    const version = optionMediaVersionOf({ gallery_images: gallery, manufacturer_document_url: null });
    expect(optionMediaVersionOf({ gallery_images: gallery, manufacturer_document_url: null })).toBe(version);
    expect(optionMediaVersionOf({ gallery_images: [image('a', '正面', 11), gallery[1]], manufacturer_document_url: null })).not.toBe(version);
    expect(optionMediaVersionOf({ gallery_images: gallery, manufacturer_document_url: '/api/local-files/option-o/manufacturer/x.pdf' })).not.toBe(version);
    expect(hasOptionMediaChanges({ delete: [], update: [], add: [], document: { action: 'keep' } })).toBe(false);
    expect(hasOptionMediaChanges({ delete: [], update: [], add: [], document: { action: 'remove' } })).toBe(true);
  });
});

describe.sequential('追加画像・メーカー資料の一括反映：ローカル検証モード（DB の apply_option_media_changes と同じ判定）', () => {
  let dir = '';
  const admin: SessionUser = { id: 'omc-admin', email: 'omc-admin@example.com', role: 'admin', full_name: '本部' };
  const customer: SessionUser = { id: 'omc-customer', email: 'omc-customer@example.com', role: 'customer', full_name: 'お客様' };
  const dealer: SessionUser = { id: 'omc-dealer', email: 'omc-dealer@example.com', role: 'dealer', full_name: '代理店' };
  const png = { bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png', fileName: 'photo.png' };
  const pdf = { bytes: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf', fileName: 'catalog.pdf' };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-option-media-'));
    process.env.WING_LOCAL_DIR = dir;
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function setup() {
    const store = new LocalStore();
    const [option, other] = (await store.listOptions()).filter((row) => row.status === 'published');
    const first = await store.uploadOptionImage(png, option.id);
    const second = await store.uploadOptionImage(png, option.id);
    await store.upsertOptionImage({ id: null, option_id: option.id, url: first, alt: option.name, caption: '正面', sort_order: 10 });
    await store.upsertOptionImage({ id: null, option_id: option.id, url: second, alt: option.name, caption: null, sort_order: 20 });
    const documentUrl = await store.uploadProductDocument(pdf, option.id);
    await store.setOptionManufacturerDocument(option.id, documentUrl);
    const current = async () => (await store.getOption(option.id))!;
    return { store, option, other, first, second, documentUrl, current };
  }

  it('お客様・持ち主でない代理店は反映できない', async () => {
    const { store, option, current } = await setup();
    const expected = optionMediaExpectedOf(await current());
    const changes = { delete: [], update: [], add: [], document: { action: 'remove' as const } };
    await expect(store.applyOptionMediaChanges(customer, option.id, expected, changes)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.applyOptionMediaChanges(dealer, option.id, expected, changes)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('画面を開いた後に追加画像・資料が変わっていたら反映しない', async () => {
    const { store, option, current } = await setup();
    const expected = optionMediaExpectedOf(await current());
    const stale = { ...expected, gallery: expected.gallery.map((row, index) => (index === 0 ? { ...row, caption: '開いた後に変わる前' } : row)) };
    await expect(
      store.applyOptionMediaChanges(admin, option.id, stale, { delete: [], update: [], add: [], document: { action: 'remove' } })
    ).rejects.toThrow('画面を開いた後にほかの操作で変わりました');
    await expect(
      store.applyOptionMediaChanges(admin, option.id, { ...expected, manufacturer_document_url: null }, { delete: [], update: [], add: [], document: { action: 'remove' } })
    ).rejects.toThrow('画面を開いた後にほかの操作で変わりました');
    expect((await current()).manufacturer_document_url).not.toBeNull();
  });

  it('ほかの商品のフォルダー・無いファイル・同じファイルは紐付けず、途中で止まったら何も変えない', async () => {
    const { store, option, other, first, second, current } = await setup();
    const otherFile = await store.uploadOptionImage(png, other.id);
    const before = await current();
    const expected = optionMediaExpectedOf(before);
    const secondId = before.gallery_images!.find((row) => row.url === second)!.id;
    for (const url of [otherFile, `/api/local-files/option-${option.id}/gallery/missing.png`, first]) {
      await expect(
        store.applyOptionMediaChanges(admin, option.id, expected, {
          delete: [secondId],
          update: [],
          add: [{ url, caption: null, sort_order: 30, alt: null }],
          document: { action: 'keep' },
        })
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect(optionMediaExpectedOf(await current())).toEqual(expected);
  });

  it('削除・説明と表示順の変更・追加・資料の差し替えをまとめて反映し、履歴と参照されなくなったファイルを返す', async () => {
    const { store, option, first, second, documentUrl, current } = await setup();
    const before = await current();
    const firstId = before.gallery_images!.find((row) => row.url === first)!.id;
    const secondId = before.gallery_images!.find((row) => row.url === second)!.id;
    const added = await store.uploadOptionImage(png, option.id);
    const nextDocument = await store.uploadProductDocument(pdf, option.id);
    const result = await store.applyOptionMediaChanges(admin, option.id, optionMediaExpectedOf(before), {
      delete: [secondId],
      update: [{ id: firstId, caption: '  正面（新）  ', sort_order: 5 }],
      add: [{ url: added, caption: '側面', sort_order: 30, alt: null }],
      document: { action: 'replace', url: nextDocument },
    });
    expect(result.gallery.map((row) => [row.caption, row.sort_order])).toEqual([
      ['正面（新）', 5],
      ['側面', 30],
    ]);
    expect(result.gallery[1].alt).toBe(option.name);
    expect(result.manufacturer_document_url).toBe(nextDocument);
    expect(result.unreferenced_urls).toEqual([second, documentUrl]);
    const after = await current();
    expect(after.gallery_images!.map((row) => row.url).sort()).toEqual([first, added].sort());
    expect(after.manufacturer_document_url).toBe(nextDocument);
    const logs = await store.listAuditLogs();
    expect(logs.find((row) => row.action === 'media' && row.entity_id === option.id)?.summary).toBe(
      `追加画像・メーカー資料を変更：${option.name}（追加画像 削除 1・変更 1・追加 1／メーカー資料 差し替え）`
    );

    // 資料の解除。登録されていない資料の解除・今と同じ資料への差し替えは止める
    const removed = await store.applyOptionMediaChanges(admin, option.id, optionMediaExpectedOf(after), {
      delete: [],
      update: [],
      add: [],
      document: { action: 'remove' },
    });
    expect(removed.unreferenced_urls).toEqual([nextDocument]);
    await expect(
      store.applyOptionMediaChanges(admin, option.id, optionMediaExpectedOf(await current()), {
        delete: [],
        update: [],
        add: [],
        document: { action: 'remove' },
      })
    ).rejects.toThrow('メーカー資料は登録されていません');
  });

  it('メイン画像にも使っているファイルは、追加画像から外しても消す対象にしない', async () => {
    const { store, option, first, current } = await setup();
    const before = await current();
    await store.upsertOption({ ...before, image_url: first });
    const firstId = before.gallery_images!.find((row) => row.url === first)!.id;
    const result = await store.applyOptionMediaChanges(admin, option.id, optionMediaExpectedOf(await current()), {
      delete: [firstId],
      update: [],
      add: [],
      document: { action: 'keep' },
    });
    expect(result.unreferenced_urls).toEqual([]);
  });
});

describe('DB の apply_option_media_changes（20261105110000）', () => {
  it('SECURITY DEFINER・search_path は空・ログインした利用者だけが実行できる', () => {
    expect(migration).toContain('create function public.apply_option_media_changes(p_option_id uuid, p_expected jsonb, p_changes jsonb)');
    expect(migration).toContain('security definer\nset search_path = \'\'');
    expect(migration).toContain('revoke all on function public.apply_option_media_changes(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.apply_option_media_changes(uuid, jsonb, jsonb) to authenticated;');
  });

  it('商品の行と追加画像の行をロックしてから、画面を開いた時点の状態と照合する', () => {
    const lockOption = migration.indexOf('select * into v_option from public.options where id = p_option_id for update;');
    const lockImages = migration.indexOf('perform 1 from public.option_images i where i.option_id = p_option_id for update;');
    const compare = migration.indexOf("raise exception 'CONFLICT: 追加画像・メーカー資料が、画面を開いた後にほかの操作で変わりました");
    expect(lockOption).toBeGreaterThan(-1);
    expect(lockImages).toBeGreaterThan(lockOption);
    expect(compare).toBeGreaterThan(lockImages);
  });

  it('Storage の商品のフォルダーにあり、種類と大きさがバケットの決まりに合うファイルだけを紐付ける（Supabase のホストの URL だけ）', () => {
    expect(migration).toContain("v_url !~ ('^https://[a-z0-9-]+\\.supabase\\.co' || c_image_marker || 'option-' || p_option_id::text || '/gallery/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$')");
    expect(migration).toContain("v_url !~ ('^https://[a-z0-9-]+\\.supabase\\.co' || c_document_marker || 'option-' || p_option_id::text || '/manufacturer/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\\.pdf$')");
    // 同じファイルかは置き場所（パス）で比べる
    expect(migration).toContain('if exists (select 1 from public.option_images i where split_part(i.url, c_image_marker, 2) = v_path) then');
    // 上限は枚数を増やすときだけ
    expect(migration).toContain("if v_count > c_gallery_max and v_count > jsonb_array_length(v_before -> 'gallery') then");
    expect(migration).toContain("from storage.objects o where o.bucket_id = 'product-images' and o.name = v_path");
    expect(migration).toContain("from storage.objects o where o.bucket_id = 'product-documents' and o.name = v_path");
    expect(migration).toContain("not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')");
    expect(migration).toContain("<> 'application/pdf'");
  });

  it('履歴を残し、ほかの行が使っていないファイルだけを「参照されなくなったファイル」として返す（Storage のファイルは消さない）', () => {
    expect(migration).toContain("perform public.write_audit(\n      'media', 'option', p_option_id,");
    // 使っているかは Storage の置き場所（バケットとパス）で比べる
    for (const table of [
      "public.option_images i where split_part(i.url, '/storage/v1/object/public/', 2) = t.p",
      "split_part(coalesce(o.image_url, ''), '/storage/v1/object/public/', 2) = t.p",
      "split_part(coalesce(o.manufacturer_document_url, ''), '/storage/v1/object/public/', 2) = t.p",
      "public.option_variant_choices c where split_part(coalesce(c.image_url, ''), '/storage/v1/object/public/', 2) = t.p",
      "public.quote_items qi where split_part(coalesce(qi.image_url, ''), '/storage/v1/object/public/', 2) = t.p",
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).not.toMatch(/delete from storage\.objects/i);
    expect(AUDIT_ACTION_LABELS.media).toBe('画像・資料');
  });

  it('実 DB の実行時検査（OMC）をリハーサルに登録している', () => {
    const check = read('scripts/db-rehearsal/check.mjs');
    expect(check).toContain("import { runtimeOptionMediaChanges } from './runtime-option-media-changes.mjs';");
    expect(check).toContain('runtime = mergeRuntime(runtime, await runtimeOptionMediaChanges(client));');
  });
});

describe('サーバーアクションと画面', () => {
  it('利用者は引数で受け取らず、権限は共通の判定（DB と同じ決まり）で確かめる', () => {
    expect(actions.startsWith("'use server';")).toBe(true);
    const exported = [...actions.matchAll(/^export async function (\w+)\(([^)]*)\)/gm)].map((match) => [match[1], match[2]]);
    expect(exported.map(([name]) => name)).toEqual([
      'uploadStagedOptionMediaAction',
      'createOptionMediaSignedUploadAction',
      'applyOptionMediaChangesAction',
      'discardStagedOptionMediaAction',
    ]);
    for (const [, params] of exported) expect(params).not.toMatch(/actor|SessionUser/);
    expect(actions.match(/await requireStaff\(\)/g)).toHaveLength(4);
    expect(actions.match(/await editableOptionContext\(actor, /g)).toHaveLength(4);
    expect(read('lib/actions/admin.ts')).toContain("import { draftMediaContext, editableOptionContext } from '@/lib/actions/option-media-access';");
    // URL からの登録も同じ判定を使う（写しを持たない）
    expect(read('lib/actions/product-media-url.ts')).toContain("import { draftMediaContext, editableOptionContext } from '@/lib/actions/option-media-access';");
    expect(read('lib/actions/product-media-url.ts')).not.toContain('async function editableOptionContext(');
  });

  it('旧来の追加画像・メーカー資料の操作（1 件ずつ書き換える）は下書きの商品だけ。登録済みの商品は STEP 2 の一括反映だけ', () => {
    const admin = read('lib/actions/admin.ts');
    const legacy = admin.slice(admin.indexOf('export async function addOptionImageAction('), admin.indexOf('export async function addProductImageAction('));
    expect(legacy.match(/await draftMediaContext\(actor, optionId\)/g)).toHaveLength(5);
    expect(legacy).not.toContain('await editableOptionContext(actor, optionId)');
    const url = read('lib/actions/product-media-url.ts');
    expect(url.slice(url.indexOf('export async function addOptionImageFromUrlAction(')).match(/await draftMediaContext\(actor, optionId\)/g)).toHaveLength(2);
    expect(read('lib/actions/option-media-access.ts')).toContain("if (context.option.status === 'published') {");
  });

  it('置いたファイルはサーバーが署名した受け取りが付き、受け取りのあるファイルだけを消す（ブラウザが送った URL だけを信じない）', () => {
    expect(actions).toContain('return { ok: true, url, receipt: optionMediaReceipt(optionId, url) };');
    expect(actions).toContain('return { ok: true, ...target, receipt: optionMediaReceipt(optionId, target.url) };');
    expect(actions).toContain('items.filter((item) => isValidOptionMediaReceipt(optionId, item.url, item.receipt))');
    // 反映の失敗ではサーバーが勝手に消さない（画面が受け取りを添えて消す）
    expect(actions).not.toContain('discardStaged(store');
    expect(flow).toContain('discardStagedOptionMediaAction({ optionId: option.id, items: staged })');
    // 保存処理は自分のプロジェクトの Storage の URL（ホストまで）だけを紐付ける
    expect(read('lib/data/supabase-store.ts')).toContain("throw new StoreError('VALIDATION', '追加画像・メーカー資料の置き場所が正しくありません。画面を開き直してから、もう一度お試しください。');");
  });

  it('成功したら参照されなくなったファイルだけを消す（今参照しているファイルは消さない）', () => {
    expect(actions).toContain('await removeOptionMediaFiles(store, optionId, result.unreferenced_urls);');
    expect(actions).toContain('urls.filter((url) => !referenced.has(url))');
  });

  it('3.5MB を超えるファイルは署名付きアップロード（置き場所はサーバーが決める）', () => {
    expect(flow).toContain('if (file.size <= SERVER_ACTION_UPLOAD_MAX_BYTES) {');
    expect(flow).toContain('.uploadToSignedUrl(target.path, target.token, file, { contentType })');
    expect(read('lib/data/supabase-store.ts')).toContain('await admin.storage.from(bucket).createSignedUploadUrl(storagePath)');
    expect(read('lib/data/local-store.ts')).toContain('async createOptionMediaSignedUpload(): Promise<null> {');
  });
});
