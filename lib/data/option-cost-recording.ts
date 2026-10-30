import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isMissingFunction, isMissingRelation } from '@/lib/data/schema-compat';
import { isLocalMode } from '@/lib/data/store';
export { canEditCostField, type CostRecordingAccess } from '@/lib/domain/option-cost-access';
import { isHqCostProduct, type CostRecordingAccess } from '@/lib/domain/option-cost-access';

/**
 * 商品標準原価・原価差額の Version の記録（v2.5 PR-A3）。
 *
 * 商品登録の「商品標準原価（税別）」「原価差額（税別）」は、旧シミュレーターが売価として使う列
 * （options.price・option_variant_choices.extra_price）にそのまま保存する（列の意味は変えない）。
 * 登録済みの商品だけ、本部が保存・登録したときに、同じ金額で原価の Version を作る（下書きは登録のときに作る）。
 * Version の作り方・権限・監査は DB の RPC（20261016200000）が決める。ここでは呼ぶだけ。
 */

export type CostRecordingResult =
  | { status: 'recorded' | 'unchanged' | 'skipped' | 'unavailable' }
  | { status: 'error'; message: string };

const RECORD_REASON = {
  save: '商品登録で商品標準原価を保存',
  publish: '商品の登録（公開）で商品標準原価を記録',
  choice: '商品登録で原価差額を保存',
  publishChoice: '商品の登録（公開）で原価差額を記録',
} as const;

/** 権限の確認ができなかったときの文（保存の操作は止める。本部の入力を黙って捨てない） */
export const COST_ACCESS_ERROR_MESSAGE = '原価の権限を確認できませんでした。時間をおいて、もう一度保存してください。';

type DbError = { code?: string; message?: string } | null;

function unavailable(error: DbError) {
  return isMissingFunction(error) || isMissingRelation(error);
}

function errorMessage(error: Exclude<DbError, null>) {
  const message = error.message ?? '';
  const reason = message.replace(/^(VALIDATION|CONFLICT|FORBIDDEN|NOT_FOUND|UNAUTHENTICATED|LOCKED|INTERNAL):\s*/, '').trim();
  return reason || '原価の Version を記録できませんでした';
}

export async function getCostRecordingAccess(): Promise<CostRecordingAccess> {
  if (isLocalMode()) return { available: false, canManage: false };
  const db = await createClient();
  const [manage, versions] = await Promise.all([
    db.rpc('can_manage_option_hq_standard_cost'),
    // Version の表が無い（20261016200000 が未適用）なら、記録はしない
    db.from('option_standard_cost_versions').select('id').limit(1),
  ]);
  if (unavailable(manage.error) || unavailable(versions.error)) return { available: false, canManage: false };
  // 一時的な失敗を「本部ではない」と取り違えない（本部の入力が黙って捨てられるのを防ぐ）
  if (manage.error) return { available: true, canManage: false, error: true };
  return { available: true, canManage: manage.data === true };
}

/** 本部商品の外（旧フリー商品）と、商品台帳の編集者以外には原価の決まりを掛けない */
export const NO_COST_RECORDING: CostRecordingAccess = { available: false, canManage: false };

/**
 * 商品の原価の権限。本部商品なら本部かどうかを返し、本部商品の外（旧フリー商品）には原価の決まりを掛けない。
 * カテゴリーは、原価の仕組みがある（または権限の確認に失敗した）ときだけ確かめる（未適用の本番では読み取りが増えない）。
 * 本部商品かどうかの決まりは isHqCostProduct（DB では option_is_hq_cost_product）と同じ。Server Action はすべてこれを使う
 */
export async function getCostAccessForProduct(
  listCategories: () => Promise<{ id: string; code: string }[]>,
  categoryId: string | null | undefined
): Promise<CostRecordingAccess> {
  const access = await getCostRecordingAccess();
  if (!access.available && !access.error) return access;
  const categoryCode = (await listCategories()).find((row) => row.id === categoryId)?.code;
  return isHqCostProduct(categoryCode) ? access : NO_COST_RECORDING;
}

