import type { CSSProperties } from "react";
import type { ReverbSettings } from "../types";
import { REVERB_MODE_OPTIONS } from "../utils/reverb";

interface ReverbPluginPanelProps {
  reverb: ReverbSettings;
  onChange: (patch: Partial<ReverbSettings>) => void;
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  size?: "small" | "medium";
  onChange: (value: number) => void;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDb(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function Knob({
  label,
  value,
  min,
  max,
  step,
  display,
  size = "medium",
  onChange,
}: KnobProps) {
  const normalized = (value - min) / (max - min);
  const angle = -135 + Math.max(0, Math.min(1, normalized)) * 270;

  return (
    <label className={`reverb-knob ${size}`}>
      <span>{label}</span>
      <span
        className="reverb-knob-cap"
        style={{ "--angle": `${angle}deg` } as CSSProperties}
      >
        <input
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="range"
          value={value}
        />
      </span>
      <strong>{display}</strong>
    </label>
  );
}

export function ReverbPluginPanel({ reverb, onChange }: ReverbPluginPanelProps) {
  const wetBlend = reverb.wet / Math.max(0.01, reverb.dry + reverb.wet);

  return (
    <div className={`reverb-rack ${reverb.enabled ? "on" : ""}`}>
      <div className="reverb-wood-frame">
        <div className="reverb-faceplate">
          <div className="reverb-screws" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>

          <div className="reverb-main-deck">
            <section className="reverb-brand-module">
              <div>
                <span className="reverb-brand">REV PLATE-140</span>
                <span className="reverb-subtitle">REVERBERATION UNIT</span>
              </div>
              <button
                className={`reverb-power ${reverb.enabled ? "on" : ""}`}
                onClick={() => onChange({ enabled: !reverb.enabled })}
                type="button"
              >
                <span className="reverb-power-lamp" />
                <span>POWER</span>
              </button>
            </section>

            <section className="reverb-tube-module">
              <div className="reverb-tube-window" aria-hidden="true">
                <span />
              </div>
              <Knob
                display={formatPercent(reverb.drive)}
                label="Drive"
                max={1}
                min={0}
                onChange={(drive) => onChange({ drive })}
                step={0.01}
                value={reverb.drive}
              />
            </section>

            <section className="reverb-decay-module">
              <span className="reverb-module-title">DECAY TIME</span>
              <label className="reverb-model-select">
                <span>Model</span>
                <select
                  onChange={(event) =>
                    onChange({
                      mode: event.target.value as ReverbSettings["mode"],
                    })
                  }
                  value={reverb.mode}
                >
                  {REVERB_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="reverb-decay-fader">
                <input
                  max={12}
                  min={0.2}
                  onChange={(event) => onChange({ decay: Number(event.target.value) })}
                  step={0.1}
                  type="range"
                  value={reverb.decay}
                />
                <div className="reverb-decay-scale" aria-hidden="true">
                  <span>MAX</span>
                  <span>8</span>
                  <span>4</span>
                  <span>2</span>
                  <span>MIN</span>
                </div>
              </div>
              <strong>{reverb.decay.toFixed(1)} s</strong>
            </section>

            <section className="reverb-blend-module">
              <Knob
                display={formatPercent(wetBlend)}
                label="Blend"
                max={1}
                min={0}
                onChange={(blend) =>
                  onChange({
                    dry: Number((1 - blend).toFixed(2)),
                    wet: Number(blend.toFixed(2)),
                  })
                }
                step={0.01}
                value={wetBlend}
              />
              <Knob
                display={formatPercent(reverb.width)}
                label="Width"
                max={1}
                min={0}
                onChange={(width) => onChange({ width })}
                step={0.01}
                value={reverb.width}
              />
            </section>
          </div>

          <div className="reverb-bottom-strip">
            <div className="reverb-arturia-mark">A</div>
            <Knob
              display={`${Math.round(reverb.preDelayMs)} ms`}
              label="Pre-delay"
              max={250}
              min={0}
              onChange={(preDelayMs) => onChange({ preDelayMs })}
              size="small"
              step={1}
              value={reverb.preDelayMs}
            />
            <Knob
              display={`${Math.round(reverb.highPassHz)} Hz`}
              label="HP Filter"
              max={2000}
              min={20}
              onChange={(highPassHz) => onChange({ highPassHz })}
              size="small"
              step={10}
              value={reverb.highPassHz}
            />
            <Knob
              display={`${Math.round(reverb.lowPassHz)} Hz`}
              label="LP Filter"
              max={20000}
              min={1000}
              onChange={(lowPassHz) => onChange({ lowPassHz })}
              size="small"
              step={100}
              value={reverb.lowPassHz}
            />

            <section className="reverb-mod-section">
              <span>MODULATION</span>
              <label className="reverb-toggle">
                <input
                  checked={reverb.modEnabled}
                  onChange={(event) => onChange({ modEnabled: event.target.checked })}
                  type="checkbox"
                />
                <i />
                Active
              </label>
              <Knob
                display={formatPercent(reverb.modAmount)}
                label="Amount"
                max={1}
                min={0}
                onChange={(modAmount) => onChange({ modAmount })}
                size="small"
                step={0.01}
                value={reverb.modAmount}
              />
            </section>

            <section className="reverb-eq-section">
              <span>POST EQUALIZER</span>
              <Knob
                display={formatDb(reverb.postEqLowGain)}
                label="Low"
                max={12}
                min={-12}
                onChange={(postEqLowGain) => onChange({ postEqLowGain })}
                size="small"
                step={0.5}
                value={reverb.postEqLowGain}
              />
              <Knob
                display={formatDb(reverb.postEqMidGain)}
                label="Mid"
                max={12}
                min={-12}
                onChange={(postEqMidGain) => onChange({ postEqMidGain })}
                size="small"
                step={0.5}
                value={reverb.postEqMidGain}
              />
              <Knob
                display={formatDb(reverb.postEqHighGain)}
                label="High"
                max={12}
                min={-12}
                onChange={(postEqHighGain) => onChange({ postEqHighGain })}
                size="small"
                step={0.5}
                value={reverb.postEqHighGain}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
