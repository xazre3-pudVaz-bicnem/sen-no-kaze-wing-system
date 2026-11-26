import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const proposal = read('docs/security-proposals/contract-formal-guard.sql');
const original = read('supabase/migrations/20261013150000_electronic_contracts.sql');
const local = read('lib/data/local-store.ts');
const begin = local.slice(local.indexOf('  async beginElectronicContract('), local.indexOf('  private mutateContract('));

describe('Contract initiation formal-quote repair proposal', () => {
  it('does not edit the already-applied electronic contract migration', () => {
    expect(original).toContain("if q.status <> 'accepted' then");
    expect(proposal).toContain('begin_electronic_contract(uuid,text,text)');
  });
  it('proposes fail-closed kind, customer and revision checks inside RPC', () => {
    expect(proposal).toContain("if q.quote_kind is distinct from 'formal' then");
    expect(proposal).toContain('req.user_id is distinct from q.user_id');
    expect(proposal).toContain('parent.revision = q.revision - 1');
    expect(proposal).toContain('q.pricing_model = \'v2.5\'');
    expect(proposal).toContain('v_after is distinct from v_before');
  });
  it('prevents preliminary and legacy NULL contract initiation in LocalStore', () => {
    expect(begin).toContain("quote.quote_kind !== 'formal'");
    expect(begin).toContain('見積Revisionの系譜を確認できません');
    expect(begin).toContain('request.user_id !== quote.user_id');
  });
});
