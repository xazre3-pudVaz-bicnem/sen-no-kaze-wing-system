'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, requireAdmin } from '@/lib/auth/session';
import { getStore, isDemoFallback, isLocalMode } from '@/lib/data/store';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';

const withdrawalPath = '/mypage/withdrawal';
const detailPath = (id: string, reason: 'unavailable' | 'blocked') =>
  `/admin/customer-management/${encodeURIComponent(id)}?member_delete_error=${reason}`;

export async function requestCustomerWithdrawalAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/mypage/withdrawal');
  if (user.role !== 'customer') redirect('/mypage?forbidden=1');
  if (formData.get('confirmed') !== 'yes') redirect(`${withdrawalPath}?error=invalid`);

  // アカウント削除やAuth Admin APIを直接呼ばない。本人確認と受付はDB側で最終保証する。
  if (!hasSupabaseEnv() || isDemoFallback() || isLocalMode()) {
    redirect(`${withdrawalPath}?error=unavailable`);
  }
  const db = await createClient();
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || authData.user?.id !== user.id) redirect(`${withdrawalPath}?error=blocked`);

  const { error } = await db.rpc('request_customer_account_withdrawal');
  if (error) {
    // RPC未反映・permission denied・履歴不整合で、受付成功と見せない。
    redirect(`${withdrawalPath}?error=${error.code === 'PGRST202' ? 'unavailable' : 'blocked'}`);
  }
  redirect(`${withdrawalPath}?requested=1`);
}

export async function deleteUnusedCustomerAccountAction(formData: FormData): Promise<void> {
  const actor = await requireAdmin('/admin/customer-management');
  const customerId = String(formData.get('customer_id') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customerId)) {
    redirect('/admin/customer-management?error=invalid_customer_id');
  }
  if (actor.id === customerId) redirect(detailPath(customerId, 'blocked'));

  const store = await getStore();
  const profile = await store.getProfile(customerId);
  if (!profile || profile.role_code !== 'customer') redirect(detailPath(customerId, 'blocked'));

  // UIの案件件数・RLSの見える範囲だけでは「未使用」を判定しない。
  // 本番専用RPCが完全な参照検査・競合ロック・Auth削除を原子的に担うまでfail closed。
  if (!hasSupabaseEnv() || isDemoFallback() || isLocalMode()) redirect(detailPath(customerId, 'unavailable'));

  const db = await createClient();
  const { error } = await db.rpc('delete_unused_customer_account', { p_customer_id: customerId });
  if (error) redirect(detailPath(customerId, error.code === 'PGRST202' ? 'unavailable' : 'blocked'));

  revalidatePath('/admin/customer-management');
  redirect('/admin/customer-management?member_deleted=1');
}
