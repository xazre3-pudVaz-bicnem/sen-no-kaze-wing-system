/**
 * 案件の進行（フローチャート第4版 フェーズ4〜15）の型・表示名・入力の検査。
 * 入力の検査は DB（20261013220000_case_flow_intake_site.sql 以降）の RPC と同じ規則にする（正本は DB）。
 * ローカル検証モードの実装と、画面の入力チェックの両方から使う。
 */

/** 案件（見積依頼）への関わり方。DB の case_access() と同じ */
export type CaseAccess = 'admin' | 'staff' | 'manufacturer' | 'customer';

export class CaseFlowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseFlowValidationError';
  }
}

const fail = (message: string): never => {
  throw new CaseFlowValidationError(message);
};

/** 前後の空白を除いた文字列。空なら null。長すぎれば検査エラー（DB の cf_text と同じ） */
export function cfText(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') fail(`${label}の形式が正しくありません`);
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) fail(`${label}は${max}文字以内で入力してください`);
  return text;
}

/** 文字列の配列（空白を除き、重複を除く）。DB の cf_text_array と同じ */
export function cfTextArray(value: unknown, maxItems: number, maxLen: number, label: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label}の形式が正しくありません`);
  const out: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') fail(`${label}の形式が正しくありません`);
    const text = (item as string).trim();
    if (!text) continue;
    if (text.length > maxLen) fail(`${label}の項目は${maxLen}文字以内にしてください`);
    if (!out.includes(text)) out.push(text);
  }
  if (out.length > maxItems) fail(`${label}は${maxItems}件までです`);
  return out;
}

// ---------- 代理店の公開情報（フェーズ4） ----------

export const DEALER_SERVICE_CODES = [
  'transport',
  'foundation',
  'installation',
  'electrical',
  'plumbing',
  'exterior',
  'permit',
  'maintenance',
] as const;
export type DealerServiceCode = (typeof DEALER_SERVICE_CODES)[number];
export const DEALER_SERVICE_LABELS: Record<DealerServiceCode, string> = {
  transport: '運搬',
  foundation: '基礎工事',
  installation: '設置',
  electrical: '電気工事',
  plumbing: '給排水工事',
  exterior: '外構',
  permit: '確認申請',
  maintenance: '点検・修理',
};

export interface DealerProfile {
  dealer_id: string;
  display_name: string;
  intro: string | null;
  service_prefectures: string[];
  service_municipalities: string[];
  services: DealerServiceCode[];
  qualifications: string | null;
  track_record: string | null;
  completed_count: number | null;
  phone: string | null;
  website_url: string | null;
  published: boolean;
  published_at: string | null;
  lock_version: number;
  updated_at: string;
}

export type DealerProfileInput = Pick<
  DealerProfile,
  | 'display_name'
  | 'intro'
  | 'service_prefectures'
  | 'service_municipalities'
  | 'services'
  | 'qualifications'
  | 'track_record'
  | 'completed_count'
  | 'phone'
  | 'website_url'
>;

export function normalizeDealerProfileInput(raw: Record<string, unknown>): DealerProfileInput {
  const display_name = cfText(raw.display_name, 100, '表示名');
  if (!display_name) fail('表示名を入力してください');
  const services = cfTextArray(raw.services, 20, 40, '施工対応');
  if (services.some((s) => !(DEALER_SERVICE_CODES as readonly string[]).includes(s))) fail('施工対応の項目が正しくありません');
  let completed_count: number | null = null;
  if (raw.completed_count !== null && raw.completed_count !== undefined && raw.completed_count !== '') {
    if (typeof raw.completed_count !== 'number' || !/^\d{1,6}$/.test(String(raw.completed_count))) {
      fail('施工実績の件数は 0 以上の整数で入力してください');
    }
    completed_count = raw.completed_count as number;
  }
  const website_url = cfText(raw.website_url, 300, 'Web サイト');
  if (website_url && !/^https:\/\/\S+$/.test(website_url)) fail('Web サイトは https:// から始まる URL で入力してください');
  return {
    display_name: display_name as string,
    intro: cfText(raw.intro, 2000, '紹介文'),
    service_prefectures: cfTextArray(raw.service_prefectures, 47, 10, '対応エリア（都道府県）'),
    service_municipalities: cfTextArray(raw.service_municipalities, 200, 60, '対応エリア（市区町村）'),
    services: services as DealerServiceCode[],
    qualifications: cfText(raw.qualifications, 1000, '資格'),
    track_record: cfText(raw.track_record, 2000, '施工実績'),
    completed_count,
    phone: cfText(raw.phone, 30, '電話番号'),
    website_url,
  };
}

/** 設置予定地（都道府県・市区町村）に対応する代理店か。市区町村の指定がある代理店は、その市区町村だけを対象にする */
export function dealerServesArea(profile: Pick<DealerProfile, 'service_prefectures' | 'service_municipalities'>, prefecture: string | null, municipality: string | null): boolean {
  if (!prefecture) return true;
  if (!profile.service_prefectures.includes(prefecture)) return false;
  const inPref = profile.service_municipalities.filter((m) => m.startsWith(`${prefecture}/`));
  if (inPref.length === 0 || !municipality) return true;
  return inPref.includes(`${prefecture}/${municipality}`);
}

// ---------- 見積依頼のときのお客様の希望（フェーズ5） ----------

export const MEETING_METHODS = ['onsite', 'online', 'visit', 'phone'] as const;
export type MeetingMethod = (typeof MEETING_METHODS)[number];
export const MEETING_METHOD_LABELS: Record<MeetingMethod, string> = {
  onsite: '現地で打合せ',
  online: 'オンライン',
  visit: '来場（事務所・展示場）',
  phone: '電話',
};

export const SLOT_PERIODS = ['am', 'pm', 'evening', 'any'] as const;
export type SlotPeriod = (typeof SLOT_PERIODS)[number];
export const SLOT_PERIOD_LABELS: Record<SlotPeriod, string> = {
  am: '午前',
  pm: '午後',
  evening: '夕方以降',
  any: '終日可',
};

export interface PreferredSlot {
  date: string;
  period: SlotPeriod;
}

export interface QuoteRequestPreferences {
  quote_request_id: string;
  preferred_dealer_id: string | null;
  meeting_method: MeetingMethod | null;
  preferred_slots: PreferredSlot[];
  note: string | null;
  updated_at: string;
}

export interface QuoteRequestPreferencesInput {
  preferred_dealer_id: string | null;
  meeting_method: MeetingMethod | null;
  preferred_slots: PreferredSlot[];
  note: string | null;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** today は日本時間の日付（YYYY-MM-DD）。DB は current_date で判定する */
export function normalizePreferencesInput(raw: Record<string, unknown>, today: string): QuoteRequestPreferencesInput {
  const dealer = cfText(raw.preferred_dealer_id, 36, '相談したい代理店');
  if (dealer && !/^[0-9a-f-]{36}$/i.test(dealer)) fail('相談したい代理店の指定が正しくありません');
  const method = cfText(raw.meeting_method, 20, '打合せの方法');
  if (method && !(MEETING_METHODS as readonly string[]).includes(method)) fail('打合せの方法が正しくありません');
  const slotsRaw = raw.preferred_slots ?? [];
  if (!Array.isArray(slotsRaw) || slotsRaw.length > 3) fail('打合せの希望日は 3 つまでです');
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 365);
  const slots: PreferredSlot[] = [];
  for (const slot of slotsRaw as Array<Record<string, unknown>>) {
    const date = typeof slot?.date === 'string' ? slot.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail('打合せの希望日の形式が正しくありません');
    if (date < today || date > isoDate(last)) fail('打合せの希望日は今日から 1 年以内の日付にしてください');
    const period = (typeof slot?.period === 'string' && slot.period) || 'any';
    if (!(SLOT_PERIODS as readonly string[]).includes(period)) fail('打合せの希望の時間帯が正しくありません');
    slots.push({ date, period: period as SlotPeriod });
  }
  return {
    preferred_dealer_id: dealer,
    meeting_method: (method as MeetingMethod | null) ?? null,
    preferred_slots: slots,
    note: cfText(raw.note, 1000, '日程のご要望'),
  };
}

// ---------- 案件の受付・担当（フェーズ5〜6） ----------

export interface CaseWorkflow {
  quote_request_id: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  primary_staff_id: string | null;
  primary_assigned_at: string | null;
  manufacturer_id: string | null;
  manufacturer_assigned_at: string | null;
  updated_at: string;
}

/** お客様に見せる進み具合（社内の情報は含まない）。DB の get_case_progress と同じ */
export interface CaseProgress {
  acknowledged_at: string | null;
  primary_staff_name: string | null;
  site_survey_status: 'none' | 'draft' | 'completed';
  site_survey_completed_at: string | null;
  /** 製造（20261013234000 以降）。送る前・依頼が無いときは none */
  manufacturing_status?: Exclude<ManufacturingOrderStatus, 'draft'> | 'none';
  unit_count?: number | null;
  units_shipped?: number;
  units_installed?: number;
  /** 契約が締結済みか（20261013237000 以降）。契約の中身は本部とお客様だけが読めるため、担当代理店の画面はこれで判定する */
  contract_signed?: boolean;
  /** 完了確認・引渡しの状態（20261013237000 以降）。始めていなければ none */
  handover_status?: HandoverStatus | 'none';
}

// ---------- 日程（フェーズ6・予約ボード） ----------

export const APPOINTMENT_PURPOSES = ['meeting', 'site_survey', 'handover', 'inspection', 'other'] as const;
export type AppointmentPurpose = (typeof APPOINTMENT_PURPOSES)[number];
export const APPOINTMENT_PURPOSE_LABELS: Record<AppointmentPurpose, string> = {
  meeting: '打合せ',
  site_survey: '現地調査',
  handover: '引渡し',
  inspection: '点検',
  other: 'その他',
};

export type AppointmentStatus = 'proposed' | 'confirmed' | 'done' | 'canceled';
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  proposed: '日程調整中',
  confirmed: '確定',
  done: '実施済み',
  canceled: '取り消し',
};

export interface AppointmentCandidate {
  starts_at: string;
  ends_at: string | null;
}

export interface CaseAppointment {
  id: string;
  quote_request_id: string;
  purpose: AppointmentPurpose;
  method: MeetingMethod;
  status: AppointmentStatus;
  candidates: AppointmentCandidate[];
  confirmed_starts_at: string | null;
  confirmed_ends_at: string | null;
  location: string | null;
  note: string | null;
  customer_note: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
}

export interface CaseAppointmentInput {
  purpose: AppointmentPurpose;
  method: MeetingMethod;
  candidates: AppointmentCandidate[];
  location: string | null;
  note: string | null;
  confirm: boolean;
}

export function normalizeAppointmentInput(raw: Record<string, unknown>, now: Date): CaseAppointmentInput {
  const purpose = cfText(raw.purpose, 20, '日程の種類') ?? 'meeting';
  const method = cfText(raw.method, 20, '打合せの方法') ?? 'onsite';
  if (!(APPOINTMENT_PURPOSES as readonly string[]).includes(purpose)) fail('日程の種類が正しくありません');
  if (!(MEETING_METHODS as readonly string[]).includes(method)) fail('打合せの方法が正しくありません');
  const candidatesRaw = raw.candidates;
  if (!Array.isArray(candidatesRaw) || candidatesRaw.length < 1 || candidatesRaw.length > 5) fail('候補の日時は 1〜5 つ入力してください');
  const min = now.getTime() - 24 * 60 * 60 * 1000;
  const max = now.getTime() + 2 * 365 * 24 * 60 * 60 * 1000;
  const candidates = (candidatesRaw as Array<Record<string, unknown>>).map((c) => {
    const starts = typeof c?.starts_at === 'string' ? Date.parse(c.starts_at) : NaN;
    const endsRaw = typeof c?.ends_at === 'string' && c.ends_at ? c.ends_at : null;
    const ends = endsRaw ? Date.parse(endsRaw) : null;
    if (Number.isNaN(starts) || (ends !== null && Number.isNaN(ends))) fail('候補の日時の形式が正しくありません');
    if (starts < min || starts > max) fail('候補の日時は今日以降の日時にしてください');
    if (ends !== null && ends <= starts) fail('終了の時刻は開始より後にしてください');
    return { starts_at: new Date(starts).toISOString(), ends_at: ends === null ? null : new Date(ends).toISOString() };
  });
  const confirm = raw.confirm === true;
  if (confirm && candidates.length !== 1) fail('日時を確定するときは、候補を 1 つにしてください');
  return {
    purpose: purpose as AppointmentPurpose,
    method: method as MeetingMethod,
    candidates,
    location: cfText(raw.location, 200, '場所'),
    note: cfText(raw.note, 1000, 'お客様へのご案内'),
    confirm,
  };
}

const jstDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
const jstTime = (iso: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** 日時の表示（日本時間）。終了があれば「〜HH:MM」を付ける */
export function formatCandidate(candidate: AppointmentCandidate): string {
  return candidate.ends_at ? `${jstDateTime(candidate.starts_at)}〜${jstTime(candidate.ends_at)}` : jstDateTime(candidate.starts_at);
}

/** 状態の変更として認めるもの（DB の set_case_appointment_status と同じ） */
export function canChangeAppointmentStatus(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return (from === 'proposed' && to === 'canceled') || (from === 'confirmed' && (to === 'done' || to === 'canceled'));
}

// ---------- 現地確認（フェーズ7） ----------

export const SITE_LAND_FIELDS = [
  { key: 'area_sqm', label: '敷地面積' },
  { key: 'land_category', label: '地目' },
  { key: 'road_access', label: '接道（方位・種別）' },
  { key: 'road_width', label: '前面道路の幅員' },
  { key: 'electricity', label: '電気（引込み）' },
  { key: 'water', label: '上水道' },
  { key: 'sewage', label: '下水・浄化槽' },
  { key: 'gas', label: 'ガス（都市ガス・LP）' },
  { key: 'delivery_route', label: '搬入経路（車両・道幅・電線）' },
  { key: 'crane', label: 'クレーンの要否・設置場所' },
  { key: 'ground', label: '地盤・設置面' },
  { key: 'slope', label: '高低差・傾斜' },
] as const;

export const SITE_LEGAL_FIELDS = [
  { key: 'city_planning_area', label: '都市計画区域' },
  { key: 'zoning', label: '用途地域' },
  { key: 'fire_zone', label: '防火地域' },
  { key: 'building_coverage', label: '建蔽率' },
  { key: 'floor_area_ratio', label: '容積率' },
  { key: 'building_confirmation', label: '建築確認の要否' },
  { key: 'height_district', label: '高度地区・日影規制' },
  { key: 'other_regulations', label: 'その他の規制（遺跡・景観など）' },
  { key: 'admin_consultation', label: '行政との協議' },
] as const;

export interface SiteSurvey {
  quote_request_id: string;
  status: 'draft' | 'completed';
  surveyed_on: string | null;
  surveyor_name: string | null;
  land: Record<string, string>;
  legal: Record<string, string>;
  survey_notes: string | null;
  completed_at: string | null;
  lock_version: number;
  updated_at: string;
}

export interface SiteSurveyInput {
  surveyed_on: string | null;
  surveyor_name: string | null;
  land: Record<string, string>;
  legal: Record<string, string>;
  survey_notes: string | null;
}

export function normalizeSiteSurveyInput(raw: Record<string, unknown>): SiteSurveyInput {
  const surveyedOn = cfText(raw.surveyed_on, 10, '確認日');
  if (surveyedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(surveyedOn) || Number.isNaN(Date.parse(`${surveyedOn}T00:00:00Z`)))) {
    fail('確認日の形式が正しくありません');
  }
  const pick = (source: unknown, fields: readonly { key: string }[], label: string) => {
    const obj = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
    const out: Record<string, string> = {};
    for (const { key } of fields) {
      const value = cfText(obj[key], 200, label);
      if (value) out[key] = value;
    }
    return out;
  };
  return {
    surveyed_on: surveyedOn,
    surveyor_name: cfText(raw.surveyor_name, 100, '確認した人'),
    land: pick(raw.land, SITE_LAND_FIELDS, '土地・搬入の項目'),
    legal: pick(raw.legal, SITE_LEGAL_FIELDS, '法規・行政の項目'),
    survey_notes: cfText(raw.survey_notes, 4000, '測量・確認のメモ'),
  };
}

// ---------- 社内の記録（フェーズ7） ----------

export type CaseNoteKind = 'meeting' | 'consult' | 'consult_reply' | 'tech_review' | 'other';
export const CASE_NOTE_KIND_LABELS: Record<CaseNoteKind, string> = {
  meeting: '打合せ記録',
  consult: '本部への相談',
  consult_reply: '本部からの回答',
  tech_review: '技術検討',
  other: 'メモ',
};

export type TechVerdict = 'feasible' | 'conditional' | 'infeasible';
export const TECH_VERDICT_LABELS: Record<TechVerdict, string> = {
  feasible: '製造できる',
  conditional: '条件付きで製造できる',
  infeasible: '製造できない',
};

export interface CaseNote {
  id: string;
  quote_request_id: string;
  kind: CaseNoteKind;
  body: string;
  verdict: TechVerdict | null;
  estimated_cost: number | null;
  parent_id: string | null;
  created_by: string;
  /** 書いた時点の名前 */
  author_name: string;
  created_at: string;
}

export interface CaseNoteInput {
  kind: CaseNoteKind;
  body: string;
  verdict: TechVerdict | null;
  estimated_cost: number | null;
  parent_id: string | null;
}

export function normalizeCaseNoteInput(raw: Record<string, unknown>): CaseNoteInput {
  const kind = cfText(raw.kind, 20, '記録の種類');
  if (!kind || !['meeting', 'consult', 'consult_reply', 'tech_review', 'other'].includes(kind)) fail('記録の種類が正しくありません');
  const body = cfText(raw.body, 4000, '内容');
  if (!body) fail('内容を入力してください');
  let verdict: TechVerdict | null = null;
  let estimated_cost: number | null = null;
  let parent_id: string | null = null;
  if (kind === 'tech_review') {
    const v = cfText(raw.verdict, 20, '製造可否');
    if (!v || !['feasible', 'conditional', 'infeasible'].includes(v)) fail('製造可否を選んでください');
    verdict = v as TechVerdict;
    if (raw.estimated_cost !== null && raw.estimated_cost !== undefined && raw.estimated_cost !== '') {
      if (typeof raw.estimated_cost !== 'number' || !/^\d{1,10}$/.test(String(raw.estimated_cost)) || raw.estimated_cost > 1_000_000_000) {
        fail('概算コストは 0 以上の整数（円）で入力してください');
      }
      estimated_cost = raw.estimated_cost as number;
    }
  }
  if (kind === 'consult_reply') {
    parent_id = cfText(raw.parent_id, 36, '回答する相談');
    if (!parent_id || !/^[0-9a-f-]{36}$/i.test(parent_id)) fail('回答する相談を選んでください');
  }
  return { kind: kind as CaseNoteKind, body: body as string, verdict, estimated_cost, parent_id };
}

// ---------- 見積の修正依頼（フェーズ9） ----------

export interface QuoteChangeRequest {
  id: string;
  quote_request_id: string;
  quote_id: string;
  message: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  requested_by: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeChangeRequestMessage(value: unknown): string {
  const text = cfText(value, 2000, '修正したい内容');
  if (!text) fail('修正したい内容を 2000 文字以内で入力してください');
  return text as string;
}

// ---------- 書面で締結した契約（フェーズ10） ----------

export interface PaperContractInput {
  signer_name: string;
  signer_email: string;
  /** 締結日（日本時間の日付 YYYY-MM-DD） */
  signed_on: string;
}

export function normalizePaperContractInput(raw: Record<string, unknown>, today: string): PaperContractInput {
  const name = cfText(raw.signer_name, 100, '署名者の氏名');
  if (!name) fail('署名者の氏名を入力してください');
  const email = (cfText(raw.signer_email, 254, '署名者のメールアドレス') ?? '').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('署名者のメールアドレスの形式が正しくありません');
  const signedOn = cfText(raw.signed_on, 10, '締結日');
  if (!signedOn || !/^\d{4}-\d{2}-\d{2}$/.test(signedOn) || Number.isNaN(Date.parse(`${signedOn}T00:00:00Z`))) fail('締結日を正しく入力してください');
  const min = new Date(`${today}T00:00:00Z`);
  min.setUTCDate(min.getUTCDate() - 3650);
  if ((signedOn as string) > today || (signedOn as string) < min.toISOString().slice(0, 10)) fail('締結日を正しく入力してください');
  return { signer_name: name as string, signer_email: email, signed_on: signedOn as string };
}

// ---------- 製造依頼と個体（フェーズ11） ----------

export type ManufacturingOrderStatus = 'draft' | 'sent' | 'received' | 'in_production' | 'shipped' | 'completed' | 'canceled';
export const MANUFACTURING_ORDER_STATUS_LABELS: Record<ManufacturingOrderStatus, string> = {
  draft: '作成中（未送信）',
  sent: '依頼済み（受領待ち）',
  received: '受領済み',
  in_production: '製造中',
  shipped: '出荷済み',
  completed: '完了',
  canceled: '取り消し',
};

export interface ManufacturingSpecSnapshot {
  quote_no: string;
  revision: number | null;
  base_model_name: string;
  spec_code: string | null;
  finish_level: string | null;
  items: { kind: string; name: string; quantity: number | string; unit: string | null }[];
}

export interface ManufacturingOrder {
  id: string;
  quote_request_id: string;
  contract_id: string;
  quote_id: string;
  manufacturer_id: string | null;
  status: ManufacturingOrderStatus;
  unit_count: number;
  requested_delivery_on: string | null;
  spec_note: string | null;
  spec_snapshot: ManufacturingSpecSnapshot | null;
  supply_note: string | null;
  /** 注文番号（採番の形式が先方の確認待ちのため、まだ発行しない） */
  order_no: string | null;
  sent_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
}

export interface ManufacturingOrderInput {
  unit_count: number;
  requested_delivery_on: string | null;
  spec_note: string | null;
  supply_note: string | null;
}

export const UNIT_STATUSES = ['planned', 'in_production', 'inspected', 'shipped', 'installed', 'handed_over'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  planned: '製造前',
  in_production: '製造中',
  inspected: '検査済み',
  shipped: '出荷済み',
  installed: '設置済み',
  handed_over: '引渡し済み',
};

export interface ManufacturingUnit {
  id: string;
  order_id: string;
  quote_request_id: string;
  seq: number;
  /** 個体番号（採番の形式が先方の確認待ちのため、まだ発行しない） */
  unit_no: string | null;
  status: UnitStatus;
  produced_on: string | null;
  inspected_on: string | null;
  shipped_on: string | null;
  installed_on: string | null;
  handed_over_on: string | null;
  note: string | null;
  lock_version: number;
  updated_at: string;
}

export interface UnitUpdateInput {
  status: UnitStatus;
  produced_on: string | null;
  inspected_on: string | null;
  shipped_on: string | null;
  installed_on: string | null;
  handed_over_on: string | null;
  note: string | null;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function cfDate(value: unknown, label: string): string | null {
  const text = cfText(value, 10, label);
  if (!text) return null;
  if (!isDate(text)) fail(`${label}の形式が正しくありません`);
  return text;
}

export function normalizeManufacturingOrderInput(raw: Record<string, unknown>, today: string): ManufacturingOrderInput {
  const count = typeof raw.unit_count === 'number' ? raw.unit_count : Number(String(raw.unit_count ?? '').trim());
  if (!Number.isInteger(count) || count < 1 || count > 50) fail('棟数は 1〜50 で入力してください');
  const delivery = cfDate(raw.requested_delivery_on, '希望納期');
  if (delivery) {
    const last = new Date(`${today}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + 1095);
    if (delivery < today || delivery > last.toISOString().slice(0, 10)) fail('希望納期は今日から 3 年以内の日付にしてください');
  }
  return {
    unit_count: count,
    requested_delivery_on: delivery,
    spec_note: cfText(raw.spec_note, 4000, '製造仕様のメモ'),
    supply_note: cfText(raw.supply_note, 2000, '基幹資材の供給手配'),
  };
}

