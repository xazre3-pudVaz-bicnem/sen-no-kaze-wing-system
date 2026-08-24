/**
 * 先方の商品マスター（public/Wing_product_master_v1_5.xlsx）から
 * lib/seed/product-master.ts を生成する。
 *
 *   node scripts/generate-product-master.ts [--file <xlsx>]
 *
 * 手で書き写すと転記ミスが起きるので、マスターが更新されたらこれを流し直す。
 * 実運用での更新は管理画面の「商品の一括登録」から行う（こちらは初期データ用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readXlsx } from '../lib/import/archive.ts';
import { buildImportPlan, slugify } from '../lib/import/catalog-import.ts';
import { arg } from './env.ts';

const file = arg('file') ?? path.join(process.cwd(), 'public', 'Wing_product_master_v1_5.xlsx');
if (!fs.existsSync(file)) {
  console.error(`ファイルが見つかりません: ${file}`);
  process.exit(1);
}

const plan = buildImportPlan(readXlsx(fs.readFileSync(file)));

/** 同じ入力からは常に同じ UUID を作る（再生成で ID が変わらないように） */
function stableId(prefix: string, key: string): string {
  const h = createHash('sha256').update(`${prefix}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** 先方のカテゴリー名 → 既存カテゴリーのコード */
const CATEGORY_MAP: Record<string, string> = {
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
};

const IMAGE_DIR = '/images/catalog';
const imageUrl = (f: string | null) => (f && fs.existsSync(path.join(process.cwd(), 'public', 'images', 'catalog', f)) ? `${IMAGE_DIR}/${f}` : null);

const missingImages: string[] = [];
const skipped: string[] = [];

const products = plan.products
  .map((p) => {
    const categoryCode = CATEGORY_MAP[p.categoryName];
    if (!categoryCode) {
      skipped.push(`${p.code}（カテゴリー「${p.categoryName}」の対応先がありません）`);
      return null;
    }
    if (p.imageFile && !imageUrl(p.imageFile)) missingImages.push(p.imageFile);
    return {
      id: stableId('option', p.code),
      code: slugify(p.code, p.code),
      categoryCode,
      name: p.manufacturer ? `${p.manufacturer} ${p.name}` : p.name,
      description: p.description,
      manufacturer: p.manufacturer,
      model_no: p.modelNo,
      size_note: p.sizeNote,
      list_price: p.listPrice,
      highlight: p.highlight,
      // Wing 表示価格が未確定なので「別途見積」として登録する（勝手な金額は入れない）
      price: p.price ?? 0,
      price_on_request: p.price == null,
      image_url: imageUrl(p.imageFile),
      sort_order: 100 + p.sortOrder,
    };
  })
  .filter((v): v is NonNullable<typeof v> => v !== null);

const productByCode = new Map(plan.products.map((p) => [p.code, p]));

/** 選択項目は「商品コード＋選択項目名」で束ねる */
const groupKeys: { key: string; productCode: string; name: string; sort: number }[] = [];
for (const c of plan.choices) {
  if (!productByCode.has(c.productCode)) continue;
  const key = `${c.productCode}::${c.groupName}`;
  if (!groupKeys.some((g) => g.key === key)) {
    groupKeys.push({ key, productCode: c.productCode, name: c.groupName, sort: groupKeys.length + 1 });
  }
}

const usedChoiceCodes = new Map<string, Set<string>>();
const uniqueChoiceCode = (groupId: string, base: string) => {
  const used = usedChoiceCodes.get(groupId) ?? new Set<string>();
  usedChoiceCodes.set(groupId, used);
  let code = base;
  for (let n = 2; used.has(code); n++) code = `${base}-${n}`;
  used.add(code);
  return code;
};

const usedGroupCodes = new Map<string, Set<string>>();
const uniqueGroupCode = (optionId: string, base: string) => {
  const used = usedGroupCodes.get(optionId) ?? new Set<string>();
  usedGroupCodes.set(optionId, used);
  let code = base;
  for (let n = 2; used.has(code); n++) code = `${base}-${n}`;
  used.add(code);
  return code;
};

const groups = groupKeys
  .filter((g) => products.some((p) => p.id === stableId('option', g.productCode)))
  .map((g) => ({
    id: stableId('vgroup', g.key),
    option_id: stableId('option', g.productCode),
    code: uniqueGroupCode(stableId('option', g.productCode), slugify(g.name, `g${g.sort}`)),
    name: g.name,
    sort_order: g.sort,
  }));

const choices = plan.choices
  .filter((c) => groups.some((g) => g.id === stableId('vgroup', `${c.productCode}::${c.groupName}`)))
  .map((c, i) => {
    if (c.imageFile && !imageUrl(c.imageFile)) missingImages.push(c.imageFile);
    return {
      id: stableId('vchoice', `${c.productCode}::${c.groupName}::${c.choiceName}`),
      group_id: stableId('vgroup', `${c.productCode}::${c.groupName}`),
      code: uniqueChoiceCode(stableId('vgroup', `${c.productCode}::${c.groupName}`), slugify(c.choiceName, `c${i + 1}`)),
      name: c.choiceName,
      kind: c.kind,
      // 追加価格は未確定。確定するまで 0 円＋「別途見積」で出す
      extra_price: c.extraPrice ?? 0,
      price_on_request: c.extraPrice == null && c.kind === 'option',
      image_url: imageUrl(c.imageFile),
      note: c.note,
      sort_order: c.sortOrder || i + 1,
    };
  });

const ts = `/**
 * 先方の商品マスター（${path.basename(file)}）から自動生成。
 * 直接編集せず、\`node scripts/generate-product-master.ts\` を流し直すこと。
 *
 * 価格が未確定の商品・選択肢は price_on_request（別途見積）で登録している。
 * 金額が決まったらマスターを更新し、管理画面の「商品の一括登録」から取り込む。
 */
import type { OptionVariantChoice, OptionVariantGroup } from '../domain/types.ts';

export interface MasterProduct {
  id: string;
  code: string;
  categoryCode: string;
  name: string;
  description: string | null;
  manufacturer: string | null;
  model_no: string | null;
  size_note: string | null;
  list_price: number | null;
  highlight: string | null;
  price: number;
  price_on_request: boolean;
  image_url: string | null;
  sort_order: number;
}

export const masterProducts: MasterProduct[] = ${JSON.stringify(products, null, 2)};

export const masterVariantGroups: Omit<OptionVariantGroup, 'note' | 'is_required' | 'status'>[] = ${JSON.stringify(groups, null, 2)};

export const masterVariantChoices: Omit<OptionVariantChoice, 'status'>[] = ${JSON.stringify(choices, null, 2)};
`;

const outPath = path.join(process.cwd(), 'lib', 'seed', 'product-master.ts');
fs.writeFileSync(outPath, ts, 'utf8');

console.log(`生成しました: ${path.relative(process.cwd(), outPath)}`);
console.log(`  商品 ${products.length} 件 / 選択項目 ${groups.length} 件 / 選択肢 ${choices.length} 件`);
if (skipped.length) console.log(`  取り込まなかった商品: ${skipped.join(', ')}`);
if (missingImages.length) console.log(`  画像が見つかりません: ${[...new Set(missingImages)].join(', ')}`);
for (const w of plan.warnings) console.log(`  警告: ${w}`);
