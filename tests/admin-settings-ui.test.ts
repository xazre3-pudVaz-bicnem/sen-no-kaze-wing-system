import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/settings/page.tsx'), 'utf8');

describe('管理設定トップ', () => {
  it('日常の管理を最上位にして組織と利用者を中心に見せる', () => {
    expect(page).toContain('日常の管理');
    expect(page).toContain('組織・代理店');
    expect(page).toContain('ユーザー・担当者');
    expect(page).toContain('href="/admin/customers"');
  });

  it('管理・監査を小さな補助領域として分ける', () => {
    expect(page).toContain('管理・監査');
    expect(page).toContain('権限・役割');
    expect(page).toContain('変更履歴');
    expect(page).toContain('href="/admin/audit"');
    expect(page).toContain('compact');
  });

  it('利用可否を明示し、未確定のその他設定を先行表示しない', () => {
    expect(page).toContain("available ? '利用可能' : '準備中'");
    expect(page).not.toContain('その他設定');
  });

  it('操作マニュアルを設定項目ではなくヘルプとして分離する', () => {
    expect(page).toContain('ヘルプ');
    expect(page).toContain('href="/admin/manual"');
    expect(page).toContain('操作マニュアル');
  });
});
