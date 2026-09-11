import type { EstimateSectionCode, OptionCategory, ProductOption } from './types';

export type EstimateLinkPolicy = 'required' | 'optional' | 'none';

export interface EstimateLineMatchSource {
  section_code: EstimateSectionCode;
  group_label: string | null;
  name: string;
  unit: string | null;
  remark: string | null;
}

export interface EstimateProductCandidate {
  option: ProductOption;
  score: number;
  reasons: string[];
}

const CATEGORY_RULES: { code: string; keywords: string[] }[] = [
  { code: 'ub', keywords: ['ユニットバス', 'シャワーユニット', 'シャワートイレユニット', '浴室ユニット', '3点ユニット'] },
  { code: 'toilet', keywords: ['トイレ', '便器', 'ウォシュレット', '温水洗浄便座'] },
  { code: 'washbasin', keywords: ['洗面化粧台', '洗面器', '洗面台', '洗面', '混合水栓'] },
  { code: 'kitchen', keywords: ['ミニキッチン', 'キッチン', '流し台', 'シンク'] },
  { code: 'boiler', keywords: ['給湯器', '湯沸器'] },
  { code: 'aircon', keywords: ['エアコン', '空調機', 'ルームエアコン'] },
  { code: 'exterior-wall', keywords: ['外壁材', '外壁', 'ガルノート', '角スパン', 'サイディング'] },
  { code: 'floor', keywords: ['床材', 'フローリング', 'モクタイル', 'pタイル', 'ｐタイル'] },
  { code: 'wall-ceiling', keywords: ['壁・天井', '壁天井', 'クロス仕上', '壁クロス', '天井クロス', 'ラワン板'] },
  { code: 'interior-door', keywords: ['内部建具', '室内ドア', '建具'] },
  { code: 'sash', keywords: ['サッシ', '引違い窓', '縦辷り窓', 'すべり窓', '窓一式'] },
  { code: 'lighting', keywords: ['照明器具', 'ダウンライト', 'ペンダントライト'] },
  { code: 'furniture', keywords: ['折り畳み式ベッド', '折りたたみ式ベッド', 'ベッド', '下足箱', '洋服掛け', 'ハンガーパイプ', '家具'] },
  { code: 'appliances', keywords: ['冷蔵庫', '洗濯機', '家電'] },
  { code: 'smartlock', keywords: ['スマートキー', 'スマートロック'] },
  { code: 'carpentry', keywords: ['室内造作', '造作工事'] },
  { code: 'insulation', keywords: ['断熱仕様', '断熱材', 'スタイロフォーム', 'グラスウール'] },
  { code: 'fireproof', keywords: ['防火仕様', '防火構造'] },
  { code: 'sitework', keywords: ['運送費', '運搬費', '現場設置', '確認申請', '設計監理', '給排水', '電気設備工事', '基礎工事', '廃材処分', '現場諸費用'] },
];

const REQUIRED_CATEGORY_CODES = new Set([
  'ub',
  'toilet',
  'washbasin',
  'kitchen',
  'boiler',
  'aircon',
  'exterior-wall',
  'floor',
  'wall-ceiling',
  'interior-door',
  'sash',
]);

const OPTIONAL_CATEGORY_CODES = new Set([
  'lighting',
  'furniture',
  'appliances',
  'smartlock',
  'carpentry',
  'insulation',
  'fireproof',
]);

export function normalizeEstimateMatchText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[‐‑‒–—―ー−]/g, '-')
    .replace(/[「」『』【】（）()［］\[\]・,，.。:：/／]/g, '');
}

export function estimateLineSourceText(line: EstimateLineMatchSource): string {
  return [line.group_label, line.name, line.remark].filter(Boolean).join(' ');
}

export function inferEstimateCategoryCode(line: EstimateLineMatchSource): string | null {
  const source = normalizeEstimateMatchText(estimateLineSourceText(line));
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => source.includes(normalizeEstimateMatchText(keyword)))) return rule.code;
  }
  return null;
}

export function defaultEstimateLinkPolicy(categoryCode: string | null, sectionCode: EstimateSectionCode): EstimateLinkPolicy {
  if (sectionCode === 'sitework' || categoryCode === 'sitework') return 'none';
  if (categoryCode && REQUIRED_CATEGORY_CODES.has(categoryCode)) return 'required';
  if (categoryCode && OPTIONAL_CATEGORY_CODES.has(categoryCode)) return 'optional';
  return 'none';
}

export function estimateLineFingerprint(
  line: Pick<EstimateLineMatchSource, 'section_code' | 'group_label' | 'name' | 'unit'>,
  categoryCode: string | null
): string {
  void categoryCode;
  return [
    'v1',
    line.section_code,
    normalizeEstimateMatchText(line.group_label),
    normalizeEstimateMatchText(line.name),
    normalizeEstimateMatchText(line.unit),
  ].join('|');
}

