import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { buildEstimateSpecSelection, optionAvailableForSpec } from '@/lib/domain/estimate-template';
import { productLedgerState, productSimulatorVisibleSetting } from '@/lib/domain/product-lifecycle';
import type { BaseModel, CatalogBundle, ProductOption } from '@/lib/domain/types';

// PR #500：ローカル検証モード（E2E）でも、DB の保存境界（20261015113000）と同じ判定にする。

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/** 標準構成・必須・初期選択・前提・競合・本体の仕様のどれにも関わらない、ホテル仕様で選べる任意の商品 */
function freeOptions(bundle: CatalogBundle, models: BaseModel[], baseline: string[]): ProductOption[] {
  const presetCodes = new Set(models.flatMap((m) => (m.presets ?? []).flatMap((p) => p.option_codes)));
  const related = new Set([
    ...bundle.dependencies.flatMap((d) => [d.option_id, d.requires_option_id]),
    ...bundle.conflicts.flatMap((c) => [c.option_id, c.conflicts_with_option_id]),
  ]);
  return bundle.options
    .filter((o) => {
      const category = bundle.categories.find((c) => c.id === o.category_id);
      return (
        productLedgerState(o) === 'registered' &&
        productSimulatorVisibleSetting(o) &&
        !o.is_required &&
        !o.is_default &&
        !o.owner_id &&
        !presetCodes.has(o.code) &&
        !related.has(o.id) &&
        !baseline.includes(o.id) &&
        category?.status === 'published' &&
        category.selection_mode === 'multi' &&
        category.customer_visible &&
        optionAvailableForSpec(o, 'hotel')
      );
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

describe.sequential('商品の状態：ローカル検証モード（DB の保存境界と同じ判定）', () => {
  let dir = '';
  const actor = { id: 'lifecycle-user', email: 'lifecycle@example.com', role: 'customer' as const, full_name: '状態テスト' };
  const contact = { full_name: '状態テスト', company_name: null, email: 'lifecycle@example.com', phone: '000-0000-0000', address: '検査用住所', site_address: null };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-product-lifecycle-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function setup() {
    const store = new LocalStore();
    const models = await store.listModels();
    const model = models.find((row) => row.slug === 'wing-01')!;
    const bundle = (await store.getCatalogBundle(model.id))!;
    const baseline = buildEstimateSpecSelection(bundle, model, 'hotel');
    const free = freeOptions(bundle, models, baseline);
    expect(free.length).toBeGreaterThanOrEqual(2);
    const input = (optionIds: string[]) => ({
      base_model_id: model.id,
      option_ids: optionIds,
      preview_image_url: null,
      notes: null,
      finish_level: 'full' as const,
      spec_code: 'hotel',
      variant_choice_ids: [] as string[],
    });
    const optionOf = async (id: string) => (await store.getCatalogBundle(model.id))!.options.find((o) => o.id === id)!;
    return { store, model, bundle, baseline, free, input, optionOf };
  }

  it('状態の変更は画面が読んだ版のときだけ行い、取扱再開ではシミュレーター表示設定を保持する', async () => {
    const { store, free, optionOf } = await setup();
    const product = free[0];

    const hidden = await store.setProductLifecycle({ id: product.id, action: 'hide_from_simulator', expectedUpdatedAt: product.updated_at });
    // 古い画面（非表示にする前に読んだ版）からの操作は成功扱いにしない
    await expect(store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: product.updated_at })).rejects.toMatchObject({
      code: 'LOCKED',
    });
    expect(productLedgerState(await optionOf(product.id))).toBe('registered');

    const retired = await store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: hidden.updated_at });
    let current = await optionOf(product.id);
    expect(productLedgerState(current)).toBe('retired');
    expect(current.simulator_visible).toBe(false);
    // 取扱終了中はシミュレーター表示を変えない・重ねて取扱終了にしない
    await expect(store.setProductLifecycle({ id: product.id, action: 'show_in_simulator', expectedUpdatedAt: retired.updated_at })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: retired.updated_at })).rejects.toThrow(
      'すでに販売停止'
    );

    await store.setProductLifecycle({ id: product.id, action: 'resume', expectedUpdatedAt: retired.updated_at });
    current = await optionOf(product.id);
    expect(productLedgerState(current)).toBe('registered');
    expect(current.simulator_visible).toBe(false);
  });

  it('取扱終了の商品は保存済みの明細としてだけ残せ、新規・足し直し・複製・見積依頼は止める', async () => {
    const { store, baseline, free, input, optionOf } = await setup();
    const product = free[0];
    const created = await store.saveConfiguration(actor, { ...input([...baseline, product.id]), id: null, name: '取扱終了の前に保存' });
    const { updated_at } = await optionOf(product.id);
    const retired = await store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: updated_at });

    // 同じ明細のまま保存し直せる
    const kept = await store.saveConfiguration(actor, {
      ...input([...baseline, product.id]),
      id: created.id,
      name: 'そのまま保存',
      expected_lock_version: created.lock_version,
    });
    // 残ったままでは見積を依頼できない・複製できない・新しいプランにも入れられない
    await expect(store.createQuoteFromConfiguration(actor, created.id, contact, null, kept.lock_version ?? null)).rejects.toThrow(
      '販売停止中のため、この内容では見積を依頼できません'
    );
    expect(await store.listQuotes(actor.id)).toHaveLength(0);
    await expect(store.duplicateConfiguration(created.id, actor)).rejects.toThrow('販売停止中のため新しく選べません');
    await expect(store.saveConfiguration(actor, { ...input([...baseline, product.id]), id: null, name: '新規' })).rejects.toThrow(
      '販売停止中のため新しく選べません'
    );

    // 外すことはできるが、外した後に足し直せない
    const removed = await store.saveConfiguration(actor, {
      ...input(baseline),
      id: created.id,
      name: '外した',
      expected_lock_version: kept.lock_version,
    });
    await expect(
      store.saveConfiguration(actor, { ...input([...baseline, product.id]), id: created.id, name: '足し直し', expected_lock_version: removed.lock_version })
    ).rejects.toThrow('販売停止中のため新しく選べません');

    // 取扱を再開すれば、また選べる
    await store.setProductLifecycle({ id: product.id, action: 'resume', expectedUpdatedAt: retired.updated_at });
    const resumed = await store.saveConfiguration(actor, {
      ...input([...baseline, product.id]),
      id: created.id,
      name: '再開後に足した',
      expected_lock_version: removed.lock_version,
    });
    expect(resumed.lock_version).toBe((removed.lock_version ?? 0) + 1);
  });

  it('シミュレーター非表示の商品は、保存済みの明細を残したまま見積を依頼でき、新しくは選べない', async () => {
    const { store, baseline, free, input, optionOf } = await setup();
    const product = free[1];
    const created = await store.saveConfiguration(actor, { ...input([...baseline, product.id]), id: null, name: '非表示の前に保存' });
    const { updated_at } = await optionOf(product.id);
    await store.setProductLifecycle({ id: product.id, action: 'hide_from_simulator', expectedUpdatedAt: updated_at });

    const kept = await store.saveConfiguration(actor, {
      ...input([...baseline, product.id]),
      id: created.id,
      name: 'そのまま保存',
      expected_lock_version: created.lock_version,
    });
    await expect(store.saveConfiguration(actor, { ...input([...baseline, product.id]), id: null, name: '新規' })).rejects.toThrow(
      'シミュレーターでは新しく選べない商品です'
    );
    // 非表示は見積不可ではない
    const quote = await store.createQuoteFromConfiguration(actor, created.id, contact, null, kept.lock_version ?? null);
    expect(quote.configuration_id).toBe(created.id);
  });

  it('商品の登録・編集の保存では、取扱終了・シミュレーター表示を書き換えない（古い行を書き戻しても）', async () => {
    const { store, free, optionOf } = await setup();
    const product = free[0];
    // 取扱中・表示 ON の時点で読んだ行
    const stale = await optionOf(product.id);
    const hidden = await store.setProductLifecycle({ id: product.id, action: 'hide_from_simulator', expectedUpdatedAt: stale.updated_at });
    await store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: hidden.updated_at });

    const { gallery_images: _galleryImages, created_at: _createdAt, updated_at: _updatedAt, ...editable } = stale;
    await store.upsertOption({ ...editable, name: `${stale.name}（名称変更）` });
    const current = await optionOf(product.id);
    expect(current.name).toBe(`${stale.name}（名称変更）`);
    expect(productLedgerState(current)).toBe('retired');
    expect(current.simulator_visible).toBe(false);
  });

  it('必須・初期選択・前提商品は販売停止にしない（fail closed。先に設定を見直す）', async () => {
    const { store, bundle, optionOf } = await setup();
    const requiredOrDefault = bundle.options.find((o) => productLedgerState(o) === 'registered' && (o.is_required || o.is_default))!;
    const dependencyTarget = bundle.options.find((o) => bundle.dependencies.some((d) => d.requires_option_id === o.id && d.option_id !== o.id))!;

    for (const product of [requiredOrDefault, dependencyTarget]) {
      expect(product).toBeTruthy();
      await expect(store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: product.updated_at })).rejects.toMatchObject({
        code: 'LOCKED',
      });
      expect(productLedgerState(await optionOf(product.id))).toBe('registered');
    }
  });

  it('本体の仕様（標準の商品構成）で使っている商品も販売停止にでき、その仕様は新しい受付を止める（自動で差し替えない。20261020110000）', async () => {
    const { store, model, bundle, input, optionOf } = await setup();
    const dependencyTargets = new Set(bundle.dependencies.map((d) => d.requires_option_id));
    const hotelPreset = (model.presets ?? []).find((p) => p.code === 'hotel')!;
    const presetProduct = bundle.options.find(
      (o) => hotelPreset.option_codes.includes(o.code) && productLedgerState(o) === 'registered' && !o.is_required && !o.is_default && !dependencyTargets.has(o.id)
    )!;
    expect(presetProduct).toBeTruthy();
    // 依頼の前に保存したプラン（販売停止の商品を含まない）
    const otherIds = buildEstimateSpecSelection(bundle, model, 'hotel').filter((id) => id !== presetProduct.id);
    const saved = await store.saveConfiguration(actor, { ...input(otherIds), id: null, name: '販売停止の前に保存' });

    const stopped = await store.setProductLifecycle({ id: presetProduct.id, action: 'retire', expectedUpdatedAt: presetProduct.updated_at });
    expect(productLedgerState(await optionOf(presetProduct.id))).toBe('retired');
    expect(stopped.updated_at).toBeTruthy();

    const acceptance = await store.getSpecAcceptanceState(model.id, 'hotel');
    expect(acceptance).toEqual({ accepting: false, stoppedNames: [presetProduct.name], available: true });
    // 販売停止の商品を選んでいないプランでも、その仕様の新しい見積依頼は受け付けない
    await expect(store.createQuoteFromConfiguration(actor, saved.id, contact, null, saved.lock_version ?? null)).rejects.toThrow(
      'この仕様の標準の商品構成に、販売停止の商品'
    );
    // 標準構成の組み立てでは、販売停止の商品を別の商品で補わない
    const rebuilt = buildEstimateSpecSelection((await store.getCatalogBundle(model.id))!, model, 'hotel');
    expect(rebuilt).not.toContain(presetProduct.id);
  });

  it('廃番は販売停止の商品だけ・理由が必須。廃番の間は販売を再開できず、取り消しは本部の管理者だけ（取り消すと販売停止に戻る）', async () => {
    const { store, free, optionOf } = await setup();
    const editor = { id: 'editor-user', email: 'editor@example.com', role: 'master_dealer' as const, full_name: '総代理店' };
    const admin = { id: 'admin-user', email: 'admin@example.com', role: 'admin' as const, full_name: '本部' };
    const product = free[0];
    await expect(
      store.setProductDiscontinued({ id: product.id, discontinued: true, reason: '生産終了', expectedUpdatedAt: product.updated_at }, editor)
    ).rejects.toThrow('廃番にできるのは販売停止の商品だけです');
    const stopped = await store.setProductLifecycle({ id: product.id, action: 'retire', expectedUpdatedAt: product.updated_at });
    await expect(
      store.setProductDiscontinued({ id: product.id, discontinued: true, reason: '  ', expectedUpdatedAt: stopped.updated_at }, editor)
    ).rejects.toThrow('理由を 500 文字以内で入力してください');
    await expect(
      store.setProductDiscontinued({ id: product.id, discontinued: true, reason: '生産終了', expectedUpdatedAt: stopped.updated_at }, actor)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const discontinued = await store.setProductDiscontinued({ id: product.id, discontinued: true, reason: '生産終了', expectedUpdatedAt: stopped.updated_at }, editor);
    expect((await optionOf(product.id)).discontinued_at).toBeTruthy();

    await expect(store.setProductLifecycle({ id: product.id, action: 'resume', expectedUpdatedAt: discontinued.updated_at })).rejects.toThrow(
      '廃番の商品は販売を再開できません'
    );
    await expect(
      store.setProductDiscontinued({ id: product.id, discontinued: false, reason: '誤操作', expectedUpdatedAt: discontinued.updated_at }, editor)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const restored = await store.setProductDiscontinued({ id: product.id, discontinued: false, reason: '誤操作', expectedUpdatedAt: discontinued.updated_at }, admin);
    const after = await optionOf(product.id);
    expect(after.discontinued_at).toBeNull();
    expect(productLedgerState(after)).toBe('retired');
    // 古い版の操作は失敗にする
    await expect(
      store.setProductDiscontinued({ id: product.id, discontinued: true, reason: '生産終了', expectedUpdatedAt: discontinued.updated_at }, editor)
    ).rejects.toMatchObject({ code: 'LOCKED' });
    // 取り消した後は、販売を再開できる
    await store.setProductLifecycle({ id: product.id, action: 'resume', expectedUpdatedAt: restored.updated_at });
    expect(productLedgerState(await optionOf(product.id))).toBe('registered');
  });
});

