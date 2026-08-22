import 'server-only';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Profile } from '@/lib/domain/types';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';

/**
 * ローカル検証モードの認証（Supabase Auth の代替）。
 * - パスワードは scrypt でハッシュ化
 * - セッションは HMAC 署名付き Cookie
 * 本番では使わない。
 */
export const LOCAL_SESSION_COOKIE = 'wing_local_session';

function secret() {
  return process.env.WING_LOCAL_SESSION_SECRET || 'wing-local-dev-secret';
}
function sign(userId: string) {
  return createHmac('sha256', secret()).update(userId).digest('hex');
}
function hash(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}

export async function localGetSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(LOCAL_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [userId, sig] = raw.split('.');
  if (!userId || !sig) return null;
  const expected = sign(userId);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const db = loadDb();
  const profile = db.profiles.find((p) => p.id === userId);
  if (!profile) return null;
  return { id: profile.id, email: profile.email, role: profile.role_code, full_name: profile.full_name };
}

async function setSessionCookie(userId: string) {
  const store = await cookies();
  store.set(LOCAL_SESSION_COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function localSignOut() {
  const store = await cookies();
  store.delete(LOCAL_SESSION_COOKIE);
}

export interface LocalSignUpInput {
  email: string;
  password: string;
  full_name: string;
  company_name: string | null;
  phone: string | null;
  postal_code: string | null;
  address: string | null;
}

export async function localSignUp(input: LocalSignUpInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = loadDb();
  const email = input.email.toLowerCase();
  if (db.users.some((u) => u.email === email)) return { ok: false, error: 'このメールアドレスは既に登録されています。' };
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const adminEmails = (process.env.WING_LOCAL_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  db.users.push({ id, email, password_hash: hash(input.password, salt), salt, created_at: now });
  const customerNo = `C${String(db.profiles.length + 1).padStart(6, '0')}`;
  const profile: Profile = {
    id,
    customer_no: customerNo,
    email,
    full_name: input.full_name,
    company_name: input.company_name,
    phone: input.phone,
    postal_code: input.postal_code,
    address: input.address,
    role_code: adminEmails.includes(email) ? 'admin' : 'customer',
    created_at: now,
    updated_at: now,
  };
  db.profiles.push(profile);
  saveDb(db);
  await setSessionCookie(id);
  return { ok: true };
}

export async function localSignIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = loadDb();
  const user = db.users.find((u) => u.email === email.toLowerCase());
  if (!user) return { ok: false, error: 'メールアドレスまたはパスワードが正しくありません。' };
  const h = hash(password, user.salt);
  if (h.length !== user.password_hash.length || !timingSafeEqual(Buffer.from(h), Buffer.from(user.password_hash))) {
    return { ok: false, error: 'メールアドレスまたはパスワードが正しくありません。' };
  }
  await setSessionCookie(user.id);
  return { ok: true };
}

/** 再設定トークンを発行。ローカルモードではメールを送らず、画面にリンクを表示する */
export async function localRequestPasswordReset(email: string): Promise<{ devLink: string | null }> {
  const db = loadDb();
  const user = db.users.find((u) => u.email === email.toLowerCase());
  if (!user) return { devLink: null };
  const token = randomBytes(24).toString('hex');
  db.resetTokens = db.resetTokens.filter((t) => t.user_id !== user.id);
  db.resetTokens.push({ token, user_id: user.id, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  saveDb(db);
  return { devLink: `/reset-password/update?token=${token}` };
}

export async function localUpdatePassword(token: string | null, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = loadDb();
  let userId: string | null = null;
  if (token) {
    const t = db.resetTokens.find((x) => x.token === token);
    if (!t || new Date(t.expires_at).getTime() < Date.now()) return { ok: false, error: 'リンクの有効期限が切れています。再度お手続きください。' };
    userId = t.user_id;
    db.resetTokens = db.resetTokens.filter((x) => x.token !== token);
  } else {
    const session = await localGetSessionUser();
    if (!session) return { ok: false, error: 'ログインが必要です。' };
    userId = session.id;
  }
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: 'ユーザーが見つかりません。' };
  user.salt = randomBytes(16).toString('hex');
  user.password_hash = hash(newPassword, user.salt);
  saveDb(db);
  await setSessionCookie(user.id);
  return { ok: true };
}
