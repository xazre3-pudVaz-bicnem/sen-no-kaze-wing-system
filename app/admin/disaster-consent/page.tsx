import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { DisasterConsentTextForm } from '@/components/case-flow/forms';

export const metadata: Metadata = { title: '災害時提供の承諾書 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * 災害時提供の承諾書の文面（フェーズ15・本部だけ）。文面は先方（本部・法務）が決める。
 * 登録するまで、お客様のマイページには災害時提供の意思の設定を表示しない。登録した版は変えず、直すときは新しい版を足す。
 */
export default async function DisasterConsentTextPage() {
  const actor = await requireAdmin('/admin/disaster-consent');
  const caseFlow = await getCaseFlowStore();
  const texts = await caseFlow.listDisasterConsentTexts(actor);
  const latest = texts[0] ?? null;

  return (
    <AdminPage
      title="災害時提供の承諾書"
      lead="引渡し済みのお客様に、災害時に建物を提供できるかの意思を伺うときの文面です。先方が確定した文面だけを登録してください。"
    >
      <p className="text-xs text-muted">
        お客様の意思と提供の可否は <Link href="/admin/stock-ledger" className="underline-offset-4 hover:underline">全国ストック台帳</Link> で確認します。
      </p>
      <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="disaster-consent-current">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">お客様に表示している文面</h2>
          {latest ? <Badge tone="success">第{latest.version}版</Badge> : <Badge tone="warn">未登録（お客様には表示していません）</Badge>}
        </div>
        {latest ? (
          <div className="rounded-lg bg-[#fbfcfb] p-3 text-sm">
            <p className="font-semibold">{latest.title}</p>
            <p className="mt-2 whitespace-pre-wrap leading-7 text-ink-soft">{latest.body}</p>
            <p className="mt-2 text-[0.65rem] text-muted">登録 {formatDate(latest.published_at)}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">文面は先方の確認待ちです。登録するまで、お客様のマイページに災害時提供の欄は出ません。</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm">
        <h2 className="font-semibold">{latest ? '新しい版を登録する' : '文面を登録する'}</h2>
        <DisasterConsentTextForm />
      </section>

      {texts.length > 1 && (
        <section className="space-y-2 rounded-lg border border-line bg-white p-4 shadow-sm">
          <h2 className="font-semibold">これまでの版</h2>
          <ul className="space-y-1 text-sm">
            {texts.slice(1).map((text) => (
              <li key={text.id}>
                第{text.version}版　{text.title}　<span className="text-xs text-muted">{formatDate(text.published_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminPage>
  );
}
