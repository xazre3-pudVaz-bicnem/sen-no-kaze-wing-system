import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCatalogEditor: vi.fn(),
  isLocalMode: vi.fn(() => false),
  rpc: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/lib/auth/session', () => ({
  requireCatalogEditor: mocks.requireCatalogEditor,
}));

vi.mock('@/lib/data/store', () => ({
  isLocalMode: mocks.isLocalMode,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import {
  publishBaseMasterDraftAction,
  saveBaseMasterDraftAction,
} from '@/lib/actions/base-masters';

const initialState = { ok: false };
const revisionId = '11111111-1111-4111-8111-111111111111';
const masterId = '22222222-2222-4222-8222-222222222222';
const lineKey = '33333333-3333-4333-8333-333333333333';

function makeSaveForm(overrides?: Partial<Record<string, string>>) {
  const form = new FormData();
  const values: Record<string, string> = {
    revision_id: revisionId,
    master_id: masterId,
    name: 'Wing ホテル非防火',
    fire_spec_code: 'non_fire',
    expense_method: 'rate',
    expense_rate_percent: '15',
    expense_amount: '0',
    lines_json: JSON.stringify([
      {
        line_key: lineKey,
        section: '1. 金物',
        name: '金物A',
        quantity: 2,
        unit: '式',
        unit_price: 5000,
        remark: '既存行',
      },
      {
        line_key: null,
        section: '2. 木材',
        name: '木材B',
        quantity: 1,
        unit: '式',
        unit_price: 4000,
        remark: '新規行',
      },
    ]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe('本体マスターServer Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLocalMode.mockReturnValue(false);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it('saveはFormDataの不正revision UUIDをRPCへ渡さない', async () => {
    const result = await saveBaseMasterDraftAction(
      initialState,
      makeSaveForm({ revision_id: 'not-a-uuid' })
    );

    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('saveは既存line_keyをそのままRPCへ渡し、新規行はnullのまま渡す', async () => {
    await expect(
      saveBaseMasterDraftAction(initialState, makeSaveForm())
    ).rejects.toThrow(`REDIRECT:/admin/base-masters/${masterId}?saved=`);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_base_master_draft',
      expect.objectContaining({
        p_revision_id: revisionId,
        p_lines: [
          expect.objectContaining({ line_key: lineKey, name: '金物A' }),
          expect.objectContaining({ line_key: null, name: '木材B' }),
        ],
      })
    );
  });

  it('publishは不正UUIDでRPCを呼ばない', async () => {
    const form = new FormData();
    form.set('revision_id', 'invalid');
    form.set('master_id', masterId);

    const result = await publishBaseMasterDraftAction(initialState, form);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('IDが不正');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('publishは検証済みrevision UUIDだけをpublish RPCへ渡す', async () => {
    const form = new FormData();
    form.set('revision_id', revisionId);
    form.set('master_id', masterId);

    await expect(
      publishBaseMasterDraftAction(initialState, form)
    ).rejects.toThrow(`REDIRECT:/admin/base-masters/${masterId}?published=1`);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('publish_base_master_draft', {
      p_revision_id: revisionId,
    });
  });

  it('権限チェックはRPCより先に実行される', async () => {
    mocks.requireCatalogEditor.mockRejectedValueOnce(new Error('FORBIDDEN'));

    await expect(
      saveBaseMasterDraftAction(initialState, makeSaveForm())
    ).rejects.toThrow('FORBIDDEN');

    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