/** 個体の状態を変えられるか（DB の update_manufacturing_unit と同じ）。製造・検査・出荷は製造の担当、設置・引渡しは担当代理店。本部はすべて・戻すこともできる */
export function canSetUnitStatus(access: CaseAccess, from: UnitStatus, to: UnitStatus): boolean {
  if (access === 'customer') return false;
  if (to !== from) {
    if ((to === 'in_production' || to === 'inspected' || to === 'shipped') && access !== 'admin' && access !== 'manufacturer') return false;
    if ((to === 'installed' || to === 'handed_over') && access !== 'admin' && access !== 'staff') return false;
  }
  if (UNIT_STATUSES.indexOf(to) < UNIT_STATUSES.indexOf(from) && access !== 'admin') return false;
  return true;
}

export function normalizeUnitInput(raw: Record<string, unknown>, current: UnitStatus): UnitUpdateInput {
  const status = (cfText(raw.status, 20, '個体の状態') ?? current) as UnitStatus;
  if (!(UNIT_STATUSES as readonly string[]).includes(status)) fail('個体の状態が正しくありません');
  return {
    status,
    produced_on: cfDate(raw.produced_on, '製造日'),
    inspected_on: cfDate(raw.inspected_on, '検査日'),
    shipped_on: cfDate(raw.shipped_on, '出荷日'),
    installed_on: cfDate(raw.installed_on, '設置日'),
    handed_over_on: cfDate(raw.handed_over_on, '引渡し日'),
    note: cfText(raw.note, 1000, '個体のメモ'),
  };
}

