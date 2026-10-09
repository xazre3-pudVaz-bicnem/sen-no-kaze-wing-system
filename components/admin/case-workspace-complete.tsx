import { CaseWorkspace as BaseCaseWorkspace } from '@/components/admin/case-workspace';
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

function ProductionWorkflowMock({ revision, unitCount }: { revision: number; unitCount: string | null }) {
  const steps = ['製造予定', '出荷', '搬入', '基礎', '設置', '電気', '給排水'];

  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-production-workflow-mock">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">製造依頼・工程進捗</h3>
            <MockBadge />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            製造依頼から施工完了までの完成形表示です。個体番号・工程状態・日程・写真はまだ正式保存しません。
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          ['製造依頼', '未登録'],
          ['対象Revision', `未固定（参照 第${revision}版）`],
          ['棟数', unitCount ?? '未登録'],
          ['個体番号', '未発行'],
          ['製造担当', '未登録'],
          ['製造予定', '未登録'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-[#fbfcfb] p-3">
            <p className="text-xs font-semibold text-muted">{label}</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">工程</h4>
          <span className="text-[0.65rem] text-muted">すべて未判定・未保存</span>
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-[48rem] items-stretch gap-1.5">
            {steps.map((step, index) => (
              <div key={step} className="flex min-w-0 flex-1 items-center">
                <div className="min-w-0 flex-1 rounded-lg border border-line bg-[#f7f8f8] px-2 py-2 text-center">
                  <p className="text-xs font-semibold text-ink">{step}</p>
                  <p className="mt-1 text-[0.62rem] text-muted">未記録</p>
                </div>
                {index < steps.length - 1 && <span className="w-4 shrink-0 text-center text-muted">→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-line bg-[#fbfcfb] p-4">
          <p className="text-sm font-semibold">工程写真</p>
          <p className="mt-1 text-xs leading-5 text-muted">製造・出荷・搬入・基礎・設置・設備工事の写真を工程ごとに並べる想定です。</p>
          <div className="mt-3 grid grid-cols-3 gap-2" aria-label="工程写真の表示イメージ">
            {[1, 2, 3].map((value) => (
              <div key={value} className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-line bg-white text-[0.62rem] text-muted">
                写真{value}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-[#e6d8a8] bg-[#fffaf0] p-4">
          <p className="text-sm font-semibold text-[#765d1f]">正式実装時の停止条件</p>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            製造依頼、個体番号、工程状態、担当、日程、写真の正式保存・完了判定は製造・工程DBが必要です。このモックからは更新しません。
          </p>
        </div>
      </div>
    </section>
  );
}

function HandoverCorrectionMock() {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-handover-correction-mock">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">是正・引渡し前確認</h3>
        <MockBadge />
      </div>
      <p className="text-xs leading-5 text-muted">
        完了確認で見つかった是正事項を、担当・期限・写真・完了確認と合わせて管理する完成形イメージです。
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['是正事項', '未記録'],
          ['担当・期限', '未記録'],
          ['是正写真', '未登録'],
          ['是正完了確認', '未判定'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-[#fbfcfb] p-3">
            <p className="text-xs font-semibold text-muted">{label}</p>
            <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>
      <p className="rounded-lg bg-[#f7f8f8] px-3 py-2 text-xs leading-5 text-muted">
        引渡し日・引渡し確認・保証・点検・修理・問い合わせは上の「引渡し・アフター」完成形表示と連動する想定ですが、現在は正式DBを作らないため保存しません。
      </p>
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

  return (
    <>
      <BaseCaseWorkspace {...props} />
      {quoteReference && activeTab === 'documents' && (
        <div className="mt-2">
          <ContractHistoryMock
            quoteNo={quoteReference.quoteNo}
            revision={quoteReference.revision}
            total={quoteReference.total}
          />
        </div>
      )}
      {quoteReference && activeTab === 'production' && (
        <div className="mt-2">
          <ProductionWorkflowMock revision={quoteReference.revision} unitCount={quoteReference.unitCount} />
        </div>
      )}
      {quoteReference && activeTab === 'handover' && (
        <div className="mt-2">
          <HandoverCorrectionMock />
        </div>
      )}
    </>
  );
}
