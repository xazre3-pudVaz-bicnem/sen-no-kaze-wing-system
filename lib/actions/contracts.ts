'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/session';
import { getStore, StoreError } from '@/lib/data/store';
import { contractInsetItems } from '@/lib/domain/electronic-contract';
import { flushNotificationsSafely } from '@/lib/mail/send';
import { gmoSignConfig, isLocalGmoSignStub, localStubEnvelope, sendContractEnvelope, GmoSignError } from '@/lib/integrations/gmosign';

export interface ContractActionState {
  ok: boolean;
  message?: string;
  error?: string;
}

const sendSchema = z.object({
  quote_id: z.uuid(),
  signer_name: z.string().trim().min(1, '署名者の氏名を入力してください').max(100),
  signer_email: z.email('署名者のメールアドレスの形式が正しくありません').max(254),
});

const cancelSchema = z.object({
  quote_id: z.uuid(),
  contract_id: z.uuid(),
  reason: z.string().trim().max(1000).optional(),
});

const errorMessage = (e: unknown) => (e instanceof StoreError ? e.message : null);

/**
 * 本部：承諾済みの確定見積から、GMOサインで契約書をお客様へ送信する。
 * 1. DB で送信を開始（権限・承諾済み・現在の版・二重送信を確認し、状態 sending）
 * 2. GMOサインの契約書テンプレートから送信
 * 3. 成功なら sent、失敗なら failed を記録（failed はやり直せる）
 */
export async function sendElectronicContractAction(_prev: ContractActionState, formData: FormData): Promise<ContractActionState> {
  const actor = await requireAdmin('/admin/quotes');
  const parsed = sendSchema.safeParse({
    quote_id: formData.get('quote_id'),
    signer_name: formData.get('signer_name'),
    signer_email: formData.get('signer_email'),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };

  const config = gmoSignConfig();
  const localStub = isLocalGmoSignStub();
  if (!config && !localStub) {
    return { ok: false, error: 'GMOサインの接続設定が未完了のため送信できません（docs/electronic-contract-gmosign.md）。' };
  }

  const store = await getStore();
  const detail = await store.getQuote(parsed.data.quote_id, actor);
  if (!detail) return { ok: false, error: '見積が見つかりません' };

  let contractId: string;
  try {
    contractId = await store.beginElectronicContract(actor, parsed.data.quote_id, parsed.data.signer_name, parsed.data.signer_email);
  } catch (e) {
    return { ok: false, error: errorMessage(e) ?? '送信を開始できませんでした' };
  }

  try {
    const sent = config
      ? await sendContractEnvelope(config, {
          envelopeName: `工事請負契約書 ${detail.quote.quote_no}`,
          signer: { name: parsed.data.signer_name, email: parsed.data.signer_email },
          insetItems: contractInsetItems(detail.quote),
        })
      : localStubEnvelope();
    await store.recordElectronicContractSent(actor, contractId, sent.envelopeXid, sent.documentId);
  } catch (e) {
    const reason = e instanceof GmoSignError ? e.message : errorMessage(e) ?? '送信に失敗しました';
    try {
      await store.recordElectronicContractFailed(actor, contractId, reason);
    } catch (recordError) {
      console.error('[wing] electronic contract failure could not be recorded', recordError);
    }
    revalidatePath(`/admin/quotes/${parsed.data.quote_id}`);
    return { ok: false, error: `${reason}。内容を確認して、もう一度送信してください。` };
  }

  await flushNotificationsSafely();
  revalidatePath(`/admin/quotes/${parsed.data.quote_id}`);
  revalidatePath(`/mypage/quotes/${parsed.data.quote_id}`);
  return { ok: true, message: localStub ? 'ローカル検証モードのため、GMOサインへは接続せずに送信済みとして記録しました。' : '契約書を送信しました。お客様の署名をお待ちください。' };
}

/** 本部：送信処理中・署名待ちの契約を取り消す（GMOサイン上の封筒の取り消しは GMOサインの画面で行う） */
export async function cancelElectronicContractAction(_prev: ContractActionState, formData: FormData): Promise<ContractActionState> {
  const actor = await requireAdmin('/admin/quotes');
  const parsed = cancelSchema.safeParse({
    quote_id: formData.get('quote_id'),
    contract_id: formData.get('contract_id'),
    reason: formData.get('reason') ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: '入力内容を確認してください' };
  const store = await getStore();
  try {
    await store.cancelElectronicContract(actor, parsed.data.contract_id, parsed.data.reason ?? null);
  } catch (e) {
    return { ok: false, error: errorMessage(e) ?? '取り消せませんでした' };
  }
  revalidatePath(`/admin/quotes/${parsed.data.quote_id}`);
  revalidatePath(`/mypage/quotes/${parsed.data.quote_id}`);
  return { ok: true, message: '契約を取り消しました。GMOサイン上の封筒は GMOサインの画面で取り消してください。' };
}
