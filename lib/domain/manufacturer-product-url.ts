/**
 * メーカー公式商品ページURL（PR #535）。DB の options_manufacturer_product_url_https_check（20261111160000）と同じ決まり：
 * https・ホスト（英数字・ハイフン・ドット）・任意のポート・その後ろは空白と制御文字を含まない ASCII の印字可能文字だけ・1000 文字以内
 * （スキームの大文字小文字は問わない。認証情報（user@host）はホストに @ を使えないので通らない）。
 * DB（PostgreSQL の正規表現）と JavaScript で解釈が分かれないよう、文字は ASCII の範囲で指定する（Unicode の空白などを使わない）。
 * 日本語のパスなどは、保存の前に normalizeManufacturerProductUrl で %エンコードした URL にする（ブラウザが開く URL と同じ）。
 * 商品登録・登録済み商品の変更確認・保存（zod）・ローカル検証モードの保存・お客様の画面で同じ判定を使う
 */
export const MANUFACTURER_PRODUCT_URL_MAX_LENGTH = 1000;
/** DB の check 制約の正規表現と同じ（SQL では `~*` で大文字小文字を問わない） */
export const MANUFACTURER_PRODUCT_URL_PATTERN_SOURCE = '^https://[a-z0-9.-]+(:[0-9]{1,5})?([/?#][\\x21-\\x7e]*)?$';
export const MANUFACTURER_PRODUCT_URL_PATTERN = new RegExp(MANUFACTURER_PRODUCT_URL_PATTERN_SOURCE, 'i');
export const MANUFACTURER_PRODUCT_URL_ERROR = 'https://から始まるメーカー公式商品ページURL（空白・ログイン情報を含まない）を入力してください';

/**
 * 入力を保存する形にする：前後の空白を除き、URL として読めれば %エンコードした形（日本語のパス・空白など）にする。
 * 読めないときは前後の空白を除いた入力のまま（判定で止める）
 */
export function normalizeManufacturerProductUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.href : trimmed;
  } catch {
    return trimmed;
  }
}

/** 保存できる URL か（normalizeManufacturerProductUrl の後の値で判定する） */
export function isValidManufacturerProductUrl(value: string): boolean {
  return value.length <= MANUFACTURER_PRODUCT_URL_MAX_LENGTH && MANUFACTURER_PRODUCT_URL_PATTERN.test(value);
}