describe('商品の状態の変更：Server Action と Supabase の保存（静的）', () => {
  const action = read('lib/actions/product-lifecycle.ts');
  const supabaseStore = read('lib/data/supabase-store.ts');

  it('Server Action は台帳の編集権限と機能の有効化を確かめ、画面が読んだ版を保存処理へ渡す', () => {
    expect(action).toContain("'use server';");
    expect(action).toContain('export async function setProductLifecycleAction(formData: FormData)');
    expect(action.indexOf('await requireCatalogEditor(ledgerPath);')).toBeLessThan(action.indexOf('const store = await getStore();'));
    expect(action).toContain("String(formData.get('expected_updated_at') ?? '')");
    expect(action).toContain('productLifecycleEnabled(await store.getProductLifecycleCapability())');
    expect(action).toContain('await store.setProductLifecycle({ id, action, expectedUpdatedAt });');
    // 利用者の ID などを引数に取る関数を 'use server' から公開しない（どちらも FormData だけを受け取る）
    expect([...action.matchAll(/^export async function (\w+)/gm)].map((m) => m[1])).toEqual(['setProductLifecycleAction', 'setProductDiscontinuedAction']);
    // 販売の再開は、仕様・供給・価格の確認のチェックが必要
    expect(action).toContain("if (action === 'resume' && formData.get('resume_confirmed') !== '1') {");
    // 廃番・取り消しは台帳の編集権限を確かめてから、理由と画面が読んだ版を渡す（取り消しの本部の管理者の判定は保存処理と DB）
    expect(action).toContain('export async function setProductDiscontinuedAction(formData: FormData)');
    expect(action).toContain('await store.setProductDiscontinued({ id, discontinued: mode === \'discontinue\', reason, expectedUpdatedAt }, actor);');
  });

  it('Supabase では版（updated_at）が一致する行だけを更新し、0 件なら成功扱いにしない', () => {
    expect(supabaseStore).toContain(".eq('updated_at', expectedUpdatedAt)");
    expect(supabaseStore).toContain(".select('id, updated_at');");
    expect(supabaseStore).toContain('if (rows.length === 0) {');
    expect(supabaseStore).toContain("db.rpc('product_lifecycle_capability')");
    // 取扱終了の拒否（RETIRED:）は入力の誤りとして画面に返す
    expect(supabaseStore).toContain("if (msg.startsWith('RETIRED:')) throw new StoreError('VALIDATION'");
  });

  it('商品の登録・編集の保存（upsertOption）は、販売停止・廃番・シミュレーター表示の列を送らない', () => {
    const start = supabaseStore.indexOf('async upsertOption(input: OptionInput)');
    const body = supabaseStore.slice(start, supabaseStore.indexOf('\n  }\n', start));
    expect(body).toContain('simulator_visible: _simulatorVisible, archived_at: _archivedAt, discontinued_at: _discontinuedAt, ...rest');
    expect(body).toContain("return this.upsert<ProductOption>('options', rest);");
  });
});
