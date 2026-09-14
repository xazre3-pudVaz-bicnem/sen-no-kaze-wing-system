import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isLocalMode: vi.fn(() => false),
  rpc: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/data/store', () => ({ isLocalMode: mocks.isLocalMode }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import {
  resolveLegacyEstimateDuplicateAction,
  setLegacyBaseMappingDecisionAction,
  setLegacyBaseSpecMappingAction,
} from '@/lib/actions/base-migration';

const batchId = '11111111-1111-4111-8111-111111111111';
const mappingId = '22222222-2222-4222-8222-222222222222';
const modelId = '33333333-3333-4333-8333-333333333333';
const checkId = '44444444-4444-4444-8444-444444444444';

describe('旧本体移行監査Server Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLocalMode.mockReturnValue(false);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it('sitework分類とexpected_versionをRPCへ渡す', async () => {
    const form = new FormData();
    form.set('batch_id', batchId);
    form.set('mapping_id', mappingId);
    form.set('expected_version', '3');
    form.set('target_classification', 'sitework');
    form.set('target_group_label', '');
    form.set('note', '現地工事として別途');

    await expect(setLegacyBaseMappingDecisionAction(form))
      .rejects.toThrow(`REDIRECT:/admin/base-migration?batch=${batchId}&saved=1`);

    expect(mocks.rpc).toHaveBeenCalledWith('set_legacy_base_mapping_decision', {
      p_batch_id: batchId,
      p_mapping_id: mappingId,
      p_expected_version: 3,
      p_target_classification: 'sitework',
      p_target_group_label: null,
      p_note: '現地工事として別途',
    });
  });

  it('expected_versionが不正ならRPCへ到達しない', async () => {
    const form = new FormData();
    form.set('batch_id', batchId);
    form.set('mapping_id', mappingId);
    form.set('expected_version', '-1');
    form.set('target_classification', 'base');

    await expect(setLegacyBaseMappingDecisionAction(form))
      .rejects.toThrow('REDIRECT:/admin/base-migration?error=');

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('spec対応でも楽観ロックversionをRPCへ渡す', async () => {
    const form = new FormData();
    form.set('batch_id', batchId);
    form.set('base_model_id', modelId);
    form.set('legacy_spec_code', 'hotel');
    form.set('expected_version', '2');
    form.set('proposed_group_key', 'wing-hotel-body');
    form.set('reason', 'BOM一致');

    await expect(setLegacyBaseSpecMappingAction(form))
      .rejects.toThrow(`REDIRECT:/admin/base-migration?batch=${batchId}&saved=1`);

    expect(mocks.rpc).toHaveBeenCalledWith('set_legacy_base_spec_mapping', {
      p_batch_id: batchId,
      p_base_model_id: modelId,
      p_legacy_spec_code: 'hotel',
      p_expected_version: 2,
      p_proposed_group_key: 'wing-hotel-body',
      p_reason: 'BOM一致',
    });
  });

  it('重複解決でも楽観ロックversionをRPCへ渡す', async () => {
    const form = new FormData();
    form.set('batch_id', batchId);
    form.set('check_id', checkId);
    form.set('expected_version', '4');
    form.set('resolution', 'use_existing');

    await expect(resolveLegacyEstimateDuplicateAction(form))
      .rejects.toThrow(`REDIRECT:/admin/base-migration?batch=${batchId}&saved=1`);

    expect(mocks.rpc).toHaveBeenCalledWith('resolve_legacy_estimate_duplicate', {
      p_batch_id: batchId,
      p_check_id: checkId,
      p_expected_version: 4,
      p_resolution: 'use_existing',
    });
  });

  it('DBのCONFLICTメッセージを利用者へ返す', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'CONFLICT: この分類判断は他のユーザーに更新されました。画面を再読込してください' },
    });

    const form = new FormData();
    form.set('batch_id', batchId);
    form.set('mapping_id', mappingId);
    form.set('expected_version', '0');
    form.set('target_classification', 'base');

    await expect(setLegacyBaseMappingDecisionAction(form))
      .rejects.toThrow(/画面を再読込してください/);
  });

  it('未ログインならRPCへ到達しない', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));

    const form = new FormData();
    form.set('batch_id', batchId);
    form.set('mapping_id', mappingId);
    form.set('expected_version', '0');
    form.set('target_classification', 'base');

    await expect(setLegacyBaseMappingDecisionAction(form))
      .rejects.toThrow('UNAUTHENTICATED');

    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
