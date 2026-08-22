import { finishLevelRank, type FinishLevel, type OptionCategory, type OptionConflict, type OptionDependency, type ProductOption } from './types';

export type RuleIssueType = 'conflict' | 'dependency' | 'required' | 'single';

export interface RuleIssue {
  type: RuleIssueType;
  message: string;
  option_ids: string[];
}

export interface RuleContext {
  options: ProductOption[];
  categories: OptionCategory[];
  dependencies: OptionDependency[];
  conflicts: OptionConflict[];
}

/**
 * 注文範囲に入っているカテゴリーだけを返す。
 * 本体のみ（shell）なら サッシ・外壁・防火仕様・別途工事 だけが対象になる。
 */
export function categoriesInScope(categories: OptionCategory[], level: FinishLevel): OptionCategory[] {
  const max = finishLevelRank(level);
  return categories.filter((c) => finishLevelRank(c.finish_level) <= max);
}

/** 注文範囲から外れたカテゴリーの選択を落とす（範囲を狭めたときに使う） */
export function pruneToScope(ctx: RuleContext, selectedIds: string[], level: FinishLevel): string[] {
  const ids = new Set(categoriesInScope(ctx.categories, level).map((c) => c.id));
  return selectedIds.filter((id) => {
    const o = ctx.options.find((x) => x.id === id);
    return o ? ids.has(o.category_id) : false;
  });
}

const nameOf = (ctx: RuleContext, id: string) => ctx.options.find((o) => o.id === id)?.name ?? '不明なオプション';

/** 選択集合全体の整合性を検証する（サーバー側の保存・見積時にも使う） */
export function validateSelection(ctx: RuleContext, selectedIds: string[], level: FinishLevel = 'full'): RuleIssue[] {
  const selected = new Set(selectedIds);
  const issues: RuleIssue[] = [];
  const published = ctx.options.filter((o) => o.status === 'published');
  const inScope = new Set(categoriesInScope(ctx.categories, level).map((c) => c.id));

  for (const c of ctx.conflicts) {
    if (selected.has(c.option_id) && selected.has(c.conflicts_with_option_id)) {
      issues.push({
        type: 'conflict',
        message:
          c.message ??
          `「${nameOf(ctx, c.option_id)}」と「${nameOf(ctx, c.conflicts_with_option_id)}」は同時に選べません。`,
        option_ids: [c.option_id, c.conflicts_with_option_id],
      });
    }
  }
  for (const d of ctx.dependencies) {
    if (selected.has(d.option_id) && !selected.has(d.requires_option_id)) {
      issues.push({
        type: 'dependency',
        message: d.message ?? `「${nameOf(ctx, d.option_id)}」には「${nameOf(ctx, d.requires_option_id)}」が必要です。`,
        option_ids: [d.option_id, d.requires_option_id],
      });
    }
  }
  for (const cat of ctx.categories.filter((c) => c.status === 'published' && inScope.has(c.id))) {
    const inCat = published.filter((o) => o.category_id === cat.id);
    const chosen = inCat.filter((o) => selected.has(o.id));
    if (cat.selection_mode === 'single' && chosen.length > 1) {
      issues.push({
        type: 'single',
        message: `「${cat.name}」は 1 つだけ選択してください。`,
        option_ids: chosen.map((o) => o.id),
      });
    }
    if (cat.is_required && inCat.length > 0 && chosen.length === 0) {
      issues.push({
        type: 'required',
        message: `「${cat.name}」を選択してください。`,
        option_ids: inCat.map((o) => o.id),
      });
    }
  }
  for (const o of published.filter((o) => o.is_required && inScope.has(o.category_id))) {
    if (!selected.has(o.id)) {
      issues.push({ type: 'required', message: `「${o.name}」は必須です。`, option_ids: [o.id] });
    }
  }
  for (const id of selectedIds) {
    const o = ctx.options.find((x) => x.id === id);
    if (o && !inScope.has(o.category_id)) {
      const cat = ctx.categories.find((c) => c.id === o.category_id);
      issues.push({
        type: 'required',
        message: `「${o.name}」は選択中の注文範囲に含まれません。${cat ? `「${cat.name}」を頼むには注文範囲を広げてください。` : ''}`,
        option_ids: [o.id],
      });
    }
  }
  return issues;
}

export interface ToggleResult {
  next: string[];
  /** ユーザーへ説明する文言（自動追加・自動解除・拒否理由） */
  notices: string[];
  /** 選択を拒否したか */
  rejected: boolean;
}

