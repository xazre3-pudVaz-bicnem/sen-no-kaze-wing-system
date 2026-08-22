import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { isLocalMode, type SessionUser } from '@/lib/data/store';
import { hasRoleAtLeast, type RoleCode } from '@/lib/domain/types';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';

/** 現在のログインユーザー（リクエスト内でキャッシュ） */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (isLocalMode()) {
    const { localGetSessionUser } = await import('./local-auth');
    return localGetSessionUser();
  }
  if (!hasSupabaseEnv()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('role_code, full_name, email').eq('id', user.id).maybeSingle();
  return {
    id: user.id,
    email: profile?.email ?? user.email ?? '',
    role: (profile?.role_code as SessionUser['role']) ?? 'customer',
    full_name: profile?.full_name ?? '',
  };
});

export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

export async function requireAdmin(nextPath = '/admin'): Promise<SessionUser> {
  const user = await requireUser(nextPath);
  if (user.role !== 'admin') redirect('/mypage?forbidden=1');
  return user;
}

/**
 * 指定した権限以上を要求する（customer < dealer < master_dealer < admin）。
 * 管理画面は代理店以上が入れるが、商品台帳の編集は総代理店以上に限る。
 */
export async function requireRole(min: RoleCode, nextPath = '/admin'): Promise<SessionUser> {
  const user = await requireUser(nextPath);
  if (!hasRoleAtLeast(user.role, min)) redirect('/mypage?forbidden=1');
  return user;
}

/** 管理画面に入れる（代理店以上） */
export const requireStaff = (nextPath = '/admin') => requireRole('dealer', nextPath);
/** 商品台帳を編集できる（総代理店以上） */
export const requireCatalogEditor = (nextPath = '/admin') => requireRole('master_dealer', nextPath);