/** 製造依頼の状態の変更（DB の set_manufacturing_order_status と同じ） */
export function canChangeOrderStatus(access: CaseAccess, from: ManufacturingOrderStatus, to: ManufacturingOrderStatus): boolean {
  const role =
    to === 'received' || to === 'in_production' || to === 'shipped'
      ? access === 'admin' || access === 'manufacturer'
      : to === 'completed'
        ? access === 'admin' || access === 'staff'
        : to === 'canceled'
          ? access === 'admin'
          : false;
  if (!role) return false;
  return (
    (from === 'sent' && to === 'received') ||
    (from === 'received' && to === 'in_production') ||
    (from === 'in_production' && to === 'shipped') ||
    (from === 'shipped' && to === 'completed') ||
    (from !== 'completed' && from !== 'canceled' && to === 'canceled')
  );
}

// ---------- 工程表（フェーズ12） ----------

export const SCHEDULE_CATEGORIES = [
  'manufacturing',
  'inspection',
  'shipping',
  'delivery',
  'foundation',
  'installation',
  'electrical',
  'plumbing',
  'equipment',
  'handover',
  'other',
] as const;
export type ScheduleCategory = (typeof SCHEDULE_CATEGORIES)[number];
export const SCHEDULE_CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  manufacturing: '製造',
  inspection: '品質検査',
  shipping: '出荷',
  delivery: '配送・搬入',
  foundation: '基礎工事',
  installation: '設置',
  electrical: '電気工事',
  plumbing: '給排水工事',
  equipment: '設備',
  handover: '引渡し',
  other: 'その他',
};
/** 製造の担当（総代理店）が編集できる工程 */
export const MANUFACTURER_SCHEDULE_CATEGORIES: ScheduleCategory[] = ['manufacturing', 'inspection', 'shipping'];

