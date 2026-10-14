/**
 * 案件の進行（フローチャート第4版 フェーズ4〜7）の型・表示名・入力の検査。
 * 入力の検査は DB（20261013220000_case_flow_intake_site.sql）の RPC と同じ規則にする（正本は DB）。
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

// ---------- 案件の写真・書類 ----------

export type CaseFileContext = 'site_survey' | 'progress' | 'handover' | 'punch' | 'after_service' | 'contract' | 'document';
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
