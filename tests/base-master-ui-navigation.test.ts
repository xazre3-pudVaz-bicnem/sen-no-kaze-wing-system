import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBaseMasterRevision } from '@/lib/domain/base-master-ui';

const listPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/base-masters/page.tsx'), 'utf8');
const detailPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/base-masters/[id]/page.tsx'), 'utf8');
const revisionForm = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/base-master-revision-form.tsx'), 'utf8');
const demo = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/base-master-excel-demo.tsx'), 'utf8');

describe('本体マスターUI', () => {
  it('版表記を第n版へ統一する', () => {
    expect(formatBaseMasterRevision(1)).toBe('第1版');
    expect(formatBaseMasterRevision(3)).toBe('第3版');
    expect(listPage).toContain('formatBaseMasterRevision(current.version)');
    expect(detailPage).toContain('formatBaseMasterRevision(revision.version)');
    expect(revisionForm).toContain('formatBaseMasterRevision(revision.version)');
    expect(demo).toContain('formatBaseMasterRevision(master.revision)');
    expect(demo).not.toContain('Rev.{master.revision}');
    expect(revisionForm).not.toContain('下書き v{revision.version}');
  });

  it('本体マスター一覧に検索と絞り込みを備える', () => {
    expect(listPage).toContain('name="q"');
    expect(listPage).toContain('name="model"');
    expect(listPage).toContain('name="status"');
    expect(listPage).toContain('name="fire"');
    expect(listPage).toContain("master.fire_spec_code !== fireFilter");
    expect(listPage).toContain('条件に一致する本体マスターはありません。');
  });

  it('仕様マトリクスをデータ由来の本体候補で絞り込める', () => {
    expect(demo).toContain('matrixModelOptions');
    expect(demo).toContain('Array.from(new Set(matrixRows.map((row) => row.model)))');
    expect(demo).toContain('visibleMatrixRows');
    expect(demo).toContain('15項目のうち給湯器は独立項目です。');
  });
});
