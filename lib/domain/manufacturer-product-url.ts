/**
 * メーカー公式商品ページURL（PR #535）。DB の options_manufacturer_product_url_https_check（20261105100000）と同じ決まり：
 * https・ホストあり・認証情報（user@）なし・空白なし・1000 文字以内（スキームの大文字小文字は問わない）。
 * 商品登録・登録済み商品の変更確認・保存（zod）・ローカル検証モードの保存で同じ判定を使う
 */
export const MANUFACTURER_PRODUCT_URL_MAX_LENGTH = 1000;
export const MANUFACTURER_PRODUCT_URL_PATTERN = /^https:\/\/[^\s/?#@]+([/?#]\S*)?$/i;
export const MANUFACTURER_PRODUCT_URL_ERROR = 'https://から始まるメーカー公式商品ページURL（空白・ログイン情報を含まない）を入力してください';

export function isValidManufacturerProductUrl(value: string): boolean {
  if (value.length > MANUFACTURER_PRODUCT_URL_MAX_LENGTH || !MANUFACTURER_PRODUCT_URL_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
