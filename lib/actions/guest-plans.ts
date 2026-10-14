'use server';

import { headers } from 'next/headers';
import { StoreError } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { CaseFlowValidationError, normalizeGuestPlanInput } from '@/lib/domain/case-flow';

/**
 * ログインなしの一時保存（フェーズ2）。シミュレーターの仕様の選択を保存し、URL の鍵を返す。
 * 保存するのは仕様の選択だけで、価格は開いたときに計算し直す。鍵のハッシュだけを DB に残す（lib/data/case-flow）。
 */

export type GuestPlanResult = { ok: true; token: string; expires_at: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 同じ接続元からの連続作成を抑える（サーバーごとの目安。全体の上限は DB でも確かめる）
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_WINDOW = 10;
const recent = new Map<string, number[]>();

export async function createGuestPlanAction(input: { base_model_id: unknown; plan: unknown }): Promise<GuestPlanResult> {
  try {
    const baseModelId = typeof input?.base_model_id === 'string' ? input.base_model_id.toLowerCase() : '';
    if (!UUID.test(baseModelId)) throw new CaseFlowValidationError('商品の指定が正しくありません');
    if (!input.plan || typeof input.plan !== 'object') throw new CaseFlowValidationError('一時保存の内容が正しくありません');
    const plan = normalizeGuestPlanInput(input.plan as Record<string, unknown>);

    const from = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
    const now = Date.now();
    const hits = (recent.get(from) ?? []).filter((at) => now - at < WINDOW_MS);
    if (hits.length >= LIMIT_PER_WINDOW) return { ok: false, error: '一時保存が続いています。少し時間をおいてからお試しください' };

    const store = await getCaseFlowStore();
    const saved = await store.createGuestPlan(baseModelId, plan);
    hits.push(now);
    recent.set(from, hits);
    if (recent.size > 5000) {
      for (const [key, times] of recent) if (times.every((at) => now - at >= WINDOW_MS)) recent.delete(key);
    }
    return { ok: true, token: saved.token, expires_at: saved.expires_at };
  } catch (e) {
    if (e instanceof CaseFlowValidationError || e instanceof StoreError) return { ok: false, error: e.message };
    console.error('[wing] guest plan could not be saved', e);
    return { ok: false, error: '一時保存できませんでした。時間をおいてもう一度お試しください' };
  }
}
