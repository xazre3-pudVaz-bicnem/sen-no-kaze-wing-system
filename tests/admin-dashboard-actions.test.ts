import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboard = fs.readFileSync(path.join(process.cwd(), 'app/admin/page.tsx'), 'utf8');

describe('Admin dashboard actions', () => {
  it('shows concrete next actions instead of count-only summary cards', () => {
    expect(dashboard).toContain('まず確認すること');
    expect(dashboard).toContain('data-testid="dashboard-action-card"');
    expect(dashboard).toContain('次に何をするかまで確認できます。');
    expect(dashboard).not.toContain('<Stat ');
  });

  it('uses only existing quote/request/contact/notification state for admin actions', () => {
    expect(dashboard).toContain("request.status === 'new'");
    expect(dashboard).toContain("quote.status === 'issued' && quote.revision === 1 && !quote.dealer_id");
    expect(dashboard).toContain("quote.status === 'issued' && quote.revision === 1 && Boolean(quote.dealer_id)");
    expect(dashboard).toContain("quote.status === 'issued' && quote.revision > 1");
    expect(dashboard).toContain("quote.status === 'accepted'");
    expect(dashboard).toContain("contact.status === 'new'");

    for (const label of [
      '新しい見積依頼',
      '担当代理店が未割当',
      '現地確認・施工金額確認',
      '確定見積の確認・案内',
      'お客様が見積を承諾',
      '未対応のお問い合わせ',
      '未読のお知らせ',
    ]) {
      expect(dashboard).toContain(label);
    }
  });

  it('keeps dealer dashboard scoped to assigned quotes and uses the same safe quote-stage rules', () => {
    expect(dashboard).toContain('store.listDealerQuotes(actor.id)');
    expect(dashboard).not.toContain('store.listAllQuotes(actor.id)');
    expect(dashboard).toContain("q.status === 'issued' && q.revision === 1");
    expect(dashboard).toContain("q.status === 'issued' && q.revision > 1");
    expect(dashboard).toContain("q.status === 'accepted'");
  });

  it('does not invent unsupported deadlines or downstream workflow state', () => {
    expect(dashboard).not.toContain('契約待ち');
    expect(dashboard).not.toContain('製造遅延');
    expect(dashboard).not.toContain('引渡し期限超過');
    expect(dashboard).not.toContain('今日の予定');
    expect(dashboard).not.toContain('担当者期限');
  });
});
