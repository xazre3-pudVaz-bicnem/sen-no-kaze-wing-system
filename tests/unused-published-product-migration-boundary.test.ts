import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const foundation = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261014101000_unused_published_product_safe_delete.sql'),
  'utf8'
);
const hardening = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261014102000_unused_published_product_safe_delete_hardening.sql'),
  'utf8'
);

describe('safe-delete migrationの途中状態', () => {
  it('101000単独適用後は旧safe-delete RPCをapplication roleへ公開しない', () => {
    expect(foundation).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.delete_unused_published_option\(uuid\)\s+to\s+authenticated\s*;/i
    );
    expect(foundation).toContain(
      'POSTCONDITION: pre-hardening safe-delete RPC must not be executable by application roles'
    );
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(foundation).toContain(
        `has_function_privilege('${role}', 'public.delete_unused_published_option(uuid)', 'EXECUTE')`
      );
    }
  });

  it('102000が成功した最後にcanonical wrapperだけauthenticatedへ公開する', () => {
    const grant = 'grant execute on function public.delete_unused_published_option(uuid) to authenticated;';
    expect(hardening).toContain(grant);
    expect(hardening.indexOf(grant)).toBeGreaterThan(
      hardening.indexOf('perform public.delete_unused_published_option_internal(p_option_id);')
    );
    expect(hardening).toContain(
      'POSTCONDITION: hardened safe-delete RPC must be executable by authenticated only'
    );
    expect(hardening).toContain(
      'POSTCONDITION: internal safe-delete implementation must not be executable by application roles'
    );
  });
});
