import type { PreviewImageRule, ProductOption, ViewKey } from './types';

export interface PreviewLayer {
  url: string;
  alt: string;
  z_index: number;
}

export type PreviewMatchKind = 'exact' | 'layered' | 'nearest' | 'none';

export interface PreviewResolution {
  view: ViewKey;
  kind: PreviewMatchKind;
  layers: PreviewLayer[];
  /** 選択しているが画像に反映されていないキー */
  missing_keys: string[];
  /** 画像には写っているが選択していないキー */
  extra_keys: string[];
  /** 表示に使ったルールの補足 */
  note: string | null;
  /** 「画像は完成イメージです」表示が必要か（exact 以外） */
  approximate: boolean;
}

const sortedUnique = (keys: string[]) => [...new Set(keys)].sort();
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** 選択中オプションから、指定ビューに影響するプレビューキー集合を取り出す */
export function selectedPreviewKeys(options: ProductOption[], selectedIds: string[], view: ViewKey): string[] {
  const selected = new Set(selectedIds);
  return sortedUnique(
    options
      .filter((o) => selected.has(o.id) && o.preview_key && o.affects_views.includes(view))
      .map((o) => o.preview_key as string)
  );
}

/**
 * 画像切り替えの解決。優先順:
 *  1. 選択キー集合と完全一致する完成済み画像（composite）
 *  2. ベース層＋各キーのレイヤー画像（layer）がすべて揃うなら合成
 *  3. 最も近い登録画像（共通キーが多く・余分が少ないもの）＋「完成イメージ」表示
 *  4. 何もなければ none（UI はプレースホルダーを表示）
 * 勝手に別仕様の画像を「正しい完成図」として見せないため、exact 以外は approximate=true を返す。
 */
export function resolvePreview(rules: PreviewImageRule[], view: ViewKey, selectedKeys: string[]): PreviewResolution {
  const keys = sortedUnique(selectedKeys);
  const active = rules.filter((r) => r.view === view && r.status === 'published');
  const composites = active.filter((r) => r.kind === 'composite');
  const layers = active.filter((r) => r.kind === 'layer');

  const exact = composites.find((r) => sameSet(sortedUnique(r.preview_keys), keys));
  if (exact) {
    return {
      view,
      kind: 'exact',
      layers: [{ url: exact.url, alt: exact.alt, z_index: 0 }],
      missing_keys: [],
      extra_keys: [],
      note: exact.note,
      approximate: false,
    };
  }

  const baseLayer = layers.find((r) => r.preview_keys.length === 0);
  if (baseLayer) {
    const keyLayers = keys.map((k) => layers.find((r) => r.preview_keys.length === 1 && r.preview_keys[0] === k));
    if (keyLayers.every(Boolean)) {
      const stack = [baseLayer, ...(keyLayers as PreviewImageRule[])]
        .sort((a, b) => a.z_index - b.z_index)
        .map((r) => ({ url: r.url, alt: r.alt, z_index: r.z_index }));
      return { view, kind: 'layered', layers: stack, missing_keys: [], extra_keys: [], note: null, approximate: false };
    }
  }

  const candidates = [...composites, ...(baseLayer ? [baseLayer] : [])];
  if (candidates.length === 0) {
    return { view, kind: 'none', layers: [], missing_keys: keys, extra_keys: [], note: null, approximate: true };
  }
  let best: PreviewImageRule | null = null;
  let bestScore = -Infinity;
  for (const r of candidates) {
    const rk = new Set(sortedUnique(r.preview_keys));
    const common = keys.filter((k) => rk.has(k)).length;
    const extra = [...rk].filter((k) => !keys.includes(k)).length;
    const missing = keys.length - common;
    // 余分（選んでいない設備が写る）は欠落より強く減点する
    const score = common * 2 - extra * 3 - missing;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  const chosen = best as PreviewImageRule;
  const chosenKeys = new Set(chosen.preview_keys);
  return {
    view,
    kind: 'nearest',
    layers: [{ url: chosen.url, alt: chosen.alt, z_index: 0 }],
    missing_keys: keys.filter((k) => !chosenKeys.has(k)),
    extra_keys: [...chosenKeys].filter((k) => !keys.includes(k)),
    note: chosen.note,
    approximate: true,
  };
}

export interface MissingCombo {
  view: ViewKey;
  keys: string[];
}

/**
 * 管理画面用: 画像に影響するキーの全組み合わせのうち、exact/layered で表示できない組み合わせを列挙する。
 * キー数が多い場合は組み合わせ爆発を避けるため maxKeys で打ち切る（打ち切ったことを truncated で返す）。
 */
export function findMissingPreviewCombos(
  rules: PreviewImageRule[],
  options: ProductOption[],
  maxKeys = 6
): { missing: MissingCombo[]; truncated: ViewKey[] } {
  const missing: MissingCombo[] = [];
  const truncated: ViewKey[] = [];
  const views: ViewKey[] = ['exterior', 'interior', 'water', 'floorplan'];
  for (const view of views) {
    const keys = sortedUnique(
      options.filter((o) => o.status === 'published' && o.preview_key && o.affects_views.includes(view)).map((o) => o.preview_key as string)
    );
    const useKeys = keys.slice(0, maxKeys);
    if (keys.length > maxKeys) truncated.push(view);
    const n = useKeys.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const combo = useKeys.filter((_, i) => mask & (1 << i));
      const r = resolvePreview(rules, view, combo);
      if (r.kind === 'nearest' || r.kind === 'none') missing.push({ view, keys: combo });
    }
  }
  return { missing, truncated };
}

/** 選択キーのラベル化（オプション名） */
export function previewKeyLabels(options: ProductOption[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const o of options) if (o.preview_key && !m.has(o.preview_key)) m.set(o.preview_key, o.name);
  return m;
}
