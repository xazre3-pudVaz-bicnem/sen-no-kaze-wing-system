/**
 * ローカル検証モードのデータを初期化し、テスト用アカウントを作成する。
 *   WING_LOCAL_MODE=1 node scripts/seed-local.ts
 * 作成されるアカウント:
 *   顧客   : customer@example.com / Wing-Demo1!
 *   管理者 : admin@example.com    / Wing-Admin1!
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { seedCatalog } from '../lib/seed/catalog.ts';

const dir = path.resolve(process.cwd(), process.env.WING_LOCAL_DIR || '.wing-local');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const now = new Date().toISOString();
let customerSeq = 0;
const mkUser = (email: string, password: string, full_name: string, role_code: 'customer' | 'admin') => {
  const salt = randomBytes(16).toString('hex');
  const id = randomUUID();
  customerSeq += 1;
  return {
    user: { id, email, password_hash: scryptSync(password, salt, 64).toString('hex'), salt, created_at: now },
    profile: { id, customer_no: `C${String(customerSeq).padStart(6, '0')}`, email, full_name, company_name: role_code === 'admin' ? '株式会社 技術の杜' : null, phone: '0120-030-205', postal_code: null, address: '千葉県千葉市花見川区西小中台2-29-202', role_code, created_at: now, updated_at: now },
  };
};
const customer = mkUser('customer@example.com', 'Wing-Demo1!', '山田 太郎', 'customer');
const admin = mkUser('admin@example.com', 'Wing-Admin1!', '管理者', 'admin');

const db = {
  users: [customer.user, admin.user],
  profiles: [customer.profile, admin.profile],
  models: seedCatalog.models,
  images: seedCatalog.images,
  categories: seedCatalog.categories,
  options: seedCatalog.options,
  dependencies: seedCatalog.dependencies,
  conflicts: seedCatalog.conflicts,
  previewRules: seedCatalog.previewRules,
  configurations: [],
  configurationItems: [],
  snapshots: [],
  quoteRequests: [],
  quotes: [],
  quoteItems: [],
  quoteDocuments: [],
  quoteSequences: {},
  resetTokens: [],
};
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db, null, 2));
console.log(`ローカル DB を初期化しました: ${path.join(dir, 'db.json')}`);
console.log('顧客   : customer@example.com / Wing-Demo1!');
console.log('管理者 : admin@example.com / Wing-Admin1!');
