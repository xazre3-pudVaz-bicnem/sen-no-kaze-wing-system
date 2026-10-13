import 'server-only';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { CaseFlowValidationError, normalizePreferencesInput } from '@/lib/domain/case-flow';
import { getCaseFlowStore } from './store';

/** 日本時間の今日（YYYY-MM-DD） */
export function todayInJapan(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

/**
 * 見積依頼の画面のお客様の希望（相談したい代理店・打合せの方法・希望日）を保存する。
 * 見積依頼のサーバー処理（requestQuoteAction）が、見積を作ったあとにログイン中の本人として呼ぶ。
 * ブラウザから直接呼べるサーバー処理（'use server'）にはしない（利用者を引数で受け取るため）。
 * 失敗しても見積依頼そのものは成立しているため、エラーの文言を返すだけにする。
 */
export async function saveQuoteRequestPreferencesFromForm(user: SessionUser, requestId: string, formData: FormData): Promise<string | null> {
  try {
    const slots = [1, 2, 3]
      .map((n) => ({ date: field(formData, `slot_${n}_date`).trim(), period: field(formData, `slot_${n}_period`).trim() || 'any' }))
      .filter((slot) => slot.date);
    const input = normalizePreferencesInput(
      {
        preferred_dealer_id: field(formData, 'preferred_dealer_id'),
        meeting_method: field(formData, 'meeting_method'),
        preferred_slots: slots,
        note: field(formData, 'schedule_note'),
      },
      todayInJapan()
    );
    if (!input.preferred_dealer_id && !input.meeting_method && input.preferred_slots.length === 0 && !input.note) return null;
    const store = await getCaseFlowStore();
    await store.setQuoteRequestPreferences(user, requestId, input);
    return null;
  } catch (e) {
    if (e instanceof CaseFlowValidationError || e instanceof StoreError) return e.message;
    console.error('[wing] quote request preferences could not be saved', e);
    return 'ご希望の日程・代理店を保存できませんでした';
  }
}
