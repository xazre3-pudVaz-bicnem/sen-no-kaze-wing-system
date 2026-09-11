import Link from 'next/link';
import { deleteProductImageAction, deletePreviewRuleAction } from '@/lib/actions/admin';
import { findMissingPreviewCombos, previewKeyLabels } from '@/lib/domain/preview';
import { buildStandardFloorplanSlots } from '@/lib/domain/floorplan-admin';
import { findDedicatedBaseFloorplanRule, previewRuleDisplayNote } from '@/lib/domain/preview-rule-meta';
import { VIEW_LABELS, type CatalogBundle, type PreviewImageRule, type ProductImage, type ViewKey } from '@/lib/domain/types';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { ProductImageForm } from '@/components/admin/forms';
import { cn } from '@/lib/utils';

export type SimulatorImageSection = 'floorplan' | 'completion' | 'elevation' | 'case';

const SECTION_TABS: { key: SimulatorImageSection; label: string; lead: string }[] = [
  { key: 'floorplan', label: '平面図', lead: '本体・ホテル・住宅・事務所などの平面図を管理します。' },
  { key: 'completion', label: '完成イメージ', lead: '外観・室内・水まわりの完成イメージを管理します。' },
  { key: 'elevation', label: '立面図', lead: '正面・側面・背面などの立面図を管理します。' },
  { key: 'case', label: '施工事例', lead: 'シミュレーターに表示する施工事例写真を管理します。' },
];

const COMPLETION_VIEWS: ViewKey[] = ['exterior', 'interior', 'water'];

export function simulatorImageHref(modelId: string, section: SimulatorImageSection, extra?: string) {
  return `/admin/models/${modelId}?tab=simulator-images&section=${section}${extra ? `&${extra}` : ''}`;
}

function editorBack(modelId: string, section: SimulatorImageSection) {
  return encodeURIComponent(simulatorImageHref(modelId, section));
}

function previewEditHref(rule: PreviewImageRule, section: SimulatorImageSection) {
  return `/admin/preview-rules/${rule.id}?model=${rule.base_model_id}&section=${section}&back=${editorBack(rule.base_model_id, section)}`;
}

function previewNewHref(
  modelId: string,
  section: SimulatorImageSection,
  query: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  params.set('model', modelId);
  params.set('section', section);
  params.set('back', simulatorImageHref(modelId, section));
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return `/admin/preview-rules/new?${params.toString()}`;
}

function PreviewCard({
  rule,
  label,
  section,
  keyLabel,
}: {
  rule: PreviewImageRule;
  label: string;
  section: SimulatorImageSection;
  keyLabel: (key: string) => string;
}) {
  const displayNote = previewRuleDisplayNote(rule);
  const back = simulatorImageHref(rule.base_model_id, section);
  return (
    <li className="card overflow-hidden">
      <div className="relative aspect-[16/10] bg-sand">
        <SmartImage src={rule.url} alt={rule.alt} fill sizes="33vw" className={rule.view === 'floorplan' ? 'object-contain' : 'object-cover'} />
        <span className="absolute top-2 left-2 flex gap-1">
          <Badge tone="success">登録済み</Badge>
          {rule.status !== 'published' && <Badge tone="warn">非公開</Badge>}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="font-semibold">{label}</p>
          {displayNote && <p className="mt-1 line-clamp-2 text-xs text-muted">{displayNote}</p>}
        </div>
        <Link href={previewEditHref(rule, section)} className="btn-secondary btn-sm inline-flex">画像を変更</Link>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">詳細・その他の操作</summary>
          <div className="mt-2 space-y-2 rounded-lg bg-ivory/60 p-3">
            <p>対応条件：{rule.preview_keys.length ? rule.preview_keys.map(keyLabel).join(' + ') : '標準状態'}</p>
            <form action={deletePreviewRuleAction}>
              <input type="hidden" name="id" value={rule.id} />
              <input type="hidden" name="redirect_to" value={back} />
              <ConfirmSubmit message="この画像の登録を削除しますか？" className="text-danger underline">
                この画像を削除
              </ConfirmSubmit>
            </form>
          </div>
        </details>
      </div>
    </li>
  );
}

