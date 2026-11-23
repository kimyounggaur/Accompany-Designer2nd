import { Download, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { audioEngine } from "../../audio/audioEngine";
import { estimateBpm } from "../../audio/bpmDetector";
import { CommittedNumberInput } from "../../components/CommittedNumberInput";
import { ko } from "../../i18n/ko";
import { useDawStore } from "../../store/useDawStore";
import { deleteClip } from "../../app/actions";
import { findClip, getClipPlaybackRate, getClipTimelineDuration } from "../../utils/audioMath";
import { PanelSection } from "./PanelSection";

/**
 * 선택한 클립의 설정. 상단 바에 있던 WARP·원본 BPM·배속 묶음이 여기로 왔다(클립마다 다른 값이므로).
 * 이 칸에 따로 있던 "소스 BPM"·"스트레치"·"속도"는 WARP 묶음과 같은 값이어서 하나로 합쳤다.
 */
export function ClipPanel() {
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const bpm = useDawStore((state) => state.bpm);
  const setBpm = useDawStore((state) => state.setBpm);
  const updateClip = useDawStore((state) => state.updateClip);
  const updateAudioAsset = useDawStore((state) => state.updateAudioAsset);
  const beginHistoryGroup = useDawStore((state) => state.beginHistoryGroup);
  const endHistoryGroup = useDawStore((state) => state.endHistoryGroup);
  const [bpmStatus, setBpmStatus] = useState("");
  const [bpmSuggestion, setBpmSuggestion] = useState<{ clipId: string; value: number }>();

  const selectedClip = useMemo(() => findClip(tracks, selectedClipId)?.clip, [tracks, selectedClipId]);
  const asset = selectedClip ? audioAssets[selectedClip.audioBufferId] : undefined;
  const warpOn = selectedClip?.stretchMode === "resample";
  const playbackRate = selectedClip ? getClipPlaybackRate(bpm, selectedClip) : 1;

  function detectClipBpm() {
    if (!selectedClip) return;

    const buffer = audioEngine.getBuffer(selectedClip.audioBufferId);
    if (!buffer) {
      setBpmStatus("오디오 버퍼가 없어 BPM을 분석할 수 없습니다.");
      return;
    }

    setBpmStatus("BPM 분석 중...");
    window.setTimeout(() => {
      const detected = estimateBpm(buffer);
      if (!detected) {
        setBpmStatus("BPM을 안정적으로 추정하지 못했습니다.");
        return;
      }

      updateAudioAsset(selectedClip.audioBufferId, { detectedBpm: detected }, { history: false });
      setBpmSuggestion({ clipId: selectedClip.id, value: detected });
      setBpmStatus(`추정 BPM ${detected} · 곡에 따라 절반이나 두 배로 감지될 수 있습니다.`);
    }, 30);
  }

  function downloadRecordingWav() {
    if (!asset?.blobUrl) return;

    const anchor = document.createElement("a");
    anchor.href = asset.blobUrl;
    anchor.download = asset.fileName.toLowerCase().endsWith(".wav") ? asset.fileName : `${asset.fileName}.wav`;
    anchor.click();
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
              onFocus={beginHistoryGroup}
              onBlur={endHistoryGroup}
              onChange={(event) => updateClip(selectedClip.id, { name: event.target.value })}
            />
          </label>

          <div className={`warp-block ${warpOn ? "on" : ""}`} data-testid="warp-block">
            <button
              className={`warp-block__toggle ${warpOn ? "on" : ""}`}
              aria-pressed={warpOn}
              onClick={() => updateClip(selectedClip.id, { stretchMode: warpOn ? "none" : "resample" })}
              title={warpOn ? "Warp 끄기" : "Warp 켜기"}
              data-testid="warp-toggle"
              type="button"
            >
              <span className="warp-block__led" />
              <span>WARP</span>
            </button>
            <label className="warp-block__field">
              <span className="warp-block__label">원본 BPM</span>
              <CommittedNumberInput
                key={selectedClip.id}
                label="원본 BPM"
                testId="source-bpm-input"
                min={20}
                max={300}
                step={0.1}
                value={selectedClip.sourceBpm}
                onCommit={(value) => updateClip(selectedClip.id, { sourceBpm: value })}
              />
            </label>
            <div className="warp-block__rate" title="현재 재생 배속">
              <span className="warp-block__label">배속</span>
              <span
                className={`warp-block__rate-value ${
                  warpOn && Math.abs(playbackRate - 1) > 0.01 ? "active" : ""
                }`}
                data-testid="warp-rate"
              >
                {warpOn ? `${playbackRate.toFixed(2)}×` : "1.00×"}
              </span>
            </div>
          </div>

          <label>
            게인
            <input
              max={2}
              min={0}
              step={0.01}
              type="range"
              value={selectedClip.gain}
              onChange={(event) => updateClip(selectedClip.id, { gain: Number(event.target.value) })}
            />
          </label>
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
          <button className="text-button full" onClick={detectClipBpm} type="button">
            BPM 감지
          </button>
          {bpmSuggestion?.clipId === selectedClip.id && (
            <div className="control-stack">
              <button
                className="text-button full"
                type="button"
                onClick={() => {
                  updateClip(selectedClip.id, { sourceBpm: bpmSuggestion.value });
                  setBpmStatus(`클립 원본 BPM을 ${bpmSuggestion.value}(으)로 설정했습니다.`);
                }}
              >
                클립 원본 BPM에 적용
              </button>
              <button
                className="text-button full"
                type="button"
                onClick={() => {
                  setBpm(bpmSuggestion.value);
                  setBpmStatus(`프로젝트 템포를 ${bpmSuggestion.value}(으)로 설정했습니다.`);
                }}
              >
                프로젝트 템포에 적용
              </button>
            </div>
          )}
          {asset && (
            <p className="asset-meta">
              {asset.fileName} · {asset.duration.toFixed(2)}초 · {asset.sampleRate}Hz
            </p>
          )}
          {asset?.sourceType === "recording" && (
            <div className="recording-save-box">
              <p className="asset-meta">
                WAV {asset.byteSize ? `${(asset.byteSize / 1024).toFixed(1)}KB` : ""}
                {asset.recordedAt ? ` · ${new Date(asset.recordedAt).toLocaleString()}` : ""}
              </p>
              <button
                className="text-button full"
                disabled={!asset.blobUrl}
                onClick={downloadRecordingWav}
                title={asset.blobUrl ? "녹음 WAV 저장" : ko.clip.noWavData}
                type="button"
              >
                <Download size={16} />
                WAV 저장
              </button>
            </div>
          )}
          {bpmStatus && <p className="asset-meta">{bpmStatus}</p>}
        </div>
      ) : (
        <p className="empty-state">클립을 선택하면 편집 값이 표시됩니다.</p>
      )}
    </PanelSection>
  );
}
