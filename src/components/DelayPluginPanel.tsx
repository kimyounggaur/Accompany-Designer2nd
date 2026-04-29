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

export function DelayPluginPanel({ bpm, delay, onChange }: DelayPluginPanelProps) {
  const effectiveTimeMs = getDelayTimeMs(delay, bpm);

  return (
    <div className={`delay-rack ${delay.enabled ? "on" : ""}`}>
      <div className="delay-wood-frame">
        <div className="delay-faceplate">
          <div className="delay-top-row">
            <div className="delay-brand-block">
              <span className="delay-brand">DLY TAPE-375</span>
              <span className="delay-subtitle">DELAY INSERT UNIT</span>
            </div>

            <button
              className={`delay-power ${delay.enabled ? "on" : ""}`}
              onClick={() => onChange({ enabled: !delay.enabled })}
              type="button"
            >
              <span className="delay-led" />
              <span>{delay.enabled ? "POWER ON" : "POWER"}</span>
            </button>
          </div>

          <div className="delay-modules">
            <label className="delay-module delay-time-module">
              <span>Delay Time</span>
              <strong>{Math.round(effectiveTimeMs)} ms</strong>
              <input
                disabled={delay.syncEnabled}
                max={2000}
                min={1}
                onChange={(event) => onChange({ delayTimeMs: Number(event.target.value) })}
                type="range"
                value={delay.delayTimeMs}
              />
            </label>

            <label className="delay-module">
              <span>Feedback</span>
              <strong>{formatPercent(delay.feedback)}</strong>
              <input
                max={0.95}
                min={0}
                onChange={(event) => onChange({ feedback: Number(event.target.value) })}
                step={0.01}
                type="range"
                value={delay.feedback}
              />
            </label>

            <label className="delay-module">
              <span>High Cut</span>
              <strong>{Math.round(delay.highCutHz)} Hz</strong>
              <input
                max={20000}
                min={1000}
                onChange={(event) => onChange({ highCutHz: Number(event.target.value) })}
                step={100}
                type="range"
                value={delay.highCutHz}
              />
            </label>
          </div>

          <div className="delay-bottom-row">
            <div className="delay-blend">
              <label>
                Dry
                <input
                  max={1}
                  min={0}
                  onChange={(event) => onChange({ dry: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={delay.dry}
                />
                <span>{formatPercent(delay.dry)}</span>
              </label>
              <label>
                Wet
                <input
                  max={1}
                  min={0}
                  onChange={(event) => onChange({ wet: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={delay.wet}
                />
                <span>{formatPercent(delay.wet)}</span>
              </label>
            </div>

            <div className="delay-switches">
              <label className="delay-check">
                <input
                  checked={delay.syncEnabled}
                  onChange={(event) => onChange({ syncEnabled: event.target.checked })}
                  type="checkbox"
                />
                Sync
              </label>
              <select
                disabled={!delay.syncEnabled}
                onChange={(event) =>
                  onChange({ syncDivision: event.target.value as DelaySettings["syncDivision"] })
                }
                value={delay.syncDivision}
              >
                {DELAY_SYNC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className="delay-check muted-option">
                <input
                  checked={delay.pingPong}
                  onChange={(event) => onChange({ pingPong: event.target.checked })}
                  type="checkbox"
                />
                Ping Pong
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
