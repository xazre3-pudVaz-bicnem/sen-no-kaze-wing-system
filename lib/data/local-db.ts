import 'server-only';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AppNotification,
  AuditLog,
  BaseBreakdownItem,
  OptionVariantChoice,
  OptionVariantGroup,
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
import '@/lib/seed/independent-insulation';
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
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  baseBreakdownItems: BaseBreakdownItem[];
  notifications: AppNotification[];
  auditLogs: AuditLog[];
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
    variantGroups: clone(seedCatalog.variantGroups),
    variantChoices: clone(seedCatalog.variantChoices),
    baseBreakdownItems: clone(seedCatalog.baseBreakdownItems),
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
    notifications: [],
    auditLogs: [],
  };
}

const INDEPENDENT_INSULATION_CATEGORY_CODES = new Set(['insulation-floor', 'insulation-wall', 'insulation-ceiling']);

function insulationBucket(code: string): 'floor' | 'wall' | 'ceiling' | null {
  if (code.startsWith('insulation-floor-')) return 'floor';
  if (code.startsWith('insulation-wall-')) return 'wall';
  if (code.startsWith('insulation-ceiling-')) return 'ceiling';
  return null;
}

/**
 * 既存のローカル JSON は作成時点の categories/options を保持するため、
 * 後から追加した断熱3カテゴリーだけは不足分をシードから補う。
 * 既存の商品・価格・選択内容は上書きしない。
 */
function reconcileIndependentInsulation(db: LocalDb): boolean {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  let changed = false;

  for (const category of seedCatalog.categories.filter((row) => INDEPENDENT_INSULATION_CATEGORY_CODES.has(row.code))) {
    if (db.categories.some((row) => row.id === category.id || row.code === category.code)) continue;
    db.categories.push(clone(category));
    changed = true;
  }

  for (const option of seedCatalog.options.filter((row) => insulationBucket(row.code) !== null)) {
    if (db.options.some((row) => row.id === option.id || row.code === option.code)) continue;
    db.options.push(clone(option));
    changed = true;
  }

  const oldCategory = db.categories.find((row) => row.code === 'insulation');
  if (oldCategory && oldCategory.customer_visible !== false) {
    oldCategory.customer_visible = false;
    changed = true;
  }

  const seedWing = seedCatalog.models.find((model) => model.slug === 'wing-01');
  const localWing = seedWing ? db.models.find((model) => model.id === seedWing.id || model.slug === seedWing.slug) : null;
  if (seedWing && localWing) {
    for (const localPreset of localWing.presets ?? []) {
      const seedPreset = seedWing.presets?.find((preset) => preset.code === localPreset.code);
      if (!seedPreset) continue;
      const next = [...localPreset.option_codes];
      for (const code of seedPreset.option_codes) {
        const bucket = insulationBucket(code);
        if (!bucket) continue;
        const alreadyHasBucket = next.some((existingCode) => insulationBucket(existingCode) === bucket);
        if (!alreadyHasBucket) next.push(code);
      }
      if (next.length !== localPreset.option_codes.length) {
        localPreset.option_codes = next;
        changed = true;
      }
    }
  }

  return changed;
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
  const db = { ...emptyDb(), ...parsed } as LocalDb;
  if (reconcileIndependentInsulation(db)) saveDb(db);
  return db;
}

type StoredExteriorFace = {
  face_code?: unknown;
  option_id?: unknown;
  variant_choice_ids?: unknown;
};

const EXTERIOR_FACE_ORDER = [
  { code: 'front', label: '正面' },
  { code: 'right', label: '右側面' },
  { code: 'back', label: '背面' },
  { code: 'left', label: '左側面' },
] as const;

/**
 * ローカルモードの見積も Supabase と同じ4面スナップショットに揃える。
 * 4面行がすでにあれば触らないため、発行後の商品名・色名変更で既存見積は書き換わらない。
 */
function ensureExteriorFaceQuoteSnapshots(db: LocalDb) {
  const wallCategory = db.categories.find((category) => category.code === 'exterior-wall');
  if (!wallCategory) return;
  const wallOptions = db.options.filter((option) => option.category_id === wallCategory.id);
  const wallOptionNames = wallOptions.map((option) => option.name);

  for (const quote of db.quotes) {
    const existingFaceRows = db.quoteItems.filter(
      (item) => item.quote_id === quote.id && item.name.startsWith('外壁仕様（')
    );
    if (existingFaceRows.length === 4) continue;

    const configuration = db.configurations.find((row) => row.id === quote.configuration_id) as
      | (Configuration & { exterior_faces?: unknown })
      | undefined;
    if (!configuration || !Array.isArray(configuration.exterior_faces)) continue;
    const rawFaces = configuration.exterior_faces as StoredExteriorFace[];

    const resolved = EXTERIOR_FACE_ORDER.map((face, index) => {
      const raw = rawFaces.find((row) => row && typeof row === 'object' && row.face_code === face.code);
      if (!raw || typeof raw.option_id !== 'string') return null;
      const option = wallOptions.find((row) => row.id === raw.option_id);
      if (!option) return null;
      const choiceIds = Array.isArray(raw.variant_choice_ids)
        ? raw.variant_choice_ids.filter((id): id is string => typeof id === 'string')
        : [];
      const variants = choiceIds
        .map((id) => {
          const choice = db.variantChoices.find((row) => row.id === id);
          const group = choice ? db.variantGroups.find((row) => row.id === choice.group_id && row.option_id === option.id) : null;
          return choice && group ? { group, choice } : null;
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => a.group.sort_order - b.group.sort_order || a.choice.sort_order - b.choice.sort_order);
      const variantLabel = variants.map(({ group, choice }) => `${group.name}：${choice.name}`).join('／');
      const variantExtra = variants.reduce((sum, { choice }) => sum + (choice.price_on_request ? 0 : choice.extra_price), 0);
      const priceOnRequest = option.price_on_request || variants.some(({ choice }) => choice.price_on_request);
      const unitPrice = (option.price_on_request ? 0 : option.price) + variantExtra;
      return {
        face,
        option,
        variantLabel,
        priceOnRequest,
        unitPrice,
        sortOrder: 11 + index,
      };
    });

    if (resolved.some((row) => row === null)) continue;
    const complete = resolved.filter((row): row is NonNullable<typeof row> => row !== null);

    // 初回だけ従来の外壁1行（および不完全な4面行）を除外し、4面仕様へ置き換える。
    db.quoteItems = db.quoteItems.filter((item) => {
      if (item.quote_id !== quote.id) return true;
      if (item.name.startsWith('外壁仕様（')) return false;
      if (item.kind !== 'option') return true;
      return !wallOptionNames.some((name) => item.name === name || item.name.startsWith(`${name}（`));
    });

    for (const row of complete) {
      db.quoteItems.push({
        id: randomUUID(),
        quote_id: quote.id,
        kind: 'option',
        name: `外壁仕様（${row.face.label}）`,
        description: row.variantLabel ? `${row.option.name} ／ ${row.variantLabel}` : row.option.name,
        unit: '面',
        remark: row.priceOnRequest ? '別途見積・見積発行時点の面別外壁仕様' : '見積発行時点の面別外壁仕様',
        unit_price: row.unitPrice,
        quantity: 1,
        amount: row.priceOnRequest ? 0 : row.unitPrice,
        image_url: row.option.image_url,
        sort_order: row.sortOrder,
      });
    }
  }
}

export function saveDb(db: LocalDb): void {
  ensureExteriorFaceQuoteSnapshots(db);
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