import 'server-only';
import { createHash } from 'node:crypto';
import { getStore, isLocalMode, StoreError, type CatalogImportBatch } from '@/lib/data/store';
import {
  FREE_PRODUCT_CATEGORY_CODE,
  type OptionCategory,
  type OptionVariantChoice,
  type OptionVariantGroup,
  type ProductOption,
} from '@/lib/domain/types';
import { introducesUnconfirmedZeroPrice, requiresZeroPriceConfirmation } from '@/lib/domain/product-publication';
import { isHqCostProduct, newChoicePriceWithoutCost } from '@/lib/domain/option-cost-access';
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
  /** 取り込んだ本部商品（本部の一括登録で、登録済みなら原価の Version に記録する） */
  hqOptionIds: string[];
  /** 商品ごとの、取り込んだ選択肢 */
  choiceIdsByOption: Record<string, string[]>;
}

interface ApplyOptions {
  catalogImportUserId?: string;
  /**
   * 本部商品の金額（商品価格・追加金額・別途見積）を Excel から反映しない（v2.5 PR-A3：本部商品の原価は本部だけ）。
   * 既存の本部商品と選択肢は今の金額のまま、新しい本部商品は金額未登録（0 円）の下書き、新しい選択肢は 0 円にする。
   * 本部商品の外（旧フリー商品）は従来どおり Excel の金額を使う
   */
  protectHqCost?: boolean;
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
    hqOptionIds: [],
    choiceIdsByOption: {},
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
  const byId = new Map(categories.map((c) => [c.id, c]));
  // 金額を反映しない本部商品（protectHqCost）は、今の金額をそのまま書き戻す。本部以外の画面の読み取りでは本部商品の金額が 0 になる
  // （スイッチが入った後。v2.5 PR-C1b）ため、書き戻す金額だけはサーバーで読む（画面には出さない）
  const existingOptions = await withWriteBackOptionPrices(await store.listOptions(), options.protectHqCost === true);
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
  /** 金額を Excel から反映しない本部商品（protectHqCost のとき） */
  const protectedOptionIds = new Set<string>();

