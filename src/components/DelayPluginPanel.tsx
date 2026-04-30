import { useCallback, useRef } from "react";
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
}

function DelayKnob({ value, label, display, color = "#d97a30", size = 56, onChange }: KnobProps) {
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

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startV.current = value;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dy = startY.current - ev.clientY;
      const next = Math.max(0, Math.min(1, startV.current + dy / 180));
      onChange(next);
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [value, onChange]);

  return (
    <div className="dly-knob-wrap" style={{ width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ cursor: "ns-resize", display: "block", userSelect: "none" }}
        onMouseDown={onMouseDown}
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
              <span className="dly-brand">DLY TAPE-375</span>
              <span className="dly-sub">DELAY INSERT UNIT</span>
            </div>
            <button
              className={`dly-power ${delay.enabled ? "on" : ""}`}
              onClick={() => onChange({ enabled: !delay.enabled })}
              type="button"
            >
              <span className="dly-led" />
              <span>{delay.enabled ? "POWER ON" : "POWER"}</span>
            </button>
          </div>

          {/* ── Knobs row ── */}
          <div className="dly-knobs-row">
            <DelayKnob
              value={timeNorm}
              label="TIME"
              display={`${Math.round(effectiveTimeMs)} ms`}
              color="#d97a30"
              onChange={(v) => onChange({ delayTimeMs: Math.round(1 + v * (2000 - 1)) })}
            />
            <DelayKnob
              value={fbNorm}
              label="FEEDBACK"
              display={formatPercent(delay.feedback)}
              color="#e0a040"
              onChange={(v) => onChange({ feedback: Math.round(v * 0.95 * 100) / 100 })}
            />
            <DelayKnob
              value={hcNorm}
              label="HI-CUT"
              display={`${Math.round(delay.highCutHz / 100) * 100} Hz`}
              color="#c86822"
              onChange={(v) => onChange({ highCutHz: Math.round((1000 + v * (20000 - 1000)) / 100) * 100 })}
            />
            <DelayKnob
              value={dryNorm}
              label="DRY"
              display={formatPercent(delay.dry)}
              color="#8ab8d8"
              onChange={(v) => onChange({ dry: Math.round(v * 100) / 100 })}
            />
            <DelayKnob
              value={wetNorm}
              label="WET"
              display={formatPercent(delay.wet)}
              color="#58c878"
              onChange={(v) => onChange({ wet: Math.round(v * 100) / 100 })}
            />
          </div>

          {/* ── Controls row ── */}
          <div className="dly-controls-row">
            {/* Sync section */}
            <div className="dly-section">
              <span className="dly-section-label">SYNC</span>
              <div className="dly-section-body">
                <label className="dly-toggle">
                  <input
                    type="checkbox"
                    checked={delay.syncEnabled}
                    onChange={(e) => onChange({ syncEnabled: e.target.checked })}
                  />
                  <span className="dly-toggle-track">
                    <span className="dly-toggle-thumb" />
                  </span>
                  <span className="dly-toggle-text">{delay.syncEnabled ? "ON" : "OFF"}</span>
                </label>
                <select
                  className="dly-select"
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
              <span className="dly-section-label">PING-PONG</span>
              <div className="dly-section-body">
                <label className="dly-toggle">
                  <input
                    type="checkbox"
                    checked={delay.pingPong}
                    onChange={(e) => onChange({ pingPong: e.target.checked })}
                  />
                  <span className="dly-toggle-track">
                    <span className="dly-toggle-thumb" />
                  </span>
                  <span className="dly-toggle-text">{delay.pingPong ? "ON" : "OFF"}</span>
                </label>
              </div>
            </div>

            {/* Time display */}
            <div className="dly-section dly-section-time">
              <span className="dly-section-label">EFFECTIVE TIME</span>
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
