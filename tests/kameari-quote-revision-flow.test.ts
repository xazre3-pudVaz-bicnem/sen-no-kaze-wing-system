import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { DealerRevisionItem, SessionUser } from '@/lib/data/store';

const root = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.WING_LOCAL_DIR;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function seedIssuedKameariRevisionCase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-kameari-revision-'));
  tempDirs.push(dir);
  execFileSync(process.execPath, ['scripts/seed-kameari-case.ts'], {
    cwd: root,
    env: { ...process.env, WING_LOCAL_DIR: dir },
    stdio: 'pipe',
  });
  process.env.WING_LOCAL_DIR = dir;

  const db = loadDb();
  const parent = db.quotes[0];
  const dealer = db.profiles.find((profile) => profile.role_code === 'master_dealer');
  if (!parent || !dealer) throw new Error('亀有fixtureの親Quoteまたは担当者が見つかりません');

  // 実受注fixture自体は accepted のまま保持する。
  // このテスト専用コピーだけ、Revision可能な issued 状態として実経路を検証する。
  parent.status = 'issued';
  const request = db.quoteRequests.find((row) => row.id === parent.quote_request_id);
  if (request) request.status = 'sent';
  saveDb(db);

  const actor: SessionUser = {
    id: dealer.id,
    email: dealer.email,
    role: 'master_dealer',
    full_name: dealer.full_name,
  };
  const items: DealerRevisionItem[] = db.quoteItems
    .filter((item) => item.quote_id === parent.id)
    .map((item) => ({
      kind: item.kind as DealerRevisionItem['kind'],
      name: item.name,
      description: item.description,
      unit: item.unit,
      remark: item.remark,
      unit_price: item.unit_price,
      quantity: item.quantity,
      image_url: item.image_url,
    }));

  return { parentId: parent.id, requestId: parent.quote_request_id, actor, items };
}

describe('亀有実案件相当のQuote Revision実経路', () => {
  it('無変更の第2版で9,196,000円を維持し親Revisionを履歴化する', async () => {
    const { parentId, requestId, actor, items } = seedIssuedKameariRevisionCase();
    const store = new LocalStore();

    const child = await store.createDealerRevision(
      parentId,
      { items, dealer_note: '無変更Revision回帰テスト' },
      actor
    );

    expect(child.parent_quote_id).toBe(parentId);
    expect(child.revision).toBe(2);
    expect(child.status).toBe('issued');
    expect(child.adjustment).toBe(-9_798);
    expect(child.subtotal).toBe(8_360_000);
    expect(child.tax).toBe(836_000);
    expect(child.total).toBe(9_196_000);

    const db = loadDb();
    const parent = db.quotes.find((quote) => quote.id === parentId);
    const savedChild = db.quotes.find((quote) => quote.id === child.id);
    const request = db.quoteRequests.find((row) => row.id === requestId);
    const childRaw = db.quoteItems
      .filter((item) => item.quote_id === child.id)
      .reduce((sum, item) => sum + item.amount, 0);

    expect(childRaw).toBe(8_369_798);
    expect(savedChild?.adjustment).toBe(-9_798);
    expect(savedChild?.total).toBe(9_196_000);
    expect(parent?.status).toBe('superseded');
    expect(request?.quote_id).toBe(child.id);
    expect(request?.status).toBe('sent');
  });
});