export type ScheduleStatus = 'planned' | 'in_progress' | 'done' | 'delayed';
export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = { planned: '予定', in_progress: '進行中', done: '完了', delayed: '遅れ' };

export interface CaseScheduleItem {
  id: string;
  quote_request_id: string;
  category: ScheduleCategory;
  title: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: ScheduleStatus;
  customer_visible: boolean;
  /** お客様に見せる項目では、お客様にも表示される */
  note: string | null;
  sort_order: number;
  lock_version: number;
  updated_at: string;
}

export interface ScheduleItemInput {
  category: ScheduleCategory;
  title: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: ScheduleStatus;
  customer_visible: boolean;
  note: string | null;
}

export function normalizeScheduleItemInput(raw: Record<string, unknown>): ScheduleItemInput {
  const category = cfText(raw.category, 20, '工程の種類');
  if (!category || !(SCHEDULE_CATEGORIES as readonly string[]).includes(category)) fail('工程の種類が正しくありません');
  const title = cfText(raw.title, 100, '工程名');
  if (!title) fail('工程名を入力してください');
  const status = cfText(raw.status, 20, '工程の状態') ?? 'planned';
  if (!['planned', 'in_progress', 'done', 'delayed'].includes(status)) fail('工程の状態が正しくありません');
  const input = {
    category: category as ScheduleCategory,
    title: title as string,
    planned_start: cfDate(raw.planned_start, '予定の開始日'),
    planned_end: cfDate(raw.planned_end, '予定の終了日'),
    actual_start: cfDate(raw.actual_start, '実績の開始日'),
    actual_end: cfDate(raw.actual_end, '実績の終了日'),
    status: status as ScheduleStatus,
    customer_visible: raw.customer_visible === true,
    note: cfText(raw.note, 1000, 'メモ'),
  };
  if ((input.planned_start && input.planned_end && input.planned_end < input.planned_start) || (input.actual_start && input.actual_end && input.actual_end < input.actual_start)) {
    fail('終了日は開始日以降にしてください');
  }
  return input;
}

