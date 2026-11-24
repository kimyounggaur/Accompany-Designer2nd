import { Download, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
  applyBpmToClip,
  applyBpmToProject,
  cancelBpmDetection,
  canScaleBpmSuggestion,
  scaleBpmSuggestion,
  startBpmDetection,
} from "../../app/bpmDetection";
import { toggleTempoMatch } from "../../app/tempoMatch";
import { CommittedNumberInput } from "../controls/CommittedNumberInput";
import { plainEntry } from "../controls/entries";
import { Slider, type SliderEntry } from "../controls/Slider";
import { useHistoryGesture, useTextGesture } from "./useHistoryGesture";
import { DEFAULT_CLIP_GAIN } from "../../domain/project/defaults";
import { BPM_RANGE, CLIP_GAIN_RANGE, CLIP_SOURCE_BPM_RANGE } from "../../domain/project/ranges";
import { formatPlaybackRate, formatSemitones, rateToSemitones } from "../../domain/timeline/pitch";
import { ko } from "../../i18n/ko";
import { hasRememberedAudio, recallAudio } from "../../services/persistence/audioBlobs";
import { useBpmStore } from "../../state/bpmStore";
import { useDawStore } from "../../store/useDawStore";
import { deleteClip } from "../../app/actions";
import { findClip, getClipPlaybackRate, getClipTimelineDuration } from "../../utils/audioMath";
import { PanelSection } from "./PanelSection";

/** 게인 숫자 칸: 슬라이더와 같은 단위(0 ~ 2배) */
const GAIN_ENTRY: SliderEntry = {
  ...plainEntry(ko.clip.gainValue, CLIP_GAIN_RANGE[0], CLIP_GAIN_RANGE[1], 0.01),
  className: "clip-gain__number",
  testId: "clip-gain-input",
};

/**
 * 선택한 클립의 설정. 상단 바에 있던 템포 맞춤(예전 이름 WARP)·원본 BPM·배속 묶음이 여기로 왔다(클립마다 다른 값이므로).
 * 이 칸에 따로 있던 "소스 BPM"·"스트레치"·"속도"는 템포 맞춤 묶음과 같은 값이어서 하나로 합쳤다.
 *
 * 숫자로 정하는 값(원본 BPM·게인)은 모두 숫자 칸(CommittedNumberInput)으로도 입력할 수 있다(설계서 §P4-4).
 * 배속 옆에는 그만큼 달라지는 음정을 반음으로 보여 준다: 지금의 템포 맞춤은 속도와 음정이 함께 바뀐다.
 */
