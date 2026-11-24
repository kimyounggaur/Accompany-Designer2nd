import { useState } from "react";
import { ko } from "../i18n/ko";
import { DEFAULT_REVERB_SETTINGS } from "../domain/project/defaults";
import {
  REVERB_DECAY_RANGE,
  REVERB_HIGH_PASS_RANGE,
  REVERB_LOW_PASS_RANGE,
  REVERB_PRE_DELAY_RANGE,
  EQ_GAIN_RANGE,
} from "../domain/project/ranges";
import type { ReverbSettings } from "../domain/types";
import { REVERB_MODE_OPTIONS } from "../utils/reverb";
import { plainEntry, scaledEntry } from "../ui/controls/entries";
import { clampValue, roundTo } from "../ui/controls/knobMath";
import { Knob } from "../ui/controls/Knob";
import { Slider } from "../ui/controls/Slider";
import { Toggle } from "../ui/controls/Toggle";
import { ValueEntry } from "../ui/controls/ValueEntry";
import { useHistoryGesture } from "../ui/inspector/useHistoryGesture";

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

const formatMs = (value: number) => `${Math.round(value)} ms`;
const formatHz = (value: number) => `${Math.round(value)} Hz`;

const PERCENT_ENTRY = (label: string) => scaledEntry(label, 100, 0, 100, 1);
const DB_ENTRY = (label: string) => plainEntry(label, EQ_GAIN_RANGE[0], EQ_GAIN_RANGE[1], 0.5);

const DRIVE_ENTRY = PERCENT_ENTRY(`${ko.reverb.drive} 리버브 값(%)`);
const BLEND_ENTRY = PERCENT_ENTRY(`${ko.reverb.blend} 리버브 값(%)`);
const WIDTH_ENTRY = PERCENT_ENTRY(`${ko.reverb.width} 리버브 값(%)`);
const PRE_DELAY_ENTRY = plainEntry(`${ko.reverb.preDelay} 리버브 값(ms)`, REVERB_PRE_DELAY_RANGE[0], REVERB_PRE_DELAY_RANGE[1], 1);
const HIGH_PASS_ENTRY = plainEntry(`${ko.reverb.highPass} 리버브 값(Hz)`, REVERB_HIGH_PASS_RANGE[0], REVERB_HIGH_PASS_RANGE[1], 10);
const LOW_PASS_ENTRY = plainEntry(`${ko.reverb.lowPass} 리버브 값(Hz)`, REVERB_LOW_PASS_RANGE[0], REVERB_LOW_PASS_RANGE[1], 100);
const MOD_AMOUNT_ENTRY = PERCENT_ENTRY(`${ko.reverb.modulation} ${ko.reverb.amount} 값(%)`);
const EQ_LOW_ENTRY = DB_ENTRY(`${ko.reverb.postEq} ${ko.reverb.low} 값(dB)`);
const EQ_MID_ENTRY = DB_ENTRY(`${ko.reverb.postEq} ${ko.reverb.mid} 값(dB)`);
const EQ_HIGH_ENTRY = DB_ENTRY(`${ko.reverb.postEq} ${ko.reverb.high} 값(dB)`);
const DECAY_ENTRY = plainEntry("잔향 길이 값(초)", REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1], 0.1);

/** 잔향 길이 값 글자. 누르면 숫자 칸으로 바뀐다(자기 열림 상태를 가지므로 따로 정의한다) */
function DecayReadout({ decay, onCommit }: { decay: number; onCommit: (input: number) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <strong>
      <ValueEntry
        text={`${decay.toFixed(1)} s`}
        config={DECAY_ENTRY}
        value={decay}
        editing={editing}
        onOpen={() => setEditing(true)}
        onCommit={onCommit}
        onClose={() => setEditing(false)}
      />
    </strong>
  );
}