  for (const p of plan.products) {
    const category = resolveCategory(p.categoryName);
    // 上で全件検証済み。型上の undefined だけを防ぐ。
    if (!category) throw new StoreError('VALIDATION', `商品「${p.code}」のカテゴリーを解決できませんでした`);
    const code = slugify(p.code, p.code);
    const existing = optionByCode.get(code);
    if (existing) {
      const currentCategory = byId.get(existing.category_id);
      if (!currentCategory) {
        throw new StoreError('VALIDATION', `商品「${existing.name}」の現在カテゴリーを確認できません。`);
      }
      const currentIsFree = currentCategory.code === FREE_PRODUCT_CATEGORY_CODE;
      const targetIsFree = category.code === FREE_PRODUCT_CATEGORY_CODE;
      if (currentIsFree !== targetIsFree) {
        throw new StoreError(
          'VALIDATION',
          `フリー商品と通常商品の間でカテゴリーを変更することはできません。商品「${existing.name}」のカテゴリーを確認してください。`
        );
      }
    } else if (category.code === FREE_PRODUCT_CATEGORY_CODE) {
      throw new StoreError(
        'VALIDATION',
        `フリー商品の新規登録は終了しました。商品「${p.name}」はExcel一括登録から新規作成できません。`
      );
    }
    const optionId = existing?.id ?? stableId('option', p.code);
    const protectCost = options.protectHqCost === true && isHqCostProduct(category.code);
    if (protectCost) protectedOptionIds.add(optionId);
    if (isHqCostProduct(category.code) && !result.hqOptionIds.includes(optionId)) result.hqOptionIds.push(optionId);
    const importedPriceState = protectCost
      ? existing
        ? { price: existing.price, price_on_request: existing.price_on_request }
        : { price: 0, price_on_request: false }
      : {
          price: p.price ?? 0,
          price_on_request: p.price == null,
        };

    // Excel一括登録でも、Published商品を新たに「通常価格0円」へ移行させない。
    // 既存Published商品を自動でDraftへ落とすと公開中カタログを突然非公開にするため、
    // このケースは一括登録全体を止め、商品登録STEP 1→Draft→STEP 2確認を要求する。
    if (
      existing?.status === 'published' &&
      introducesUnconfirmedZeroPrice(existing, importedPriceState)
    ) {
      throw new StoreError(
        'VALIDATION',
        `公開中の商品「${existing.name}」をExcel一括登録から通常価格0円へ変更することはできません。商品登録画面でいったん下書きへ戻し、STEP 2で0円が正式価格であることを確認して再公開してください。`
      );
    }

    const requiresZeroConfirmation = requiresZeroPriceConfirmation(importedPriceState);
    const status: ProductOption['status'] =
      requiresZeroConfirmation && existing?.status !== 'published' ? 'draft' : 'published';
    if (status === 'draft') {
      result.warnings.push(
        protectCost
          ? `商品「${p.name}」は商品標準原価が未登録のため下書きで登録しました。本部が原価を登録してから登録（公開）します。`
          : `商品「${p.name}」は通常価格0円のため下書きで登録しました。STEP 2で0円が正式価格であることを確認してから公開してください。`
      );
    }

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
      price: importedPriceState.price,
      price_on_request: importedPriceState.price_on_request,
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
      status,
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
  // 金額を反映しない本部商品は、今の選択肢の金額を引き継ぐ（同じ Excel の行は同じ ID になる）
  const existingChoiceById = new Map<string, OptionVariantChoice>();
  const existingProtectedIds = [...protectedOptionIds].filter((optionId) => existingOptions.some((row) => row.id === optionId));
  for (const variants of await Promise.all(existingProtectedIds.map((optionId) => store.getOptionVariants(optionId)))) {
    for (const choice of await withWriteBackChoicePrices(variants.choices, true)) existingChoiceById.set(choice.id, choice);
  }

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

    const choiceId = stableId('vchoice', `${key}::${c.choiceName}`);
    const keptChoice = protectedOptionIds.has(option.id) ? existingChoiceById.get(choiceId) : undefined;
    // 金額を反映しない本部商品：今の選択肢は今の金額のまま、新しい選択肢は原価差額が未登録（追加の選択肢は別途見積・標準と固定は 0 円）
    const choicePrice = protectedOptionIds.has(option.id)
      ? keptChoice
        ? { extra_price: keptChoice.extra_price, price_on_request: keptChoice.price_on_request }
        : newChoicePriceWithoutCost(c.kind)
      : { extra_price: c.extraPrice ?? 0, price_on_request: c.extraPrice == null && c.kind === 'option' };
    const choice: OptionVariantChoice = {
      id: choiceId,
      group_id: groupId,
      code: uniqueCode(choiceCodeUsed, groupId, slugify(c.choiceName, `c${result.variantChoices + 1}`)),
      name: c.choiceName,
      kind: c.kind,
      ...choicePrice,
      image_url: url,
      note: c.note,
      sort_order: c.sortOrder || result.variantChoices + 1,
      status: 'published',
    };
    batch.variantChoices.push(choice);
    result.variantChoices++;
    result.choiceIdsByOption[option.id] = [...(result.choiceIdsByOption[option.id] ?? []), choiceId];
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

/** 書き戻すためだけに、今の商品価格を読む（ローカル検証モードはストアの値のまま） */
async function withWriteBackOptionPrices(rows: ProductOption[], enabled: boolean): Promise<ProductOption[]> {
  if (!enabled || isLocalMode()) return rows;
  const { withLegacyOptionPrices } = await import('@/lib/data/legacy-prices');
  return withLegacyOptionPrices(rows, 'all');
}

/** 書き戻すためだけに、今の選択肢の追加金額を読む（ローカル検証モードはストアの値のまま） */
async function withWriteBackChoicePrices(rows: OptionVariantChoice[], enabled: boolean): Promise<OptionVariantChoice[]> {
  if (!enabled || isLocalMode()) return rows;
  const { withLegacyChoicePrices } = await import('@/lib/data/legacy-prices');
  return withLegacyChoicePrices(rows, 'all');
}
