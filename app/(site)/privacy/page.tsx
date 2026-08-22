import { buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { Breadcrumbs, Container, Section } from '@/components/ui';

export const metadata = buildMetadata({
  title: 'プライバシーポリシー',
  description: `${COMPANY.name}の Wing 見積シミュレーターにおける個人情報の取り扱いについて。`,
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <Section>
      <Container className="max-w-3xl">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'プライバシーポリシー' }]} />
        <h1 className="mt-6 text-3xl sm:text-4xl">プライバシーポリシー</h1>
        <div className="prose-wing mt-8 space-y-6 text-ink-soft">
          <p>{COMPANY.name}（以下「当社」）は、Wing 見積シミュレーター（以下「本サービス」）において取得する個人情報を、以下のとおり取り扱います。</p>
          <section>
            <h2 className="text-xl text-ink">1. 取得する情報</h2>
            <p>会員登録・見積依頼・お問い合わせの際に、氏名、法人名、メールアドレス、電話番号、住所、設置予定地、作成された仕様・見積内容を取得します。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">2. 利用目的</h2>
            <p>お見積りの作成と送付、設置場所の確認、ご契約に関する連絡、お問い合わせへの回答、本サービスの改善のために利用します。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">3. 第三者提供</h2>
            <p>法令に基づく場合を除き、ご本人の同意なく第三者に提供しません。運搬・施工を委託する協力会社へは、業務に必要な範囲で提供することがあります。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">4. 保存と安全管理</h2>
            <p>データはアクセス制御を行ったクラウド基盤に保存し、ご本人と当社の担当者のみが閲覧できます。</p>
          </section>
          <section>
            <h2 className="text-xl text-ink">5. 開示・訂正・削除</h2>
            <p>マイページから保存データの削除ができます。アカウントの削除・情報の開示等は、お問い合わせ窓口（{COMPANY.tel}）までご連絡ください。</p>
          </section>
          <p className="text-sm text-muted">制定日：2026年8月21日（正式な内容は法務確認のうえ差し替えてください）</p>
        </div>
      </Container>
    </Section>
  );
}
