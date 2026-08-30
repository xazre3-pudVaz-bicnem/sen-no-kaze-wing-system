import 'server-only';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
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

/**
 * 外壁4面の割当を保存する。
 * 商品・色の妥当性は呼び出し側で CatalogBundle に対して検証済みであること。
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
    saveDb(db);
    return;
  }

  const { createClient } = await import('@/lib/supabase/server');
  const db = await createClient();
  const { error } = await db.from('configurations').update({ exterior_faces: faces }).eq('id', configurationId);
  if (error) throw error;
}
