import { beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
  getOption: vi.fn(),
  getOptionVariants: vi.fn(),
  upsertVariantGroup: vi.fn(),
  upsertVariantChoice: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireCatalogEditor: vi.fn(async () => ({})),
}));
vi.mock('@/lib/data/store', () => ({
  getStore: vi.fn(async () => stubs),
  StoreError: class StoreError extends Error {},
}));
vi.mock('@/lib/data/public-catalog', () => ({ CATALOG_TAG: 'catalog' }));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { createVariantGroupWithFirstChoiceAction } from '@/lib/actions/product-registration-variants';

const optionId = '11111111-1111-4111-8111-111111111111';

function prepare(names: string[], prices: string[], standard: number) {
  const form = new FormData();
  form.set('option_id', optionId);
  form.set('name', '扉カラー');
  form.set('standard_choice_index', String(standard));
  form.set('first_choice_name', names[standard] ?? '');
  names.forEach((name, index) => {
    if (index !== standard) form.append('additional_choice_name', name);
    form.set(`choice_extra_price_${index}`, prices[index]);
    form.set(`choice_image_url_${index}`, `https://example.com/image-${index}.png`);
  });
  return form;
}

async function save(form: FormData) {
  return createVariantGroupWithFirstChoiceAction({ ok: false }, form);
}

describe('選択項目の初回作成：保存アクションの金額対応', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.getOption.mockResolvedValue({ id: optionId });
    stubs.getOptionVariants.mockResolvedValue({ groups: [], choices: [] });
    stubs.upsertVariantGroup.mockImplementation(async (item) => item);
    stubs.upsertVariantChoice.mockImplementation(async (item) => item);
  });

  it('標準を先頭にした場合、名前・追加金額・画像を同じ選択肢に保存する', async () => {
    const result = await save(prepare(['ホワイト', 'ブラック', '木目調'], ['0', '460', '2500'], 0));
    expect(result.ok).toBe(true);
    expect(stubs.upsertVariantGroup).toHaveBeenCalledTimes(1);
    expect(stubs.upsertVariantChoice).toHaveBeenCalledTimes(3);
    expect(stubs.upsertVariantChoice.mock.calls.map(([saved]) => ({
      name: saved.name, kind: saved.kind, extra_price: saved.extra_price, image_url: saved.image_url,
    }))).toEqual([
      { name: 'ホワイト', kind: 'standard', extra_price: 0, image_url: 'https://example.com/image-0.png' },
      { name: 'ブラック', kind: 'option', extra_price: 460, image_url: 'https://example.com/image-1.png' },
      { name: '木目調', kind: 'option', extra_price: 2500, image_url: 'https://example.com/image-2.png' },
    ]);
  });

  it('標準を2番目へ切り替えても表示順に紐づいた価格・画像を取り違えない', async () => {
    const result = await save(prepare(['ホワイト', 'ブラック', '木目調'], ['0', '460', '2500'], 1));
    expect(result.ok).toBe(true);
    expect(stubs.upsertVariantChoice.mock.calls.map(([saved]) => ({
      name: saved.name, kind: saved.kind, extra_price: saved.extra_price, image_url: saved.image_url,
    }))).toEqual([
      { name: 'ブラック', kind: 'standard', extra_price: 460, image_url: 'https://example.com/image-1.png' },
      { name: 'ホワイト', kind: 'option', extra_price: 0, image_url: 'https://example.com/image-0.png' },
      { name: '木目調', kind: 'option', extra_price: 2500, image_url: 'https://example.com/image-2.png' },
    ]);
  });

  it('中間行を削除し標準位置が繰り上がっても、残った金額を取り違えない', async () => {
    // ブラウザでは削除後の2行がindex 0,1となり、金額も表示行と同じindexで送信される。
    const result = await save(prepare(['ホワイト', '木目調'], ['0', '2500'], 1));
    expect(result.ok).toBe(true);
    expect(stubs.upsertVariantChoice.mock.calls.map(([saved]) => [
      saved.name, saved.kind, saved.extra_price, saved.image_url,
    ])).toEqual([
      ['木目調', 'standard', 2500, 'https://example.com/image-1.png'],
      ['ホワイト', 'option', 0, 'https://example.com/image-0.png'],
    ]);
  });

  it.each(['', '-1', '0.5', '100000001', 'abc'])('不正金額 %s はDB保存前に拒否する', async (invalid) => {
    const result = await save(prepare(['ホワイト', 'ブラック'], ['0', invalid], 0));
    expect(result.ok).toBe(false);
    expect(stubs.upsertVariantGroup).not.toHaveBeenCalled();
    expect(stubs.upsertVariantChoice).not.toHaveBeenCalled();
  });

  it('名前のない選択肢に金額だけが指定されたときは保存しない', async () => {
    const result = await save(prepare(['ホワイト', ''], ['0', '460'], 0));
    expect(result.ok).toBe(false);
    expect(stubs.upsertVariantGroup).not.toHaveBeenCalled();
    expect(stubs.upsertVariantChoice).not.toHaveBeenCalled();
  });

  it('従来画面が金額フィールドを送信しない場合は0円として保存する', async () => {
    const form = prepare(['ホワイト', 'ブラック'], ['0', '460'], 0);
    form.delete('choice_extra_price_0');
    form.delete('choice_extra_price_1');
    const result = await save(form);
    expect(result.ok).toBe(true);
    expect(stubs.upsertVariantChoice.mock.calls.map(([saved]) => saved.extra_price)).toEqual([0, 0]);
  });
});
