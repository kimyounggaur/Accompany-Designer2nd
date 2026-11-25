import { Headphones, Mic, Music2, Timer, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../../audio/currentEngine";
import { MONITOR_VOLUME_DEFAULT } from "../../audio/engine/MonitorBus";
import { CommittedNumberInput } from "../controls/CommittedNumberInput";
import { plainEntry } from "../controls/entries";
import { Slider, type SliderEntry } from "../controls/Slider";
import { LATENCY_OFFSET_MAX_MS, LATENCY_OFFSET_MIN_MS } from "../../domain/recording/latency";
import { countInOptions, effectiveCountIn, type CountInOption } from "../../domain/timeline/snap";
import { ko } from "../../i18n/ko";
import { readMonitorVolume, writeMonitorVolume } from "../../services/monitorVolume";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";
import { useDismiss } from "../useDismiss";

/** 모니터 볼륨 숫자 칸: 슬라이더와 같은 단위(퍼센트, 5씩) */
const MONITOR_ENTRY: SliderEntry = {
  ...plainEntry(ko.monitor.volumeInput, 0, 100, 5),
  className: "monitor-volume-number",
  testId: "monitor-volume-input",
};

/** 카운트인 선택지의 이름: 카운트 없음 · n박 · n마디 */
function countInLabel(option: CountInOption): string {
  if (option.unit === "none") return "카운트 없음";
  return `${option.count}${option.unit === "beat" ? "박" : "마디"}`;
}

interface RecordOptionsProps {
  isRecording: boolean;
  /**
   * inline: 한 줄에 모두 펼침(넓은 화면). popover: "녹음 설정" 버튼 뒤로 접음(좁은 화면).
   * sheet: 휴대폰 모드의 아래 시트 안에 늘 펼쳐 둠(설계서 §P6-5). 단추마다 글자 이름표가 붙는다.
   */
  variant: "inline" | "popover" | "sheet";
}

/** 입력 모니터링 · 녹음 메트로놈 · 카운트인 · 입력 장치 */
export function RecordOptions({ isRecording, variant }: RecordOptionsProps) {
  const monitoringEnabled = useRecordingStore((state) => state.monitoringEnabled);
  const metronomeEnabled = useRecordingStore((state) => state.metronomeEnabled);
  const storedCountIn = useRecordingStore((state) => state.countInBeats);
  const timeSignature = useDawStore((state) => state.timeSignature);
  const inputDeviceId = useRecordingStore((state) => state.inputDeviceId);
  const latencyOffsetMs = useRecordingStore((state) => state.latencyOffsetMs);
  const setRecordingInputDevice = useRecordingStore((state) => state.setInputDevice);
  const setRecordingMonitoring = useRecordingStore((state) => state.setMonitoring);
  const setRecordingMetronome = useRecordingStore((state) => state.setMetronome);
  const setRecordingCountIn = useRecordingStore((state) => state.setCountIn);
  const setLatencyOffsetMs = useRecordingStore((state) => state.setLatencyOffsetMs);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [monitorVolume, setMonitorVolume] = useState(readMonitorVolume);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismiss(rootRef, open, () => setOpen(false));

  // 기억해 둔 모니터 볼륨을 소리 엔진에 알린다(엔진은 소리 길을 만들 때 이 값을 쓴다). 녹음 중에도 바꿀 수 있다.
  useEffect(() => {
    audioEngine.setMonitorVolume(monitorVolume);
  }, [monitorVolume]);

  const monitorPercent = Math.round(monitorVolume * 100);
  // 카운트인 선택지는 박자표를 따른다(3/4의 "1마디"는 3박). 화면의 값과 녹음이 실제로 세는 박 수는 같은 함수로 정한다.
  const countInChoices = countInOptions(timeSignature);
  const countInBeats = effectiveCountIn(storedCountIn, timeSignature);

  useEffect(() => {
    let mounted = true;

    async function loadInputs() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mounted) return;
      setInputDevices(devices.filter((device) => device.kind === "audioinput"));
    }

    void loadInputs();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadInputs);
    return () => {
      mounted = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadInputs);
    };
  }, []);

  const sheet = variant === "sheet";
  const controls = (
    <>
      <button
        className={`icon-button monitor-button ${monitoringEnabled ? "active" : ""}`}
        disabled={isRecording}
        onClick={() => setRecordingMonitoring(!monitoringEnabled)}
        title="입력 모니터링"
        aria-pressed={monitoringEnabled}
        type="button"
      >
        <Headphones size={16} />
        {sheet && <span>{ko.phone.monitorLabel}</span>}
      </button>
      <button
        className={`icon-button metronome-button ${metronomeEnabled ? "active" : ""}`}
        disabled={isRecording}
        onClick={() => setRecordingMetronome(!metronomeEnabled)}
        title="녹음 메트로놈"
        aria-pressed={metronomeEnabled}
        type="button"
      >
        <Music2 size={16} />
        {sheet && <span>{ko.phone.metronomeLabel}</span>}
      </button>
      <label className="monitor-volume-control" title={ko.monitor.volumeTitle}>
        <Volume2 size={14} aria-hidden="true" />
        <Slider
          label={ko.monitor.volumeLabel}
          min={0}
          max={100}
          step={5}
          value={monitorPercent}
          defaultValue={Math.round(MONITOR_VOLUME_DEFAULT * 100)}
          format={ko.monitor.volumeValue}
          testId="monitor-volume"
          entry={MONITOR_ENTRY}
          onChange={(percent) => {
            const next = percent / 100;
            setMonitorVolume(next);
            writeMonitorVolume(next);
          }}
        />
      </label>
      <label className="count-in-control">
        <Timer size={14} />
        {sheet && <span>{ko.phone.countInLabel}</span>}
        <select
          aria-label="녹음 카운트인"
          disabled={isRecording}
          onChange={(event) => setRecordingCountIn(Number(event.target.value))}
          value={countInBeats}
        >
          {countInChoices.map((option) => (
            <option key={option.value} value={option.value}>
              {countInLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className="latency-control" title={ko.record.latencyTitle}>
        <span>{ko.record.latencyLabel}</span>
        <CommittedNumberInput
          label={ko.record.latencyAria}
          testId="latency-offset"
          value={latencyOffsetMs}
          min={LATENCY_OFFSET_MIN_MS}
          max={LATENCY_OFFSET_MAX_MS}
          step={5}
          disabled={isRecording}
          onCommit={(value) => setLatencyOffsetMs(value)}
        />
        <span aria-hidden="true">{ko.record.latencyUnit}</span>
      </label>
      <label className="input-select-control">
        <span>입력</span>
        <select
          aria-label="녹음 입력 장치"
          disabled={isRecording}
          onChange={(event) => setRecordingInputDevice(event.target.value || undefined)}
          value={inputDeviceId ?? ""}
        >
          <option value="">기본 마이크</option>
          {inputDevices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `입력 ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  if (variant === "inline") {
    return <div className="transport-group record-options-group">{controls}</div>;
  }

  if (variant === "sheet") {
    return (
      <div className="record-options-group record-options-sheet" data-testid="record-options-sheet">
        {controls}
      </div>
    );
  }

  return (
    <div className="transport-group record-options-group popover-host" ref={rootRef}>
      <button
        className={`text-button ${open ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="녹음 설정"
        data-testid="record-options-toggle"
        type="button"
      >
        <Mic size={16} />
        <span>녹음 설정</span>
      </button>
      {open && (
        <div className="popover-panel record-options-popover" role="dialog" aria-label="녹음 설정" data-testid="record-options-popover">
          {controls}
        </div>
      )}
    </div>
  );
}
