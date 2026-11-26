import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import { C, O } from '@/lib/seed/catalog';

// ローカル検証モードの設備包含（#631）が、DB の set_option_included_categories と
// 守りのトリガー（20261110024245）と同じ判定になることを確かめる
const admin: SessionUser = { id: 'local-admin', email: 'admin@example.com', role: 'admin', full_name: '本部' };
const master: SessionUser = { id: 'local-master', email: 'master@example.com', role: 'master_dealer', full_name: '総代理店' };
const dealer: SessionUser = { id: 'local-dealer', email: 'dealer@example.com', role: 'dealer', full_name: '代理店' };
const customer: SessionUser = { id: 'local-customer', email: 'customer@example.com', role: 'customer', full_name: 'お客様' };

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-included-categories-'));
  process.env.WING_LOCAL_DIR = dir;
  process.env.WING_LOCAL_MODE = '1';
});

afterEach(() => {
  delete process.env.WING_LOCAL_DIR;
  delete process.env.WING_LOCAL_MODE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const sorted = (ids: string[]) => [...ids].sort();

describe('ローカル検証モードの設備包含：DB の関数と同じ判定', () => {
  it('本部は空集合から両方・片方・空へ置き換えられ、毎回変更の履歴が残る', async () => {
    const store = new LocalStore();
    expect(await store.listOptionIncludedCategoryIds(admin, O.ub1216)).toEqual([]);

    const both = await store.setOptionIncludedCategories(admin, O.ub1216, [], [C.washbasin, C.toilet]);
    expect(both).toEqual(sorted([C.toilet, C.washbasin]));
    expect(await store.listOptionIncludedCategoryIds(admin, O.ub1216)).toEqual(sorted([C.toilet, C.washbasin]));

    expect(await store.setOptionIncludedCategories(admin, O.ub1216, [C.washbasin, C.toilet], [C.toilet])).toEqual([C.toilet]);
    expect(await store.setOptionIncludedCategories(admin, O.ub1216, [C.toilet], [])).toEqual([]);
    expect(await store.listOptionIncludedCategoryIds(admin, O.ub1216)).toEqual([]);

    const audits = loadDb().auditLogs.filter((row) => row.action === 'option.included_categories.save');
    expect(audits).toHaveLength(3);
    expect(audits.every((row) => row.entity_id === O.ub1216 && row.actor_id === admin.id)).toBe(true);
  });

  it('同じ集合の保存は書き換えず、履歴も残さない', async () => {
    const store = new LocalStore();
    await store.setOptionIncludedCategories(admin, O.ub1216, [], [C.toilet]);
    expect(await store.setOptionIncludedCategories(admin, O.ub1216, [C.toilet], [C.toilet])).toEqual([C.toilet]);
    expect(loadDb().auditLogs.filter((row) => row.action === 'option.included_categories.save')).toHaveLength(1);
  });

  it.each([
    [master, '総代理店'],
    [dealer, '代理店'],
    [customer, 'お客様'],
  ])('%s（%s）は保存できない（FORBIDDEN）', async (actor) => {
    const store = new LocalStore();
    await expect(store.setOptionIncludedCategories(actor, O.ub1216, [], [C.toilet])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(loadDb().optionIncludedCategories ?? []).toEqual([]);
  });

  it('開いた時点の集合が今と違えば CONFLICT で、何も変えない', async () => {
    const store = new LocalStore();
    await store.setOptionIncludedCategories(admin, O.ub1216, [], [C.toilet]);
    await expect(store.setOptionIncludedCategories(admin, O.ub1216, [], [C.washbasin])).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await store.listOptionIncludedCategoryIds(admin, O.ub1216)).toEqual([C.toilet]);
  });

  it('見つからない商品は NOT_FOUND', async () => {
    const store = new LocalStore();
    await expect(
      store.setOptionIncludedCategories(admin, '99999999-9999-4999-8999-999999999999', [], [C.toilet])
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    [[C.toilet, C.toilet], '重複'],
    [[''], '空欄'],
  ])('%s（%s）は勝手に直さずに止める（VALIDATION）', async (next) => {
    const store = new LocalStore();
    await expect(store.setOptionIncludedCategories(admin, O.ub1216, [], next)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('浴室以外の商品・自分のカテゴリー・トイレと洗面以外は VALIDATION', async () => {
    const store = new LocalStore();
    await expect(store.setOptionIncludedCategories(admin, O.toiletWashlet, [], [C.washbasin])).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.setOptionIncludedCategories(admin, O.ub1216, [], [C.ub])).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.setOptionIncludedCategories(admin, O.ub1216, [], [C.kitchen])).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(loadDb().optionIncludedCategories ?? []).toEqual([]);
  });

  it('非公開のトイレ・洗面は含められない', async () => {
    const store = new LocalStore();
    const washbasin = (await store.listCategories()).find((row) => row.id === C.washbasin)!;
    await store.upsertCategory({ ...washbasin, status: 'draft' });
    await expect(store.setOptionIncludedCategories(admin, O.ub1216, [], [C.washbasin])).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('見える範囲：本部は全部、ほかは公開中の商品の公開中のカテゴリーだけ', async () => {
    const store = new LocalStore();
    await store.setOptionIncludedCategories(admin, O.ub1216, [], [C.toilet, C.washbasin]);
    expect(await store.listOptionIncludedCategoryIds(customer, O.ub1216)).toEqual(sorted([C.toilet, C.washbasin]));
    expect(await store.listOptionIncludedCategoryIds(null, O.ub1216)).toEqual(sorted([C.toilet, C.washbasin]));

    const option = (await store.getOption(O.ub1216))!;
    await store.upsertOption({ ...option, status: 'draft' });
    expect(await store.listOptionIncludedCategoryIds(dealer, O.ub1216)).toEqual([]);
    expect(await store.listOptionIncludedCategoryIds(admin, O.ub1216)).toEqual(sorted([C.toilet, C.washbasin]));
  });

  it('含まれる設備が残っている商品は、カテゴリーを変えられない（解除すれば変えられる）', async () => {
    const store = new LocalStore();
    await store.setOptionIncludedCategories(admin, O.ub1216, [], [C.toilet]);
    const option = (await store.getOption(O.ub1216))!;
    await expect(store.upsertOption({ ...option, category_id: C.kitchen })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await store.getOption(O.ub1216))!.category_id).toBe(C.ub);

    // カテゴリーを変えない保存（名前の変更など）は今までどおりできる
    await store.upsertOption({ ...option, name: option.name + '（改）' });

    await store.setOptionIncludedCategories(admin, O.ub1216, [C.toilet], []);
    const latest = (await store.getOption(O.ub1216))!;
    await store.upsertOption({ ...latest, category_id: C.kitchen });
    expect((await store.getOption(O.ub1216))!.category_id).toBe(C.kitchen);
  });

  it('設備包含で使っているカテゴリーは、コード・公開状態を変えられない（名前は変えられる）', async () => {
    const store = new LocalStore();
    await store.setOptionIncludedCategories(admin, O.ub1216, [], [C.toilet]);
    const categories = await store.listCategories();
    const toilet = categories.find((row) => row.id === C.toilet)!;
    const ub = categories.find((row) => row.id === C.ub)!;
    const washbasin = categories.find((row) => row.id === C.washbasin)!;

    await expect(store.upsertCategory({ ...toilet, status: 'draft' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.upsertCategory({ ...toilet, code: 'toilet-2' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.upsertCategory({ ...ub, status: 'draft' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await store.upsertCategory({ ...toilet, name: toilet.name + '（改）' });
    // 使っていないカテゴリーは今までどおり変えられる
    await store.upsertCategory({ ...washbasin, status: 'draft' });
    expect((await store.listCategories()).find((row) => row.id === C.washbasin)!.status).toBe('draft');
  });

  it('商品を消すと、含まれる設備の行も一緒に消える', async () => {
    const store = new LocalStore();
    await store.setOptionIncludedCategories(admin, O.showerToiletUnit, [], [C.toilet]);
    await store.deleteOption(O.showerToiletUnit);
    expect((loadDb().optionIncludedCategories ?? []).filter((row) => row.option_id === O.showerToiletUnit)).toEqual([]);
  });

  it('古い db.json（設備包含の項目が無い）でも読める', async () => {
    const store = new LocalStore();
    expect(await store.listOptionIncludedCategoryIds(admin, O.ub3point)).toEqual([]);
    expect(loadDb().optionIncludedCategories).toBeUndefined();
  });
});
