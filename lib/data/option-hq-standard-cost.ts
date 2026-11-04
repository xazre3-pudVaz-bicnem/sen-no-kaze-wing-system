import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isMissingFunction, isMissingRelation } from '@/lib/data/schema-compat';
import { isLocalMode } from '@/lib/data/store';

export type OptionHqStandardCost = {
  option_id: string;
  standard_cost: number;
  lock_version: number;
  updated_at: string;
};

/** 標準原価の Version（20261016200000）。作った後は変わらない */
export type OptionStandardCostVersion = {
  id: string;
  version_no: number;
  standard_cost: number;
  change_reason: string;
  created_at: string;
  superseded_at: string | null;
};

export type OptionHqStandardCostAccess = {
  available: boolean;
  canView: boolean;
  canManage: boolean;
  cost: OptionHqStandardCost | null;
  /** 新しい順。Version の表がまだ DB に無い間は null（現在値の表示・変更はそのまま使える） */
  versions: OptionStandardCostVersion[] | null;
};

const VERSION_HISTORY_LIMIT = 20;

type DbError = { code?: string; message?: string } | null;

function migrationUnavailable(error: DbError) {
  return isMissingFunction(error) || isMissingRelation(error);
}

function throwDbError(error: Exclude<DbError, null>): never {
  throw new Error(`本部商品基準原価の取得に失敗しました: ${error.code ?? 'unknown'}`);
}

/**
 * 商品編集画面向け。migrationがアプリより後に反映されても画面を500にしない。
 * 権限判定はDB helperを正本とし、クライアント側role推測では代用しない。
 */
export async function getOptionHqStandardCostAccess(optionId: string): Promise<OptionHqStandardCostAccess> {
  // ローカル検証モード（開発・E2E）は本部の原価を持たない。接続先の無い Supabase へも問い合わせない
  if (isLocalMode()) return { available: false, canView: false, canManage: false, cost: null, versions: null };

  const db = await createClient();
  const [viewResult, manageResult] = await Promise.all([
    db.rpc('can_view_option_hq_standard_cost'),
    db.rpc('can_manage_option_hq_standard_cost'),
  ]);

  if (migrationUnavailable(viewResult.error) || migrationUnavailable(manageResult.error)) {
    return { available: false, canView: false, canManage: false, cost: null, versions: null };
  }
  if (viewResult.error) throwDbError(viewResult.error);
  if (manageResult.error) throwDbError(manageResult.error);

  const canView = viewResult.data === true;
  const canManage = manageResult.data === true;
  if (!canView) return { available: true, canView: false, canManage: false, cost: null, versions: null };

  const [result, versionResult] = await Promise.all([
    db
      .from('option_hq_standard_costs')
      .select('option_id, standard_cost, lock_version, updated_at')
      .eq('option_id', optionId)
      .maybeSingle(),
    db
      .from('option_standard_cost_versions')
      .select('id, version_no, standard_cost, change_reason, created_at, superseded_at')
      .eq('option_id', optionId)
      .order('version_no', { ascending: false })
      .limit(VERSION_HISTORY_LIMIT),
  ]);

  if (migrationUnavailable(result.error)) {
    return { available: false, canView: false, canManage: false, cost: null, versions: null };
  }
  if (result.error) throwDbError(result.error);
  if (versionResult.error && !migrationUnavailable(versionResult.error)) throwDbError(versionResult.error);

  return {
    available: true,
    canView: true,
    canManage,
    cost: (result.data as OptionHqStandardCost | null) ?? null,
    versions: versionResult.error ? null : ((versionResult.data ?? []) as OptionStandardCostVersion[]),
  };
}

/** 商品台帳向け。本部閲覧権限が無ければ値も項目名もclientへ渡さない。 */
export async function getOptionHqStandardCostMap(optionIds: string[]): Promise<Record<string, number> | null> {
  if (isLocalMode()) return null;
  if (optionIds.length === 0) return {};

  const db = await createClient();
  const access = await db.rpc('can_view_option_hq_standard_cost');
  if (migrationUnavailable(access.error)) return null;
  if (access.error) throwDbError(access.error);
  if (access.data !== true) return null;

  const result = await db
    .from('option_hq_standard_costs')
    .select('option_id, standard_cost')
    .in('option_id', optionIds);

  if (migrationUnavailable(result.error)) return null;
  if (result.error) throwDbError(result.error);

  return Object.fromEntries(
    (result.data ?? []).map((row) => [String(row.option_id), Number(row.standard_cost)])
  );
}
