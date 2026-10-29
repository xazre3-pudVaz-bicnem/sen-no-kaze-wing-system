import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #389（本体分類表の仕様別カテゴリー選択の corrective）の安全機構は、10/13 に #441 へ移植して本番適用済み。
 * #389 が「本番適用の前に業者側で実 DB で確かめる」としていた確認を、今の本体仕様マトリクスに合わせた実行時検査で行う（2026-10-29 先方の方針）。
 */
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('#389 の安全機構の実行時検査（本体分類表・明細の保護）', () => {
  it('実 DB の検査（check.mjs --runtime）に登録する', () => {
    const check = read('scripts/db-rehearsal/check.mjs');
    expect(check).toContain("import { runtimeConfigurationSpecGuard } from './runtime-configuration-spec-guard.mjs';");
    expect(check).toContain('await runtimeConfigurationSpecGuard(client, { connectionString: url })');
  });

  it('1 本の接続の検査は最後に rollback し、削除と結果の読み取りは別の文にする', () => {
    const sql = read('scripts/db-rehearsal/runtime-configuration-spec-guard.sql');
    expect(sql.trimEnd().endsWith('rollback;')).toBe(true);
    expect(sql).toContain("v_out := pg_temp.csg_run_as('authenticated', u_owner, format('delete from public.configurations where id = %L returning ''deleted''', c_del));");
    // 遅延する制約トリガー（仕様の変更の検査）まで確かめる
    expect(sql).toContain('set constraints all immediate;');
    for (const step of ['CSG-1 ', 'CSG-10 ', 'CSG-16 ', 'CSG-19 ', 'CSG-22 ', 'CSG-25 ']) expect(sql).toContain(step);
  });

  it('同時実行は 2 本の接続で、ローカルの使い捨て DB でだけ行い、試験データは最後に消す', () => {
    const mjs = read('scripts/db-rehearsal/runtime-configuration-spec-guard.mjs');
    expect(mjs).toContain("if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host))");
    expect(mjs).toContain("wait_event_type === 'Lock'");
    expect(mjs).toContain('await cleanup()');
    for (const step of ['CSG-C1 ', 'CSG-C4 ', 'CSG-C7 ']) expect(mjs).toContain(step);
  });
});
