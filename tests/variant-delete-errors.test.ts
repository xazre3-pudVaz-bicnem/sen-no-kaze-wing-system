import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { variantDeleteErrorMessage } from '@/lib/domain/variant-delete-errors';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');

describe('下書き商品の選択項目・選択肢の安全削除：失敗の文', () => {
  it('DB が返す理由（文の先頭）ごとに、正しい文を出す（すべてを「使用中」にしない）', () => {
    expect(variantDeleteErrorMessage({ code: 'PGRST202', message: 'Could not find the function' })).toContain('未反映');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'FORBIDDEN: 商品編集権限がありません' })).toBe('この選択肢を削除する権限がありません。');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'UNAUTHENTICATED: ログインが必要です' })).toBe('この選択肢を削除する権限がありません。');
    expect(variantDeleteErrorMessage({ code: '42501', message: 'permission denied' })).toBe('この選択肢を削除する権限がありません。');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'LOCKED: ほかの保存処理と重なったため削除しませんでした' })).toContain('重なりました');
    expect(variantDeleteErrorMessage({ code: '55P03', message: 'lock timeout' })).toContain('重なりました');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'NOT_FOUND: 対象の選択肢がありません' })).toContain('見つかりません');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'VALIDATION: 別の選択項目の表示条件に使われているため削除できません' })).toContain('表示条件を外して');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'VALIDATION: 下書き商品だけ削除できます' })).toContain('下書き商品以外');
    expect(variantDeleteErrorMessage({ code: 'P0001', message: 'VALIDATION: この商品は保存済み仕様・見積…で使用されているため削除できません。' })).toContain('使用中');
    // 原価 Version（v2.5）などの外部キー（RESTRICT）で止まったときも「使用中」
    expect(variantDeleteErrorMessage({ code: '23503', message: 'update or delete on table violates foreign key constraint' })).toContain('原価の記録');
    expect(variantDeleteErrorMessage({ code: 'XX000', message: 'unknown' })).toBe('安全確認ができないため削除されませんでした。');
  });

  it('Server Action は DB の結果をこの文にし、同時実行の試験を実 DB の検査に登録している', () => {
    expect(read('lib/actions/unused-draft-variant-delete.ts')).toContain('redirect(errorPath(variantDeleteErrorMessage(result.error)));');
    const check = read('scripts/db-rehearsal/check.mjs');
    expect(check).toContain("import { runtimeUnusedDraftVariantRace } from './runtime-unused-draft-variant-race.mjs';");
    expect(check).toContain('runtime = mergeRuntime(runtime, await runtimeUnusedDraftVariantRace({ connectionString: url }));');
  });
});