// ---------- 施工の記録（フェーズ13） ----------

export type ProgressKind = 'progress' | 'completion' | 'inspection' | 'support';
export const PROGRESS_KIND_LABELS: Record<ProgressKind, string> = { progress: '進み具合', completion: '完了', inspection: '検査', support: '技術支援' };
/** 製造の担当（総代理店）が書ける記録 */
export const MANUFACTURER_PROGRESS_KINDS: ProgressKind[] = ['progress', 'support'];

export interface CaseProgressReport {
  id: string;
  quote_request_id: string;
  schedule_item_id: string | null;
  kind: ProgressKind;
  title: string;
  body: string | null;
  reported_on: string;
  customer_visible: boolean;
  created_by: string;
  author_name: string;
  created_at: string;
}

export interface ProgressReportInput {
  kind: ProgressKind;
  title: string;
  body: string | null;
  reported_on: string;
  schedule_item_id: string | null;
  customer_visible: boolean;
}

export function normalizeProgressReportInput(raw: Record<string, unknown>, today: string): ProgressReportInput {
  const kind = cfText(raw.kind, 20, '記録の種類');
  if (!kind || !['progress', 'completion', 'inspection', 'support'].includes(kind)) fail('記録の種類が正しくありません');
  const title = cfText(raw.title, 100, '見出し');
  if (!title) fail('見出しを入力してください');
  const on = cfDate(raw.reported_on, '記録日') ?? today;
  if (on > today) fail('記録日は今日以前の日付にしてください');
  const item = cfText(raw.schedule_item_id, 36, '工程の指定');
  if (item && !/^[0-9a-f-]{36}$/i.test(item)) fail('工程の指定が正しくありません');
  return {
    kind: kind as ProgressKind,
    title: title as string,
    body: cfText(raw.body, 4000, '内容'),
    reported_on: on,
    schedule_item_id: item,
    customer_visible: raw.customer_visible === true,
  };
}

// ---------- 完了確認・是正・引渡し（フェーズ14） ----------

export type HandoverStatus = 'inspecting' | 'correcting' | 'ready' | 'handed_over';
export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  inspecting: '完成確認中（お客様の確認待ち）',
  correcting: '是正中',
  ready: '引渡しの準備完了',
  handed_over: '引渡し済み',
};

export type CustomerConfirmation = 'pending' | 'ok' | 'issues';
export const CUSTOMER_CONFIRMATION_LABELS: Record<CustomerConfirmation, string> = {
  pending: '回答待ち',
  ok: '問題なし',
  issues: '気になる点あり',
};

export interface CaseHandover {
  quote_request_id: string;
  status: HandoverStatus;
  inspection_on: string;
  /** お客様にも表示される */
  inspection_summary: string | null;
  customer_confirmation: CustomerConfirmation;
  /** mypage：お客様がマイページで回答／certificate：署名済みの承諾書を担当が記録 */
  customer_confirmed_via: 'mypage' | 'certificate' | null;
  customer_confirmed_at: string | null;
  certificate_file_id: string | null;
  certificate_signed_on: string | null;
  handed_over_on: string | null;
  lock_version: number;
  updated_at: string;
}

export type PunchItemStatus = 'open' | 'fixed' | 'verified';
export const PUNCH_ITEM_STATUS_LABELS: Record<PunchItemStatus, string> = {
  open: '是正待ち',
  fixed: '是正済み（確認待ち）',
  verified: '確認済み',
};

export interface CasePunchItem {
  id: string;
  quote_request_id: string;
  description: string;
  raised_by_customer: boolean;
  status: PunchItemStatus;
  fixed_on: string | null;
  verified_at: string | null;
  lock_version: number;
  created_at: string;
}

export interface HandoverInspectionInput {
  inspection_on: string;
  inspection_summary: string | null;
}

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** today は日本時間の日付。DB の start_handover_inspection と同じ範囲（10 年前〜1 年後） */
export function normalizeHandoverInspectionInput(raw: Record<string, unknown>, today: string): HandoverInspectionInput {
  const on = cfDate(raw.inspection_on, '完成確認の日');
  if (!on || on > shiftDate(today, 365) || on < shiftDate(today, -3650)) fail('完成確認の日を正しく入力してください');
  return { inspection_on: on as string, inspection_summary: cfText(raw.inspection_summary, 2000, '完成確認の内容') };
}

/** お客様の「気になる点」。1 行に 1 つ（空の行は除く）。DB の confirm_handover と同じ 1〜20 件・1 件 1000 文字 */
export function normalizeHandoverIssues(value: unknown): string[] {
  const lines = (typeof value === 'string' ? value.split(/\r?\n/) : Array.isArray(value) ? value : [])
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 20) fail('気になる点を 1〜20 件入力してください');
  if (lines.some((line) => line.length > 1000)) fail('気になる点は 1 件 1000 文字以内で入力してください');
  return lines;
}

export function normalizePunchDescription(value: unknown): string {
  const text = cfText(value, 1000, '是正事項');
  if (!text) fail('是正事項を 1000 文字以内で入力してください');
  return text as string;
}

/** 是正事項の状態の変更（DB の set_punch_item_status と同じ）。是正は担当、是正の確認はお客様か担当 */
export function canSetPunchItemStatus(access: CaseAccess, from: PunchItemStatus, to: PunchItemStatus): boolean {
  if (to === 'fixed') return (access === 'admin' || access === 'staff') && from === 'open';
  if (to === 'verified') return access !== 'manufacturer' && from === 'fixed';
  return false;
}