/** 登録済みの商品の商品標準原価を、今の商品価格の列と同じ金額で Version に記録する（本部だけ） */
export async function recordPublishedOptionCost(
  optionId: string,
  kind: 'save' | 'publish',
  knownAccess?: CostRecordingAccess
): Promise<CostRecordingResult> {
  const access = knownAccess ?? (await getCostRecordingAccess());
  if (!access.available) return { status: 'unavailable' };
  if (access.error) return { status: 'error', message: COST_ACCESS_ERROR_MESSAGE };
  if (!access.canManage) return { status: 'skipped' };
  const db = await createClient();
  const { data: option, error } = await db
    .from('options')
    .select('id, status, price, price_on_request')
    .eq('id', optionId)
    .maybeSingle();
  if (error) return { status: 'error', message: errorMessage(error) };
  if (!option || option.status !== 'published' || option.price_on_request) return { status: 'skipped' };
  const price = Number(option.price ?? 0);
  // 下書きの 0 円は価格未確認。登録（公開）のときだけ、確認済みの 0 円として記録する
  if (price < 0 || (price === 0 && kind !== 'publish')) return { status: 'skipped' };

  const [current, copy] = await Promise.all([
    db.from('option_standard_cost_versions').select('standard_cost').eq('option_id', optionId).is('superseded_at', null).maybeSingle(),
    db.from('option_hq_standard_costs').select('lock_version').eq('option_id', optionId).maybeSingle(),
  ]);
  if (current.error) return { status: 'error', message: errorMessage(current.error) };
  if (copy.error) return { status: 'error', message: errorMessage(copy.error) };
  if (current.data && Number(current.data.standard_cost) === price) return { status: 'unchanged' };

  const result = await db.rpc('set_option_hq_standard_cost', {
    p_option_id: optionId,
    p_standard_cost: price,
    p_expected_lock_version: copy.data?.lock_version ?? 0,
    p_change_reason: RECORD_REASON[kind],
  });
  if (result.error) return { status: 'error', message: errorMessage(result.error) };
  return { status: 'recorded' };
}

/** 登録済みの商品の選択肢の原価差額を、今の追加金額の列と同じ金額で Version に記録する（本部だけ。0 円も記録する） */
export async function recordPublishedChoiceCosts(
  optionId: string,
  kind: 'choice' | 'publishChoice',
  choiceIds?: string[],
  knownAccess?: CostRecordingAccess
): Promise<CostRecordingResult> {
  const access = knownAccess ?? (await getCostRecordingAccess());
  if (!access.available) return { status: 'unavailable' };
  if (access.error) return { status: 'error', message: COST_ACCESS_ERROR_MESSAGE };
  if (!access.canManage) return { status: 'skipped' };
  const db = await createClient();
  const { data: option, error } = await db.from('options').select('id, status').eq('id', optionId).maybeSingle();
  if (error) return { status: 'error', message: errorMessage(error) };
  if (!option || option.status !== 'published') return { status: 'skipped' };

  const groups = await db.from('option_variant_groups').select('id').eq('option_id', optionId);
  if (groups.error) return { status: 'error', message: errorMessage(groups.error) };
  const groupIds = (groups.data ?? []).map((row) => row.id as string);
  if (!groupIds.length) return { status: 'skipped' };
  let choiceQuery = db.from('option_variant_choices').select('id, extra_price, price_on_request').in('group_id', groupIds);
  if (choiceIds) choiceQuery = choiceQuery.in('id', choiceIds);
  const choices = await choiceQuery;
  if (choices.error) return { status: 'error', message: errorMessage(choices.error) };
  const targets = (choices.data ?? []).filter((row) => !row.price_on_request);
  if (!targets.length) return { status: 'skipped' };

  const versions = await db
    .from('option_variant_cost_versions')
    .select('id, variant_choice_id, cost_adjustment')
    .in('variant_choice_id', targets.map((row) => row.id as string))
    .is('superseded_at', null);
  if (versions.error) return { status: 'error', message: errorMessage(versions.error) };
  const currentByChoice = new Map((versions.data ?? []).map((row) => [row.variant_choice_id as string, row]));

  let recorded = false;
  for (const choice of targets) {
    const amount = Number(choice.extra_price ?? 0);
    const current = currentByChoice.get(choice.id as string);
    if (current && Number(current.cost_adjustment) === amount) continue;
    const result = await db.rpc('set_option_variant_cost_adjustment', {
      p_variant_choice_id: choice.id,
      p_cost_adjustment: amount,
      p_expected_current_version_id: current?.id ?? null,
      p_change_reason: RECORD_REASON[kind],
    });
    if (result.error) return { status: 'error', message: errorMessage(result.error) };
    recorded = true;
  }
  return { status: recorded ? 'recorded' : 'unchanged' };
}

/** 記録の結果を、保存の後の案内の文にする（失敗しても商品の保存は済んでいる） */
export function costRecordingNotice(result: CostRecordingResult): string | null {
  if (result.status !== 'error') return null;
  return `商品は保存しましたが、原価の Version を記録できませんでした（${result.message}）。「原価 Version の取り込み」の画面から記録できます。`;
}
