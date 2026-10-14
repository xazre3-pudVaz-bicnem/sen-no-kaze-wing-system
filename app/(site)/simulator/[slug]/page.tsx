import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { getExteriorFaces } from '@/lib/data/exterior-faces';
import { getPublicBundleBySlug, getPublicCatalog } from '@/lib/data/public-catalog';
import { getSimulatorSaleViews } from '@/lib/data/standard-estimate-sale-views';
import { buildSimulatorEntryState } from '@/lib/domain/simulator-entry';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { ELEVATIONS, MODEL_WING01_ID } from '@/lib/seed/catalog';
import { JsonLd } from '@/components/ui';
import { SimulatorCaseImagesProvider } from '@/components/simulator/case-images-context';
import { SimulatorApp, type SimulatorInitial } from '@/components/simulator/simulator-app';

type Params = Promise<{ slug: string }>;
type Search = Promise<{ c?: string; resume?: string; spec?: string; preview?: string; plan?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getPublicBundleBySlug(slug);
  const model = bundle?.model;
  return buildMetadata({
    title: model ? `${model.name} 見積シミュレーター｜オプションを選んで概算金額と完成イメージを確認` : '見積シミュレーター',
    description: `${model?.name ?? 'Wing'}のベースにトイレ・お風呂・キッチン・エアコン・ウッドデッキなどのオプションを加え、完成イメージと概算金額をその場で確認。保存して後から再編集、見積依頼・見積書PDFの発行まで。`,
    path: `/simulator/${slug}`,
  });
}

