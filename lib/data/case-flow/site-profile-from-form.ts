import 'server-only';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { CaseFlowValidationError, normalizeSiteProfileInput, type SiteProfileInput } from '@/lib/domain/case-flow';
import { getCaseFlowStore } from './store';

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

/** 画面の土地の入力欄（SiteProfileFields）の値を入力の形にする。土地の有無を選んでいなければ null（入力しない） */
export function siteProfileInputFromForm(formData: FormData): SiteProfileInput | null {
  if (!field(formData, 'land_status').trim()) return null;
  return normalizeSiteProfileInput({
    land_status: field(formData, 'land_status'),
    site_address: field(formData, 'site_address'),
    area_sqm: field(formData, 'area_sqm'),
    land_category: field(formData, 'land_category'),
    road_access: field(formData, 'road_access'),
    electricity: field(formData, 'electricity'),
    water: field(formData, 'water'),
    drainage: field(formData, 'drainage'),
    desired_area: field(formData, 'desired_area'),
    intended_use: field(formData, 'intended_use'),
    land_budget: field(formData, 'land_budget'),
    note: field(formData, 'land_note'),
  });
}

/**
 * 見積依頼の画面の「設置予定地・土地」（任意）を、見積依頼を送る前に保存する。
 * 見積依頼のサーバー処理（requestQuoteAction）がログイン中の本人として呼ぶ。
 * ブラウザから直接呼べるサーバー処理（'use server'）にはしない（利用者を引数で受け取るため）。
 */
export async function saveSiteProfileFromForm(
  user: SessionUser,
  configurationId: string,
  formData: FormData
): Promise<{ error: string | null; version: number | null; input: SiteProfileInput | null }> {
  try {
    const input = siteProfileInputFromForm(formData);
    if (!input) return { error: null, version: null, input: null };
    const raw = field(formData, 'site_profile_lock_version').trim();
    const expected = /^\d+$/.test(raw) ? Number(raw) : null;
    const store = await getCaseFlowStore();
    const version = await store.saveSiteProfile(user, configurationId, input, expected);
    return { error: null, version, input };
  } catch (e) {
    if (e instanceof CaseFlowValidationError || e instanceof StoreError) return { error: e.message, version: null, input: null };
    console.error('[wing] site profile could not be saved', e);
    return { error: '設置予定地・土地の情報を保存できませんでした', version: null, input: null };
  }
}
