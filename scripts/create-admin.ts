/**
 * アカウントを作成（または既存ユーザーの権限・パスワードを更新）する。
 *   node scripts/create-admin.ts --email admin@example.com --password 'Passw0rd!' --name '管理者'
 *   node scripts/create-admin.ts --email dealer@example.com --password 'Passw0rd!' --name '山田 太郎'  *     --role dealer --company '山田工務店'
 *
 * --role は customer / dealer / master_dealer / admin（既定は admin）
 * - Supabase モード: service role で auth ユーザーを作成（メール確認済み）→ profiles を upsert
 * - ローカルモード（WING_LOCAL_MODE=1）: .wing-local/db.json に直接書き込む
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { arg, loadEnv, requireEnv } from './env.ts';

loadEnv();
const email = (arg('email') ?? '').toLowerCase();
const password = arg('password') ?? '';
const name = arg('name') ?? '管理者';
const company = arg('company') ?? null;
const ROLES = ['customer', 'dealer', 'master_dealer', 'admin'] as const;
const role = (arg('role') ?? 'admin') as (typeof ROLES)[number];
if (!email || !password) {
  console.error("使い方: node scripts/create-admin.ts --email <email> --password <password> [--name <氏名>] [--role <" + ROLES.join('|') + ">] [--company <法人名>]");
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`--role は ${ROLES.join(' / ')} のいずれかを指定してください`);
  process.exit(1);
}
if (password.length < 8) {
  console.error('パスワードは8文字以上にしてください');
  process.exit(1);
}

if (process.env.WING_LOCAL_MODE === '1') {
  const dir = path.resolve(process.cwd(), process.env.WING_LOCAL_DIR || '.wing-local');
  const file = path.join(dir, 'db.json');
  if (!fs.existsSync(file)) {
    console.error('ローカル DB がまだありません。先に `npm run dev` を一度起動して初期化してください。');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Date().toISOString();
  let user = db.users.find((u: { email: string }) => u.email === email);
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  if (user) {
    user.salt = salt;
    user.password_hash = hash;
  } else {
    user = { id: randomUUID(), email, password_hash: hash, salt, created_at: now };
    db.users.push(user);
  }
  const profile = db.profiles.find((p: { id: string }) => p.id === user.id);
  if (profile) {
    profile.role_code = role;
    if (company) profile.company_name = company;
    profile.updated_at = now;
  } else {
    db.profiles.push({ id: user.id, customer_no: `C${String(db.profiles.length + 1).padStart(6, '0')}`, email, full_name: name, company_name: company, phone: null, postal_code: null, address: null, role_code: role, created_at: now, updated_at: now });
  }
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
  console.log(`ローカルアカウントを作成しました: ${email}（${role}）`);
} else {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, key, { auth: { persistSession: false } });
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (created.error) {
    if (!/already|exists|registered/i.test(created.error.message)) throw created.error;
    // 既存ユーザーを探す
    let page = 1;
    while (!userId) {
      const list = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (list.error) throw list.error;
      const found = list.data.users.find((u) => u.email?.toLowerCase() === email);
      if (found) userId = found.id;
      else if (list.data.users.length < 200) break;
      else page += 1;
    }
    if (!userId) throw new Error('既存ユーザーが見つかりませんでした');
    const upd = await admin.auth.admin.updateUserById(userId, { password });
    if (upd.error) throw upd.error;
  } else {
    userId = created.data.user.id;
  }
  const patch: Record<string, unknown> = { id: userId, email, full_name: name, role_code: role };
  if (company) patch.company_name = company;
  const { error } = await admin.from('profiles').upsert(patch, { onConflict: 'id' });
  if (error) throw error;
  console.log(`アカウントを作成/更新しました: ${email}（${role}）`);
}