export default async function SimulatorPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, { c, resume, spec, preview, plan }] = await Promise.all([params, searchParams]);

  // 公開カタログと認証確認は互いに依存しないため並列取得する。
  // カタログは1回だけ取得し、bundle とモデル一覧を同じ結果から組み立てる。
  const [catalog, user] = await Promise.all([getPublicCatalog(), getSessionUser()]);
  const catalogModel = catalog.models.find((m) => m.slug === slug);
  const bundle = catalogModel ? (catalog.bundles[catalogModel.id] ?? null) : null;
  if (!bundle) notFound();
  const model = bundle.model;
  const allModels = catalog.models;

  // Excelから取り込んだ標準見積をシミュレーターへ渡す。
  // 未登録・未マイグレーション環境では空配列になり、従来計算へ安全にフォールバックする。
  // 本部の管理者だけ、?preview=standard で切り替え前の新しい価格を確認できる（保存・見積依頼はできない）
  const previewRequested = preview === 'standard' && user?.role === 'admin';
  const store = await getStore();
  const [templateHeaders, sale] = await Promise.all([
    store.listEstimateTemplates(model.id),
    // 新しい標準見積（売価だけ）。サイトの新価格へ切り替えるスイッチが入っているときだけ、お客様にも使う
    getSimulatorSaleViews(model.id, { preview: previewRequested }),
  ]);
  const saleViews = sale.saleViews;
  const pricingPreview = previewRequested && !sale.switchedOn;
  const estimateTemplates = (
    await Promise.all(templateHeaders.map((row) => store.getEstimateTemplateBundle(model.id, row.spec_code)))
  ).filter((row): row is NonNullable<typeof row> => Boolean(row));

  // 立面図は商品台帳で登録した画像（kind=elevation）。未登録の Wing だけ従来の固定データで補う
  const registered = bundle.images
    .filter((i) => i.kind === 'elevation')
    .map((i) => ({ url: i.url, label: i.caption ?? i.alt ?? '立面図', alt: i.alt }));
  const elevations = registered.length > 0 ? registered : model.id === MODEL_WING01_ID ? ELEVATIONS : [];

  // 施工事例も同じ bundle.images から渡す。クライアント側で同じカタログを再取得しない。
  const caseImages = bundle.images
    .filter((image) => image.kind === 'case')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      caption: image.caption,
    }));

  let initial: SimulatorInitial | null = null;
  let loadError: string | null = null;
  let guestPlanExpiresAt: string | null = null;
  if (c) {
    if (!user) {
      loadError = '保存した仕様を開くにはログインが必要です。';
    } else {
      const found = await store.getConfiguration(c, user);
      if (!found) loadError = '保存した仕様が見つからないか、閲覧権限がありません。';
      else {
        const exteriorFaces = await getExteriorFaces(found.configuration.id);
        initial = {
          id: found.configuration.id,
          name: found.configuration.name,
          option_ids: found.items.map((i) => i.option_id),
          variant_choice_ids: found.items.flatMap((i) => i.variant_choice_ids ?? []),
          exterior_faces: exteriorFaces,
          status: found.configuration.status,
          finish_level: found.configuration.finish_level ?? 'full',
          spec_code: found.configuration.spec_code ?? null,
          site_prefecture: found.configuration.site_prefecture ?? null,
          site_municipality: found.configuration.site_municipality ?? null,
          site_location_undecided: found.configuration.site_location_undecided ?? false,
          lock_version: found.configuration.lock_version ?? null,
        };
      }
    }
  } else if (plan) {
    // ログインなしの一時保存（フェーズ2）。保存したのは仕様の選択だけで、金額はここで計算し直す。
    // 選んだ商品が台帳から外れていても、シミュレーターが今の台帳に合わせて整える
    const guest = await (await getCaseFlowStore()).getGuestPlan(plan);
    if (!guest) {
      loadError = '一時保存の URL が見つからないか、有効期限（保存から 30 日）が切れています。';
    } else if (guest.base_model_id !== model.id) {
      const other = allModels.find((m) => m.id === guest.base_model_id);
      if (other) redirect(`/simulator/${other.slug}?plan=${encodeURIComponent(plan)}`);
      loadError = '一時保存したプランの商品が見つかりません。';
    } else {
      initial = {
        // 未保存の新規下書き（保存するとマイページの新しいプランになる）
        id: null as never,
        name: guest.plan.name || `${model.name === 'フラット' ? 'Flat' : model.name} の仕様`,
        option_ids: guest.plan.option_ids,
        variant_choice_ids: guest.plan.variant_choice_ids,
        exterior_faces: guest.plan.exterior_faces,
        status: 'draft',
        finish_level: guest.plan.finish_level,
        spec_code: guest.plan.spec_code,
        site_prefecture: guest.plan.site_prefecture,
        site_municipality: guest.plan.site_municipality,
        site_location_undecided: guest.plan.site_location_undecided,
        lock_version: null,
      };
      guestPlanExpiresAt = guest.expires_at;
    }
  } else if (spec) {
    // /plans の平面図から入った場合は、該当仕様の標準構成を選択済みで開始する。
    // 未知の spec_code は helper 側で無視し、通常の既定仕様へ安全にフォールバックする。
    const entry = buildSimulatorEntryState(bundle, estimateTemplates, spec);
    if (entry) {
      initial = {
        // URL指定の新規下書きなので保存済みConfiguration IDは持たない。
        // SimulatorApp は nullish 値を新規保存として扱うため、runtimeでは null を渡す。
        id: null as never,
        name: `${model.name === 'フラット' ? 'Flat' : model.name} の仕様`,
        option_ids: entry.option_ids,
        variant_choice_ids: entry.variant_choice_ids,
        exterior_faces: entry.exterior_faces,
        status: 'draft',
        finish_level: entry.finish_level,
        spec_code: entry.spec_code,
        site_prefecture: null,
        site_municipality: null,
        site_location_undecided: false,
        // 未保存の新規下書き。版は最初の保存で 1 から始まる
        lock_version: null,
      };
    }
  }

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: `${model.name} 見積シミュレーター`, path: `/simulator/${model.slug}` }])} />
      <SimulatorCaseImagesProvider images={caseImages}>
        <SimulatorApp
          bundle={bundle}
          estimateTemplates={estimateTemplates}
          saleViews={saleViews}
          pricingPreview={pricingPreview}
          models={allModels.map((m) => ({ slug: m.slug, name: m.name }))}
          elevations={elevations}
          initial={initial}
          loadError={loadError}
          resume={resume === '1'}
          user={user ? { id: user.id, name: user.full_name || user.email } : null}
          guestPlanExpiresAt={guestPlanExpiresAt}
        />
      </SimulatorCaseImagesProvider>
    </>
  );
}
