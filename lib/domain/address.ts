/**
 * 住所文字列から ブロック（地方）／都道府県／市町村 を読み取る。
 * 管理画面の「ブロック・県・市町村で抽出」に使う（先方要望 2026-08-28）。
 * 住所は自由入力のため完全ではない。読み取れない場合は null を返し、抽出時は「不明」として扱う。
 */

export const BLOCKS = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄'] as const;
export type Block = (typeof BLOCKS)[number];

/** ブロック → 都道府県（標準的な 8 地方区分。中部は北陸・甲信越を含む） */
export const BLOCK_PREFECTURES: Record<Block, string[]> = {
  北海道: ['北海道'],
  東北: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  関東: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  中部: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  近畿: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  中国: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  四国: ['徳島県', '香川県', '愛媛県', '高知県'],
  '九州・沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'],
};

export const PREFECTURES: string[] = BLOCKS.flatMap((b) => BLOCK_PREFECTURES[b]);

const PREF_TO_BLOCK = new Map<string, Block>(
  BLOCKS.flatMap((b) => BLOCK_PREFECTURES[b].map((p) => [p, b] as [string, Block]))
);

export interface ParsedAddress {
  block: Block | null;
  prefecture: string | null;
  /** 市区町村（政令市は市まで。郡は取り除いて町村名） */
  city: string | null;
}

/** 住所から都道府県・市町村を読み取る。前置き（〒123-4567 など）があっても拾える */
export function parseAddress(address: string | null | undefined): ParsedAddress {
  const src = (address ?? '').trim();
  if (!src) return { block: null, prefecture: null, city: null };

  const prefecture = PREFECTURES.find((p) => src.includes(p)) ?? null;
  if (!prefecture) return { block: null, prefecture: null, city: null };

  const rest = src.slice(src.indexOf(prefecture) + prefecture.length);
  // 最初に現れる 市・区・町・村 まで（例：市川市・札幌市・千代田区）。郡名は取り除く。
  // 廿日市市・野々市市のように市名自体が「市」で終わる場合は、直後にも区分文字が続く限り伸ばす
  const m = rest.match(/^[\s、,]*(.+?[市区町村])(?![市区町村])/);
  let city = m ? m[1].trim() : null;
  if (city && city.includes('郡') && /[町村]$/.test(city)) {
    city = city.slice(city.lastIndexOf('郡') + 1) || city;
  }
  // 「○○市△△区」は市までにそろえる（札幌市中央区 → 札幌市）
  if (city) {
    const cityOnly = city.match(/^(.+?市)/);
    if (cityOnly && cityOnly[1] !== city && city.endsWith('区')) city = cityOnly[1];
  }

  return { block: PREF_TO_BLOCK.get(prefecture) ?? null, prefecture, city };
}

export interface RegionFilterValue {
  block: string | null;
  pref: string | null;
  city: string | null;
}

/** searchParams から抽出条件を読む（不正値は無視） */
export function readRegionFilter(sp: Record<string, string | undefined>): RegionFilterValue {
  const block = sp.block && (BLOCKS as readonly string[]).includes(sp.block) ? sp.block : null;
  const pref = sp.pref && PREFECTURES.includes(sp.pref) ? sp.pref : null;
  const city = sp.city?.trim() ? sp.city.trim() : null;
  return { block, pref, city };
}

/** 住所が抽出条件に合うか。条件が無ければ常に true */
export function matchesRegion(address: string | null | undefined, f: RegionFilterValue): boolean {
  if (!f.block && !f.pref && !f.city) return true;
  const parsed = parseAddress(address);
  if (f.pref) {
    if (parsed.prefecture !== f.pref) return false;
  } else if (f.block && parsed.block !== f.block) {
    return false;
  }
  if (f.city && parsed.city !== f.city) return false;
  return true;
}

export function regionFilterActive(f: RegionFilterValue): boolean {
  return Boolean(f.block || f.pref || f.city);
}

/** 選択中の条件の表示名（「関東／東京都／千代田区」） */
export function regionFilterLabel(f: RegionFilterValue): string {
  return [f.block && !f.pref ? f.block : null, f.pref, f.city].filter(Boolean).join('／');
}
