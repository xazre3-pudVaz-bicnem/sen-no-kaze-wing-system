import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');

describe('商品台帳の要確認フィルター', () => {
  it('既存の要確認判定だけを一覧のクイック絞り込みへ接続する', () => {
    expect(client).toContain('const [attentionOnly, setAttentionOnly] = useState(false)');
    expect(client).toContain("quick: attentionOnly ? 'needs-attention' : 'all'");
    expect(client).toContain('options.filter(needsProductAttention).length');
    expect(client).toContain('要確認 <span');
  });

  it('登録状態タブと要確認を同時選択せず、一覧とカテゴリー件数へ同じ条件を適用する', () => {
    expect(client).toContain("setStatus(''); setAttentionOnly(true); setPage(1)");
    expect(client).toContain("setStatus('published'); setAttentionOnly(false); setPage(1)");
    expect(client).toContain("setStatus('draft'); setAttentionOnly(false); setPage(1)");
    expect(client.match(/quick: attentionOnly \? 'needs-attention' : 'all'/g)).toHaveLength(2);
  });
});
