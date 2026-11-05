import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { buildEstimateSpecSelection } from '@/lib/domain/estimate-template';
import { quoteRequestSchema, saveConfigurationSchema } from '@/lib/validation';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013100000_configuration_optimistic_locking.sql');
const source = read('supabase/migrations/20260928100000_configuration_atomic_save_corrective.sql');
const quoteSource = read('supabase/migrations/20260911050000_standard_estimate_simulator.sql');
const supabaseStore = read('lib/data/supabase-store.ts');
const simulator = read('components/simulator/simulator-app.tsx');
const simulatorPage = read('app/(site)/simulator/[slug]/page.tsx');
const requestQuotePage = read('app/(site)/mypage/configurations/[id]/request-quote/page.tsx');
const quoteRequestForm = read('components/mypage/quote-request-form.tsx');
const configurationActions = read('lib/actions/configurations.ts');
const concurrency = read('scripts/db-rehearsal/runtime-concurrency.mjs');

/** migration の `v_xxx constant text := '...'`（E'...' の連結を含む）を、SQL と同じ規則で文字列へ戻す */
function textConstant(name: string): string {
  const declaration = migration.match(new RegExp(`${name} constant text :=([\\s\\S]*?);\\n`));
  expect(declaration, name).not.toBeNull();
  const pieces = [...declaration![1].matchAll(/(E?)'((?:[^'\\]|''|\\.)*)'/g)];
  expect(pieces.length, name).toBeGreaterThan(0);
  return pieces
    .map(([, escape, text]) => {
      const unquoted = text.split("''").join("'");
      return escape ? unquoted.split('\\n').join('\n') : unquoted;
    })
    .join('');
}

const DOLLAR = '$' + '$';
const SIG13 = 'uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean';
const SIG14 = `${SIG13}, integer`;

