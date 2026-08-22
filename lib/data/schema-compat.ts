import type { OptionCategory, ProductOption } from '@/lib/domain/types';

/**
 * マイグレーション 0008（商品台帳の階層化）が未適用の DB でも画面が落ちないようにするための補正。
 *
 * 0008 で追加されるのは options.spec_codes / option_categories.group_* / preview_hotspots。
 * 本番へアプリだけ先に配信された場合、これらが無いと全ページが 500 になるため、
 * 読み取り側で既定値に寄せて「全仕様共通・分類はその他・ホットスポットなし」として扱う。
 * 0008 を適用したあとも値はそのまま通るので、そのまま残しておいて安全。
 */

/** テーブル自体が存在しない（PostgREST のスキーマキャッシュに無い／未作成） */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /does not exist/i.test(error.message ?? '');
}

/** 列が存在しない（0008 未適用の options / option_categories） */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

export function normalizeOptions(rows: ProductOption[]): ProductOption[] {
  return rows.map((o) => (Array.isArray(o.spec_codes) ? o : { ...o, spec_codes: [] }));
}

export function normalizeCategories(rows: OptionCategory[]): OptionCategory[] {
  return rows.map((c) =>
    c.group_code
      ? c
      : { ...c, group_code: 'other', group_name: 'その他', group_sort: c.group_sort ?? 99 }
  );
}
