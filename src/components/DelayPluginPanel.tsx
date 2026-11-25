import { ko } from "../i18n/ko";
import { DEFAULT_DELAY_SETTINGS } from "../domain/project/defaults";
import { DELAY_FEEDBACK_RANGE, DELAY_HIGH_CUT_RANGE, DELAY_TIME_RANGE } from "../domain/project/ranges";
import type { DelaySettings } from "../domain/types";
import { DELAY_SYNC_OPTIONS, getDelayTimeMs } from "../utils/delay";
import { plainEntry, scaledEntry } from "../ui/controls/entries";
import { Knob } from "../ui/controls/Knob";
import { Toggle } from "../ui/controls/Toggle";
import { useHistoryGesture } from "../ui/inspector/useHistoryGesture";

interface DelayPluginPanelProps {
  bpm: number;
  delay: DelaySettings;
  onChange: (patch: Partial<DelaySettings>) => void;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

const TIME_ENTRY = plainEntry("시간 딜레이 값(ms)", DELAY_TIME_RANGE[0], DELAY_TIME_RANGE[1], 1);
const FEEDBACK_ENTRY = scaledEntry("반복 딜레이 값(%)", 100, 0, DELAY_FEEDBACK_RANGE[1] * 100, 1);
const HIGH_CUT_ENTRY = plainEntry("고음 컷 딜레이 값(Hz)", DELAY_HIGH_CUT_RANGE[0], DELAY_HIGH_CUT_RANGE[1], 100);
const DRY_ENTRY = scaledEntry("원음 딜레이 값(%)", 100, 0, 100, 1);
const WET_ENTRY = scaledEntry("효과음 딜레이 값(%)", 100, 0, 100, 1);

// ── Panel ────────────────────────────────────────────────────────────────────
export function DelayPluginPanel({ bpm, delay, onChange }: DelayPluginPanelProps) {
  const effectiveTimeMs = getDelayTimeMs(delay, bpm);
  const gesture = useHistoryGesture("effect:delay");

  return (
    <div className={`dly-rack ${delay.enabled ? "on" : ""}`}>
      {/* Wood frame */}
      <div className="dly-frame">
        {/* Faceplate */}
        <div className="dly-face">

          {/* ── Header row ── */}
          <div className="dly-header">
            <div className="dly-brand-block">
              <span className="dly-brand">공간 딜레이</span>
              <span className="dly-sub">{ko.delay.subtitle}</span>
            </div>
            <Toggle
              className={`dly-power ${delay.enabled ? "on" : ""}`}
              label={ko.state.power("딜레이", delay.enabled)}
              pressed={delay.enabled}
              onChange={(enabled) => onChange({ enabled })}
            >
              <span className="dly-led" />
              <span>{delay.enabled ? "켜짐" : "꺼짐"}</span>
            </Toggle>
          </div>

          {/* ── Knobs row ── */}
          <div className="dly-knobs-row">
            <Knob
              face="arc"
              label="시간 딜레이"
              caption="시간"
              color="#d97a30"
              value={delay.delayTimeMs}
              min={DELAY_TIME_RANGE[0]}
              max={DELAY_TIME_RANGE[1]}
              step={1}
              defaultValue={DEFAULT_DELAY_SETTINGS.delayTimeMs}
              disabled={delay.syncEnabled}
              valueText={`${Math.round(effectiveTimeMs)} ms`}
              entry={TIME_ENTRY}
              onChange={(delayTimeMs) => onChange({ delayTimeMs })}
              {...gesture}
            />
            <Knob
              face="arc"
              label="반복 딜레이"
              caption="반복"
              color="#e0a040"
              value={delay.feedback}
              min={DELAY_FEEDBACK_RANGE[0]}
              max={DELAY_FEEDBACK_RANGE[1]}
              step={0.01}
              defaultValue={DEFAULT_DELAY_SETTINGS.feedback}
              format={formatPercent}
              entry={FEEDBACK_ENTRY}
              onChange={(feedback) => onChange({ feedback })}
              {...gesture}
            />
            <Knob
              face="arc"
              label="고음 컷 딜레이"
              caption="고음 컷"
              color="#c86822"
              curve="log"
              value={delay.highCutHz}
              min={DELAY_HIGH_CUT_RANGE[0]}
              max={DELAY_HIGH_CUT_RANGE[1]}
              step={100}
              defaultValue={DEFAULT_DELAY_SETTINGS.highCutHz}
              format={(hz) => `${Math.round(hz / 100) * 100} Hz`}
              entry={HIGH_CUT_ENTRY}
              onChange={(highCutHz) => onChange({ highCutHz })}
              {...gesture}
            />
            <Knob
              face="arc"
              label="원음 딜레이"
              caption="원음"
              color="#8ab8d8"
              value={delay.dry}
              min={0}
              max={1}
              step={0.01}
              defaultValue={DEFAULT_DELAY_SETTINGS.dry}
              format={formatPercent}
              entry={DRY_ENTRY}
              onChange={(dry) => onChange({ dry })}
              {...gesture}
            />
            <Knob
              face="arc"
              label="효과음 딜레이"
              caption="효과음"
              color="#58c878"
              value={delay.wet}
              min={0}
              max={1}
              step={0.01}
              defaultValue={DEFAULT_DELAY_SETTINGS.wet}
              format={formatPercent}
              entry={WET_ENTRY}
              onChange={(wet) => onChange({ wet })}
              {...gesture}
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