/**
 * UI 上でオプションをクリックしたときの状態遷移。
 * - ラジオ（single カテゴリー）は同カテゴリーの他項目を外す
 * - 競合する項目が選択済みなら理由を返して拒否する
 * - 前提オプションが未選択なら自動で追加して通知する
 * - 依存されている項目を外そうとしたら拒否する（先に依存元を外す）
 */
export function toggleOption(ctx: RuleContext, selectedIds: string[], optionId: string): ToggleResult {
  const option = ctx.options.find((o) => o.id === optionId);
  if (!option) return { next: selectedIds, notices: ['オプションが見つかりません。'], rejected: true };
  const category = ctx.categories.find((c) => c.id === option.category_id);
  const selected = new Set(selectedIds);
  const notices: string[] = [];

  if (selected.has(optionId)) {
    if (option.is_required || (category?.selection_mode === 'single' && category.is_required)) {
      return {
        next: selectedIds,
        notices: [`「${option.name}」は解除できません。別の項目を選んでください。`],
        rejected: true,
      };
    }
    const dependents = ctx.dependencies.filter((d) => d.requires_option_id === optionId && selected.has(d.option_id));
    if (dependents.length > 0) {
      const names = dependents.map((d) => `「${nameOf(ctx, d.option_id)}」`).join('・');
      return {
        next: selectedIds,
        notices: [`${names}に必要なため「${option.name}」は外せません。先に${names}を解除してください。`],
        rejected: true,
      };
    }
    selected.delete(optionId);
    return { next: [...selected], notices, rejected: false };
  }

  for (const c of ctx.conflicts) {
    const other =
      c.option_id === optionId ? c.conflicts_with_option_id : c.conflicts_with_option_id === optionId ? c.option_id : null;
    if (other && selected.has(other)) {
      const otherOpt = ctx.options.find((o) => o.id === other);
      const sameSingle = category?.selection_mode === 'single' && otherOpt?.category_id === option.category_id;
      if (!sameSingle) {
        return {
          next: selectedIds,
          notices: [
            c.message ??
              `「${option.name}」は「${nameOf(ctx, other)}」と同時に選べません。「${nameOf(ctx, other)}」を外してから選択してください。`,
          ],
          rejected: true,
        };
      }
    }
  }
  if (category?.selection_mode === 'single') {
    for (const o of ctx.options) {
      if (o.category_id === category.id && selected.has(o.id)) selected.delete(o.id);
    }
  }
  selected.add(optionId);

  const queue = [optionId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const d of ctx.dependencies.filter((d) => d.option_id === cur)) {
      if (selected.has(d.requires_option_id)) continue;
      const req = ctx.options.find((o) => o.id === d.requires_option_id);
      if (!req || req.status !== 'published') continue;
      const reqCat = ctx.categories.find((c) => c.id === req.category_id);
      if (reqCat?.selection_mode === 'single') {
        for (const o of ctx.options) if (o.category_id === reqCat.id && selected.has(o.id)) selected.delete(o.id);
      }
      selected.add(req.id);
      notices.push(d.message ?? `「${option.name}」に必要なため「${req.name}」を追加しました。`);
      queue.push(req.id);
    }
  }
  return { next: [...selected], notices, rejected: false };
}

/** 各オプションについて「いま選べない理由」を返す（カード上の説明表示に使う） */
export function explainBlocked(ctx: RuleContext, selectedIds: string[]): Map<string, string> {
  const selected = new Set(selectedIds);
  const map = new Map<string, string>();
  for (const c of ctx.conflicts) {
    const a = ctx.options.find((o) => o.id === c.option_id);
    const b = ctx.options.find((o) => o.id === c.conflicts_with_option_id);
    if (!a || !b) continue;
    const catA = ctx.categories.find((x) => x.id === a.category_id);
    const sameSingle = catA?.selection_mode === 'single' && a.category_id === b.category_id;
    if (sameSingle) continue;
    if (selected.has(a.id) && !selected.has(b.id)) map.set(b.id, c.message ?? `「${a.name}」と同時に選べません`);
    if (selected.has(b.id) && !selected.has(a.id)) map.set(a.id, c.message ?? `「${b.name}」と同時に選べません`);
  }
  return map;
}

/** 初期選択（is_default ＋ 必須）を返す。前提オプションも満たす */
export function defaultSelection(ctx: RuleContext, level: FinishLevel = 'full'): string[] {
  const inScope = new Set(categoriesInScope(ctx.categories, level).map((c) => c.id));
  const ids = ctx.options
    .filter((o) => o.status === 'published' && inScope.has(o.category_id) && (o.is_default || o.is_required))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => o.id);
  let cur: string[] = [];
  for (const id of ids) {
    const r = toggleOption(ctx, cur, id);
    if (!r.rejected) cur = r.next;
  }
  return [...new Set(cur)];
}
