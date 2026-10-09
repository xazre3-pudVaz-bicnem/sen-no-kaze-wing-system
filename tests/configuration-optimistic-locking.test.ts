import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { buildEstimateSpecSelection } from '@/lib/domain/estimate-template';
import { saveConfigurationSchema } from '@/lib/validation';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261009100000_configuration_optimistic_locking.sql');
const source = read('supabase/migrations/20260928100000_configuration_atomic_save_corrective.sql');
const supabaseStore = read('lib/data/supabase-store.ts');
const simulator = read('components/simulator/simulator-app.tsx');
const simulatorPage = read('app/(site)/simulator/[slug]/page.tsx');
const concurrency = read('scripts/db-rehearsal/runtime-concurrency.mjs');

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
    // ログイン後の再開でも版を失わない
    expect(simulator).toContain('lockVersion: result.configuration.lock_version ?? null');
    expect(simulator).toContain('if (!initial) setLockVersion(draft.lockVersion ?? null);');
  });

  it('実行時検査が、同時保存で片方だけ成功することを確認している', () => {
    for (const step of [
      'L-3 古い版（1）のままの保存は拒否される',
      'L-5 版の指定が無い保存は拒否される',
      'L-7 同時保存：後から来た保存は、先の保存が終わるまで待たされる',
      'L-8 同時保存：先の保存が commit された後、後から来た保存は拒否される',
      'L-9 同時保存：成功したのは片方だけ（版は 1 つだけ進む）',
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
});
