import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  isLocalMode: vi.fn(),
  requireStaff: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/data/store', () => ({ isLocalMode: mocks.isLocalMode }));
vi.mock('@/lib/auth/session', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { getOptionHqStandardCostAccess, getOptionHqStandardCostMap } from '@/lib/data/option-hq-standard-cost';
import { saveOptionHqStandardCostAction } from '@/lib/actions/option-hq-standard-cost';

const OPTION_ID = '11111111-1111-4111-8111-111111111111';

describe('本部商品基準原価：ローカル検証モード', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLocalMode.mockReturnValue(true);
    mocks.requireStaff.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.createClient.mockRejectedValue(new Error('ローカル検証モードで Supabase へ接続しようとした'));
  });

  it('商品編集画面のカードは出さず、Supabase へ問い合わせない', async () => {
    await expect(getOptionHqStandardCostAccess(OPTION_ID)).resolves.toEqual({
      available: false,
      canView: false,
      canManage: false,
      cost: null,
      versions: null,
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('商品台帳には原価の項目を渡さず、Supabase へ問い合わせない', async () => {
    await expect(getOptionHqStandardCostMap([OPTION_ID])).resolves.toBeNull();
    await expect(getOptionHqStandardCostMap([])).resolves.toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('保存は受け付けず、Supabase へ問い合わせない', async () => {
    const fd = new FormData();
    fd.set('option_id', OPTION_ID);
    fd.set('standard_cost', '95000');
    fd.set('expected_lock_version', '0');
    fd.set('change_reason', '初回設定');

    const result = await saveOptionHqStandardCostAction({ ok: false }, fd);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ローカル検証モード');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
