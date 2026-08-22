import 'server-only';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  BaseModel,
  Configuration,
  ConfigurationItem,
  ConfigurationSnapshot,
  OptionCategory,
  OptionConflict,
  OptionDependency,
  PreviewImageRule,
  PreviewHotspot,
  ProductImage,
  ProductOption,
  Profile,
  ContactMessage,
  Quote,
  QuoteDocument,
  QuoteItem,
  QuoteRequest,
} from '@/lib/domain/types';
import { seedCatalog } from '@/lib/seed/catalog';

/**
 * ローカル検証モードの JSON データベース。
 * Supabase を使わずに全フローを動かすためのもので、本番では使わない。
 */
export interface LocalUser {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: string;
}

export interface LocalDb {
  users: LocalUser[];
  profiles: Profile[];
  models: BaseModel[];
  images: ProductImage[];
  categories: OptionCategory[];
  options: ProductOption[];
  dependencies: OptionDependency[];
  conflicts: OptionConflict[];
  previewRules: PreviewImageRule[];
  hotspots: PreviewHotspot[];
  configurations: Configuration[];
  configurationItems: ConfigurationItem[];
  snapshots: ConfigurationSnapshot[];
  quoteRequests: QuoteRequest[];
  quotes: Quote[];
  quoteItems: QuoteItem[];
  quoteDocuments: QuoteDocument[];
  quoteSequences: Record<string, number>;
  resetTokens: { token: string; user_id: string; expires_at: string }[];
  contactMessages: ContactMessage[];
}

export function localDir(): string {
  if (process.env.WING_LOCAL_DIR) return path.resolve(process.cwd(), process.env.WING_LOCAL_DIR);
  // Vercel 等のサーバーレス環境はプロジェクトディレクトリが読み取り専用のため一時領域を使う
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return path.join(os.tmpdir(), 'wing-local');
  return path.resolve(process.cwd(), '.wing-local');
}

function dbPath() {
  return path.join(localDir(), 'db.json');
}

export function emptyDb(): LocalDb {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    users: [],
    profiles: [],
    models: clone(seedCatalog.models),
    images: clone(seedCatalog.images),
    categories: clone(seedCatalog.categories),
    options: clone(seedCatalog.options),
    dependencies: clone(seedCatalog.dependencies),
    conflicts: clone(seedCatalog.conflicts),
    previewRules: clone(seedCatalog.previewRules),
    hotspots: clone(seedCatalog.hotspots),
    configurations: [],
    configurationItems: [],
    snapshots: [],
    quoteRequests: [],
    quotes: [],
    quoteItems: [],
    quoteDocuments: [],
    quoteSequences: {},
    resetTokens: [],
    contactMessages: [],
  };
}

declare global {
  var __wingLocalReset: boolean | undefined;
}

export function loadDb(): LocalDb {
  const p = dbPath();
  // WING_LOCAL_RESET=1 のときはサーバー起動ごとに初期化（E2E 用）
  if (process.env.WING_LOCAL_RESET === '1' && !globalThis.__wingLocalReset) {
    globalThis.__wingLocalReset = true;
    if (fs.existsSync(p)) fs.rmSync(p);
    const files = path.join(localDir(), 'files');
    if (fs.existsSync(files)) fs.rmSync(files, { recursive: true, force: true });
  }
  if (!fs.existsSync(p)) {
    const db = emptyDb();
    saveDb(db);
    return db;
  }
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw) as Partial<LocalDb>;
  return { ...emptyDb(), ...parsed };
}

export function saveDb(db: LocalDb): void {
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function filesDir(): string {
  const d = path.join(localDir(), 'files');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
