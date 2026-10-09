'use client';

import { useMemo, useState } from 'react';
import { formatBaseMasterRevision } from '@/lib/domain/base-master-ui';
import { formatYen } from '@/lib/domain/pricing';

type SampleRevisionStatus = 'published' | 'draft' | 'historical';
type FireSpec = 'non-fire' | 'fire';

type SampleLine = {
  id: string;
  section: string;
  name: string;
  quantity: number;
  unit: string;
  unitCost: number;
  note: string;
};

type SampleRevision = {
  revision: number;
  status: SampleRevisionStatus;
  label: string;
};

type SampleBaseMaster = {
  id: string;
  model: string;
  purpose: string;
  size: string;
  fireSpec: FireSpec;
  revision: number;
  status: SampleRevisionStatus;
  totalCost: number;
  lines: SampleLine[];
  history: SampleRevision[];
};

type MatrixItem =
  | 'roofExterior'
  | 'interior'
  | 'entranceDoor'
  | 'sash'
  | 'bath'
  | 'kitchen'
  | 'washbasin'
  | 'toilet'
  | 'boiler'
  | 'entranceStorage'
  | 'interiorDoor'
  | 'closet'
  | 'bed'
  | 'furnishings'
  | 'other';

type MatrixRow = {
  id: string;
  model: string;
  purpose: string;
  size: string;
  fireSelectable: boolean;
  availability: Record<MatrixItem, boolean>;
};

const SAMPLE_BASE_MASTERS: SampleBaseMaster[] = [
  {
    id: 'wing-hotel-3640-4550-nonfire',
    model: 'Wing',
    purpose: 'ホテル仕様',
    size: '3,640×4,550',
    fireSpec: 'non-fire',
    revision: 3,
    status: 'published',
    totalCost: 1654620,
    history: [
      { revision: 3, status: 'published', label: '現在の公開版' },
      { revision: 2, status: 'historical', label: '過去の公開版' },
      { revision: 1, status: 'historical', label: '過去の公開版' },
    ],
    lines: [
      { id: 'w-h-1', section: '1．金物', name: '伸縮脚・ジャッキ金物', quantity: 12, unit: '本', unitCost: 18200, note: '本体支持用' },
      { id: 'w-h-2', section: '1．金物', name: '折り畳み部 大型丁番', quantity: 12, unit: '枚', unitCost: 4150, note: '' },
      { id: 'w-h-3', section: '2．木材・構造材', name: '構造材・プレカット材', quantity: 1, unit: '式', unitCost: 548600, note: '本体フレーム' },
      { id: 'w-h-4', section: '2．木材・構造材', name: '床・天井根太材', quantity: 1, unit: '式', unitCost: 188400, note: '' },
      { id: 'w-h-5', section: '3．構造用／外部面材', name: '構造用面材', quantity: 1, unit: '式', unitCost: 214500, note: '外周構造面' },
      { id: 'w-h-6', section: '4．断熱材', name: '床・壁・天井 断熱材', quantity: 1, unit: '式', unitCost: 196420, note: '' },
      { id: 'w-h-7', section: '5．組立', name: '本体組立費', quantity: 5, unit: '人', unitCost: 47700, note: '工場組立' },
    ],
  },
  {
    id: 'wing-residence-3640-4550-fire',
    model: 'Wing',
    purpose: '住居仕様',
    size: '3,640×4,550',
    fireSpec: 'fire',
    revision: 2,
    status: 'published',
    totalCost: 1811060,
    history: [
      { revision: 2, status: 'published', label: '現在の公開版' },
      { revision: 1, status: 'historical', label: '過去の公開版' },
    ],
    lines: [
      { id: 'w-r-1', section: '1．金物', name: '伸縮脚・ジャッキ金物', quantity: 12, unit: '本', unitCost: 18200, note: '本体支持用' },
      { id: 'w-r-2', section: '1．金物', name: '折り畳み部 大型丁番', quantity: 12, unit: '枚', unitCost: 4150, note: '' },
      { id: 'w-r-3', section: '2．木材・構造材', name: '構造材・プレカット材', quantity: 1, unit: '式', unitCost: 592000, note: '防火仕様用構成を含む' },
      { id: 'w-r-4', section: '3．構造用／外部面材', name: '構造用・外部面材', quantity: 1, unit: '式', unitCost: 302600, note: '本体構造基準' },
      { id: 'w-r-5', section: '4．断熱材', name: '床・壁・天井 断熱材', quantity: 1, unit: '式', unitCost: 216160, note: '' },
      { id: 'w-r-6', section: '5．組立', name: '本体組立費', quantity: 6, unit: '人', unitCost: 55600, note: '工場組立' },
      { id: 'w-r-7', section: '6．その他直接構造原価', name: '防火仕様構造副資材', quantity: 1, unit: '式', unitCost: 98500, note: '' },
    ],
  },
  {
    id: 'box-hotel-2100-4550-nonfire',
    model: 'BOX',
    purpose: 'ホテル仕様',
    size: '2,100×4,550',
    fireSpec: 'non-fire',
    revision: 1,
    status: 'draft',
    totalCost: 1289740,
    history: [{ revision: 1, status: 'draft', label: '下書き' }],
    lines: [
      { id: 'b-h-1', section: '1．金物', name: '本体接合金物', quantity: 1, unit: '式', unitCost: 158400, note: '' },
      { id: 'b-h-2', section: '2．木材・構造材', name: '構造材・プレカット材', quantity: 1, unit: '式', unitCost: 472000, note: 'BOX本体フレーム' },
      { id: 'b-h-3', section: '3．構造用／外部面材', name: '構造用面材', quantity: 1, unit: '式', unitCost: 176900, note: '' },
      { id: 'b-h-4', section: '4．断熱材', name: '床・壁・天井 断熱材', quantity: 1, unit: '式', unitCost: 163240, note: '' },
      { id: 'b-h-5', section: '5．組立', name: '本体組立費', quantity: 4, unit: '人', unitCost: 79800, note: '工場組立' },
    ],
  },
  {
    id: 'wing-office-3640-4550-nonfire-history',
    model: 'Wing',
    purpose: '事務所仕様',
    size: '3,640×4,550',
    fireSpec: 'non-fire',
    revision: 1,
    status: 'historical',
    totalCost: 1539600,
    history: [{ revision: 1, status: 'historical', label: '過去の公開版' }],
    lines: [
      { id: 'w-o-1', section: '1．金物', name: '伸縮脚・本体金物', quantity: 1, unit: '式', unitCost: 278400, note: '' },
      { id: 'w-o-2', section: '2．木材・構造材', name: '構造材・プレカット材', quantity: 1, unit: '式', unitCost: 536000, note: '' },
      { id: 'w-o-3', section: '3．構造用／外部面材', name: '構造用面材', quantity: 1, unit: '式', unitCost: 206400, note: '' },
      { id: 'w-o-4', section: '4．断熱材', name: '断熱材', quantity: 1, unit: '式', unitCost: 191200, note: '' },
      { id: 'w-o-5', section: '5．組立', name: '本体組立費', quantity: 1, unit: '式', unitCost: 327600, note: '' },
    ],
  },
];

