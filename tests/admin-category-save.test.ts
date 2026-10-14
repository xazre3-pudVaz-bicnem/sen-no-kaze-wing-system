import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  requireAdmin: vi.fn(),
  requireCatalogEditor: vi.fn(),
  requireStaff: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
}));
vi.mock('@/lib/auth/session', () => ({
  requireAdmin: mocks.requireAdmin,
  requireCatalogEditor: mocks.requireCatalogEditor,
  requireStaff: mocks.requireStaff,
}));
vi.mock('@/lib/data/public-catalog', () => ({
  CATALOG_TAG: 'catalog',
}));
vi.mock('@/lib/mail/send', () => ({
  flushNotificationsSafely: vi.fn(),
}));
vi.mock('@/lib/data/store', () => ({
  getStore: mocks.getStore,
  isLocalMode: vi.fn(() => false),
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { saveCategoryAction } from '@/lib/actions/admin';

const CATEGORY_ID = '29000000-0000-4000-8000-000000000002';

/** 管理画面のカテゴリー編集フォーム（components/admin/forms.tsx の CategoryForm）と同じ項目。 */
function categoryForm(checked: { is_required?: boolean; customer_visible?: boolean }) {
  const fd = new FormData();
  fd.set('id', CATEGORY_ID);
  fd.set('name', '壁断熱');
  fd.set('group_name', '内外装仕上げ');
  fd.set('group_code', 'finish');
  fd.set('group_sort', '2');
  fd.set('code', 'insulation-wall');
  fd.set('sort_order', '5');
  fd.set('finish_level', 'shell');
  fd.set('selection_mode', 'single');
  fd.set('status', 'published');
  fd.set('description', '壁断熱を個別に選択します。');
  // チェックボックスは、チェックしたときだけ "on" が送られる
  if (checked.is_required) fd.set('is_required', 'on');
  if (checked.customer_visible) fd.set('customer_visible', 'on');
  return fd;
}

describe('カテゴリー保存（管理画面）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCatalogEditor.mockResolvedValue({ id: 'admin', role: 'admin' });
  });

  it('「必須」だけを外して保存しても、お客様画面への表示はそのまま残る', async () => {
    const store = { upsertCategory: vi.fn(async (value: unknown) => value) };
    mocks.getStore.mockResolvedValue(store);

    const result = await saveCategoryAction({ ok: false }, categoryForm({ is_required: false, customer_visible: true }));

    expect(result.ok).toBe(true);
    expect(store.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      id: CATEGORY_ID,
      code: 'insulation-wall',
      is_required: false,
      customer_visible: true,
    }));
  });

  it('チェックボックスはどちらも、チェックした状態・外した状態がそのまま保存される', async () => {
    for (const checked of [
      { is_required: true, customer_visible: true },
      { is_required: true, customer_visible: false },
      { is_required: false, customer_visible: false },
    ]) {
      const store = { upsertCategory: vi.fn(async (value: unknown) => value) };
      mocks.getStore.mockResolvedValue(store);

      const result = await saveCategoryAction({ ok: false }, categoryForm(checked));

      expect(result.ok).toBe(true);
      expect(store.upsertCategory).toHaveBeenCalledWith(expect.objectContaining(checked));
    }
  });
});
