import type {
  CaseAppointment,
  CaseFile,
  CaseNote,
  CaseWorkflow,
  DealerProfile,
  QuoteRequestPreferences,
  SiteSurvey,
} from '@/lib/domain/case-flow';

/** ローカル検証モードの JSON DB（.wing-local/db.json）の caseFlow。DB の 20261013220000 の表に対応する */
export interface LocalCaseFlowTables {
  dealerProfiles: DealerProfile[];
  preferences: QuoteRequestPreferences[];
  workflows: CaseWorkflow[];
  appointments: CaseAppointment[];
  siteSurveys: SiteSurvey[];
  notes: CaseNote[];
  files: CaseFile[];
}

export function emptyCaseFlowTables(): LocalCaseFlowTables {
  return { dealerProfiles: [], preferences: [], workflows: [], appointments: [], siteSurveys: [], notes: [], files: [] };
}