/** 承諾書の署名日（今日以前・完成確認の日の 1 年前以降）。DB の record_completion_certificate と同じ */
export function normalizeCertificateSignedOn(value: unknown, today: string, inspectionOn: string): string {
  const on = cfDate(value, '承諾書の署名日');
  if (!on || on > today || on < shiftDate(inspectionOn, -365)) fail('承諾書の署名日を正しく入力してください（今日以前）');
  return on as string;
}

/** 引渡し日（完成確認の日〜今日）。DB の complete_handover と同じ */
export function normalizeHandedOverOn(value: unknown, today: string, inspectionOn: string): string {
  const on = cfDate(value, '引渡し日');
  if (!on || on > today || on < inspectionOn) fail('引渡し日は完成確認の日から今日までの日付にしてください');
  return on as string;
}

// ---------- アフター（フェーズ15） ----------

export type AfterServiceKind = 'inspection' | 'inquiry' | 'repair';
export const AFTER_SERVICE_KIND_LABELS: Record<AfterServiceKind, string> = { inspection: '定期点検', inquiry: '問い合わせ', repair: '修理' };

export type AfterServiceStatus = 'open' | 'in_progress' | 'escalated' | 'resolved';
export const AFTER_SERVICE_STATUS_LABELS: Record<AfterServiceStatus, string> = {
  open: '受付',
  in_progress: '対応中',
  escalated: '製造の担当が対応中',
  resolved: '完了',
};

export interface AfterServiceRequest {
  id: string;
  quote_request_id: string;
  kind: AfterServiceKind;
  title: string;
  body: string | null;
  status: AfterServiceStatus;
  /** お客様への回答（お客様にも表示される） */
  response: string | null;
  requested_by: string;
  requested_by_customer: boolean;
  escalated_at: string | null;
  resolved_at: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
}

export interface AfterServiceRequestInput {
  kind: AfterServiceKind;
  title: string;
  body: string | null;
}

export function normalizeAfterServiceRequestInput(raw: Record<string, unknown>): AfterServiceRequestInput {
  const kind = cfText(raw.kind, 20, 'ご依頼の種類');
  if (!kind || !(kind in AFTER_SERVICE_KIND_LABELS)) fail('ご依頼の種類を選んでください');
  const title = cfText(raw.title, 100, '件名');
  if (!title) fail('件名を入力してください');
  return { kind: kind as AfterServiceKind, title: title as string, body: cfText(raw.body, 4000, '内容') };
}

export interface AfterServiceUpdateInput {
  status: AfterServiceStatus;
  /** undefined：回答を変えない／null：回答を消す */
  response?: string | null;
}

export function normalizeAfterServiceUpdateInput(raw: Record<string, unknown>, current: AfterServiceStatus): AfterServiceUpdateInput {
  const status = (cfText(raw.status, 20, '状態') ?? current) as AfterServiceStatus;
  if (!(status in AFTER_SERVICE_STATUS_LABELS)) fail('状態が正しくありません');
  const input: AfterServiceUpdateInput = { status };
  if ('response' in raw) input.response = cfText(raw.response, 2000, 'お客様への回答');
  return input;
}

/** アフターを更新できるか（DB の update_after_service_request と同じ）。総代理店は回されたものの回答と完了だけ */
export function canUpdateAfterService(access: CaseAccess, row: Pick<AfterServiceRequest, 'status' | 'escalated_at'>, to: AfterServiceStatus): boolean {
  if (access === 'customer') return false;
  if (access === 'manufacturer' && (!row.escalated_at || (to !== 'escalated' && to !== 'resolved'))) return false;
  return !(row.status === 'resolved' && to !== 'resolved');
}

// ---------- 災害時提供の意思（フェーズ15） ----------

export type DisasterDecision = 'accepted' | 'conditional' | 'declined';
export const DISASTER_DECISION_LABELS: Record<DisasterDecision, string> = {
  accepted: '承諾する',
  conditional: '条件付きで承諾する',
  declined: '承諾しない',
};

/** 承諾書の文面（先方が決めた文面を本部が登録する。登録されるまでお客様には表示しない） */
export interface DisasterConsentText {
  id: string;
  version: number;
  title: string;
  body: string;
  published_at: string;
}

export interface DisasterConsent {
  id: string;
  quote_request_id: string;
  user_id: string;
  text_id: string;
  decision: DisasterDecision;
  conditions: string | null;
  created_at: string;
}

export interface DisasterConsentInput {
  decision: DisasterDecision;
  conditions: string | null;
  /** 読んだ文面の版（最新の版と違えば DB が断る） */
  text_version: number;
}

export function normalizeDisasterConsentInput(raw: Record<string, unknown>): DisasterConsentInput {
  const decision = cfText(raw.decision, 20, '災害時提供の意思');
  if (!decision || !(decision in DISASTER_DECISION_LABELS)) fail('承諾・条件付き承諾・不承諾のいずれかを選んでください');
  const conditions = cfText(raw.conditions, 2000, '条件');
  if (decision === 'conditional' && !conditions) fail('条件を入力してください');
  const version = typeof raw.text_version === 'number' ? raw.text_version : Number(String(raw.text_version ?? '').trim());
  if (!Number.isInteger(version) || version < 1) fail('承諾書の文面を読み込み直してください');
  return { decision: decision as DisasterDecision, conditions: decision === 'conditional' ? conditions : null, text_version: version };
}

export function normalizeDisasterConsentTextInput(raw: Record<string, unknown>): { title: string; body: string } {
  const title = cfText(raw.title, 100, '見出し');
  if (!title) fail('見出しを 100 文字以内で入力してください');
  const body = cfText(raw.body, 20000, '文面');
  if (!body) fail('文面を 20000 文字以内で入力してください');
  return { title: title as string, body: body as string };
}

// ---------- 全国ストック台帳（フェーズ15・本部だけ） ----------

export type StockRegistrationStatus = 'registered' | 'suspended';
export const STOCK_REGISTRATION_STATUS_LABELS: Record<StockRegistrationStatus, string> = { registered: '登録中', suspended: '登録停止' };

export interface StockLedgerEntry {
  unit_id: string;
  quote_request_id: string;
  registration_status: StockRegistrationStatus;
  operating_status: string | null;
  last_inspection_on: string | null;
  immediate_available: boolean;
  transportable: boolean;
  supply_72h: boolean;
  supply_7d: boolean;
  location_prefecture: string | null;
  location_municipality: string | null;
  note: string | null;
  judged_by: string | null;
  judged_at: string;
  lock_version: number;
  updated_at: string;
}

export type StockLedgerEntryInput = Pick<
  StockLedgerEntry,
  | 'registration_status'
  | 'operating_status'
  | 'last_inspection_on'
  | 'immediate_available'
  | 'transportable'
  | 'supply_72h'
  | 'supply_7d'
  | 'location_prefecture'
  | 'location_municipality'
  | 'note'
>;

