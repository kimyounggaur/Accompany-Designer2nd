import type { ReverbSettings } from "../types";
import { REVERB_MODE_OPTIONS } from "../utils/reverb";

interface ReverbPluginPanelProps {
  reverb: ReverbSettings;
  onChange: (patch: Partial<ReverbSettings>) => void;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDb(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

export function ReverbPluginPanel({ reverb, onChange }: ReverbPluginPanelProps) {
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

          <div className="reverb-top-row">
            <div className="reverb-brand-block">
              <span className="reverb-brand">REV PLATE-140</span>
              <span className="reverb-subtitle">REVERBERATION UNIT</span>
              <button
                className={`reverb-power ${reverb.enabled ? "on" : ""}`}
                onClick={() => onChange({ enabled: !reverb.enabled })}
                type="button"
              >
                <span className="reverb-led" />
                <span>POWER</span>
              </button>
            </div>

            <label className="reverb-tube-module">
              <span>Drive</span>
              <strong>{formatPercent(reverb.drive)}</strong>
              <input
                max={1}
                min={0}
                onChange={(event) => onChange({ drive: Number(event.target.value) })}
                step={0.01}
                type="range"
                value={reverb.drive}
              />
            </label>

            <div className="reverb-decay-module">
              <label>
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
              <label>
                <span>Decay Time</span>
                <strong>{reverb.decay.toFixed(1)} s</strong>
                <input
                  max={12}
                  min={0.2}
                  onChange={(event) => onChange({ decay: Number(event.target.value) })}
                  step={0.1}
                  type="range"
                  value={reverb.decay}
                />
              </label>
            </div>

            <div className="reverb-blend-module">
              <label>
                <span>Dry</span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => onChange({ dry: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={reverb.dry}
                />
                <strong>{formatPercent(reverb.dry)}</strong>
              </label>
              <label>
                <span>Wet</span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => onChange({ wet: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={reverb.wet}
                />
                <strong>{formatPercent(reverb.wet)}</strong>
              </label>
              <label>
                <span>Width</span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => onChange({ width: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={reverb.width}
                />
                <strong>{formatPercent(reverb.width)}</strong>
              </label>
            </div>
          </div>

          <div className="reverb-bottom-strip">
            <label className="reverb-strip-control">
              <span>Pre-delay</span>
              <strong>{Math.round(reverb.preDelayMs)} ms</strong>
              <input
                max={250}
                min={0}
                onChange={(event) => onChange({ preDelayMs: Number(event.target.value) })}
                step={1}
                type="range"
                value={reverb.preDelayMs}
              />
            </label>

            <label className="reverb-strip-control">
              <span>HP Filter</span>
              <strong>{Math.round(reverb.highPassHz)} Hz</strong>
              <input
                max={2000}
                min={20}
                onChange={(event) => onChange({ highPassHz: Number(event.target.value) })}
                step={10}
                type="range"
                value={reverb.highPassHz}
              />
            </label>

            <label className="reverb-strip-control">
              <span>LP Filter</span>
              <strong>{Math.round(reverb.lowPassHz)} Hz</strong>
              <input
                max={20000}
                min={1000}
                onChange={(event) => onChange({ lowPassHz: Number(event.target.value) })}
                step={100}
                type="range"
                value={reverb.lowPassHz}
              />
            </label>

            <div className="reverb-mod-box">
              <label className="reverb-check">
                <input
                  checked={reverb.modEnabled}
                  onChange={(event) => onChange({ modEnabled: event.target.checked })}
                  type="checkbox"
                />
                Active
              </label>
              <label>
                <span>Mod Amount</span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => onChange({ modAmount: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={reverb.modAmount}
                />
              </label>
            </div>

            <div className="reverb-post-eq">
              <span>Post Equalizer</span>
              <label>
                Low
                <input
                  max={12}
                  min={-12}
                  onChange={(event) =>
                    onChange({ postEqLowGain: Number(event.target.value) })
                  }
                  step={0.5}
                  type="range"
                  value={reverb.postEqLowGain}
                />
                <strong>{formatDb(reverb.postEqLowGain)}</strong>
              </label>
              <label>
                Mid
                <input
                  max={12}
                  min={-12}
                  onChange={(event) =>
                    onChange({ postEqMidGain: Number(event.target.value) })
                  }
                  step={0.5}
                  type="range"
                  value={reverb.postEqMidGain}
                />
                <strong>{formatDb(reverb.postEqMidGain)}</strong>
              </label>
              <label>
                High
                <input
                  max={12}
                  min={-12}
                  onChange={(event) =>
                    onChange({ postEqHighGain: Number(event.target.value) })
                  }
                  step={0.5}
                  type="range"
                  value={reverb.postEqHighGain}
                />
                <strong>{formatDb(reverb.postEqHighGain)}</strong>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
