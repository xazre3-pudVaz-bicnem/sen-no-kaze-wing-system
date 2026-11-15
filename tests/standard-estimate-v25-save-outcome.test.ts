import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mock.revalidatePath, updateTag: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  requireAdmin: vi.fn(async () => {}),
}));
vi.mock('@/lib/data/store', () => ({ isLocalMode: vi.fn(() => false) }));
vi.mock('@/lib/data/public-catalog', () => ({ CATALOG_TAG: 'standard-catalog' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc: mock.rpc, from: mock.from })),
}));

const {
  saveStandardEstimateV25DraftAction,
  readStandardEstimateV25SaveStatusAction,
} = await import('@/lib/actions/standard-estimate-v25');

const revisionId = 'bd0f0000-0000-4000-8000-000000000001';
const payload = {
  rates: { sales_fee_rate: '1.07', expense_rate: '0.15', markup_rate: '1.5' },
  adjustment: 0, adjustment_reason: null,
  slots: [], lines: [],
};
const input = { revision_id: revisionId, expected_lock_version: 2, payload };

describe('PR #640 保存の成否不明: 明示拒否のみ編集再開、それ以外は安全確認へ', () => {
  beforeEach(() => {
    mock.rpc.mockReset();
    mock.from.mockReset();
    mock.revalidatePath.mockReset();
  });

  it('DBが明示的にLOCKEDで拒否した場合のみ確定的な不成立と判定する', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'LOCKED: stale version' } });
    expect(await saveStandardEstimateV25DraftAction(input)).toMatchObject({
      ok: false, saveOutcome: 'rejected',
    });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it('保存RPCが通信障害などを返した場合は、commitされている可能性を残す', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'Connection reset by peer' } });
    expect(await saveStandardEstimateV25DraftAction(input)).toMatchObject({
      ok: false, saveOutcome: 'unknown',
    });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it('不明なSQLエラーも明示拒否とはみなさない', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'unexpected error' } });
    expect(await saveStandardEstimateV25DraftAction(input)).toMatchObject({
      ok: false, saveOutcome: 'unknown',
    });
  });

  it('入力バリデーションで拒否した場合は保存未実行と判定する', async () => {
    const result = await saveStandardEstimateV25DraftAction({ ...input, expected_lock_version: -1 });
    expect(result).toMatchObject({ ok: false, saveOutcome: 'rejected' });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('DB保存成功後に画面再検証処理が失敗した場合は曖昧な例外として残る', async () => {
    mock.rpc.mockResolvedValue({ data: { lock_version: 3 }, error: null });
    mock.revalidatePath.mockImplementationOnce(() => { throw new Error('post-commit network issue'); });
    await expect(saveStandardEstimateV25DraftAction(input)).rejects.toThrow('post-commit network issue');
  });

  it('照合はread-onlyのselectで現行Revisionの版番号を取得し、書き込まない', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { lock_version: 3, status: 'draft' }, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mock.from.mockReturnValue({ select });
    expect(await readStandardEstimateV25SaveStatusAction({ revision_id: revisionId })).toEqual({
      ok: true, lockVersion: 3, status: 'draft',
    });
    expect(mock.from).toHaveBeenCalledWith('standard_estimate_revisions');
    expect(select).toHaveBeenCalledWith('lock_version, status');
    expect(eq).toHaveBeenCalledWith('id', revisionId);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('照合が不可能な場合、版番号を捏造せずエラーを返す', async () => {
    mock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    expect(await readStandardEstimateV25SaveStatusAction({ revision_id: revisionId })).toMatchObject({ ok: false });
  });
});
