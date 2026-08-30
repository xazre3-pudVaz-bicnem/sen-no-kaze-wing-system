import 'server-only';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import { computePricing } from '@/lib/domain/pricing';
import { isLocalMode } from './store';

/** 保存済み仕様から外壁4面の割当を取得する。 */
export async function getExteriorFaces(configurationId: string): Promise<ExteriorFaceSelection[]> {
  if (isLocalMode()) {
    const { loadDb } = await import('./local-db');
    const db = loadDb();
    const cfg = db.configurations.find((c) => c.id === configurationId) as
      | (typeof db.configurations[number] & { exterior_faces?: ExteriorFaceSelection[] })
      | undefined;
    return Array.isArray(cfg?.exterior_faces) ? cfg.exterior_faces : [];
  }

  const { createClient } = await import('@/lib/supabase/server');
  const db = await createClient();
  const { data, error } = await db.from('configurations').select('exterior_faces').eq('id', configurationId).maybeSingle();
  if (error) {
    // マイグレーション適用前の環境でも既存の保存仕様は開けるようにする。
    if (error.code === '42703' || /exterior_faces/i.test(error.message)) return [];
    throw error;
  }
  const rows = (data as { exterior_faces?: unknown } | null)?.exterior_faces;
  return Array.isArray(rows) ? (rows as ExteriorFaceSelection[]) : [];
}

/** ローカル検証モードでも、外壁4面保存後の金額を本番DBと同じ式で更新する。 */
function recalculateLocalAfterExteriorFaces(
  db: Awaited<ReturnType<typeof import('./local-db')>> extends never ? never : import('./local-db').LocalDb,
  configurationId: string,
  faces: ExteriorFaceSelection[]
) {
  const cfg = db.configurations.find((c) => c.id === configurationId);
  if (!cfg) throw new Error('保存データが見つかりません');
  const model = db.models.find((m) => m.id === cfg.base_model_id);
  if (!model) throw new Error('本体データが見つかりません');
  const items = db.configurationItems.filter((i) => i.configuration_id === cfg.id);
  const breakdown = db.baseBreakdownItems.filter(
    (b) => b.base_model_id === cfg.base_model_id && b.spec_code === (cfg.spec_code ?? '')
  );
  const baseOverride = breakdown.length ? breakdown.reduce((sum, b) => sum + b.amount, 0) : null;
  const pricing = computePricing(
    model,
    db.options,
    db.categories,
    items.map((i) => ({ option_id: i.option_id, quantity: i.quantity, variant_choice_ids: i.variant_choice_ids ?? [] })),
    undefined,
    { groups: db.variantGroups, choices: db.variantChoices },
    baseOverride,
    faces
  );
  Object.assign(cfg, {
    base_price: pricing.base_price,
    base_expense: pricing.base_expense,
    option_subtotal: pricing.option_subtotal,
    option_expense: pricing.option_expense,
    installation_subtotal: pricing.installation_subtotal,
    adjustment: pricing.adjustment,
    subtotal: pricing.subtotal,
    tax: pricing.tax,
    total: pricing.total,
    updated_at: new Date().toISOString(),
  });
}

/**
 * 外壁4面の割当を保存する。
 * 商品・色の妥当性は呼び出し側で CatalogBundle に対して検証済みであること。
 * 保存直後に再計算し、画面・保存仕様・正式見積の金額が一致するようにする。
 */
export async function saveExteriorFaces(configurationId: string, faces: ExteriorFaceSelection[]): Promise<void> {
  if (isLocalMode()) {
    const { loadDb, saveDb } = await import('./local-db');
    const db = loadDb();
    const cfg = db.configurations.find((c) => c.id === configurationId) as
      | (typeof db.configurations[number] & { exterior_faces?: ExteriorFaceSelection[] })
      | undefined;
    if (!cfg) throw new Error('保存データが見つかりません');
    cfg.exterior_faces = faces.map((f) => ({ ...f, variant_choice_ids: [...f.variant_choice_ids] }));
    recalculateLocalAfterExteriorFaces(db, configurationId, faces);
    saveDb(db);
    return;
  }

  const { createClient } = await import('@/lib/supabase/server');
  const db = await createClient();
  const { error } = await db.from('configurations').update({ exterior_faces: faces }).eq('id', configurationId);
  if (error) throw error;

  // save_configuration は外壁4面保存より先に再計算されるため、4面保存後にもう一度再計算する。
  const { error: recalcError } = await db.rpc('recalculate_configuration', { p_configuration_id: configurationId });
  if (recalcError) throw recalcError;
}