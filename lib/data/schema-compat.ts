import type { OptionCategory, ProductOption } from '@/lib/domain/types';

/**
 * マイグレーション 0008（商品台帳の階層化）が未適用の DB でも画面が落ちないようにするための補正。
 *
 * 0008 で追加されるのは options.spec_codes / option_categories.group_* / preview_hotspots。
 * 0009 で追加されるのは option_categories.finish_level / configurations.finish_level / quotes.finish_level。
 * 本番へアプリだけ先に配信された場合、これらが無いと全ページが 500 になるため、
 * 読み取り側で既定値に寄せて「全仕様共通・分類はその他・ホットスポットなし」として扱う。
 * 0008 を適用したあとも値はそのまま通るので、そのまま残しておいて安全。
 */

/** テーブル自体が存在しない（PostgREST のスキーマキャッシュに無い／未作成） */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /does not exist/i.test(error.message ?? '');
}

/** 列が存在しない（PostgreSQLまたはPostgRESTのスキーマキャッシュ） */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

/** 未適用migrationによりPostgRESTのRPC定義が存在しない場合だけ互換fallbackする。 */
export function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|could not find the function .* schema cache/i.test(error.message ?? '');
}

/** 指定したRPC自体が存在しないことがエラー文から明確な場合だけtrue。 */
export function isMissingNamedFunction(
  error: { code?: string; message?: string } | null | undefined,
  functionName: string
): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  const escapedName = functionName.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  const qualifiedName = `(?:public\\.)?${escapedName}`;
  if (error.code === 'PGRST202') {
    return new RegExp(`could not find the function\\s+${qualifiedName}(?:\\s*\\(|\\b).*schema cache`, 'i').test(message);
  }
  if (error.code === '42883') {
    return new RegExp(`function\\s+${qualifiedName}(?:\\s*\\(|\\b).*does not exist`, 'i').test(message);
  }
  return false;
}

type LegacyExteriorFace = {
  face_code: string;
  option_id: string;
  variant_choice_ids: string[];
};

function normalizedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

function sameIds(left: string[], right: string[]): boolean {
  const a = normalizedIds(left);
  const b = normalizedIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Atomic RPC未適用時に、旧save_configurationだけで同じ意味を保存できるか。 */
export function isLegacyConfigurationSaveCompatible(input: {
  site_prefecture: string | null;
  site_municipality: string | null;
  site_location_undecided: boolean;
  exterior_faces: LegacyExteriorFace[];
  legacy_exterior_option_ids: string[];
  legacy_exterior_variant_choice_ids: string[];
}): boolean {
  if (input.site_prefecture !== null || input.site_municipality !== null || input.site_location_undecided) {
    return false;
  }

  const faces = input.exterior_faces;
  if (faces.length === 0) return input.legacy_exterior_option_ids.length <= 1;
  if (faces.length !== 4 || input.legacy_exterior_option_ids.length !== 1) return false;

  const requiredFaceCodes = new Set(['front', 'right', 'back', 'left']);
  const actualFaceCodes = new Set(faces.map((face) => face.face_code));
  if (actualFaceCodes.size !== 4 || [...requiredFaceCodes].some((code) => !actualFaceCodes.has(code))) return false;

  const first = faces[0];
  if (!first || first.option_id !== input.legacy_exterior_option_ids[0]) return false;
  if (normalizedIds(first.variant_choice_ids).length !== first.variant_choice_ids.length) return false;
  if (!sameIds(first.variant_choice_ids, input.legacy_exterior_variant_choice_ids)) return false;

  return faces.every(
    (face) =>
      face.option_id === first.option_id &&
      normalizedIds(face.variant_choice_ids).length === face.variant_choice_ids.length &&
      sameIds(face.variant_choice_ids, first.variant_choice_ids)
  );
}

export function normalizeOptions(rows: ProductOption[]): ProductOption[] {
  return rows.map((o) => (Array.isArray(o.spec_codes) ? o : { ...o, spec_codes: [] }));
}

export function normalizeCategories(rows: OptionCategory[]): OptionCategory[] {
  return rows.map((c) => {
    let next = c.group_code ? c : { ...c, group_code: 'other', group_name: 'その他', group_sort: c.group_sort ?? 99 };
    next = next.finish_level ? next : { ...next, finish_level: 'full' as const };
    // 0016 未適用の DB では customer_visible が無い → すべて表示扱い
    return typeof next.customer_visible === 'boolean' ? next : { ...next, customer_visible: true };
  });
}