const MATRIX_ITEMS: Array<{ key: MatrixItem; label: string }> = [
  { key: 'roofExterior', label: '屋根・外壁' },
  { key: 'interior', label: '内装' },
  { key: 'entranceDoor', label: '玄関ドア' },
  { key: 'sash', label: 'サッシ' },
  { key: 'bath', label: 'UB / シャワー' },
  { key: 'kitchen', label: 'キッチン' },
  { key: 'washbasin', label: '洗面' },
  { key: 'toilet', label: 'トイレ' },
  { key: 'boiler', label: '給湯器' },
  { key: 'entranceStorage', label: '玄関収納' },
  { key: 'interiorDoor', label: '室内建具' },
  { key: 'closet', label: 'クローゼット' },
  { key: 'bed', label: 'ベッド' },
  { key: 'furnishings', label: '備品' },
  { key: 'other', label: 'その他' },
];

const INITIAL_MATRIX_ROWS: MatrixRow[] = [
  {
    id: 'matrix-wing-hotel',
    model: 'Wing',
    purpose: 'ホテル仕様',
    size: '3,640×4,550',
    fireSelectable: true,
    availability: {
      roofExterior: true,
      interior: true,
      entranceDoor: true,
      sash: true,
      bath: true,
      kitchen: false,
      washbasin: true,
      toilet: true,
      boiler: true,
      entranceStorage: true,
      interiorDoor: true,
      closet: false,
      bed: true,
      furnishings: true,
      other: true,
    },
  },
  {
    id: 'matrix-wing-residence',
    model: 'Wing',
    purpose: '住居仕様',
    size: '3,640×4,550',
    fireSelectable: true,
    availability: {
      roofExterior: true,
      interior: true,
      entranceDoor: true,
      sash: true,
      bath: true,
      kitchen: true,
      washbasin: true,
      toilet: true,
      boiler: true,
      entranceStorage: true,
      interiorDoor: true,
      closet: false,
      bed: true,
      furnishings: true,
      other: true,
    },
  },
  {
    id: 'matrix-wing-office',
    model: 'Wing',
    purpose: '事務所仕様',
    size: '3,640×4,550',
    fireSelectable: true,
    availability: {
      roofExterior: true,
      interior: true,
      entranceDoor: true,
      sash: true,
      bath: true,
      kitchen: true,
      washbasin: false,
      toilet: true,
      boiler: true,
      entranceStorage: false,
      interiorDoor: false,
      closet: false,
      bed: false,
      furnishings: true,
      other: true,
    },
  },
  {
    id: 'matrix-box-hotel',
    model: 'BOX',
    purpose: 'ホテル仕様',
    size: '2,100×4,550',
    fireSelectable: true,
    availability: {
      roofExterior: true,
      interior: true,
      entranceDoor: true,
      sash: true,
      bath: true,
      kitchen: false,
      washbasin: true,
      toilet: true,
      boiler: true,
      entranceStorage: true,
      interiorDoor: true,
      closet: false,
      bed: true,
      furnishings: true,
      other: true,
    },
  },
  {
    id: 'matrix-box-water-kit',
    model: 'BOX',
    purpose: '水回りBOX',
    size: '2,100×4,550',
    fireSelectable: true,
    availability: {
      roofExterior: true,
      interior: true,
      entranceDoor: true,
      sash: true,
      bath: true,
      kitchen: true,
      washbasin: true,
      toilet: true,
      boiler: true,
      entranceStorage: false,
      interiorDoor: false,
      closet: false,
      bed: false,
      furnishings: false,
      other: false,
    },
  },
  {
    id: 'matrix-flat-office',
    model: 'Flat',
    purpose: '事務所用',
    size: '2,100×4,550',
    fireSelectable: false,
    availability: {
      roofExterior: true,
      interior: true,
      entranceDoor: true,
      sash: true,
      bath: false,
      kitchen: false,
      washbasin: false,
      toilet: false,
      boiler: false,
      entranceStorage: false,
      interiorDoor: false,
      closet: false,
      bed: false,
      furnishings: false,
      other: false,
    },
  },
];

