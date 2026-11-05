'use server';

import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { fetchSimulatorV25Units, getSimulatorStandardPricingEnabled } from '@/lib/data/standard-estimate-sale-views';

const schema = z.object({
  items: z
    .array(
      z.object({
        revision_id: z.uuid(),
        option_id: z.uuid(),
        choice_ids: z.array(z.uuid()).max(30),
      })
    )
    .min(1)
    .max(200),
});

export type SimulatorV25UnitsResult = { ok: true; units: Array<{ key: string; unit: number | null }> } | { ok: false };

/**
 * シミュレーター：売価の表に無い「商品＋選択肢」（組み合わせが多い商品）の v2.5 の売価を、サーバーで計算する（v2.5 PR-C1）。
 * 売価だけを返す（原価・率は返さない）。スイッチが切れている間は、本部のプレビューだけが使える（切り替え前の価格を公開しない）
 */
export async function fetchSimulatorV25UnitsAction(input: unknown): Promise<SimulatorV25UnitsResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false };
  if (!(await getSimulatorStandardPricingEnabled())) {
    const user = await getSessionUser();
    if (user?.role !== 'admin') return { ok: false };
  }
  try {
    const units = await fetchSimulatorV25Units(parsed.data.items);
    return { ok: true, units: [...units.entries()].map(([key, unit]) => ({ key, unit })) };
  } catch {
    return { ok: false };
  }
}
