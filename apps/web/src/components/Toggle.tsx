interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  color: string;
  hint?: string;
  count?: number;
  /** 점 대신 링으로 표시 (게임 테두리 색과 맞춤) */
  ring?: boolean;
}

/** 필터 행: 켜지면 색 점이 빛나고, 꺼지면 속이 빈 점으로 흐려진다 */
export function Toggle({ checked, onChange, label, color, hint, count, ring }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-[7px] text-left transition hover:bg-white/[0.035]"
    >
      <span
        className="size-[9px] shrink-0 rounded-full transition"
        style={
          checked
            ? ring
              ? { boxShadow: `inset 0 0 0 2px ${color}, 0 0 10px ${color}66` }
              : { background: color, boxShadow: `0 0 10px ${color}88` }
            : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }
        }
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-[12.5px] transition ${checked ? 'text-white/85' : 'text-white/35'}`}>{label}</span>
        {hint && <span className="block truncate text-[10.5px] text-white/30">{hint}</span>}
      </span>
      {count !== undefined && (
        <span className={`num font-mono text-[10.5px] ${checked ? 'text-white/40' : 'text-white/20'}`}>{count}</span>
      )}
    </button>
  );
}
