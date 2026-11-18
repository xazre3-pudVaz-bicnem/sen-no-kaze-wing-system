import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductOption } from '@/lib/domain/types';

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  requireAdmin: vi.fn(),
  requireCatalogEditor: vi.fn(),
  requireStaff: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  costFailure: false,
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
// 原価の Version の記録（v2.5 PR-A3）は、このテストでは「仕組みが無い」扱い（従来どおりの保存）
vi.mock('@/lib/data/option-cost-recording', () => ({
  getCostRecordingAccess: vi.fn(async () => ({ available: false, canManage: false })),
  getCostAccessForProduct: vi.fn(async () => ({ available: true, canManage: true })),
  NO_COST_RECORDING: { available: false, canManage: false },
  canEditCostField: (access: { available: boolean; canManage: boolean; error?: boolean }) => !access.error && (!access.available || access.canManage),
  COST_ACCESS_ERROR_MESSAGE: '原価の権限を確認できませんでした。',
  recordPublishedOptionCost: vi.fn(async () => mocks.costFailure ? ({ status: 'error', message: 'conflict' }) : ({ status: 'recorded' })),
  recordPublishedChoiceCosts: vi.fn(async () => ({ status: 'unavailable' })),
  costRecordingNotice: (result: {status: string}) => result.status === 'error' ? '商品は保存しましたが、原価の Version を記録できませんでした' : null,
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

import {
  saveOptionAction,
} from '@/lib/actions/admin';

const OPTION_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

const option = (patch: Partial<ProductOption> = {}): ProductOption => ({
  id: OPTION_ID,
  base_model_id: null,
  category_id: CATEGORY_ID,
  code: 'opt-test',
  name: 'テスト商品',
  description: null,
  price: 100_000,
  image_url: 'https://example.invalid/main.png',
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: false,
  spec_codes: [],
  owner_id: null,
  manufacturer: null,
  model_no: null,
  size_note: null,
  list_price: null,
  highlight: null,
  preview_key: null,
  affects_views: [],
  sort_order: 0,
  status: 'published',
  created_at: '',
  updated_at: '',
  ...patch,
});

function validOptionForm() {
  const fd = new FormData();
  fd.set('id', OPTION_ID);
  fd.set('base_model_id', '');
  fd.set('category_id', CATEGORY_ID);
  fd.set('name', 'テスト商品');
  fd.set('description', '');
  fd.set('price', '0');
  fd.set('image_url', '');
  fd.set('selection_type', 'radio');
  fd.set('preview_key', '');
  fd.set('sort_order', '0');
  fd.set('status', 'published');
  fd.set('owner_id', '');
  fd.set('manufacturer', '');
  fd.set('model_no', '');
  fd.set('size_note', '');
  fd.set('list_price', '');
  fd.set('highlight', '');
  return fd;
}

describe('登録済み商品の保存と原価Version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ id: 'admin', role: 'admin' });
  });
  it.each([false, true])('記録失敗=%s を保存成功と分けて返す', async (failed) => {
    mocks.costFailure = failed;
    const store = {
      getOption: vi.fn(async () => option()),
      upsertOption: vi.fn(async (value: unknown) => value),
      setOptionRelations: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store);
    const form = validOptionForm();
    form.set('price', '100000');
    form.set('image_url', 'https://example.invalid/main.png');
    const result = await saveOptionAction({ ok: false }, form);
    expect(store.upsertOption).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.costRecordingFailed).toBe(failed);
    if (failed) expect(result.message).toContain('商品は保存しましたが');
  });
});