function saveFunction(sql: string, opener: string): string {
  const start = sql.indexOf(opener);
  expect(start, opener).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`${DOLLAR};`, start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** 文字列の最初の一致を置き換える（String.replace の `$` 特殊パターンを避ける）。一致は 1 箇所だけであること */
function swap(text: string, from: string, to: string): string {
  const index = text.indexOf(from);
  expect(index, from).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(from, index + 1), `unique: ${from}`).toBe(-1);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

describe('Configuration 保存の同時編集対策（optimistic locking）: migration', () => {
  it('save_configuration_atomic は元の定義から 3 箇所だけを変更している', () => {
    let expected = saveFunction(source, 'create or replace function public.save_configuration_atomic(');
    expected = swap(expected, 'create or replace function public.save_configuration_atomic(', 'create function public.save_configuration_atomic(');
    // 1. 引数の追加
    expected = swap(
      expected,
      `  p_site_location_undecided boolean default false
)`,
      `  p_site_location_undecided boolean default false,
  p_expected_lock_version integer default null
)`
    );
    // 2. 版の判定（行 lock と Draft 判定の直後）
    expected = swap(
      expected,
      `    if v_cfg.status <> 'draft' then
      raise exception 'LOCKED: Draft以外の仕様は通常保存できません。複製して編集してください。' using errcode = 'P0001';
    end if;
`,
      `    if v_cfg.status <> 'draft' then
      raise exception 'LOCKED: Draft以外の仕様は通常保存できません。複製して編集してください。' using errcode = 'P0001';
    end if;
    -- 同時編集の検知（optimistic locking）。読み込んだ時点の版と一致しない保存は拒否し、後勝ちにしない。
    -- 行は上で FOR UPDATE 済みなので、同時に届いた保存は直列化され、後から来た方がここで止まる。
    -- 版の指定が無い（NULL）保存も拒否する。
    if v_cfg.lock_version is distinct from p_expected_lock_version then
      raise exception 'LOCKED: 他の画面でこのプランが更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
    end if;
`
    );
    // 3. 版の加算
    expected = swap(
      expected,
      `           site_location_undecided = p_site_location_undecided
     where id = v_id;`,
      `           site_location_undecided = p_site_location_undecided,
           lock_version = lock_version + 1
     where id = v_id;`
    );
    expect(saveFunction(migration, 'create function public.save_configuration_atomic(')).toBe(expected);
  });

  it('版の判定は、行を FOR UPDATE で lock した後・更新より前にある', () => {
    const body = saveFunction(migration, 'create function public.save_configuration_atomic(');
    const lock = body.indexOf('select * into v_cfg from public.configurations where id = v_id for update;');
    const check = body.indexOf('if v_cfg.lock_version is distinct from p_expected_lock_version then');
    const update = body.indexOf('update public.configurations');
    expect(lock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lock);
    expect(update).toBeGreaterThan(check);
    // NULL（版の指定なし）も不一致として拒否する
    expect(body).not.toContain('v_cfg.lock_version <> p_expected_lock_version');
  });

  it('版の列は既存行を 1 にするだけで、既存の内容・金額・履歴は書き換えない', () => {
    expect(migration).toContain('add column if not exists lock_version integer not null default 1;');
    expect(migration).toContain('add constraint configurations_lock_version_check check (lock_version >= 1);');
    const outside = migration.split(saveFunction(migration, 'create function public.save_configuration_atomic(')).join('');
    expect(outside).not.toMatch(/^\s*(update|delete\s+from|insert\s+into|truncate)\b/im);
    expect(outside).not.toMatch(/\b(quotes|quote_items|configuration_snapshots|configuration_items)\b/);
  });

  it('旧 13 引数の関数を残さず、実行境界を同じ内容で付け直す', () => {
    expect(migration).toContain(`drop function public.save_configuration_atomic(${SIG13});`);
    expect(migration).toContain(`alter function public.save_configuration_atomic(${SIG14}) owner to postgres;`);
    expect(migration).toContain(`revoke execute on function public.save_configuration_atomic(${SIG14})
  from public, anon, authenticated, service_role;`);
    expect(migration).toContain(`grant execute on function public.save_configuration_atomic(${SIG14}) to authenticated;`);
    expect(migration).toContain('exactly one save_configuration_atomic must exist');
    expect(migration).toContain("has_column_privilege('authenticated', 'public.configurations', 'lock_version', 'UPDATE')");
    expect(migration).toContain('revoke insert, update on public.configurations from anon;');
  });
});

describe('見積依頼の版確認（create_quote_from_configuration）: migration', () => {
  const quoteBody = saveFunction(quoteSource, 'create or replace function public.create_quote_from_configuration(');
  const anchor = textConstant('v_anchor');
  const check = textConstant('v_check');

  it('適用済みの定義は 20260911050000 の本文で、その後は owner・search_path・EXECUTE の変更だけ', () => {
    const later = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .filter((file) => file.slice(0, 14) > '20260911050000' && file.slice(0, 14) < '20261013100000' && file.endsWith('.sql'))
      .filter((file) => /function\s+public\.create_quote_from_configuration\s*\(/i.test(read(path.join('supabase/migrations', file))));
    for (const file of later) {
      expect(read(path.join('supabase/migrations', file)), file).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\.create_quote_from_configuration/i);
    }
    expect(later).toContain('20260915073200_security_quote_lifecycle_corrective.sql'); // search_path = ''
  });

  it('変更は 2 箇所だけ：引数の追加と、本人確認の直後の版の判定（本文の目印はちょうど 1 箇所）', () => {
    expect(textConstant('v_args_old')).toBe('(p_configuration_id uuid, p_contact jsonb, p_message text)');
    expect(textConstant('v_args_new')).toBe(
      '(p_configuration_id uuid, p_contact jsonb, p_message text, p_expected_lock_version integer DEFAULT NULL::integer)'
    );
    expect(quoteBody.split(anchor).length - 1).toBe(1);
    expect(quoteBody).not.toContain('lock_version');
    expect(migration).toContain('v_expected := replace(replace(v_definition, v_args_old, v_args_new), v_anchor, v_anchor || v_check);');
    // 版の判定は、Configuration を FOR UPDATE で lock して本人確認をした直後・見積の作成より前
    const patched = quoteBody.replace(anchor, () => anchor + check);
    const at = (needle: string) => patched.indexOf(needle);
    expect(at('select * into cfg from public.configurations where id = p_configuration_id for update;')).toBeLessThan(at(anchor));
    expect(at(check)).toBe(at(anchor) + anchor.length);
    expect(at(check)).toBeLessThan(at('perform public.validate_configuration_items('));
    expect(at(check)).toBeLessThan(at('insert into public.quote_requests'));
    expect(check).toContain('if cfg.lock_version is distinct from p_expected_lock_version then');
    expect(check).toContain("raise exception 'LOCKED: 他の画面でこのプランが更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';");
    // 依頼では版を進めない
    expect(check).not.toContain('lock_version + 1');
  });

  it('想定と違う定義なら停止し、旧 3 引数を残さず、owner・EXECUTE を同じ内容で付け直す', () => {
    expect(migration).toContain('differs from the reviewed definition (arguments or owner check not unique)');
    expect(migration).toContain('pg_catalog.pg_get_functiondef(v_new_oid) is distinct from v_expected');
    expect(migration).toContain("execute 'drop function public.create_quote_from_configuration(uuid, jsonb, text)';");
    expect(migration).toContain('alter function public.create_quote_from_configuration(uuid, jsonb, text, integer) owner to postgres;');
    expect(migration).toContain(`revoke execute on function public.create_quote_from_configuration(uuid, jsonb, text, integer)
  from public, anon, authenticated, service_role;`);
    expect(migration).toContain('grant execute on function public.create_quote_from_configuration(uuid, jsonb, text, integer) to authenticated;');
    expect(migration).toContain('exactly one create_quote_from_configuration must exist');
  });
});

describe('Configuration 保存の同時編集対策: アプリ', () => {
  it('保存 RPC へ、読み込んだ時点の版を渡す', () => {
    expect(supabaseStore).toContain('p_expected_lock_version: input.expected_lock_version ?? null,');
    expect(saveConfigurationSchema.parse({ id: null, base_model_id: '00000000-0000-4000-8000-000000000001', name: 'x', option_ids: [], preview_image_url: null, notes: null }).expected_lock_version).toBeNull();
    expect(
      saveConfigurationSchema.safeParse({ id: null, base_model_id: '00000000-0000-4000-8000-000000000001', name: 'x', option_ids: [], preview_image_url: null, notes: null, expected_lock_version: 0 }).success
    ).toBe(false);
  });

  it('シミュレーターは版を保持し、保存に成功したら返ってきた版へ進める', () => {
    expect(simulatorPage).toContain('lock_version: found.configuration.lock_version ?? null,');
    expect(simulator).toContain('const [lockVersion, setLockVersion] = useState<number | null>(initial?.lock_version ?? null);');
    expect(simulator).toContain('expected_lock_version: configId ? lockVersion : null,');
    expect(simulator).toContain('setLockVersion(result.configuration.lock_version ?? null);');
    // 既存プランの版はサーバーから取得し、保存成功時は最新の版を記録する。
    // 新規入口・ログイン後再開では、以前のプランIDと版をブラウザから復元しない。
    expect(simulator).toContain('lockVersion: result.configuration.lock_version ?? null');
    expect(simulator).toContain('canRestoreSimulatorSelection(draft, user?.id ?? null, resume)');
    expect(simulator).not.toContain('setLockVersion(draft.lockVersion ?? null)');
    expect(simulator).not.toContain('setConfigId(draft.configId)');
  });

  it('見積依頼の確認画面は表示した版を送り、DB の版と一致しなければ見積を作らない', () => {
    expect(requestQuotePage).toContain('lockVersion={configuration.lock_version ?? null}');
    expect(quoteRequestForm).toContain(`<input type="hidden" name="expected_lock_version" value={lockVersion ?? ''} />`);
    expect(configurationActions).toContain('const { configuration_id, message, expected_lock_version, ...contact } = parsed.data;');
    expect(configurationActions).toContain('store.createQuoteFromConfiguration(user, configuration_id, contact as QuoteContact, message, expected_lock_version)');
    expect(supabaseStore).toContain('p_expected_lock_version: expectedLockVersion,');
    // 版を持つ画面からの依頼は、RPC が見つからなくても版を確かめない旧経路へ逃がさない
    expect(supabaseStore).toContain(
      "if (error && expectedLockVersion === null && isMissingNamedFunction(error, 'create_quote_from_configuration')) {"
    );
    // 競合時は、見積依頼を送っていないことと再読み込みを案内する
    expect(quoteRequestForm).toContain('見積依頼はまだ送信していません。');
    expect(quoteRequestForm).toContain('data-testid="quote-request-conflict-reload"');

    const contact = { configuration_id: '00000000-0000-4000-8000-000000000001', full_name: 'x', company_name: '', email: 'x@example.com', phone: '0', address: 'x', site_address: '', message: '' };
    expect(quoteRequestSchema.parse({ ...contact, expected_lock_version: '3' }).expected_lock_version).toBe(3);
    expect(quoteRequestSchema.parse({ ...contact, expected_lock_version: '' }).expected_lock_version).toBeNull();
    expect(quoteRequestSchema.parse(contact).expected_lock_version).toBeNull();
    expect(quoteRequestSchema.safeParse({ ...contact, expected_lock_version: '0' }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...contact, expected_lock_version: '1.5' }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...contact, expected_lock_version: 'x' }).success).toBe(false);
  });

  it('実行時検査が、同時保存・見積依頼で後から来た方だけが拒否されることを確認している', () => {
    for (const step of [
      'L-3 古い版（1）のままの保存は拒否される',
      'L-5 版の指定が無い保存は拒否される',
      'L-7 同時保存：後から来た保存は、先の保存が終わるまで待たされる',
      'L-8 同時保存：先の保存が commit された後、後から来た保存は拒否される',
      'L-9 同時保存：成功したのは片方だけ（版は 1 つだけ進む）',
      'L-12 古い版（3）のままの見積依頼は拒否される',
      'L-13 版の指定が無い見積依頼は拒否される',
      'L-15 拒否された見積依頼では、見積は作られずプランも Draft のまま',
      'L-17 同時：保存が commit された後、古い版の見積依頼は拒否され、見積は作られない',
      'L-19 同時：見積依頼が commit された後、保存は拒否される（Draft ではなくなった）',
      'L-20 最新の版での見積依頼は成功し、見積は 1 件・プランは依頼済み（版は進めない）',
    ]) {
      expect(concurrency).toContain(step);
    }
    // 試験データを commit するため、ローカルの DB 以外では実行しない
    expect(concurrency).toContain("['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)");
    // `(f()).*` は列の数だけ関数を呼ぶ。保存は FROM 句で 1 回だけ呼ぶ
    expect(concurrency).toContain('select * from public.save_configuration_atomic(');
    expect(concurrency).not.toMatch(/select \(public\.save_configuration_atomic\(/);
  });
});

describe.sequential('Configuration 保存の同時編集対策: ローカル検証モード（SQL と同じ判定）', () => {
  let dir = '';
  const actor = { id: 'lock-version-user', email: 'lock@example.com', role: 'customer' as const, full_name: '版テスト' };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-lock-version-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('新規は版 1、保存のたびに 1 進み、古い版・版なしの保存は拒否する', async () => {
    const store = new LocalStore();
    const model = (await store.listModels()).find((row) => row.slug === 'wing-01')!;
    // 標準の選択（ホテル仕様）を、シミュレーターと同じ組み立てで作る
    const bundle = (await store.getCatalogBundle(model.id))!;
    const optionIds = buildEstimateSpecSelection(bundle, model, 'hotel');
    const base = {
      base_model_id: model.id,
      option_ids: [] as string[],
      preview_image_url: null,
      notes: null,
      finish_level: 'full' as const,
      spec_code: 'hotel',
      variant_choice_ids: [] as string[],
    };

    const created = await store.saveConfiguration(actor, { ...base, option_ids: optionIds, id: null, name: '新規' });
    expect(created.lock_version).toBe(1);

    const saved = await store.saveConfiguration(actor, { ...base, option_ids: optionIds, id: created.id, name: '画面A', expected_lock_version: 1 });
    expect(saved.lock_version).toBe(2);

    // 古い版のままの画面からの保存（後勝ちにしない）
    await expect(
      store.saveConfiguration(actor, { ...base, option_ids: optionIds, id: created.id, name: '画面Bの古い保存', expected_lock_version: 1 })
    ).rejects.toThrow('他の画面でこのプランが更新されています');
    // 版の指定が無い保存
    await expect(store.saveConfiguration(actor, { ...base, option_ids: optionIds, id: created.id, name: '版なし' })).rejects.toThrow(
      '他の画面でこのプランが更新されています'
    );
    const current = await store.getConfiguration(created.id, actor);
    expect(current?.configuration.name).toBe('画面A');
    expect(current?.configuration.lock_version).toBe(2);

    // 読み直せば保存できる
    const retried = await store.saveConfiguration(actor, { ...base, option_ids: optionIds, id: created.id, name: '画面Bが読み直して保存', expected_lock_version: 2 });
    expect(retried.lock_version).toBe(3);

    // 複製は新しいプランとして版 1 から始まる
    const copy = await store.duplicateConfiguration(created.id, actor);
    expect(copy.lock_version).toBe(1);
  });

  it('見積依頼は確認画面の版と一致したときだけ見積を作り、古い版・版なしは見積を作らずに拒否する', async () => {
    const store = new LocalStore();
    const model = (await store.listModels()).find((row) => row.slug === 'wing-01')!;
    const bundle = (await store.getCatalogBundle(model.id))!;
    const input = {
      base_model_id: model.id,
      option_ids: buildEstimateSpecSelection(bundle, model, 'hotel'),
      preview_image_url: null,
      notes: null,
      finish_level: 'full' as const,
      spec_code: 'hotel',
      variant_choice_ids: [] as string[],
    };
    const contact = { full_name: '版テスト', company_name: null, email: 'lock@example.com', phone: '000-0000-0000', address: '検査用住所', site_address: null };

    const created = await store.saveConfiguration(actor, { ...input, id: null, name: '確認画面で表示した内容' });
    // 確認画面を開いた後に、別の画面で保存された（版 1 → 2）
    await store.saveConfiguration(actor, { ...input, id: created.id, name: '別の画面の保存', expected_lock_version: 1 });

    await expect(store.createQuoteFromConfiguration(actor, created.id, contact, null, 1)).rejects.toThrow('他の画面でこのプランが更新されています');
    await expect(store.createQuoteFromConfiguration(actor, created.id, contact, null, null)).rejects.toThrow('他の画面でこのプランが更新されています');
    expect(await store.listQuotes(actor.id)).toHaveLength(0);
    expect((await store.getConfiguration(created.id, actor))?.configuration.status).toBe('draft');

    // 最新の内容を表示し直した確認画面からなら依頼できる。依頼で版は進めない
    const quote = await store.createQuoteFromConfiguration(actor, created.id, contact, null, 2);
    expect(quote.configuration_id).toBe(created.id);
    expect(await store.listQuotes(actor.id)).toHaveLength(1);
    const after = await store.getConfiguration(created.id, actor);
    expect(after?.configuration.status).toBe('quote_requested');
    expect(after?.configuration.lock_version).toBe(2);
  });
});
