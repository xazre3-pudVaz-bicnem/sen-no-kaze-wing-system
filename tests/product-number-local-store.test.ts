import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb } from '@/lib/data/local-db';

describe('LocalStoreの商品管理番号', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-product-no-'));
    process.env.WING_LOCAL_DIR = dir;
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('最大番号の商品を削除しても採番高水位を戻さない', async () => {
    const store = new LocalStore();
    const source = (await store.listOptions())[0];
    expect(source).toBeTruthy();

    const {
      id: _id,
      created_at: _createdAt,
      updated_at: _updatedAt,
      gallery_images: _galleryImages,
      product_no: _productNo,
      ...base
    } = source;

    const first = await store.upsertOption({
      ...base,
      id: null,
      code: 'local-product-number-first',
      name: '商品番号テスト1',
    });
    const firstNo = Number(first.product_no?.slice(4));
    const highWaterAfterFirst = loadDb().productNoSequence;

    await store.deleteOption(first.id);

    const second = await store.upsertOption({
      ...base,
      id: null,
      code: 'local-product-number-second',
      name: '商品番号テスト2',
    });
    const secondNo = Number(second.product_no?.slice(4));

    expect(first.product_no).toMatch(/^PRD-\d{6}$/);
    expect(second.product_no).toMatch(/^PRD-\d{6}$/);
    expect(secondNo).toBe(firstNo + 1);
    expect(loadDb().productNoSequence).toBe(highWaterAfterFirst + 1);
  });
});