function ProductImageCard({
  image,
  modelId,
  section,
}: {
  image: ProductImage;
  modelId: string;
  section: 'elevation' | 'case';
}) {
  const back = simulatorImageHref(modelId, section);
  return (
    <li className="card overflow-hidden">
      <div className="relative aspect-[16/10] bg-sand">
        <SmartImage src={image.url} alt={image.alt} fill sizes="33vw" className={image.kind === 'elevation' ? 'object-contain' : 'object-cover'} />
        <span className="absolute top-2 left-2"><Badge tone="success">登録済み</Badge></span>
      </div>
      <div className="space-y-3 p-4">
        <p className="font-semibold">{image.caption || image.alt || '画像'}</p>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">その他の操作</summary>
          <div className="mt-2 rounded-lg bg-ivory/60 p-3">
            <p className="mb-2">差し替える場合は、この画像を削除してから新しい画像を追加してください。</p>
            <form action={deleteProductImageAction}>
              <input type="hidden" name="id" value={image.id} />
              <input type="hidden" name="base_model_id" value={modelId} />
              <input type="hidden" name="redirect_to" value={back} />
              <ConfirmSubmit message="この画像を削除しますか？" className="text-danger underline">
                この画像を削除
              </ConfirmSubmit>
            </form>
          </div>
        </details>
      </div>
    </li>
  );
}

