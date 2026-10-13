import type {
  CaseAppointment,
  CaseFile,
  CaseNote,
  CaseProgressReport,
  CaseScheduleItem,
  CaseWorkflow,
  DealerProfile,
  ManufacturingOrder,
  ManufacturingUnit,
  QuoteChangeRequest,
  QuoteRequestPreferences,
  SiteSurvey,
} from '@/lib/domain/case-flow';

/** ローカル検証モードの JSON DB（.wing-local/db.json）の caseFlow。DB の 20261013220000 以降の表に対応する */
export interface LocalCaseFlowTables {
  dealerProfiles: DealerProfile[];
  preferences: QuoteRequestPreferences[];
  workflows: CaseWorkflow[];
  appointments: CaseAppointment[];
  siteSurveys: SiteSurvey[];
  notes: CaseNote[];
  files: CaseFile[];
  /** 見積の修正依頼（20261013230000） */
  changeRequests?: QuoteChangeRequest[];
  /** 製造依頼・個体・工程表・施工の記録（20261013234000） */
  orders?: ManufacturingOrder[];
  units?: ManufacturingUnit[];
  scheduleItems?: CaseScheduleItem[];
  progressReports?: CaseProgressReport[];
}

export function emptyCaseFlowTables(): LocalCaseFlowTables {
  return {
    dealerProfiles: [],
    preferences: [],
    workflows: [],
    appointments: [],
    siteSurveys: [],
    notes: [],
    files: [],
    changeRequests: [],
    orders: [],
    units: [],
    scheduleItems: [],
    progressReports: [],
  };
}
