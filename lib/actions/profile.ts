'use server';

import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { profileSchema, flattenErrors, type FieldErrors } from '@/lib/validation';

export interface ProfileState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
}

export async function updateProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/mypage/profile');
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error), values };
  try {
    const store = await getStore();
    await store.updateProfile(user.id, parsed.data);
  } catch {
    return { ok: false, error: '更新に失敗しました。', values };
  }
  redirect('/mypage?profile=updated');
}