export function ModelSimulatorImages({
  bundle,
  section = 'floorplan',
  missingOnly = false,
}: {
  bundle: CatalogBundle;
  section?: SimulatorImageSection;
  missingOnly?: boolean;
}) {
  const b = bundle;
  const selectedSection = SECTION_TABS.some((tab) => tab.key === section) ? section : 'floorplan';
  const labels = previewKeyLabels(b.options);
  const keyLabel = (key: string) => labels.get(key) ?? key;
  const floorplans = b.previewRules.filter((rule) => rule.view === 'floorplan').sort((a, c) => a.preview_keys.length - c.preview_keys.length);
  const presetFloorplans = buildStandardFloorplanSlots(b);
  const baseFloorplan = findDedicatedBaseFloorplanRule(floorplans);
  const presetMatchedRuleIds = new Set(presetFloorplans.flatMap((slot) => (slot.rule ? [slot.rule.id] : [])));
  if (baseFloorplan) presetMatchedRuleIds.add(baseFloorplan.id);
  const otherFloorplans = floorplans.filter((rule) => !presetMatchedRuleIds.has(rule.id));
  const elevations = b.images.filter((image) => image.kind === 'elevation').sort((a, c) => a.sort_order - c.sort_order);
  const cases = b.images.filter((image) => image.kind === 'case').sort((a, c) => a.sort_order - c.sort_order);
  const completionRules = b.previewRules.filter((rule) => COMPLETION_VIEWS.includes(rule.view));
  const floorplanRegistered = Number(Boolean(baseFloorplan)) + presetFloorplans.filter((slot) => slot.rule).length;
  const floorplanExpected = 1 + presetFloorplans.length;
  const floorplanMissing = floorplanExpected - floorplanRegistered;
  const published = b.previewRules.filter((rule) => rule.status === 'published');
  const { missing, truncated } = findMissingPreviewCombos(published, b.options.filter((option) => option.status === 'published'));
  const currentSection = SECTION_TABS.find((tab) => tab.key === selectedSection)!;

  const floorplanSlots = [
    {
      key: 'base',
      title: `${b.model.name}本体`,
      rule: baseFloorplan,
      detail: '本体専用',
      href: previewNewHref(b.model.id, 'floorplan', { view: 'floorplan', slot: 'base' }),
    },
    ...presetFloorplans.map((slot) => ({
      key: slot.code,
      title: slot.name,
      rule: slot.rule,
      detail: slot.keys.length ? `対応条件：${slot.keys.map(keyLabel).join(' + ')}` : '標準構成',
      href: previewNewHref(b.model.id, 'floorplan', {
        view: 'floorplan',
        keys: slot.keys.join(','),
        preset: slot.code,
      }),
    })),
  ];
  const visibleFloorplanSlots = missingOnly ? floorplanSlots.filter((slot) => !slot.rule) : floorplanSlots;

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{b.model.name} のシミュレーター画像</p>
            <p className="mt-1 text-xs text-muted">この商品の平面図・完成イメージ・立面図・施工事例をまとめて管理します。</p>
          </div>
          <Link href={`/simulator/${b.model.slug}`} target="_blank" className="btn-secondary btn-sm">シミュレーターで確認</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href={simulatorImageHref(b.model.id, 'floorplan')} className={cn('rounded-xl border p-4 transition hover:border-forest/50', selectedSection === 'floorplan' ? 'border-forest bg-forest/5' : 'border-line bg-white')}>
            <p className="text-xs text-muted">平面図</p>
            <p className="mt-1 text-xl font-semibold">{floorplanRegistered} / {floorplanExpected}</p>
            <p className={cn('mt-1 text-xs', floorplanMissing > 0 ? 'text-warn' : 'text-success')}>{floorplanMissing > 0 ? `未登録 ${floorplanMissing}件` : '必要な画像は登録済み'}</p>
          </Link>
          <Link href={simulatorImageHref(b.model.id, 'completion')} className={cn('rounded-xl border p-4 transition hover:border-forest/50', selectedSection === 'completion' ? 'border-forest bg-forest/5' : 'border-line bg-white')}>
            <p className="text-xs text-muted">完成イメージ</p>
            <p className="mt-1 text-xl font-semibold">{completionRules.length}件</p>
            <p className="mt-1 text-xs text-muted">外観・室内・水まわり</p>
          </Link>
          <Link href={simulatorImageHref(b.model.id, 'elevation')} className={cn('rounded-xl border p-4 transition hover:border-forest/50', selectedSection === 'elevation' ? 'border-forest bg-forest/5' : 'border-line bg-white')}>
            <p className="text-xs text-muted">立面図</p>
            <p className="mt-1 text-xl font-semibold">{elevations.length}件</p>
            <p className="mt-1 text-xs text-muted">正面・側面・背面など</p>
          </Link>
          <Link href={simulatorImageHref(b.model.id, 'case')} className={cn('rounded-xl border p-4 transition hover:border-forest/50', selectedSection === 'case' ? 'border-forest bg-forest/5' : 'border-line bg-white')}>
            <p className="text-xs text-muted">施工事例</p>
            <p className="mt-1 text-xl font-semibold">{cases.length}件</p>
            <p className="mt-1 text-xs text-muted">完成写真</p>
          </Link>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="text-2xl">{currentSection.label}</h2>
            <p className="mt-1 text-sm text-muted">{currentSection.lead}</p>
          </div>
          {selectedSection === 'floorplan' && floorplanMissing > 0 && (
            <Link
              href={missingOnly ? simulatorImageHref(b.model.id, 'floorplan') : simulatorImageHref(b.model.id, 'floorplan', 'filter=missing')}
              className="btn-secondary btn-sm"
            >
              {missingOnly ? 'すべて表示' : `未登録だけ表示（${floorplanMissing}）`}
            </Link>
          )}
        </div>

        {selectedSection === 'floorplan' && (
          <>
            {visibleFloorplanSlots.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleFloorplanSlots.map((slot) =>
                  slot.rule ? (
                    <div key={slot.key} className="card overflow-hidden">
                      <div className="relative aspect-[16/10] bg-sand">
                        <SmartImage src={slot.rule.url} alt={slot.rule.alt} fill sizes="33vw" className="object-contain" />
                        <span className="absolute top-2 left-2 flex gap-1">
                          <Badge tone="success">登録済み</Badge>
                          {slot.rule.status !== 'published' && <Badge tone="warn">非公開</Badge>}
                        </span>
                      </div>
                      <div className="space-y-3 p-4">
                        <div>
                          <p className="text-lg font-semibold">{slot.title}</p>
                          <p className="mt-1 text-xs text-muted">{slot.key === 'base' ? '本体専用平面図' : '標準構成の平面図'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={previewEditHref(slot.rule, 'floorplan')} className="btn-secondary btn-sm inline-flex">画像を変更</Link>
                          <form action={deletePreviewRuleAction}>
                            <input type="hidden" name="id" value={slot.rule.id} />
                            <input type="hidden" name="redirect_to" value={simulatorImageHref(b.model.id, 'floorplan')} />
                            <ConfirmSubmit message={`${slot.title}の平面図を削除しますか？`} className="btn-secondary btn-sm border-danger/30 text-danger">
                              画像を削除
                            </ConfirmSubmit>
                          </form>
                        </div>
                        {slot.key !== 'base' && <p className="text-xs text-muted">{slot.detail}</p>}
                      </div>
                    </div>
                  ) : (
                    <div key={slot.key} className="card flex min-h-56 flex-col justify-between gap-5 border-dashed p-5">
                      <div>
                        <Badge tone="warn">未登録</Badge>
                        <p className="mt-3 text-lg font-semibold">{slot.title}</p>
                        <p className="mt-2 text-sm text-muted">まだ平面図が登録されていません。</p>
                        <p className="mt-2 text-xs text-muted">{slot.detail}</p>
                      </div>
                      <Link href={slot.href} className="btn-primary btn-sm self-start">＋ 平面図を登録</Link>
                    </div>
                  )
                )}
              </div>
            ) : (
              <Alert tone="success">未登録の平面図はありません。</Alert>
            )}

            {!missingOnly && (
              <div className="flex flex-wrap gap-2">
                <Link href={previewNewHref(b.model.id, 'floorplan', { view: 'floorplan' })} className="btn-secondary btn-sm">＋ その他の平面図を追加</Link>
              </div>
            )}

            {!missingOnly && otherFloorplans.length > 0 && (
              <details className="rounded-xl border border-line bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold">詳細・その他の平面図（{otherFloorplans.length}件）</summary>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {otherFloorplans.map((rule) => (
                    <PreviewCard key={rule.id} rule={rule} label={rule.preview_keys.length === 0 ? '標準状態の画像' : 'その他の構成'} section="floorplan" keyLabel={keyLabel} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {selectedSection === 'completion' && (
          <div className="space-y-7">
            {COMPLETION_VIEWS.map((view) => {
              const rules = b.previewRules.filter((rule) => rule.view === view).sort((a, c) => a.preview_keys.length - c.preview_keys.length);
              return (
                <section key={view} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold">{VIEW_LABELS[view]}</h3>
                      <p className="text-xs text-muted">登録済み {rules.length}件</p>
                    </div>
                    <Link href={previewNewHref(b.model.id, 'completion', { view })} className="btn-secondary btn-sm">＋ 画像を追加</Link>
                  </div>
                  {rules.length > 0 ? (
                    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {rules.map((rule) => <PreviewCard key={rule.id} rule={rule} label={VIEW_LABELS[view]} section="completion" keyLabel={keyLabel} />)}
                    </ul>
                  ) : (
                    <div className="rounded-xl border border-dashed border-line p-5">
                      <Badge tone="warn">未登録</Badge>
                      <p className="mt-2 text-sm text-muted">{VIEW_LABELS[view]}の完成イメージはまだ登録されていません。</p>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {selectedSection === 'elevation' && (
          <div className="space-y-4">
            {elevations.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {elevations.map((image) => <ProductImageCard key={image.id} image={image} modelId={b.model.id} section="elevation" />)}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed border-line p-5">
                <Badge tone="warn">未登録</Badge>
                <p className="mt-2 text-sm text-muted">立面図はまだ登録されていません。</p>
              </div>
            )}
            <details className="card p-4">
              <summary className="cursor-pointer text-sm font-semibold">＋ 立面図を追加</summary>
              <div className="mt-4">
                <ProductImageForm modelId={b.model.id} allowedKinds={['elevation']} title="立面図を追加" />
              </div>
            </details>
          </div>
        )}

        {selectedSection === 'case' && (
          <div className="space-y-4">
            {cases.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cases.map((image) => <ProductImageCard key={image.id} image={image} modelId={b.model.id} section="case" />)}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed border-line p-5">
                <Badge tone="warn">未登録</Badge>
                <p className="mt-2 text-sm text-muted">施工事例はまだ登録されていません。</p>
              </div>
            )}
            <details className="card p-4">
              <summary className="cursor-pointer text-sm font-semibold">＋ 施工事例を追加</summary>
              <div className="mt-4">
                <ProductImageForm modelId={b.model.id} allowedKinds={['case']} title="施工事例を追加" />
              </div>
            </details>
          </div>
        )}
      </section>

      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">詳細設定・画像の不足チェック（通常は変更不要）</summary>
        <div className="mt-4 space-y-3">
          {missing.length > 0 ? (
            <Alert tone="warn" title={`システム上の画像不足候補：${missing.length}件`}>
              <ul className="grid gap-1 sm:grid-cols-2">
                {missing.map((item, index) => (
                  <li key={index} className="flex items-center justify-between gap-2 text-xs">
                    <span><span className="font-semibold">{VIEW_LABELS[item.view]}</span>：{item.keys.length ? item.keys.map(keyLabel).join(' + ') : '標準状態'}</span>
                    <Link
                      href={previewNewHref(b.model.id, item.view === 'floorplan' ? 'floorplan' : 'completion', {
                        view: item.view,
                        keys: item.keys.join(','),
                      })}
                      className="shrink-0 underline"
                    >
                      登録
                    </Link>
                  </li>
                ))}
              </ul>
              {truncated.length > 0 && <p className="mt-2 text-xs">※ 組み合わせ数が多いビューは一部のみチェックしています。</p>}
            </Alert>
          ) : (
            <Alert tone="success">現在の公開ルールでは不足警告はありません。</Alert>
          )}
        </div>
      </details>
    </div>
  );
}