export function extractEstimateProductHints(sourceText: string, options: ProductOption[]) {
  const source = normalizeEstimateMatchText(sourceText);
  const manufacturers = [...new Set(options.map((option) => option.manufacturer?.trim()).filter((v): v is string => Boolean(v)))];
  const models = [...new Set(options.map((option) => option.model_no?.trim()).filter((v): v is string => Boolean(v)))];

  const manufacturerMatches = manufacturers.filter((value) => source.includes(normalizeEstimateMatchText(value)));
  const modelMatches = models.filter((value) => {
    const key = normalizeEstimateMatchText(value);
    return key.length >= 4 && source.includes(key);
  });

  const sizeMatch =
    sourceText.match(/(?:\b|[^0-9])(\d{3,4})(?:\b|[^0-9])/)?.[1] ??
    sourceText.match(/(\d{1,2}\s*号)/)?.[1]?.replace(/\s+/g, '') ??
    null;

  return {
    manufacturer: manufacturerMatches.length === 1 ? manufacturerMatches[0] : null,
    model: modelMatches.length === 1 ? modelMatches[0] : null,
    size: sizeMatch,
  };
}

function compatibleOptions(
  options: ProductOption[],
  categoryId: string | null,
  baseModelId: string
): ProductOption[] {
  return options.filter(
    (option) =>
      option.status === 'published' &&
      (!categoryId || option.category_id === categoryId) &&
      (!option.base_model_id || option.base_model_id === baseModelId)
  );
}

export function findExactEstimateProductMatch(args: {
  sourceText: string;
  options: ProductOption[];
  categoryId: string | null;
  baseModelId: string;
}): { option: ProductOption; reason: string } | null {
  const source = normalizeEstimateMatchText(args.sourceText);
  const matches = compatibleOptions(args.options, args.categoryId, args.baseModelId).filter((option) => {
    if (!option.model_no) return false;
    const model = normalizeEstimateMatchText(option.model_no);
    if (model.length < 4 || !source.includes(model)) return false;
    if (!option.manufacturer) return true;
    return source.includes(normalizeEstimateMatchText(option.manufacturer));
  });
  if (matches.length !== 1) return null;
  return { option: matches[0], reason: 'メーカー＋型番完全一致' };
}

function tokenSet(value: string): Set<string> {
  const normalized = String(value ?? '').normalize('NFKC').toLowerCase();
  return new Set(
    normalized
      .split(/[\s　・、,，/／()（）【】\[\]-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

export function rankEstimateProductCandidates(args: {
  sourceText: string;
  options: ProductOption[];
  categoryId: string | null;
  baseModelId: string;
  limit?: number;
}): EstimateProductCandidate[] {
  const sourceNormalized = normalizeEstimateMatchText(args.sourceText);
  const sourceTokens = tokenSet(args.sourceText);
  const ranked = compatibleOptions(args.options, args.categoryId, args.baseModelId)
    .map((option) => {
      let score = 0;
      const reasons: string[] = [];

      if (option.model_no) {
        const model = normalizeEstimateMatchText(option.model_no);
        if (model.length >= 4 && sourceNormalized.includes(model)) {
          score += 70;
          reasons.push('型番一致');
        }
      }
      if (option.manufacturer && sourceNormalized.includes(normalizeEstimateMatchText(option.manufacturer))) {
        score += 20;
        reasons.push('メーカー一致');
      }
      if (option.size_note && sourceNormalized.includes(normalizeEstimateMatchText(option.size_note))) {
        score += 12;
        reasons.push('サイズ一致');
      }

      const optionName = normalizeEstimateMatchText(option.name);
      if (optionName && (sourceNormalized.includes(optionName) || optionName.includes(sourceNormalized))) {
        score += 35;
        reasons.push('商品名一致');
      } else {
        const optionTokens = tokenSet([option.name, option.description, option.model_no, option.size_note].filter(Boolean).join(' '));
        const overlap = [...sourceTokens].filter((token) => optionTokens.has(token)).length;
        if (overlap > 0) {
          score += Math.min(30, overlap * 10);
          reasons.push(`名称要素一致 ${overlap}件`);
        }
      }

      return { option, score, reasons };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.option.sort_order - b.option.sort_order);

  return ranked.slice(0, args.limit ?? 5);
}

export function categoryIdForCode(categories: OptionCategory[], code: string | null): string | null {
  if (!code) return null;
  return categories.find((category) => category.code === code)?.id ?? null;
}
