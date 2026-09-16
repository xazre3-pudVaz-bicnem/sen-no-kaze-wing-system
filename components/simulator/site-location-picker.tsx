import { PREFECTURES } from '@/lib/domain/address';
import { municipalitiesFor } from '@/data/japan-municipalities';

const UNDECIDED_VALUE = '__undecided__';

export interface SiteLocationValue {
  prefecture: string | null;
  municipality: string | null;
  undecided: boolean;
}

interface Props extends SiteLocationValue {
  disabled?: boolean;
  onChange: (value: SiteLocationValue) => void;
}

export function SiteLocationPicker({
  prefecture,
  municipality,
  undecided,
  disabled = false,
  onChange,
}: Props) {
  const municipalityOptions = undecided ? [] : municipalitiesFor(prefecture);
  const prefectureValue = undecided ? UNDECIDED_VALUE : (prefecture ?? '');

  return (
    <div className="w-full max-w-[20rem] min-w-0 lg:w-[21rem] lg:max-w-none" data-testid="site-location-picker">
      <p className="mb-1 text-[0.72rem] font-semibold text-muted">設置予定地</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <select
          value={prefectureValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === UNDECIDED_VALUE) {
              onChange({ prefecture: null, municipality: null, undecided: true });
              return;
            }
            if (!next) {
              onChange({ prefecture: null, municipality: null, undecided: false });
              return;
            }
            onChange({
              prefecture: next,
              municipality: next === prefecture ? municipality : null,
              undecided: false,
            });
          }}
          disabled={disabled}
          className="min-h-9 w-full rounded-lg border border-line bg-white px-2.5 text-[0.82rem] text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:text-[0.9rem]"
          aria-label="設置予定地の都道府県"
          data-testid="site-prefecture-select"
        >
          <option value="">都道府県を選択</option>
          <option value={UNDECIDED_VALUE}>設置予定地は未定</option>
          {PREFECTURES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={municipality ?? ''}
          onChange={(event) =>
            onChange({
              prefecture,
              municipality: event.target.value || null,
              undecided: false,
            })
          }
          disabled={disabled || undecided || !prefecture}
          className="min-h-9 w-full rounded-lg border border-line bg-white px-2.5 text-[0.82rem] text-ink disabled:cursor-not-allowed disabled:bg-sand/50 disabled:text-muted disabled:opacity-70 sm:text-[0.9rem]"
          aria-label="設置予定地の市区町村"
          data-testid="site-municipality-select"
        >
          <option value="">市区町村を選択</option>
          {municipalityOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[0.7rem] leading-relaxed text-ink-soft">
        設置地域に応じて必要な仕様をご案内します。
      </p>
    </div>
  );
}
