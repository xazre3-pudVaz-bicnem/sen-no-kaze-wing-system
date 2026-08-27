import 'server-only';
import { createHash } from 'node:crypto';
import { getStore, StoreError, type CatalogImportBatch } from '@/lib/data/store';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { slugify, type ImportPlan } from './catalog-import';

/**
 * 取り込み計画を実際のカタログへ反映する。
 *
 * すべて「コードで突き合わせて上書き（upsert）」する。同じ Excel を何度取り込んでも
 * 増殖せず、価格や画像を直して取り込み直せば更新になる。
 * 消えた商品は自動では消さない（保存済みの仕様から参照されている可能性があるため）。
 */

/** 同じ入力からは常に同じ UUID を作る */
function stableId(prefix: string, key: string): string {
  const h = createHash('sha256').update(`${prefix}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** 先方のカテゴリー名 → 台帳のカテゴリーコード */
const CATEGORY_ALIAS: Record<string, string> = {
  ユニットバス: 'ub',
  トイレ: 'toilet',
  洗面: 'washbasin',
  ミニキッチン: 'kitchen',
  給湯器: 'boiler',
  エアコン: 'aircon',
  照明器具: 'lighting',
  'スマートロック・鍵': 'smartlock',
  床材: 'floor',
  外壁: 'exterior-wall',
  内部建具: 'interior-door',
  サッシ: 'sash',
  断熱仕様: 'insulation',
  防火仕様: 'fireproof',
  下足箱: 'furniture',
  折り畳み式ベッド: 'furniture',
  家電: 'appliances',
  '壁・天井内装工事': 'wall-ceiling',
  造作工事: 'carpentry',
  外構部品: 'exterior-parts',
  フリー商品: 'free-product',
};

export interface ApplyResult {
  createdProducts: number;
  updatedProducts: number;
  variantGroups: number;
  variantChoices: number;
  imagesLinked: number;
  skipped: string[];
  warnings: string[];
}

interface ApplyOptions {
  catalogImportUserId?: string;
}

/**
 * @param images アップロードされた画像。ファイル名 → 保存後の URL
 */
export async function applyImportPlan(plan: ImportPlan, images: Map<string, string>, options: ApplyOptions = {}): Promise<ApplyResult> {
  const store = await getStore();
  const result: ApplyResult = {
    createdProducts: 0,
    updatedProducts: 0,
    variantGroups: 0,
    variantChoices: 0,
    imagesLinked: 0,
    skipped: [],
    warnings: [...plan.warnings],
  };
  let previousCatalogImportImageUrls: string[] = [];
  if (options.catalogImportUserId) {
    try {
      previousCatalogImportImageUrls = await store.listReferencedCatalogImportImageUrls(options.catalogImportUserId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '不明なエラー';
      result.warnings.push(`旧Import画像の参照確認に失敗したため、成功後の旧画像cleanupをスキップします: ${detail}`);
    }
  }

  const categories = await store.listCategories();
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const byName = new Map(categories.map((c) => [c.name, c]));
  const existingOptions = await store.listOptions();
  const optionByCode = new Map(existingOptions.map((o) => [o.code, o]));

  const resolveCategory = (name: string): OptionCategory | undefined => {
    const alias = CATEGORY_ALIAS[name];
    return (alias ? byCode.get(alias) : undefined) ?? byName.get(name) ?? byCode.get(slugify(name, ''));
  };

  const imageUrl = (file: string | null): string | null => (file ? (images.get(file) ?? null) : null);

  // 書き込み開始前にカテゴリー不足を全件検出する。途中まで登録してから skip しない。
  const missingCategories = [...new Set(plan.products.map((p) => p.categoryName).filter((name) => !resolveCategory(name)))];
  if (missingCategories.length) {
    throw new StoreError(
      'VALIDATION',
      `${missingCategories.map((name) => `カテゴリー「${name}」`).join('、')}が商品台帳に存在しません。先にカテゴリーを登録してください。`
    );
  }

  const batch: CatalogImportBatch = { options: [], variantGroups: [], variantChoices: [] };

  for (const p of plan.products) {
    const category = resolveCategory(p.categoryName);
    // 上で全件検証済み。型上の undefined だけを防ぐ。
    if (!category) throw new StoreError('VALIDATION', `商品「${p.code}」のカテゴリーを解決できませんでした`);
    const code = slugify(p.code, p.code);
    const existing = optionByCode.get(code);
    const url = imageUrl(p.imageFile);
    if (p.imageFile && !url) result.warnings.push(`画像「${p.imageFile}」が見つかりませんでした（${p.name}）。`);
    if (url) result.imagesLinked++;

    const saved = {
      id: existing?.id ?? stableId('option', p.code),
      base_model_id: existing?.base_model_id ?? null,
      category_id: category.id,
      code,
      name: p.manufacturer ? `${p.manufacturer} ${p.name}` : p.name,
      description: p.description,
      price: p.price ?? 0,
      price_on_request: p.price == null,
      image_url: url ?? existing?.image_url ?? null,
      selection_type: category.selection_mode === 'single' ? 'radio' : 'checkbox',
      is_required: existing?.is_required ?? false,
      is_default: existing?.is_default ?? false,
      is_installation: existing?.is_installation ?? false,
      spec_codes: existing?.spec_codes ?? [],
      owner_id: existing?.owner_id ?? null,
      manufacturer: p.manufacturer,
      model_no: p.modelNo,
      size_note: p.sizeNote,
      list_price: p.listPrice,
      highlight: p.highlight,
      preview_key: existing?.preview_key ?? null,
      affects_views: existing?.affects_views ?? [],
      sort_order: 100 + p.sortOrder,
      status: 'published',
    } as Omit<ProductOption, 'created_at' | 'updated_at'>;

    batch.options.push({ ...saved, import_operation: existing ? 'UPDATE' : 'INSERT' });

    if (existing) result.updatedProducts++;
    else result.createdProducts++;
    optionByCode.set(code, { ...saved, created_at: existing?.created_at ?? '', updated_at: existing?.updated_at ?? '' });
  }

  /* ---------- 選択項目と選択肢 ---------- */
  const groupSeq = new Map<string, number>();
  const groupCodeUsed = new Map<string, Set<string>>();
  const choiceCodeUsed = new Map<string, Set<string>>();
  const uniqueCode = (store_: Map<string, Set<string>>, key: string, base: string) => {
    const used = store_.get(key) ?? new Set<string>();
    store_.set(key, used);
    let code = base;
    for (let n = 2; used.has(code); n++) code = `${base}-${n}`;
    used.add(code);
    return code;
  };

  const groupIdByKey = new Map<string, string>();

  for (const c of plan.choices) {
    const option = optionByCode.get(slugify(c.productCode, c.productCode));
    if (!option) {
      result.skipped.push(`選択肢「${c.choiceName}」（商品 ${c.productCode} が登録されていません）`);
      continue;
    }
    const key = `${c.productCode}::${c.groupName}`;
    let groupId = groupIdByKey.get(key);
    if (!groupId) {
      const seq = (groupSeq.get(option.id) ?? 0) + 1;
      groupSeq.set(option.id, seq);
      groupId = stableId('vgroup', key);
      const group: OptionVariantGroup = {
        id: groupId,
        option_id: option.id,
        code: uniqueCode(groupCodeUsed, option.id, slugify(c.groupName, `g${seq}`)),
        name: c.groupName,
        note: null,
        sort_order: seq,
        is_required: true,
        status: 'published',
      };
      batch.variantGroups.push(group);
      groupIdByKey.set(key, groupId);
      result.variantGroups++;
    }

    const url = imageUrl(c.imageFile);
    if (c.imageFile && !url) result.warnings.push(`画像「${c.imageFile}」が見つかりませんでした（${c.choiceName}）。`);
    if (url) result.imagesLinked++;

    const choice: OptionVariantChoice = {
      id: stableId('vchoice', `${key}::${c.choiceName}`),
      group_id: groupId,
      code: uniqueCode(choiceCodeUsed, groupId, slugify(c.choiceName, `c${result.variantChoices + 1}`)),
      name: c.choiceName,
      kind: c.kind,
      extra_price: c.extraPrice ?? 0,
      price_on_request: c.extraPrice == null && c.kind === 'option',
      image_url: url,
      note: c.note,
      sort_order: c.sortOrder || result.variantChoices + 1,
      status: 'published',
    };
    batch.variantChoices.push(choice);
    result.variantChoices++;
  }

  try {
    await store.applyCatalogImport(batch);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '不明なエラー';
    throw new StoreError(
      'INTERNAL',
      `商品台帳の一括登録に失敗しました（商品・選択項目・選択肢は反映されませんでした）: ${detail}`
    );
  }

  if (options.catalogImportUserId && previousCatalogImportImageUrls.length) {
    try {
      await store.deleteUnreferencedCatalogImportImages(previousCatalogImportImageUrls, options.catalogImportUserId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '不明なエラー';
      result.warnings.push(`旧Import画像のcleanupに失敗しました: ${detail}`);
    }
  }

  return result;
}
