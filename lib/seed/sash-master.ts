/**
 * サッシの分類表（先方から共有された一覧表の画面から起こしたもの）。
 *
 * 表の構造：
 *   種類（単体引違 半外付／勝手口ドア など）× 幅 W × 高さ H → 呼称（例 07403）
 *   グレーのマスは設定なし。
 *
 * いただいた画面で呼称まで読み取れたのは **「単体引違 半外付」** の 1 種類だけです。
 * 他の種類は名称だけを登録し、サイズは未登録にしてあります。
 * 残りの呼称表と価格は、管理画面の「商品の一括登録」から Excel で追加してください。
 */

export interface SashType {
  code: string;
  group: '引違' | 'ドア';
  name: string;
}

/** 左ペインの種類一覧 */
export const SASH_TYPES: SashType[] = [
  { code: 'hikichigai-tantai-hangaidzuke', group: '引違', name: '単体引違 半外付' },
  { code: 'hikichigai-ranma-tantai-hangaidzuke', group: '引違', name: '欄間付き単体引違 半外付' },
  { code: 'hikichigai-shutter-tantai-hangaidzuke', group: '引違', name: 'シャッター付き単体引違 半外付' },
  { code: 'hikichigai-ranma-shutter-tantai-hangaidzuke', group: '引違', name: '欄間付きシャッター付単体引違 半外付' },
  { code: 'hikichigai-amado-hangaidzuke', group: '引違', name: '雨戸サッシ引違 半外付' },
  { code: 'hikichigai-ranma-amado-hangaidzuke', group: '引違', name: '欄間付き雨戸サッシ引違 半外付' },
  { code: 'hikichigai-mengoushi-hangaidzuke', group: '引違', name: '面格子付き引違 半外付' },
  { code: 'hikichigai-tantai-sotodzuke', group: '引違', name: '単体引違 外付' },
  { code: 'hikichigai-ranma-sotodzuke', group: '引違', name: '欄間付き引違 外付' },
  { code: 'hikichigai-shutter-tantai-sotodzuke', group: '引違', name: 'シャッター付き単体引違 外付' },
  { code: 'hikichigai-amado-sotodzuke', group: '引違', name: '雨戸サッシ引違 外付' },
  { code: 'hikichigai-ranma-amado-sotodzuke', group: '引違', name: '欄間付き雨戸サッシ引違 外付' },
  { code: 'door-katteguchi', group: 'ドア', name: '勝手口ドア' },
  { code: 'door-katteguchi-koshi-panel', group: 'ドア', name: '勝手口ドア（腰パネル）' },
  { code: 'door-katteguchi-zen-panel', group: 'ドア', name: '勝手口ドア（全パネル）' },
  { code: 'door-terrace', group: 'ドア', name: 'テラスドア' },
  { code: 'door-jiyu-kaihei', group: 'ドア', name: '自由開閉ドア' },
  { code: 'door-jiyu-kaihei-koshi-panel', group: 'ドア', name: '自由開閉ドア（腰パネル）' },
  { code: 'door-katabiraki', group: 'ドア', name: '片開' },
  { code: 'door-ryobiraki', group: 'ドア', name: '両開' },
];

/** 表の横軸（幅） */
export interface SashWidth {
  /** 呼称の頭 2〜3 桁（074／119…） */
  code: string;
  /** 内法基準 w（mm） */
  inner: number;
  /** 建具の枚数 */
  panels: number;
}

export const SASH_WIDTHS: SashWidth[] = [
  { code: '074', inner: 740, panels: 2 },
  { code: '119', inner: 1195, panels: 2 },
  { code: '165', inner: 1650, panels: 2 },
  { code: '256', inner: 2560, panels: 2 },
  { code: '256-3', inner: 2560, panels: 3 },
  { code: '256-4', inner: 2560, panels: 4 },
  { code: '347', inner: 3470, panels: 4 },
];

/** 表の縦軸（高さ） */
export interface SashHeight {
  /** 呼称の末尾 2 桁（03／05…） */
  code: string;
  /** 内法基準 h（mm） */
  inner: number;
  /** 窓 or テラス */
  kind: '窓' | 'テラス';
}

export const SASH_HEIGHTS: SashHeight[] = [
  { code: '03', inner: 300, kind: '窓' },
  { code: '05', inner: 500, kind: '窓' },
  { code: '07', inner: 700, kind: '窓' },
  { code: '09', inner: 900, kind: '窓' },
  { code: '11', inner: 1100, kind: '窓' },
  { code: '13', inner: 1300, kind: '窓' },
  { code: '15', inner: 1500, kind: '窓' },
  { code: '18', inner: 1800, kind: 'テラス' },
  { code: '20', inner: 2000, kind: 'テラス' },
  { code: '22', inner: 2200, kind: 'テラス' },
];

/**
 * 「単体引違 半外付」の呼称表。
 * キーは `${幅コード}_${高さコード}`、値は呼称。表にないマス（グレー）は含めない。
 */
export const SASH_SIZES_TANTAI_HANGAIDZUKE: Record<string, string> = {
  '074_03': '07403',
  '074_05': '07405',
  '074_07': '07407',
  '074_09': '07409',
  '074_11': '07411',

  '119_03': '11903',
  '119_05': '11905',
  '119_07': '11907',
  '119_09': '11909',
  '119_11': '11911',
  '119_13': '11913',
  '119_18': '11918',
  '119_20': '11920',

  '165_03': '16503',
  '165_05': '16505',
  '165_07': '16507',
  '165_09': '16509',
  '165_11': '16511',
  '165_13': '16513',
  '165_15': '16515',
  '165_18': '16518',
  '165_20': '16520',
  '165_22': '16522',

  '256_09': '25609-2',
  '256_11': '25611-2',
  '256_13': '25613-2',
  '256_18': '25618-2',
  '256_20': '25620-2',
  '256_22': '25622-2',

  '256-3_09': '25609-3',
  '256-3_11': '25611-3',
  '256-3_13': '25613-3',
  '256-3_18': '25618-3',
  '256-3_20': '25620-3',
  '256-3_22': '25622-3',

  '256-4_09': '25609-4',
  '256-4_11': '25611-4',
  '256-4_13': '25613-4',
  '256-4_18': '25618-4',
  '256-4_20': '25620-4',
  '256-4_22': '25622-4',

  '347_18': '34718',
  '347_20': '34720',
  '347_22': '34722',
};

/** 呼称が読み取れている種類のコード */
export const SASH_TYPE_WITH_SIZES = 'hikichigai-tantai-hangaidzuke';

/** 表示用のラベル（例「07403 ／ W740 × H300（窓・2枚）」） */
export function sashLabel(width: SashWidth, height: SashHeight, code: string): string {
  return `${code}　W${width.inner} × H${height.inner}（${height.kind}・${width.panels}枚）`;
}