export function normalizeStockLedgerEntryInput(raw: Record<string, unknown>, today: string): StockLedgerEntryInput {
  const status = cfText(raw.registration_status, 20, '登録状態') ?? 'registered';
  if (!(status in STOCK_REGISTRATION_STATUS_LABELS)) fail('登録状態が正しくありません');
  const inspected = cfDate(raw.last_inspection_on, '最終点検日');
  if (inspected && inspected > today) fail('最終点検日は今日以前の日付にしてください');
  return {
    registration_status: status as StockRegistrationStatus,
    operating_status: cfText(raw.operating_status, 200, '稼働状況'),
    last_inspection_on: inspected,
    immediate_available: raw.immediate_available === true,
    transportable: raw.transportable === true,
    supply_72h: raw.supply_72h === true,
    supply_7d: raw.supply_7d === true,
    location_prefecture: cfText(raw.location_prefecture, 10, '所在地（都道府県）'),
    location_municipality: cfText(raw.location_municipality, 60, '所在地（市区町村）'),
    note: cfText(raw.note, 1000, 'メモ'),
  };
}

/** 台帳に「登録中」として載せられるか。お客様の最新の意思が承諾か条件付き承諾のときだけ */
export function canRegisterStock(latestDecision: DisasterDecision | null): boolean {
  return latestDecision === 'accepted' || latestDecision === 'conditional';
}

// ---------- 一時保存（フェーズ2：ログインなし） ----------

/** 一時保存の有効期間（日）。DB の guest_plans.expires_at の既定と同じ */
export const GUEST_PLAN_DAYS = 30;
/** 一時保存の URL の鍵（24 バイトの base64url） */
export const GUEST_PLAN_TOKEN = /^[A-Za-z0-9_-]{32}$/;

export type GuestPlanFace = 'front' | 'right' | 'back' | 'left';

/** 一時保存する仕様の選択（価格・お客様の情報は持たない）。DB の create_guest_plan と同じ形 */
export interface GuestPlanInput {
  name: string;
  option_ids: string[];
  variant_choice_ids: string[];
  exterior_faces: { face_code: GuestPlanFace; option_id: string; variant_choice_ids: string[] }[];
  finish_level: 'shell' | 'equipment' | 'full';
  spec_code: string | null;
  site_prefecture: string | null;
  site_municipality: string | null;
  site_location_undecided: boolean;
}

