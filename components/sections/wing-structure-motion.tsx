const frameAnimation = `
  @keyframes wing-structure-frame-1 {
    0%, 20% { opacity: 1; }
    25%, 100% { opacity: 0; }
  }
  @keyframes wing-structure-frame-2 {
    0%, 20%, 50%, 100% { opacity: 0; }
    25%, 45% { opacity: 1; }
  }
  @keyframes wing-structure-frame-3 {
    0%, 45%, 75%, 100% { opacity: 0; }
    50%, 70% { opacity: 1; }
  }
  @keyframes wing-structure-frame-4 {
    0%, 70% { opacity: 0; }
    75%, 100% { opacity: 1; }
  }
  .wing-structure-frame-1 { animation: wing-structure-frame-1 7.2s steps(1, end) infinite; }
  .wing-structure-frame-2 { animation: wing-structure-frame-2 7.2s steps(1, end) infinite; }
  .wing-structure-frame-3 { animation: wing-structure-frame-3 7.2s steps(1, end) infinite; }
  .wing-structure-frame-4 { animation: wing-structure-frame-4 7.2s steps(1, end) infinite; }
  @media (prefers-reduced-motion: reduce) {
    .wing-structure-frame-1,
    .wing-structure-frame-2,
    .wing-structure-frame-3 { animation: none; opacity: 0; }
    .wing-structure-frame-4 { animation: none; opacity: 1; }
  }
`;

function StructureLine({ d }: { d: string }) {
  return <path d={d} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />;
}

export function WingStructureMotion() {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-ivory/60">
      <style>{frameAnimation}</style>
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-3 py-2">
        <p className="text-[10px] font-semibold text-muted">展開の流れ</p>
        <p className="text-[10px] text-muted">構造を簡略化したイメージ</p>
      </div>
      <div className="px-3 pb-2.5 pt-2">
        <div className="mx-auto max-w-md text-forest" aria-label="Wingは折り畳み状態から左右の壁が開き、その後に床板が下がって展開します">
          <svg viewBox="0 0 320 135" role="img" className="block h-auto w-full" aria-hidden="true">
            <path d="M38 118 H282" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />

            <g className="wing-structure-frame-1">
              <StructureLine d="M126 30 H194 V112 H126 Z" />
              <StructureLine d="M139 48 V103" />
              <StructureLine d="M181 48 V103" />
            </g>

            <g className="wing-structure-frame-2" opacity="0">
              <StructureLine d="M126 30 H194 V112 H126 Z" />
              <StructureLine d="M126 34 L69 68" />
              <StructureLine d="M194 34 L251 68" />
              <StructureLine d="M137 55 V106" />
              <StructureLine d="M183 55 V106" />
            </g>

            <g className="wing-structure-frame-3" opacity="0">
              <StructureLine d="M126 30 H194" />
              <StructureLine d="M126 34 L69 56 V111" />
              <StructureLine d="M194 34 L251 56 V111" />
              <StructureLine d="M126 110 L82 124" />
              <StructureLine d="M194 110 L238 124" />
              <StructureLine d="M126 48 V110" />
              <StructureLine d="M194 48 V110" />
            </g>

            <g className="wing-structure-frame-4" opacity="0">
              <StructureLine d="M68 48 L126 30 H194 L252 48" />
              <StructureLine d="M68 48 V112 H252 V48" />
              <StructureLine d="M126 48 V112" />
              <StructureLine d="M194 48 V112" />
              <StructureLine d="M68 112 H252" />
            </g>
          </svg>
        </div>
        <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[9px] font-semibold text-ink-soft sm:text-[10px]">
          <span>折り畳み</span>
          <span>壁が開く</span>
          <span>床が下りる</span>
          <span>展開</span>
        </div>
      </div>
    </div>
  );
}
