import type { ReactNode } from 'react';
import {
  INTENDED_USE_LABELS,
  LAND_CATEGORY_LABELS,
  LAND_STATUS_LABELS,
  ROAD_ACCESS_LABELS,
  SITE_LAND_FIELDS,
  SITE_LEGAL_FIELDS,
  SITE_UTILITY_FIELDS,
  UTILITY_STATUS_LABELS,
  type CasePartnerSiteInfo,
} from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function labelOf(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) return '—';
  return labels[value] ?? value;
}

/**
 * 総代理店（配下の確認・製造の担当）に見せる、製造・出荷・施工に必要な案件の情報（2026-11-04 の先方回答 B-3）。
 * 案件名・顧客番号・設置場所の住所と条件・用途・現地確認の内容と写真だけを出す。お客様のお名前・連絡先・ご自宅の住所・
 * メッセージ・打合せの記録・契約書・お客様が送った資料は、サーバーから返ってこない（DB の case_partner_site_info）
 */
export function CasePartnerSiteInfoSection({ info }: { info: CasePartnerSiteInfo | null | undefined }) {
  if (!info) return null;
  const { land, survey } = info;
  const filledLand = survey ? SITE_LAND_FIELDS.filter((field) => (survey.land[field.key] ?? '').trim() !== '') : [];
  const filledLegal = survey ? SITE_LEGAL_FIELDS.filter((field) => (survey.legal[field.key] ?? '').trim() !== '') : [];
  return (
    <section className="space-y-3" aria-labelledby="partner-site-heading" data-testid="partner-site-info">
      <div>
        <h2 id="partner-site-heading" className="text-lg font-semibold">
          設置場所・現地確認
        </h2>
        <p className="mt-1 text-xs text-muted">
          製造・出荷・施工に必要な情報です。お客様のお名前・連絡先・ご自宅の住所は表示しません。必要な資料は、営業担当の代理店から共有を受けてください。
        </p>
      </div>
      <dl className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="案件名">{info.case_name ?? '—'}</Item>
        <Item label="顧客番号">{info.customer_no ?? '—'}</Item>
        <Item label="設置場所の住所">{info.site_address ?? '—'}</Item>
        <Item label="土地の有無">{land ? labelOf(LAND_STATUS_LABELS, land.land_status) : '—'}</Item>
        {land?.land_status === 'owned' && (
          <>
            <Item label="敷地面積">{land.area_sqm !== null ? `${land.area_sqm.toLocaleString('ja-JP')} ㎡` : '—'}</Item>
            <Item label="地目">{labelOf(LAND_CATEGORY_LABELS, land.land_category)}</Item>
            <Item label="前面道路">{labelOf(ROAD_ACCESS_LABELS, land.road_access)}</Item>
            {SITE_UTILITY_FIELDS.map((field) => (
              <Item key={field.key} label={field.label}>
                {labelOf(UTILITY_STATUS_LABELS, land[field.key])}
              </Item>
            ))}
          </>
        )}
        {land && land.land_status !== 'owned' && <Item label="用途">{labelOf(INTENDED_USE_LABELS, land.intended_use)}</Item>}
      </dl>

      <div className="card space-y-3 p-5" data-testid="partner-site-survey">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">現地確認</h3>
          {survey ? (
            <Badge tone={survey.status === 'completed' ? 'success' : 'warn'}>{survey.status === 'completed' ? '完了' : '記録中'}</Badge>
          ) : (
            <Badge tone="neutral">まだ記録がありません</Badge>
          )}
          {survey?.surveyed_on && <span className="text-xs text-muted">確認日 {formatDate(survey.surveyed_on)}</span>}
        </div>
        {survey && (filledLand.length > 0 || filledLegal.length > 0) && (
          <dl className="grid gap-3 sm:grid-cols-2">
            {[...filledLand, ...filledLegal].map((field) => (
              <Item key={field.key} label={field.label}>
                {(field.key in survey.land ? survey.land[field.key] : survey.legal[field.key]) ?? '—'}
              </Item>
            ))}
          </dl>
        )}
        {survey?.survey_notes && (
          <div>
            <p className="text-xs text-muted">測量・確認のメモ</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{survey.survey_notes}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-muted">現地確認の写真・資料</p>
          {info.survey_files.length === 0 ? (
            <p className="mt-0.5 text-sm text-muted">ありません</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm" data-testid="partner-site-files">
              {info.survey_files.map((file) => (
                <li key={file.id}>
                  <a className="text-navy underline" href={`/api/case-files/${file.id}`} target="_blank" rel="noreferrer">
                    {file.caption || file.file_name}
                  </a>
                  <span className="ml-2 text-xs text-muted">{formatDate(file.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
