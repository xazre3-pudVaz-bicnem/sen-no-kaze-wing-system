import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { Container, Section } from '@/components/ui';
import { SiteProfileForm } from '@/components/case-flow/site-profile-fields';

export const metadata: Metadata = { title: '設置予定地・土地の確認 | マイページ', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * 保存したプランの設置予定地・土地（フローチャート フェーズ3「設置予定地域・土地確認」）。
 * 土地あり → 設置予定地を入力、土地なし・未定 → 希望地域・用途・予算を入力。見積を依頼すると担当の代理店にも伝わる。
 */
export default async function ConfigurationLandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/mypage/configurations/${id}/land`);
  const store = await getStore();
  const found = await store.getConfiguration(id, user);
  if (!found || found.configuration.user_id !== user.id) notFound();
  const { configuration } = found;
  const caseFlow = await getCaseFlowStore();
  const profile = await caseFlow.getSiteProfile(user, configuration.id);
  const area = configuration.site_location_undecided
    ? ''
    : [configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join('');

  return (
    <Section className="py-10 sm:py-14">
      <Container className="max-w-3xl space-y-6">
        <Link href="/mypage" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← マイページへ戻る
        </Link>
        <div>
          <p className="eyebrow">Site &amp; land</p>
          <h1 className="mt-1 text-3xl">設置予定地・土地の確認</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            「{configuration.name}」を建てる場所について教えてください。土地をお持ちでない方・未定の方は、希望の地域・用途・ご予算を伺います。
            分かる範囲で構いません。見積を依頼すると、担当の代理店にも伝わります。
          </p>
          {area && <p className="mt-2 text-xs text-muted">シミュレーターで選んだ地域：{area}</p>}
        </div>
        <SiteProfileForm configurationId={configuration.id} profile={profile} defaultDesiredArea={area} />
        <div className="flex flex-wrap gap-3 text-sm">
          {configuration.status === 'draft' && (
            <Link href={`/mypage/configurations/${configuration.id}/request-quote`} className="btn-secondary btn-sm">
              この仕様で見積を依頼する
            </Link>
          )}
        </div>
      </Container>
    </Section>
  );
}