export function ClipPanel() {
  const tracks = useDawStore((state) => state.tracks);
  const assets = useDawStore((state) => state.assets);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const bpm = useDawStore((state) => state.bpm);
  const updateClip = useDawStore((state) => state.updateClip);
  const gesture = useHistoryGesture(`clip:${selectedClipId ?? "none"}:panel`);
  const nameGesture = useTextGesture(`clip:${selectedClipId ?? "none"}:name`);
  const detection = useBpmStore((state) => state.detection);
  const text = ko.clip;

  const selectedClip = useMemo(() => findClip(tracks, selectedClipId)?.clip, [tracks, selectedClipId]);
  const asset = selectedClip ? assets[selectedClip.audioBufferId] : undefined;
  const warpOn = selectedClip?.stretchMode === "resample";
  const playbackRate = selectedClip ? getClipPlaybackRate(bpm, selectedClip) : 1;
  const semitones = warpOn ? rateToSemitones(playbackRate) : 0;
  /** 이 클립의 감지 상태(다른 클립의 감지는 이 칸에 보이지 않는다) */
  const bpmState = selectedClip && detection.status !== "idle" && detection.clipId === selectedClip.id ? detection : undefined;

  // 문서에는 음원의 정보만 있고 데이터는 따로 기억해 둔다(서비스 audioBlobs). 저장할 때 그 데이터로 주소를 만든다.
  const wavBlob = asset ? hasRememberedAudio(asset.id) : false;

  function downloadRecordingWav() {
    if (!asset) return;
    const blob = recallAudio(asset.id);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = asset.fileName.toLowerCase().endsWith(".wav") ? asset.fileName : `${asset.fileName}.wav`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <PanelSection
      id="clip"
      title="클립"
      className="clip-panel"
      actions={
        selectedClip && (
          <button
            className="icon-button danger"
            onClick={() => deleteClip(selectedClip.id)}
            title="클립 삭제"
            aria-label="클립 삭제"
            type="button"
          >
            <Trash2 size={16} />
          </button>
        )
      }
    >
      {selectedClip ? (
        <div className="control-stack" data-testid="clip-panel">
          <label>
            이름
            <input
              value={selectedClip.name}
              {...nameGesture}
              onChange={(event) => updateClip(selectedClip.id, { name: event.target.value })}
            />
          </label>

          <div className={`warp-block ${warpOn ? "on" : ""}`} data-testid="warp-block">
            <button
              className={`warp-block__toggle ${warpOn ? "on" : ""}`}
              aria-pressed={warpOn}
              onClick={() => toggleTempoMatch(selectedClip.id)}
              title={warpOn ? text.tempoMatchOnTitle : text.tempoMatchOffTitle}
              data-testid="warp-toggle"
              type="button"
            >
              <span className="warp-block__led" />
              <span className="warp-block__name">{text.tempoMatch}</span>
              <span className="warp-block__suffix">{text.tempoMatchSuffix}</span>
            </button>
            <label className="warp-block__field">
              <span className="warp-block__label">{text.sourceBpm}</span>
              <CommittedNumberInput
                key={selectedClip.id}
                label={text.sourceBpm}
                testId="source-bpm-input"
                min={CLIP_SOURCE_BPM_RANGE[0]}
                max={CLIP_SOURCE_BPM_RANGE[1]}
                step={0.1}
                value={selectedClip.sourceBpm}
                onCommit={(value) => updateClip(selectedClip.id, { sourceBpm: value })}
              />
            </label>
            <div className="warp-block__rate" title={text.rateTitle}>
              <span className="warp-block__label">{text.rate}</span>
              <span className="warp-block__rate-line">
                <span
                  className={`warp-block__rate-value ${warpOn && Math.abs(playbackRate - 1) > 0.01 ? "active" : ""}`}
                  data-testid="warp-rate"
                >
                  {formatPlaybackRate(warpOn ? playbackRate : 1)}
                </span>
                <span className={`warp-block__pitch ${semitones !== 0 ? "active" : ""}`} data-testid="warp-pitch">
                  {formatSemitones(semitones)}
                </span>
              </span>
            </div>
          </div>

          <div className="clip-gain">
            <label htmlFor="clip-gain-range">{text.gain}</label>
            <div className="clip-gain__row">
              <Slider
                key={selectedClip.id}
                id="clip-gain-range"
                label={text.gain}
                min={CLIP_GAIN_RANGE[0]}
                max={CLIP_GAIN_RANGE[1]}
                step={0.01}
                value={selectedClip.gain}
                defaultValue={DEFAULT_CLIP_GAIN}
                format={(gain) => `${gain.toFixed(2)}배`}
                testId="clip-gain"
                entry={GAIN_ENTRY}
                onChange={(gain) => updateClip(selectedClip.id, { gain })}
                {...gesture}
              />
            </div>
          </div>
          <button
            className={selectedClip.muted ? "toggle active danger" : "toggle"}
            onClick={() => updateClip(selectedClip.id, { muted: !selectedClip.muted })}
            aria-pressed={Boolean(selectedClip.muted)}
            type="button"
          >
            클립 음소거
          </button>
          <div className="mini-readout">
            <span>길이 {getClipTimelineDuration(bpm, selectedClip).toFixed(2)}초</span>
          </div>

          <div className="bpm-detect" data-testid="bpm-detect-block">
            <button
              className="text-button full"
              disabled={bpmState?.status === "running"}
              onClick={() => void startBpmDetection(selectedClip.id)}
              title={text.bpm.detectTitle}
              data-testid="bpm-detect"
              type="button"
            >
              {text.bpm.detect}
            </button>
            {bpmState?.status === "running" && (
              <div className="bpm-detect__progress" data-testid="bpm-progress">
                <progress
                  aria-label={text.bpm.progressLabel}
                  max={1}
                  value={bpmState.progress}
                  data-progress={bpmState.progress}
                />
                <span className="bpm-detect__percent">{text.bpm.progress(Math.round(bpmState.progress * 100))}</span>
                <button
                  className="text-button"
                  onClick={cancelBpmDetection}
                  title={text.bpm.cancelTitle}
                  data-testid="bpm-cancel"
                  type="button"
                >
                  {text.bpm.cancel}
                </button>
              </div>
            )}
            {bpmState?.status === "done" && (
              <div className="bpm-detect__result" data-testid="bpm-result">
                <p className="asset-meta" role="status" data-testid="bpm-result-text" data-value={bpmState.value}>
                  {text.bpm.result(bpmState.value)}
                </p>
                <div className="bpm-detect__scale">
                  <button
                    className="text-button"
                    disabled={!canScaleBpmSuggestion(bpmState.value, 0.5)}
                    onClick={() => scaleBpmSuggestion(0.5)}
                    title={text.bpm.halfTitle}
                    data-testid="bpm-half"
                    type="button"
                  >
                    {text.bpm.half}
                  </button>
                  <button
                    className="text-button"
                    disabled={!canScaleBpmSuggestion(bpmState.value, 2)}
                    onClick={() => scaleBpmSuggestion(2)}
                    title={text.bpm.doubleTitle}
                    data-testid="bpm-double"
                    type="button"
                  >
                    {text.bpm.double}
                  </button>
                </div>
                <button
                  className="text-button full"
                  disabled={bpmState.value < CLIP_SOURCE_BPM_RANGE[0] || bpmState.value > CLIP_SOURCE_BPM_RANGE[1]}
                  onClick={applyBpmToClip}
                  data-testid="bpm-apply-clip"
                  type="button"
                >
                  {text.bpm.applyToClip}
                </button>
                <button
                  className="text-button full"
                  disabled={bpmState.value < BPM_RANGE[0] || bpmState.value > BPM_RANGE[1]}
                  onClick={applyBpmToProject}
                  data-testid="bpm-apply-project"
                  type="button"
                >
                  {text.bpm.applyToProject}
                </button>
              </div>
            )}
            {bpmState?.status === "failed" && (
              <p className="asset-meta" role="status" data-testid="bpm-status">
                {bpmState.message}
              </p>
            )}
            {bpmState?.status === "cancelled" && (
              <p className="asset-meta" role="status" data-testid="bpm-status">
                {text.bpm.cancelled}
              </p>
            )}
          </div>

          {asset && (
            <p className="asset-meta">
              {asset.fileName} · {asset.duration.toFixed(2)}초 · {asset.sampleRate}Hz
            </p>
          )}
          {asset?.source === "recording" && (
            <div className="recording-save-box">
              <p className="asset-meta">
                WAV {asset.byteSize ? `${(asset.byteSize / 1024).toFixed(1)}KB` : ""}
                {asset.recordedAt ? ` · ${new Date(asset.recordedAt).toLocaleString()}` : ""}
              </p>
              <button
                className="text-button full"
                disabled={!wavBlob}
                onClick={downloadRecordingWav}
                title={wavBlob ? "녹음 WAV 저장" : ko.clip.noWavData}
                type="button"
              >
                <Download size={16} />
                WAV 저장
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="empty-state">클립을 선택하면 편집 값이 표시됩니다.</p>
      )}
    </PanelSection>
  );
}
