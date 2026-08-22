import { buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { Breadcrumbs, Container, Section } from '@/components/ui';

export const metadata = buildMetadata({
  title: '利用規約',
  description: 'Wing 見積シミュレーターの利用規約。会員登録、見積シミュレーション、見積依頼に関する条件。',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <Section>
      <Container className="max-w-3xl">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '利用規約' }]} />
        <h1 className="mt-6 text-3xl sm:text-4xl">利用規約</h1>
        <div className="prose-wing mt-8 space-y-6 text-ink-soft">
          <section>
            <h2 className="text-xl text-ink">第1条（適用）</h2>
            <p>本規約は、{COMPANY.name}（以下「当社」）が提供する Wing 見積シミュレーター（以下「本サービス」）の利用条件を定めるものです。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">第2条（見積の性質）</h2>
            <p>本サービスで表示される金額および発行される見積書は概算です。運送費・現地工事費・諸経費等は設置場所の確認後に確定し、正式な見積書を別途発行します。本サービス上の操作により売買契約は成立しません。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">第3条（完成イメージ）</h2>
            <p>表示される画像は完成イメージです。実際の仕上がり・色味・周辺環境とは異なる場合があります。画像に反映されていないオプションは、その旨を画面上に表示します。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">第4条（アカウント）</h2>
            <p>会員はメールアドレスとパスワードを自己の責任で管理するものとします。保存された仕様・見積はご本人と当社のみが閲覧できます。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">第5条（禁止事項）</h2>
            <p>本サービスの画像・文章の無断転載、不正アクセス、他者になりすました登録・見積依頼を禁止します。</p>
          </section>
          <p className="text-sm text-muted">制定日：2026年8月21日（正式な内容は法務確認のうえ差し替えてください）</p>
        </div>
      </Container>
    </Section>
  );
}