export function ReverbPluginPanel({ reverb, onChange }: ReverbPluginPanelProps) {
  const gesture = useHistoryGesture("effect:reverb");
  const wetBlend = reverb.wet / Math.max(0.01, reverb.dry + reverb.wet);
  const defaults = DEFAULT_REVERB_SETTINGS;

  function commitDecay(input: number) {
    const next = clampValue(roundTo(DECAY_ENTRY.fromInput(input), 8), REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1]);
    if (next === reverb.decay) return;
    gesture.onChangeStart();
    onChange({ decay: next });
    gesture.onChangeEnd();
  }

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
                <span className="reverb-brand">공간 리버브</span>
                <span className="reverb-subtitle">{ko.reverb.subtitle}</span>
              </div>
              <Toggle
                className={`reverb-power ${reverb.enabled ? "on" : ""}`}
                label="리버브 켜기"
                pressed={reverb.enabled}
                onChange={(enabled) => onChange({ enabled })}
              >
                <span className="reverb-power-lamp" />
                <span>{reverb.enabled ? ko.state.on : ko.state.off}</span>
              </Toggle>
            </section>

            <section className="reverb-tube-module">
              <div className="reverb-tube-window" aria-hidden="true">
                <span />
              </div>
              <Knob
                face="cap"
                label={`${ko.reverb.drive} 리버브`}
                caption={ko.reverb.drive}
                value={reverb.drive}
                min={0}
                max={1}
                step={0.01}
                defaultValue={defaults.drive}
                format={formatPercent}
                entry={DRIVE_ENTRY}
                onChange={(drive) => onChange({ drive })}
                {...gesture}
              />
            </section>

            <section className="reverb-decay-module">
              <span className="reverb-module-title">잔향 길이</span>
              <label className="reverb-model-select">
                <span>공간 유형</span>
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
                <Slider
                  label="잔향 길이"
                  value={reverb.decay}
                  min={REVERB_DECAY_RANGE[0]}
                  max={REVERB_DECAY_RANGE[1]}
                  step={0.1}
                  defaultValue={defaults.decay}
                  format={(value) => `${value.toFixed(1)}초`}
                  onChange={(decay) => onChange({ decay })}
                  {...gesture}
                />
                <div className="reverb-decay-scale" aria-hidden="true">
                  <span>{ko.reverb.decayLong}</span>
                  <span>8</span>
                  <span>4</span>
                  <span>2</span>
                  <span>{ko.reverb.decayShort}</span>
                </div>
              </div>
              <DecayReadout decay={reverb.decay} onCommit={commitDecay} />
            </section>

            <section className="reverb-blend-module">
              {/* 섞는 비율은 원음·효과음 두 값에서 나온 값이라 더블클릭 기본값을 두지 않는다 */}
              <Knob
                face="cap"
                label={`${ko.reverb.blend} 리버브`}
                caption={ko.reverb.blend}
                value={wetBlend}
                min={0}
                max={1}
                step={0.01}
                format={formatPercent}
                entry={BLEND_ENTRY}
                onChange={(blend) =>
                  onChange({
                    dry: Number((1 - blend).toFixed(2)),
                    wet: Number(blend.toFixed(2)),
                  })
                }
                {...gesture}
              />
              <Knob
                face="cap"
                label={`${ko.reverb.width} 리버브`}
                caption={ko.reverb.width}
                value={reverb.width}
                min={0}
                max={1}
                step={0.01}
                defaultValue={defaults.width}
                format={formatPercent}
                entry={WIDTH_ENTRY}
                onChange={(width) => onChange({ width })}
                {...gesture}
              />
            </section>
          </div>

          <div className="reverb-bottom-strip">
            <div className="reverb-arturia-mark" aria-label="반주 디자이너">RD</div>
            <Knob
              face="cap"
              size="small"
              label={`${ko.reverb.preDelay} 리버브`}
              caption={ko.reverb.preDelay}
              value={reverb.preDelayMs}
              min={REVERB_PRE_DELAY_RANGE[0]}
              max={REVERB_PRE_DELAY_RANGE[1]}
              step={1}
              defaultValue={defaults.preDelayMs}
              format={formatMs}
              entry={PRE_DELAY_ENTRY}
              onChange={(preDelayMs) => onChange({ preDelayMs })}
              {...gesture}
            />
            <Knob
              face="cap"
              size="small"
              curve="log"
              label={`${ko.reverb.highPass} 리버브`}
              caption={ko.reverb.highPass}
              value={reverb.highPassHz}
              min={REVERB_HIGH_PASS_RANGE[0]}
              max={REVERB_HIGH_PASS_RANGE[1]}
              step={10}
              defaultValue={defaults.highPassHz}
              format={formatHz}
              entry={HIGH_PASS_ENTRY}
              onChange={(highPassHz) => onChange({ highPassHz })}
              {...gesture}
            />
            <Knob
              face="cap"
              size="small"
              curve="log"
              label={`${ko.reverb.lowPass} 리버브`}
              caption={ko.reverb.lowPass}
              value={reverb.lowPassHz}
              min={REVERB_LOW_PASS_RANGE[0]}
              max={REVERB_LOW_PASS_RANGE[1]}
              step={100}
              defaultValue={defaults.lowPassHz}
              format={formatHz}
              entry={LOW_PASS_ENTRY}
              onChange={(lowPassHz) => onChange({ lowPassHz })}
              {...gesture}
            />

            <section className="reverb-mod-section">
              <span>{ko.reverb.modulation}</span>
              <label className="reverb-toggle">
                <input
                  checked={reverb.modEnabled}
                  onChange={(event) => onChange({ modEnabled: event.target.checked })}
                  type="checkbox"
                />
                <i />
                사용
              </label>
              <Knob
                face="cap"
                size="small"
                label={`${ko.reverb.modulation} ${ko.reverb.amount}`}
                caption={ko.reverb.amount}
                value={reverb.modAmount}
                min={0}
                max={1}
                step={0.01}
                defaultValue={defaults.modAmount}
                format={formatPercent}
                entry={MOD_AMOUNT_ENTRY}
                onChange={(modAmount) => onChange({ modAmount })}
                {...gesture}
              />
            </section>

            <section className="reverb-eq-section">
              <span>{ko.reverb.postEq}</span>
              <Knob
                face="cap"
                size="small"
                label={`${ko.reverb.postEq} ${ko.reverb.low}`}
                caption={ko.reverb.low}
                value={reverb.postEqLowGain}
                min={EQ_GAIN_RANGE[0]}
                max={EQ_GAIN_RANGE[1]}
                step={0.5}
                defaultValue={defaults.postEqLowGain}
                format={formatDb}
                entry={EQ_LOW_ENTRY}
                onChange={(postEqLowGain) => onChange({ postEqLowGain })}
                {...gesture}
              />
              <Knob
                face="cap"
                size="small"
                label={`${ko.reverb.postEq} ${ko.reverb.mid}`}
                caption={ko.reverb.mid}
                value={reverb.postEqMidGain}
                min={EQ_GAIN_RANGE[0]}
                max={EQ_GAIN_RANGE[1]}
                step={0.5}
                defaultValue={defaults.postEqMidGain}
                format={formatDb}
                entry={EQ_MID_ENTRY}
                onChange={(postEqMidGain) => onChange({ postEqMidGain })}
                {...gesture}
              />
              <Knob
                face="cap"
                size="small"
                label={`${ko.reverb.postEq} ${ko.reverb.high}`}
                caption={ko.reverb.high}
                value={reverb.postEqHighGain}
                min={EQ_GAIN_RANGE[0]}
                max={EQ_GAIN_RANGE[1]}
                step={0.5}
                defaultValue={defaults.postEqHighGain}
                format={formatDb}
                entry={EQ_HIGH_ENTRY}
                onChange={(postEqHighGain) => onChange({ postEqHighGain })}
                {...gesture}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
