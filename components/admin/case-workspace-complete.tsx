import { CaseWorkspace as BaseCaseWorkspace } from '@/components/admin/case-workspace';
import { ElectronicContractPanel } from '@/components/admin/electronic-contract-panel';
import { CaseSitePanels } from '@/components/case-flow/case-site-panels';
import { CaseChangeRequestsPanel, PaperContractPanel } from '@/components/case-flow/case-contract-panels';
import { CaseProductionPanels } from '@/components/case-flow/case-production-panels';
import { CaseDisasterPanel, CaseHandoverPanels } from '@/components/case-flow/case-handover-panels';
import { getStore, type SessionUser } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';

const POST_CONTRACT_TABS = new Set(['documents', 'production', 'handover']);

function extractCaseUnitCount(note: string | null) {
  const match = note?.match(/([0-9]+)\s*(台|棟)/);
  return match ? `${match[1]}${match[2]}` : null;
}

type CaseWorkspaceProps = {
  quoteId: string;
  actor: SessionUser;
  tab?: string;
  created?: string;
  revised?: string;
  from?: string;
  edit?: string;
  settings?: string;
  embedded?: boolean;
  listSearchParams?: Record<string, string | undefined>;
  /** 案件の進行の操作結果（?done= / ?error=） */
  flash?: { done?: string; error?: string };
};

function MockBadge() {
  return (
    <span className="rounded-full border border-[#e4d29c] bg-[#fff8df] px-2 py-0.5 text-[0.62rem] font-semibold text-[#765b11]">
      UIモック・保存なし
    </span>
  );
}

function ContractHistoryMock({ quoteNo, revision, total }: { quoteNo: string; revision: number; total: number }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-contract-history-mock">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">契約確定・変更履歴</h3>
            <MockBadge />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            完成形では契約対象Revision・契約金額・契約変更をここで追跡します。現在は正式な契約状態を保存・判定しません。
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-line bg-[#fbfcfb] p-3">
          <p className="text-xs font-semibold text-muted">契約対象Revision</p>
          <p className="mt-1 text-sm font-semibold text-ink">未固定</p>
          <p className="mt-1 text-[0.65rem] text-muted">参照中：{quoteNo} 第{revision}版</p>
        </div>
        <div className="rounded-lg border border-line bg-[#fbfcfb] p-3">
          <p className="text-xs font-semibold text-muted">契約金額</p>
          <p className="mt-1 text-sm font-semibold text-ink">未固定</p>
          <p className="mt-1 text-[0.65rem] text-muted">現在の見積額 {formatYen(total)} は参考値</p>
        </div>
        <div className="rounded-lg border border-line bg-[#fbfcfb] p-3">
          <p className="text-xs font-semibold text-muted">契約変更</p>
          <p className="mt-1 text-sm font-semibold text-ink">正式DB待ち</p>
          <p className="mt-1 text-[0.65rem] text-muted">変更時は元契約を書き換えず履歴として管理する想定</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[42rem] text-left text-xs">
          <thead className="bg-[#f7f8f8] text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">変更日</th>
              <th className="px-3 py-2 font-semibold">対象Revision</th>
              <th className="px-3 py-2 font-semibold">変更内容</th>
              <th className="px-3 py-2 font-semibold">契約書・合意資料</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td colSpan={4} className="px-3 py-4 text-center text-muted">
                契約変更履歴は未保存です。正式な契約DB・Revision固定の実装後に記録します。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export async function CaseWorkspace(props: CaseWorkspaceProps) {
  const activeTab = props.tab ?? 'estimate';
  let quoteReference: { quoteNo: string; revision: number; total: number; unitCount: string | null } | null = null;

  if (POST_CONTRACT_TABS.has(activeTab)) {
    const store = await getStore();
    const detail = await store.getQuote(props.quoteId, props.actor);
    if (detail) {
      quoteReference = {
        quoteNo: detail.quote.quote_no,
        revision: detail.quote.revision,
        total: detail.quote.total,
        unitCount: extractCaseUnitCount(detail.quote.dealer_note?.trim() || null),
      };
    }
  }

  const { flash, ...baseProps } = props;
  return (
    <>
      <BaseCaseWorkspace {...baseProps} />
      {activeTab === 'estimate' && (
        // お客様からの見積の修正依頼（フェーズ9）。依頼があるときだけ表示する
        <CaseChangeRequestsPanel quoteId={props.quoteId} actor={props.actor} flash={flash} />
      )}
      {activeTab === 'site' && (
        // 受付・担当・日程・現地確認・技術検討（フェーズ5〜7）。上の「正式登録候補」は案件資料からの参考表示
        <CaseSitePanels quoteId={props.quoteId} actor={props.actor} flash={flash} />
      )}
      {quoteReference && activeTab === 'documents' && (
        <div className="mt-2 space-y-2">
          {/* 電子契約（GMOサイン）と書面の契約は正式な保存・判定を行う。下の契約変更履歴はモックのまま */}
          <ElectronicContractPanel quoteId={props.quoteId} actor={props.actor} />
          <PaperContractPanel quoteId={props.quoteId} actor={props.actor} flash={flash} />
          <ContractHistoryMock
            quoteNo={quoteReference.quoteNo}
            revision={quoteReference.revision}
            total={quoteReference.total}
          />
        </div>
      )}
      {activeTab === 'production' && (
        // 製造依頼と個体・工程表・施工の記録と写真（フェーズ11〜13）
        <CaseProductionPanels quoteId={props.quoteId} actor={props.actor} flash={flash} />
      )}
      {activeTab === 'handover' && (
        // 完成確認・是正・工事完了承諾書・引渡し（フェーズ14）とアフター（フェーズ15）
        <CaseHandoverPanels quoteId={props.quoteId} actor={props.actor} flash={flash} />
      )}
      {activeTab === 'disaster' && (
        // お客様の災害時提供の意思と、本部の全国ストック台帳の判定（フェーズ15）
        <CaseDisasterPanel quoteId={props.quoteId} actor={props.actor} />
      )}
    </>
  );
}