export interface GuestPlan {
  base_model_id: string;
  plan: GuestPlanInput;
  expires_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuidList(value: unknown, max: number, label: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label}の形式が正しくありません`);
  const out: string[] = [];
  for (const item of value as unknown[]) {
    const id = typeof item === 'string' ? item.toLowerCase() : '';
    if (!UUID_PATTERN.test(id)) fail(`${label}の形式が正しくありません`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function normalizeGuestPlanInput(raw: Record<string, unknown>): GuestPlanInput {
  const facesRaw = raw.exterior_faces ?? [];
  if (!Array.isArray(facesRaw) || facesRaw.length > 4) fail('外壁の選択の形式が正しくありません');
  const exterior_faces = (facesRaw as Array<Record<string, unknown>>).map((face) => {
    const code = typeof face?.face_code === 'string' ? face.face_code : '';
    if (!['front', 'right', 'back', 'left'].includes(code)) fail('外壁の選択の形式が正しくありません');
    const [optionId] = uuidList([face?.option_id], 1, '外壁の選択');
    return { face_code: code as GuestPlanFace, option_id: optionId, variant_choice_ids: uuidList(face?.variant_choice_ids, 20, '外壁の選択') };
  });
  const finish = typeof raw.finish_level === 'string' ? raw.finish_level : 'full';
  if (!['shell', 'equipment', 'full'].includes(finish)) fail('仕上げの形式が正しくありません');
  const spec = cfText(raw.spec_code, 40, '仕様');
  if (spec && !/^[a-z0-9_-]+$/.test(spec)) fail('仕様の形式が正しくありません');
  return {
    name: cfText(raw.name, 60, 'プランの名前') ?? '',
    option_ids: uuidList(raw.option_ids, 300, '選んだ商品'),
    variant_choice_ids: uuidList(raw.variant_choice_ids, 300, '選んだ色・柄'),
    exterior_faces,
    finish_level: finish as GuestPlanInput['finish_level'],
    spec_code: spec,
    site_prefecture: cfText(raw.site_prefecture, 10, '設置予定地（都道府県）'),
    site_municipality: cfText(raw.site_municipality, 60, '設置予定地（市区町村）'),
    site_location_undecided: raw.site_location_undecided === true,
  };
}

// ---------- 設置予定地・土地（フェーズ3） ----------

export type LandStatus = 'owned' | 'none' | 'undecided';
export const LAND_STATUS_LABELS: Record<LandStatus, string> = { owned: '土地あり', none: '土地なし（これから探す）', undecided: '未定' };

export type LandCategory = 'residential' | 'farmland' | 'forest' | 'miscellaneous' | 'other' | 'unknown';
export const LAND_CATEGORY_LABELS: Record<LandCategory, string> = {
  residential: '宅地',
  farmland: '田・畑（農地）',
  forest: '山林',
  miscellaneous: '雑種地',
  other: 'その他',
  unknown: '分からない',
};

export type RoadAccess = 'wide' | 'narrow' | 'none' | 'unknown';
export const ROAD_ACCESS_LABELS: Record<RoadAccess, string> = {
  wide: '幅 4m 以上の道路に接している',
  narrow: '幅 4m 未満の道路に接している',
  none: '道路に接していない',
  unknown: '分からない',
};

export type UtilityStatus = 'available' | 'unavailable' | 'unknown';
export const UTILITY_STATUS_LABELS: Record<UtilityStatus, string> = { available: '引込みあり', unavailable: 'なし', unknown: '分からない' };
export const SITE_UTILITY_FIELDS = [
  { key: 'electricity', label: '電気' },
  { key: 'water', label: '上水道' },
  { key: 'drainage', label: '排水（下水・浄化槽）' },
] as const;

export type IntendedUse = 'residence' | 'villa' | 'office' | 'lodging' | 'store' | 'warehouse' | 'other';
export const INTENDED_USE_LABELS: Record<IntendedUse, string> = {
  residence: '住まい',
  villa: '別荘・セカンドハウス',
  office: '事務所',
  lodging: '宿泊施設（ホテル・民泊）',
  store: '店舗',
  warehouse: '倉庫・作業場',
  other: 'その他',
};

export type LandBudget = 'under_3m' | '3m_5m' | '5m_10m' | '10m_20m' | 'over_20m' | 'undecided';
export const LAND_BUDGET_LABELS: Record<LandBudget, string> = {
  under_3m: '300万円未満',
  '3m_5m': '300〜500万円',
  '5m_10m': '500〜1,000万円',
  '10m_20m': '1,000〜2,000万円',
  over_20m: '2,000万円以上',
  undecided: '未定',
};

/** 保存したプランごとの設置予定地・土地（お客様の申告）。DB の configuration_site_profiles と同じ */
export interface SiteProfile {
  configuration_id: string;
  land_status: LandStatus;
  site_address: string | null;
  area_sqm: number | null;
  land_category: LandCategory | null;
  road_access: RoadAccess | null;
  electricity: UtilityStatus | null;
  water: UtilityStatus | null;
  drainage: UtilityStatus | null;
  desired_area: string | null;
  intended_use: IntendedUse | null;
  land_budget: LandBudget | null;
  note: string | null;
  lock_version: number;
  updated_at: string;
}

export type SiteProfileInput = Omit<SiteProfile, 'configuration_id' | 'lock_version' | 'updated_at'>;

function pick<T extends string>(value: unknown, labels: Record<T, string>, label: string): T | null {
  const text = cfText(value, 20, label);
  if (!text) return null;
  if (!(text in labels)) fail(`${label}の選択が正しくありません`);
  return text as T;
}

/** 全角の数字・カンマを直してから、㎡の数値にする（小数は 2 桁まで） */
function areaOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value)
    .trim()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/[,，]/g, '');
  if (!text) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) fail('敷地面積は数字（㎡・小数は 2 桁まで）で入力してください');
  const area = Number(text);
  if (area <= 0 || area > 1_000_000) fail('敷地面積を正しく入力してください');
  return area;
}

/** 土地の有無で入力する項目が変わる：土地あり → 設置予定地、土地なし・未定 → 希望地域・用途・予算。DB の save_configuration_site_profile と同じ */
export function normalizeSiteProfileInput(raw: Record<string, unknown>): SiteProfileInput {
  const status = pick(raw.land_status, LAND_STATUS_LABELS, '土地の有無');
  if (!status) fail('土地の有無を選んでください');
  const owned = status === 'owned';
  return {
    land_status: status as LandStatus,
    site_address: owned ? cfText(raw.site_address, 200, '設置予定地') : null,
    area_sqm: owned ? areaOf(raw.area_sqm) : null,
    land_category: owned ? pick(raw.land_category, LAND_CATEGORY_LABELS, '地目') : null,
    road_access: owned ? pick(raw.road_access, ROAD_ACCESS_LABELS, '前面道路') : null,
    electricity: owned ? pick(raw.electricity, UTILITY_STATUS_LABELS, '電気') : null,
    water: owned ? pick(raw.water, UTILITY_STATUS_LABELS, '上水道') : null,
    drainage: owned ? pick(raw.drainage, UTILITY_STATUS_LABELS, '排水') : null,
    desired_area: owned ? null : cfText(raw.desired_area, 200, '希望地域'),
    intended_use: owned ? null : pick(raw.intended_use, INTENDED_USE_LABELS, '希望用途'),
    land_budget: owned ? null : pick(raw.land_budget, LAND_BUDGET_LABELS, '土地のご予算'),
    note: cfText(raw.note, 1000, '土地についてのメモ'),
  };
}

/** 画面に出す要約（担当の案件画面・お客様の画面で同じ表示にする） */
export function siteProfileSummary(profile: Pick<SiteProfile, Exclude<keyof SiteProfile, 'configuration_id' | 'lock_version' | 'updated_at'>>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [{ label: '土地', value: LAND_STATUS_LABELS[profile.land_status] }];
  const add = (label: string, value: string | null | undefined) => {
    if (value) rows.push({ label, value });
  };
  if (profile.land_status === 'owned') {
    add('設置予定地', profile.site_address);
    add('敷地面積', profile.area_sqm !== null ? `約 ${profile.area_sqm.toLocaleString('ja-JP')}㎡（約 ${Math.round(profile.area_sqm / 3.30578).toLocaleString('ja-JP')}坪）` : null);
    add('地目', profile.land_category ? LAND_CATEGORY_LABELS[profile.land_category] : null);
    add('前面道路', profile.road_access ? ROAD_ACCESS_LABELS[profile.road_access] : null);
    for (const { key, label } of SITE_UTILITY_FIELDS) add(label, profile[key] ? UTILITY_STATUS_LABELS[profile[key] as UtilityStatus] : null);
  } else {
    add('希望地域', profile.desired_area);
    add('希望用途', profile.intended_use ? INTENDED_USE_LABELS[profile.intended_use] : null);
    add('土地のご予算', profile.land_budget ? LAND_BUDGET_LABELS[profile.land_budget] : null);
  }
  add('メモ', profile.note);
  return rows;
}

// ---------- 案件の写真・書類 ----------

export type CaseFileContext ='site_survey' | 'progress' | 'handover' | 'punch' | 'after_service' | 'contract' | 'document';
export const CASE_FILE_CONTEXT_LABELS: Record<CaseFileContext, string> = {
  site_survey: '現地確認',
  progress: '工程・施工',
  handover: '完了確認・引渡し',
  punch: '指摘事項',
  after_service: 'アフター',
  contract: '契約書',
  document: '案件資料',
};

export const CASE_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CASE_FILE_TYPES: Record<string, 'jpg' | 'png' | 'webp' | 'pdf'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface CaseFile {
  id: string;
  quote_request_id: string;
  context: CaseFileContext;
  context_id: string | null;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  caption: string | null;
  customer_visible: boolean;
  uploaded_by: string;
  created_at: string;
}

export interface CaseFileInput {
  context: CaseFileContext;
  context_id: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  caption: string | null;
  customer_visible: boolean;
}

/** 誰がどの資料を登録できるか（DB の register_case_file と同じ） */
export function canRegisterCaseFile(access: CaseAccess, context: CaseFileContext): boolean {
  switch (context) {
    case 'site_survey':
    case 'handover':
      return access === 'admin' || access === 'staff';
    case 'progress':
      return access === 'admin' || access === 'staff' || access === 'manufacturer';
    case 'document':
    case 'punch':
    case 'after_service':
      return access === 'admin' || access === 'staff' || access === 'customer';
    case 'contract':
      return access === 'admin';
  }
}

export function normalizeCaseFileInput(raw: Record<string, unknown>): CaseFileInput {
  const context = cfText(raw.context, 20, '資料の種類');
  if (!context || !(context in CASE_FILE_CONTEXT_LABELS)) fail('資料の種類が正しくありません');
  const contextId = cfText(raw.context_id, 36, '資料の紐付け先');
  if (contextId && !/^[0-9a-f-]{36}$/i.test(contextId)) fail('資料の紐付け先が正しくありません');
  const contentType = cfText(raw.content_type, 40, 'ファイルの種類');
  if (!contentType || !CASE_FILE_TYPES[contentType]) fail('登録できるのは JPEG・PNG・WebP の画像と PDF だけです');
  const size = raw.size_bytes;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > CASE_FILE_MAX_BYTES) fail('ファイルは 20MB 以下にしてください');
  const fileName = cfText(raw.file_name, 200, 'ファイル名');
  if (!fileName) fail('ファイル名がありません');
  return {
    context: context as CaseFileContext,
    context_id: contextId,
    file_name: fileName as string,
    content_type: contentType as string,
    size_bytes: size as number,
    caption: cfText(raw.caption, 200, '説明'),
    customer_visible: raw.customer_visible === true,
  };
}
