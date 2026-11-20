import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const route = read('app/api/quotes/[id]/pdf/route.ts');
const supabaseStore = read('lib/data/supabase-store.ts');
const localStore = read('lib/data/local-store.ts');
const sql = read('docs/security-proposals/quote-pdf-rls.sql');
const sbPdf = supabaseStore.slice(
  supabaseStore.indexOf('  async getQuoteDocumentFile(quoteId: string)'),
  supabaseStore.indexOf('  // ---------- 電子契約')
);
const localPdf = localStore.slice(
  localStore.indexOf('  async getQuoteDocumentFile(quoteId: string)'),
  localStore.indexOf('  // ---------- 電子契約')
);

describe('Issued quote PDF protection (static review gates; real DB tests still required)', () => {
  it('does not offer or honor a regeneration URL for an issued PDF', () => {
    expect(route).toContain("req.nextUrl.searchParams.get('regenerate') === '1'");
    expect(route).toContain('{ status: 409 }');
    expect(route).not.toContain('regenerate ? null :');
    expect(read('components/admin/case-workspace.tsx')).not.toContain('pdf?regenerate=1');
  });
  it('never returns a re-rendered PDF after Storage save fails', () => {
    expect(route).toContain('await store.saveQuoteDocument(id, bytes, fileName);');
    expect(route).not.toContain('quote document save failed');
    expect(sbPdf).toContain('if (dlError || !blob)');
    expect(sbPdf).toContain('保存済みPDFを取得できません');
    expect(sbPdf).toContain('if (prior)');
    expect(sbPdf).toContain('upsert: false');
    expect(sbPdf).not.toContain('upsert: true');
  });
  it('mirrors create-only persistence in local mode', () => {
    expect(localPdf).toContain("flag: 'wx'");
    expect(localPdf).toContain('保存済みPDFを取得できません');
    expect(localPdf).not.toContain('db.quoteDocuments = db.quoteDocuments.filter');
  });
  it('keeps PDF authorization narrower than the entire quotes visibility scope', () => {
    expect(sql).toContain('q.user_id = (select auth.uid())');
    expect(sql).toContain('public.is_admin()');
    expect(sql).toContain('public.is_dealer() and q.dealer_id = (select auth.uid())');
    expect(sql).toContain('grant select on table public.quote_documents to authenticated');
    expect(sql).toContain("id='quote-documents' and public=false");
    expect(sql).not.toMatch(/delete from public\.quote_documents/i);
  });
});