const cloneMatrixRows = (rows: MatrixRow[]) => rows.map((row) => ({
  ...row,
  availability: { ...row.availability },
}));

const statusLabel = (status: SampleRevisionStatus) => {
  if (status === 'published') return '公開中';
  if (status === 'draft') return '下書き';
  return '過去の公開版';
};

const statusClass = (status: SampleRevisionStatus) => {
  if (status === 'published') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (status === 'draft') return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-slate-300 bg-slate-100 text-slate-600';
};

const fireLabel = (fireSpec: FireSpec) => fireSpec === 'fire' ? '防火' : '非防火';

export function BaseMasterExcelDemo() {
  const [selectedId, setSelectedId] = useState(SAMPLE_BASE_MASTERS[0].id);
  const [savedMatrixRows, setSavedMatrixRows] = useState<MatrixRow[]>(() => cloneMatrixRows(INITIAL_MATRIX_ROWS));
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>(() => cloneMatrixRows(INITIAL_MATRIX_ROWS));
  const [isMatrixEditing, setIsMatrixEditing] = useState(false);
  const [matrixNotice, setMatrixNotice] = useState<string | null>(null);
  const [matrixQuery, setMatrixQuery] = useState('');
  const [matrixModelFilter, setMatrixModelFilter] = useState('');

  const selected = SAMPLE_BASE_MASTERS.find((master) => master.id === selectedId) ?? SAMPLE_BASE_MASTERS[0];

  const groupedLines = useMemo(() => {
    const groups: Array<{ section: string; rows: SampleLine[] }> = [];
    for (const line of selected.lines) {
      const existing = groups.find((group) => group.section === line.section);
      if (existing) existing.rows.push(line);
      else groups.push({ section: line.section, rows: [line] });
    }
    return groups;
  }, [selected]);

  const matrixModelOptions = useMemo(
    () => Array.from(new Set(matrixRows.map((row) => row.model))),
    [matrixRows]
  );

  const visibleMatrixRows = useMemo(() => {
    const query = matrixQuery.trim().toLocaleLowerCase('ja-JP');
    return matrixRows.filter((row) => {
      if (matrixModelFilter && row.model !== matrixModelFilter) return false;
      if (!query) return true;
      return [row.model, row.purpose, row.size]
        .join(' ')
        .toLocaleLowerCase('ja-JP')
        .includes(query);
    });
  }, [matrixModelFilter, matrixQuery, matrixRows]);

  const toggleMatrixItem = (rowId: string, item: MatrixItem) => {
    if (!isMatrixEditing) return;
    setMatrixNotice(null);
    setMatrixRows((current) => current.map((row) => row.id === rowId
      ? { ...row, availability: { ...row.availability, [item]: !row.availability[item] } }
      : row));
  };

  const toggleFireSelectable = (rowId: string) => {
    if (!isMatrixEditing) return;
    setMatrixNotice(null);
    setMatrixRows((current) => current.map((row) => row.id === rowId
      ? { ...row, fireSelectable: !row.fireSelectable }
      : row));
  };

  const saveMatrixMock = () => {
    setSavedMatrixRows(cloneMatrixRows(matrixRows));
    setIsMatrixEditing(false);
    setMatrixNotice('画面内のサンプル状態を保存しました。DBには保存されません。');
  };

  const cancelMatrixEdit = () => {
    setMatrixRows(cloneMatrixRows(savedMatrixRows));
    setIsMatrixEditing(false);
    setMatrixNotice('編集内容をキャンセルしました。');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
        <div className="font-semibold">画面確認用サンプル</div>
        <p className="mt-1 text-xs leading-5 text-blue-900">
          以下はローカル仮データです。DBへの保存・公開・版操作は行いません。本体マスターの基準原価と構造明細だけを表示し、売価・粗利・販売費・経費・掛率は扱いません。
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-500">BASE MASTER</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">1. 構成一覧</h2>
              <p className="mt-1 text-xs text-slate-500">本体 → 用途・基本仕様 → バリエーション（サイズ・防火仕様） → 版の順に登録状況を確認します。</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full border px-2.5 py-1 font-semibold ${statusClass('published')}`}>公開中</span>
              <span className={`rounded-full border px-2.5 py-1 font-semibold ${statusClass('draft')}`}>下書き</span>
              <span className={`rounded-full border px-2.5 py-1 font-semibold ${statusClass('historical')}`}>過去の公開版</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[60rem] w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold">本体</th>
                <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold">用途・基本仕様</th>
                <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold">サイズ</th>
                <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold">防火仕様</th>
                <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold">版</th>
                <th className="border-b border-slate-300 px-3 py-2 text-left font-semibold">状態</th>
                <th className="border-b border-slate-300 px-3 py-2 text-right font-semibold">基準原価</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {SAMPLE_BASE_MASTERS.map((master) => {
                const active = master.id === selected.id;
                return (
                  <tr
                    key={master.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={active}
                    onClick={() => setSelectedId(master.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(master.id);
                      }
                    }}
                    className={`cursor-pointer outline-none transition hover:bg-slate-50 focus:ring-2 focus:ring-inset focus:ring-emerald-600/30 ${active ? 'bg-emerald-50/70' : 'bg-white'}`}
                  >
                    <td className="px-3 py-2 font-semibold text-slate-900">{master.model}</td>
                    <td className="px-3 py-2">{master.purpose}</td>
                    <td className="px-3 py-2 tabular-nums">{master.size}</td>
                    <td className="px-3 py-2">{fireLabel(master.fireSpec)}</td>
                    <td className="px-3 py-2 font-medium">{formatBaseMasterRevision(master.revision)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(master.status)}`}>
                        {statusLabel(master.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatYen(master.totalCost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">行を選択すると、下の本体マスター詳細が切り替わります。</div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-slate-500">選択中の版</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">2. 本体マスター詳細</h2>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(selected.status)}`}>{statusLabel(selected.status)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">標準見積と近い密度のExcel風表示で、構造・製造の基準原価だけを確認します。</p>
        </div>

        <div className="grid gap-px border-b border-slate-200 bg-slate-200 text-sm sm:grid-cols-2 lg:grid-cols-6">
          {[
            ['本体', selected.model],
            ['用途・基本仕様', selected.purpose],
            ['サイズ', selected.size],
            ['防火仕様', fireLabel(selected.fireSpec)],
            ['版', formatBaseMasterRevision(selected.revision)],
            ['状態', statusLabel(selected.status)],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-500">{label}</div>
              <div className="mt-0.5 font-medium text-slate-900">{value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
          <span className="font-semibold text-slate-600">版履歴</span>
          {selected.history.map((history) => (
            <span key={`${selected.id}-${history.revision}`} className={`rounded-full border px-2.5 py-1 font-semibold ${statusClass(history.status)}`}>
              {formatBaseMasterRevision(history.revision)}・{history.label}
            </span>
          ))}
          <span className="ml-auto text-slate-500">表示のみ・操作未接続</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[58rem] w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-slate-100 text-xs text-slate-600">
                <th className="w-[34%] border-b border-r border-slate-300 px-2 py-1.5 text-left font-semibold">品名</th>
                <th className="w-20 border-b border-r border-slate-300 px-2 py-1.5 text-right font-semibold">数量</th>
                <th className="w-20 border-b border-r border-slate-300 px-2 py-1.5 text-left font-semibold">単位</th>
                <th className="w-32 border-b border-r border-slate-300 px-2 py-1.5 text-right font-semibold">基準原価単価</th>
                <th className="w-32 border-b border-r border-slate-300 px-2 py-1.5 text-right font-semibold">原価金額</th>
                <th className="border-b border-slate-300 px-2 py-1.5 text-left font-semibold">備考</th>
              </tr>
            </thead>
            <tbody>
              {groupedLines.map((group) => (
                <FragmentGroup key={group.section} section={group.section} rows={group.rows} />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-semibold text-slate-900">
                <td colSpan={4} className="border-t border-slate-400 px-3 py-2 text-right">基準原価合計</td>
                <td className="border-t border-l border-slate-400 px-2 py-2 text-right tabular-nums">{formatYen(selected.totalCost)}</td>
                <td className="border-t border-l border-slate-400 px-2 py-2 text-xs text-slate-500">売価・粗利等は標準見積側</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border-t border-slate-200 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">本体基準図面（サンプル枠）</h3>
            <span className="text-xs text-slate-500">お客様向け平面図・立面図・完成パースはここに置きません。</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {['構造図', '骨組み図', '製造用図面', '本体基準寸法図'].map((label) => (
              <div key={label} className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm font-medium text-slate-500">
                {label}・表示位置
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-500">SPECIFICATION MATRIX</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">3. 仕様マトリクス</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                本体マスターの版一覧とは別の確認表です。本体 × 用途・基本仕様 × サイズに対し、標準見積側で各仕様項目を選択可能とするかを○／×で確認します。15項目のうち給湯器は独立項目です。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isMatrixEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsMatrixEditing(true);
                    setMatrixNotice(null);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  編集
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={cancelMatrixEdit}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={saveMatrixMock}
                    className="rounded-md border border-emerald-800 bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900"
                  >
                    保存
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-950">
          画面確認用サンプル。変更はDBへ保存されません。
        </div>

        <div className="grid gap-3 border-b border-slate-200 bg-white px-4 py-3 md:grid-cols-[minmax(16rem,1fr)_14rem_auto] md:items-end">
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-slate-600">検索</span>
            <input
              type="search"
              value={matrixQuery}
              onChange={(event) => setMatrixQuery(event.target.value)}
              placeholder="本体・用途・サイズ"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-slate-600">本体</span>
            <select
              value={matrixModelFilter}
              onChange={(event) => setMatrixModelFilter(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
            >
              <option value="">すべて</option>
              {matrixModelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMatrixQuery('');
                setMatrixModelFilter('');
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              クリア
            </button>
            <span className="text-xs text-slate-500">{visibleMatrixRows.length}行／全{matrixRows.length}行</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span>15項目</span>
          <span>非防火：全行利用可</span>
          <span>防火：行ごとの利用可否を表示</span>
          <span className="ml-auto font-medium text-emerald-700">○ 選択可</span>
          <span className="font-medium text-slate-500">× 対象外</span>
        </div>

        {matrixNotice && (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900">{matrixNotice}</div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-[118rem] w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-600">
                <th className="min-w-24 border-b border-r border-slate-300 px-2 py-2 text-left font-semibold">本体</th>
                <th className="min-w-32 border-b border-r border-slate-300 px-2 py-2 text-left font-semibold">用途・基本仕様</th>
                <th className="min-w-32 border-b border-r border-slate-300 px-2 py-2 text-left font-semibold">サイズ</th>
                <th className="min-w-20 border-b border-r border-slate-300 px-2 py-2 text-center font-semibold">非防火</th>
                <th className="min-w-20 border-b border-r border-slate-300 px-2 py-2 text-center font-semibold">防火</th>
                {MATRIX_ITEMS.map((item) => (
                  <th key={item.key} className="min-w-24 border-b border-r border-slate-300 px-2 py-2 text-center font-semibold">{item.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMatrixRows.map((row) => (
                <tr key={row.id} className="border-b border-slate-200 bg-white">
                  <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-900">{row.model}</td>
                  <td className="border-r border-slate-200 px-2 py-2">{row.purpose}</td>
                  <td className="border-r border-slate-200 px-2 py-2 tabular-nums">{row.size}</td>
                  <td className="border-r border-slate-200 bg-emerald-50/60 px-2 py-2 text-center font-semibold text-emerald-800">利用可</td>
                  <td className="border-r border-slate-200 px-1 py-1.5 text-center">
                    <button
                      type="button"
                      disabled={!isMatrixEditing}
                      onClick={() => toggleFireSelectable(row.id)}
                      aria-label={`${row.model} ${row.purpose} 防火利用可否を切替`}
                      className={`min-w-16 rounded border px-2 py-1 text-xs font-semibold ${row.fireSelectable ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-500'} ${isMatrixEditing ? 'cursor-pointer hover:ring-2 hover:ring-emerald-600/20' : 'cursor-default'}`}
                    >
                      {row.fireSelectable ? '利用可' : '対象外'}
                    </button>
                  </td>
                  {MATRIX_ITEMS.map((item) => {
                    const available = row.availability[item.key];
                    return (
                      <td key={item.key} className={`border-r border-slate-200 px-1 py-1.5 text-center ${available ? 'bg-emerald-50/40' : 'bg-slate-50'}`}>
                        <button
                          type="button"
                          disabled={!isMatrixEditing}
                          onClick={() => toggleMatrixItem(row.id, item.key)}
                          aria-label={`${row.model} ${row.purpose} ${item.label}を切替`}
                          className={`inline-flex size-8 items-center justify-center rounded text-sm font-bold ${available ? 'text-emerald-700' : 'text-slate-400'} ${isMatrixEditing ? 'cursor-pointer hover:bg-white hover:ring-2 hover:ring-emerald-600/20' : 'cursor-default'}`}
                        >
                          {available ? '○' : '×'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {visibleMatrixRows.length === 0 && (
                <tr>
                  <td colSpan={5 + MATRIX_ITEMS.length} className="px-4 py-8 text-center text-sm text-slate-500">条件に一致する行はありません。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs leading-5 text-slate-500">
          ○／×は15項目の選択可否を表します。防火は15項目を複製せず、各行の別条件として表示しています。編集・保存は画面内モックのみで、DB・版・公開状態には影響しません。
        </div>
      </section>
    </div>
  );
}

function FragmentGroup({ section, rows }: { section: string; rows: SampleLine[] }) {
  return (
    <>
      <tr className="bg-emerald-50/70 text-xs font-semibold text-emerald-950">
        <td colSpan={6} className="border-b border-emerald-200 px-2 py-1.5">{section}</td>
      </tr>
      {rows.map((line) => {
        const amount = Math.round(line.quantity * line.unitCost);
        return (
          <tr key={line.id} className="border-b border-slate-200 bg-white">
            <td className="border-r border-slate-200 px-2 py-1.5">{line.name}</td>
            <td className="border-r border-slate-200 px-2 py-1.5 text-right tabular-nums">{line.quantity}</td>
            <td className="border-r border-slate-200 px-2 py-1.5">{line.unit}</td>
            <td className="border-r border-slate-200 px-2 py-1.5 text-right tabular-nums">{formatYen(line.unitCost)}</td>
            <td className="border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right font-medium tabular-nums">{formatYen(amount)}</td>
            <td className="px-2 py-1.5 text-slate-600">{line.note || '—'}</td>
          </tr>
        );
      })}
    </>
  );
}
