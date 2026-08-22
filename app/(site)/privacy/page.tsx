import { buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { Breadcrumbs, Container } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';

export const metadata = buildMetadata({
  title: 'プライバシーポリシー',
  description: `${COMPANY.name}（千の風プロジェクト）における個人情報の取り扱いについて。`,
  path: '/privacy',
});

const sections = [
  {
    title: '1. 取得する情報',
    body: 'お問い合わせ時に、お名前、メールアドレス、電話番号、会社名・屋号、お住まいの地域、土地・候補地に関する情報、ご相談内容等をご提供いただく場合があります。また、見積シミュレーターの会員登録では、氏名、法人名、電話番号、住所、作成された仕様・見積内容をお預かりします。',
  },
  {
    title: '2. 利用目的',
    body: '取得した情報は、お問い合わせへの回答、宿泊施設運営や木造コンテナに関するご案内、お見積りの作成と送付、設置場所の確認、ご契約に関する連絡、サービス改善、必要なご連絡のために利用します。',
  },
  {
    title: '3. 情報の保存・管理',
    body: 'お問い合わせ情報および会員情報は、アクセス制御を行ったクラウドサービス上に保存・管理します。ご本人と当社の担当者のみが閲覧できる状態で、必要な範囲で適切に取り扱います。',
  },
  {
    title: '4. Google Analytics の利用',
    body: '当サイトでは、利用状況の把握と改善のため、Google Analytics を利用する予定です。Google Analytics は Cookie 等を用いて利用状況を収集する場合があります。',
  },
  {
    title: '5. 外部サービスについて',
    body: '今後、LINE公式アカウント等の外部サービスとの連携を検討しています。利用する場合は、各サービスの規約およびプライバシーポリシーもご確認ください。',
  },
  {
    title: '6. 継続的なメール案内について',
    body: '初期公開時点では、継続的なメール案内は行いません。将来実施する場合は、必要なご案内と同意確認を行います。',
  },
  {
    title: '7. 開示・訂正・利用停止等',
    body: 'ご本人から個人情報の開示、訂正、削除、利用停止等のご希望があった場合は、本人確認のうえ適切に対応します。会員の方は、マイページから保存データの削除および登録情報の変更が可能です。',
  },
];

export default function PrivacyPage() {
  const head = COMPANY.offices[0];
  return (
    <Container className="max-w-3xl pt-10 pb-24 sm:pt-14">
      <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'プライバシーポリシー' }]} />
      <div className="py-12 sm:py-16">
        <RuleHeading labelEn="Privacy Policy" title="プライバシーポリシー" tone="light" />
      </div>
      <p className="text-ink-soft leading-[1.95]">{COMPANY.name}は、お問い合わせ等でお預かりする情報を、以下の方針に基づき取り扱います。</p>
      <div className="mt-10 space-y-8">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="font-serif text-xl">{s.title}</h2>
            <p className="mt-2 leading-[1.95] text-ink-soft">{s.body}</p>
          </section>
        ))}
        <section>
          <h2 className="font-serif text-xl">8. お問い合わせ窓口</h2>
          <p className="mt-2 leading-[1.95] text-ink-soft">
            {COMPANY.name}
            <br />
            住所：{head.postal}　{head.address}
            <br />
            未掲載の連絡先については、お問い合わせフォームよりご連絡ください。
          </p>
        </section>
      </div>
      <p className="mt-12 text-sm text-muted">第１版 2026年6月1日　制定</p>
    </Container>
  );
}
