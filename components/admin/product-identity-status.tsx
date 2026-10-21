import type { ReactNode } from 'react';

export type ProductDuplicateRow = {
  id: string;
  name: string;
  productNo: string | null;
  reason: 'manufacturer-model' | 'category-manufacturer-name';
  modelNo: string | null;
  manufacturer: string | null;
};

/**
 * Product identity display only. Draft and published screens own their own
 * eligibility checks and save actions; this component never saves or validates.
 */
export function ProductManagementNumber({
  number,
  fallback = '未採番',
  testId,
}: {
  number: string | null | undefined;
  fallback?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <p className="label">商品管理番号</p>
      <div className="input flex min-h-11 items-center bg-sand/35 text-sm font-semibold text-ink-soft">
        {number ?? fallback}
      </div>
      <p className="mt-1 text-xs text-muted">PRD-000001形式で自動採番し、登録後は変更しません。</p>
    </div>
  );
}

export function ProductDuplicateStatus({
  candidates,
  ready,
  stale = false,
  testId,
  warningTestId,
  staleHint,
  emptyHint,
  candidateHint,
}: {
  candidates: readonly ProductDuplicateRow[];
  ready: boolean;
  stale?: boolean;
  testId: string;
  warningTestId?: string;
  staleHint?: ReactNode;
  emptyHint?: ReactNode;
  candidateHint?: ReactNode;
}) {
  const hasCandidates = !stale && candidates.length > 0;
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${hasCandidates ? 'border-[#d9a441] bg-[#fff8e8]' : 'border-line bg-ivory/30'}`}
      data-testid={testId}
      aria-label="既存商品チェック"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">既存商品チェック</p>
        <span className={`text-xs font-semibold ${hasCandidates ? 'text-[#8a641d]' : 'text-muted'}`}>
          {stale
            ? '入力変更後の重複は未確認'
            : hasCandidates
              ? '要確認：重複候補あり'
              : ready ? '重複候補なし' : '確認に必要な情報を入力'}
        </span>
      </div>
      {stale ? (
        <p className="mt-2 text-xs text-muted">
          {staleHint ?? '変更後の重複は未確認です。保存前に入力内容を確認してください。'}
        </p>
      ) : hasCandidates ? (
        <div className="mt-2" data-testid={warningTestId}>
          <p className="text-xs leading-5 text-ink-soft">
            {candidateHint ?? '登録を止める判定ではありません。新規商品かどうかを確認してから保存してください。'}
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="rounded-lg border border-[#ead6a7] bg-white px-3 py-2 text-sm">
                <a href={`/admin/options/${candidate.id}`} className="font-semibold underline underline-offset-4 hover:text-brown">
                  {candidate.name}
                </a>
                <span className="ml-2 text-xs text-muted">{candidate.productNo ?? '商品番号未反映'}</span>
                <p className="mt-1 text-xs text-muted">
                  {candidate.reason === 'manufacturer-model'
                    ? 'メーカー＋シリーズ・型番／品番が一致'
                    : '同一カテゴリー＋メーカー＋商品名が一致'}
                  {candidate.modelNo ? ` ／ ${candidate.manufacturer ?? 'メーカー未設定'} ／ ${candidate.modelNo}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">
          {emptyHint ?? (ready
            ? 'メーカーと商品名・型番から、登録済み商品の重複候補は見つかっていません。'
            : 'メーカーと商品名または型番を入力すると、自動で重複候補を確認します。')}
        </p>
      )}
    </div>
  );
}
