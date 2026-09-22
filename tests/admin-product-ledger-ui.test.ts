import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledger = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');

describe('商品台帳の入口', () => {
  it('商品識別情報で検索し、販売基準の導線を含めない', () => {
    expect(ledger).toContain('ProductLedgerClient');
    expect(ledger).not.toContain('/admin/base-breakdown');
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品名・メーカー・型番');
  });

  it('商品台帳の対話UIをクライアントコンポーネントへ分離する', () => {
    const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
    expect(client).toContain('商品を選択すると詳細を表示します');
    expect(client).toContain('自社仕入原価');
    expect(client).toContain('min-[900px]:grid-cols-2');
    expect(client).toContain('ProductDetail');
  });
});
