import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const foundationSql = read('supabase/migrations/20260914112000_base_master_foundation.sql');
const rpcSql = read('supabase/migrations/20260914143000_base_master_draft_publish.sql');
const actions = read('lib/actions/base-masters.ts');

describe('本体マスターRPC契約', () => {
  it('Server Actionは新本体テーブルへ直接writeせずRPCを使う', () => {
    for (const rpc of [
      'create_base_master_draft',
      'start_base_master_draft',
      'save_base_master_draft',
      'publish_base_master_draft',
      'discard_base_master_draft',
    ]) {
      expect(actions).toContain(`.rpc('${rpc}'`);
    }

    expect(actions).not.toMatch(
      /\.from\('(base_masters|base_master_revisions|base_master_revision_lines)'\)[\s\S]{0,160}\.(insert|update|delete)\(/
    );
  });

  it('stable line_keyはupsertし、省略された行だけ削除する', () => {
    expect(rpcSql).toMatch(/on conflict \(revision_id, line_key\) do update/i);
    expect(rpcSql).toMatch(/not \(line_key = any\(v_seen\)\)/i);
    expect(rpcSql).toMatch(/insert into public\.base_master_revision_lines[\s\S]*?v_revision_id,[\s\S]*?l\.line_key/i);
  });

  it('Publishは旧公開版をsupersededにし、新版をpublished/currentへ切り替える', () => {
    expect(rpcSql).toMatch(/set status = 'superseded'/i);
    expect(rpcSql).toMatch(/set status = 'published',[\s\S]*?published_by = v_uid/i);
    expect(rpcSql).toMatch(/set current_published_revision_id = v_revision\.id/i);
  });

  it('変更系RPCは本体編集権限をDBで再確認する', () => {
    const checks = rpcSql.match(/public\.can_edit_base_master\(/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(4);
    expect(rpcSql).toContain('FORBIDDEN: この本体を編集できません');
    expect(rpcSql).toContain('FORBIDDEN: この本体を公開できません');
    expect(rpcSql).toContain('FORBIDDEN: この本体Draftを破棄できません');
  });

  it('authenticatedは新本体テーブルをSELECTのみ利用する', () => {
    expect(foundationSql).toMatch(
      /revoke all privileges on table public\.organizations,[\s\S]*?public\.base_master_revision_lines[\s\S]*?from public, anon, authenticated;/i
    );
    expect(foundationSql).toMatch(
      /grant select on public\.organizations,[\s\S]*?public\.base_master_revision_lines[\s\S]*?to authenticated;/i
    );
  });

  it('公開済みRevisionと明細の不変性をDB triggerで守る', () => {
    expect(foundationSql).toContain('prevent_non_draft_base_master_line_write');
    expect(foundationSql).toContain('prevent_published_base_master_revision_mutation');
    expect(foundationSql).toContain('LOCKED: 公開済み本体Revisionの明細は変更できません');
    expect(foundationSql).toContain('LOCKED: 公開済み本体Revisionの内容は変更できません');
  });
});
