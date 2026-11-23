import { Headphones, Mic, Music2, Timer, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../../audio/currentEngine";
import { CommittedNumberInput } from "../../components/CommittedNumberInput";
import { LATENCY_OFFSET_MAX_MS, LATENCY_OFFSET_MIN_MS } from "../../domain/recording/latency";
import { ko } from "../../i18n/ko";
import { readMonitorVolume, writeMonitorVolume } from "../../services/monitorVolume";
import { useRecordingStore } from "../../state/recordingStore";
import { useDismiss } from "../useDismiss";

interface RecordOptionsProps {
  isRecording: boolean;
  /** inline: 한 줄에 모두 펼침(넓은 화면). popover: "녹음 설정" 버튼 뒤로 접음(좁은 화면). */
  variant: "inline" | "popover";
}

/** 입력 모니터링 · 녹음 메트로놈 · 카운트인 · 입력 장치 */
export function RecordOptions({ isRecording, variant }: RecordOptionsProps) {
  const monitoringEnabled = useRecordingStore((state) => state.monitoringEnabled);
  const metronomeEnabled = useRecordingStore((state) => state.metronomeEnabled);
  const countInBeats = useRecordingStore((state) => state.countInBeats);
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
      </button>
      <label className="monitor-volume-control" title={ko.monitor.volumeTitle}>
        <Volume2 size={14} aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={monitorPercent}
          aria-label={ko.monitor.volumeLabel}
          aria-valuetext={ko.monitor.volumeValue(monitorPercent)}
          data-testid="monitor-volume"
          onChange={(event) => {
            const next = Number(event.target.value) / 100;
            setMonitorVolume(next);
            writeMonitorVolume(next);
          }}
        />
      </label>
      <label className="count-in-control">
        <Timer size={14} />
        <select
          aria-label="녹음 카운트인"
          disabled={isRecording}
          onChange={(event) => setRecordingCountIn(Number(event.target.value))}
          value={countInBeats}
        >
          <option value={0}>카운트 없음</option>
          <option value={1}>1박</option>
          <option value={2}>2박</option>
          <option value={4}>1마디</option>
          <option value={8}>2마디</option>
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
