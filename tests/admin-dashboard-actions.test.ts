import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adminRoot = fs.readFileSync(path.join(process.cwd(), 'app/admin/page.tsx'), 'utf8');

describe('Admin root', () => {
  it('redirects directly to case management instead of rendering a duplicate dashboard', () => {
    expect(adminRoot).toContain("redirect('/admin/quotes')");
    expect(adminRoot).not.toContain('まず確認すること');
    expect(adminRoot).not.toContain('最近の案件受付');
    expect(adminRoot).not.toContain('dashboard-action-card');
    expect(adminRoot).not.toContain('getStore');
  });
});
