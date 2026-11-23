import { useRef } from "react";
import type { DelaySettings } from "../types";
import { DELAY_SYNC_OPTIONS, getDelayTimeMs } from "../utils/delay";

interface DelayPluginPanelProps {
  bpm: number;
  delay: DelaySettings;
  onChange: (patch: Partial<DelaySettings>) => void;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

// ── SVG Rotary Knob ──────────────────────────────────────────────────────────
interface KnobProps {
  value: number;      // 0–1 normalized
  label: string;
  display: string;
  color?: string;
  size?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function DelayKnob({ value, label, display, color = "#d97a30", size = 56, onChange, disabled = false }: KnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startV = useRef(0);

  const MIN_ANGLE = -145;
  const MAX_ANGLE = 145;
  const angle = MIN_ANGLE + value * (MAX_ANGLE - MIN_ANGLE);

  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;

  // Arc path
  const toRad = (deg: number) => (deg - 90) * (Math.PI / 180);
  const arcX1 = cx + r * Math.cos(toRad(MIN_ANGLE));
  const arcY1 = cy + r * Math.sin(toRad(MIN_ANGLE));
  const arcX2 = cx + r * Math.cos(toRad(angle));
  const arcY2 = cy + r * Math.sin(toRad(angle));
  const largeArc = angle - MIN_ANGLE > 180 ? 1 : 0;

  // Indicator dot position
  const iR = r - 5;
  const iX = cx + iR * Math.cos(toRad(angle));
  const iY = cy + iR * Math.sin(toRad(angle));

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    startY.current = event.clientY;
    startV.current = value;
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current || disabled) return;
    onChange(Math.max(0, Math.min(1, startV.current + (startY.current - event.clientY) / 180)));
  };
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    let next = value;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next += 0.01;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next -= 0.01;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(1, next)));
  };

  return (
    <div className="dly-knob-wrap" style={{ width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ cursor: disabled ? "not-allowed" : "ns-resize", display: "block", userSelect: "none", touchAction: "none", opacity: disabled ? 0.5 : 1 }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} 딜레이`}
        aria-disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={display}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onLostPointerCapture={() => { dragging.current = false; }}
        onKeyDown={onKeyDown}
      >
        {/* Outer ring */}
        <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
        {/* Body gradient */}
        <defs>
          <radialGradient id={`dkg-${label}`} cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#5a4535" />
            <stop offset="100%" stopColor="#1e1208" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill={`url(#dkg-${label})`} />
        {/* Track arc (background) */}
        <path
          d={`M ${arcX1} ${arcY1} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(toRad(MAX_ANGLE))} ${cy + r * Math.sin(toRad(MAX_ANGLE))}`}
          fill="none"
          stroke="rgba(0,0,0,0.4)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {value > 0 && (
          <path
            d={`M ${arcX1} ${arcY1} A ${r} ${r} 0 ${largeArc} 1 ${arcX2} ${arcY2}`}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
        {/* Indicator dot */}
        <circle cx={iX} cy={iY} r={3} fill={color} />
      </svg>
      <div className="dly-knob-label">{label}</div>
      <div className="dly-knob-value">{display}</div>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
export function DelayPluginPanel({ bpm, delay, onChange }: DelayPluginPanelProps) {
  const effectiveTimeMs = getDelayTimeMs(delay, bpm);

  // Normalizers
  const timeNorm = (delay.delayTimeMs - 1) / (2000 - 1);
  const fbNorm = delay.feedback / 0.95;
  const hcNorm = (delay.highCutHz - 1000) / (20000 - 1000);
  const dryNorm = delay.dry;
  const wetNorm = delay.wet;

  return (
    <div className={`dly-rack ${delay.enabled ? "on" : ""}`}>
      {/* Wood frame */}
      <div className="dly-wood">
        {/* Faceplate */}
        <div className="dly-face">

          {/* ── Header row ── */}
          <div className="dly-header">
            <div className="dly-brand-block">
              <span className="dly-brand">공간 딜레이</span>
              <span className="dly-sub">DELAY</span>
            </div>
            <button
              className={`dly-power ${delay.enabled ? "on" : ""}`}
              onClick={() => onChange({ enabled: !delay.enabled })}
              type="button"
              aria-label="딜레이 켜기"
              aria-pressed={delay.enabled}
            >
              <span className="dly-led" />
              <span>{delay.enabled ? "켜짐" : "꺼짐"}</span>
            </button>
          </div>

          {/* ── Knobs row ── */}
          <div className="dly-knobs-row">
            <DelayKnob
              value={timeNorm}
              label="시간"
              disabled={delay.syncEnabled}
              display={`${Math.round(effectiveTimeMs)} ms`}
              color="#d97a30"
              onChange={(v) => onChange({ delayTimeMs: Math.round(1 + v * (2000 - 1)) })}
            />
            <DelayKnob
              value={fbNorm}
              label="반복"
              display={formatPercent(delay.feedback)}
              color="#e0a040"
              onChange={(v) => onChange({ feedback: Math.round(v * 0.95 * 100) / 100 })}
            />
            <DelayKnob
              value={hcNorm}
              label="고음 컷"
              display={`${Math.round(delay.highCutHz / 100) * 100} Hz`}
              color="#c86822"
              onChange={(v) => onChange({ highCutHz: Math.round((1000 + v * (20000 - 1000)) / 100) * 100 })}
            />
            <DelayKnob
              value={dryNorm}
              label="원음"
              display={formatPercent(delay.dry)}
              color="#8ab8d8"
              onChange={(v) => onChange({ dry: Math.round(v * 100) / 100 })}
            />
            <DelayKnob
              value={wetNorm}
              label="효과음"
              display={formatPercent(delay.wet)}
              color="#58c878"
              onChange={(v) => onChange({ wet: Math.round(v * 100) / 100 })}
            />
          </div>

          {/* ── Controls row ── */}
          <div className="dly-controls-row">
            {/* Sync section */}
            <div className="dly-section">
              <span className="dly-section-label">템포 동기화</span>
              <div className="dly-section-body">
                <label className="dly-toggle">
                  <input
                    type="checkbox"
                    aria-label="템포 동기화"
                    checked={delay.syncEnabled}
                    onChange={(e) => onChange({ syncEnabled: e.target.checked })}
                  />
                  <span className="dly-toggle-track">
                    <span className="dly-toggle-thumb" />
                  </span>
                  <span className="dly-toggle-text">{delay.syncEnabled ? "켬" : "끔"}</span>
                </label>
                <select
                  className="dly-select"
                  aria-label="동기화 박자"
                  disabled={!delay.syncEnabled}
                  value={delay.syncDivision}
                  onChange={(e) =>
                    onChange({ syncDivision: e.target.value as DelaySettings["syncDivision"] })
                  }
                >
                  {DELAY_SYNC_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Ping Pong section */}
            <div className="dly-section">
              <span className="dly-section-label">좌우 반복</span>
              <div className="dly-section-body">
                <label className="dly-toggle">
                  <input
                    type="checkbox"
                    aria-label="좌우 반복"
                    checked={delay.pingPong}
                    onChange={(e) => onChange({ pingPong: e.target.checked })}
                  />
                  <span className="dly-toggle-track">
                    <span className="dly-toggle-thumb" />
                  </span>
                  <span className="dly-toggle-text">{delay.pingPong ? "켬" : "끔"}</span>
                </label>
              </div>
            </div>

            {/* Time display */}
            <div className="dly-section dly-section-time">
              <span className="dly-section-label">실제 딜레이</span>
              <div className="dly-section-body">
                <span className="dly-time-display">{Math.round(effectiveTimeMs)} ms</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
