import { Trash2 } from "lucide-react";
import { useMemo, useState, useRef, useCallback } from "react";
import { estimateBpm } from "../audio/bpmDetector";
import { audioEngine } from "../audio/audioEngine";
import { useDawStore } from "../store/useDawStore";
import type { CompressorSettings, EqSettings } from "../types";
import {
  findClip,
  getClipPlaybackRate,
  getClipTimelineDuration,
} from "../utils/audioMath";

export function Inspector() {
  const [bpmStatus, setBpmStatus] = useState("");
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const bpm = useDawStore((state) => state.bpm);
  const updateClip = useDawStore((state) => state.updateClip);
  const updateTrack = useDawStore((state) => state.updateTrack);
  const updateAudioAsset = useDawStore((state) => state.updateAudioAsset);
  const deleteClip = useDawStore((state) => state.deleteClip);

  const selection = useMemo(
    () => findClip(tracks, selectedClipId),
    [selectedClipId, tracks],
  );
  const selectedTrack = selection?.track ?? tracks[0];
  const selectedClip = selection?.clip;
  const asset = selectedClip ? audioAssets[selectedClip.audioBufferId] : undefined;

  function updateEq(patch: Partial<EqSettings>) {
    updateTrack(selectedTrack.id, {
      eq: {
        ...selectedTrack.eq,
        ...patch,
      },
    });
  }

  function EqKnob({
    label,
    value,
    color,
    onChange,
  }: {
    label: string;
    value: number;
    color: string;
    onChange: (v: number) => void;
  }) {
    const dragging = useRef(false);
    const startY = useRef(0);
    const startVal = useRef(0);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
      dragging.current = true;
      startY.current = e.clientY;
      startVal.current = value;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [value]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
      if (!dragging.current) return;
      const delta = (startY.current - e.clientY) * 0.25;
      const next = Math.max(-12, Math.min(12, startVal.current + delta));
      onChange(Math.round(next * 2) / 2);
    }, [onChange]);

    const onPointerUp = useCallback(() => { dragging.current = false; }, []);

    const angle = (value / 12) * 135;
    const rad = (angle - 90) * (Math.PI / 180);
    const cx = 32, cy = 32, r = 20;
    const tx = cx + r * Math.cos(rad);
    const ty = cy + r * Math.sin(rad);

    return (
      <div className="eq-band" style={{ background: color }}>
        <svg
          className="eq-knob"
          viewBox="0 0 64 64"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ cursor: "ns-resize", touchAction: "none" }}
        >
          <circle cx={cx} cy={cy} r={28} fill="#2a2a2a" />
          <circle cx={cx} cy={cy} r={22} fill="#3a3a3a" />
          <circle cx={cx} cy={cy} r={20} fill="#444" />
          <line x1={cx} y1={cy} x2={tx} y2={ty} stroke="#e8e8e0" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
        <span className="eq-band-label">{label}</span>
        <span className="eq-band-value">{value > 0 ? `+${value}` : value}dB</span>
      </div>
    );
  }

  function updateCompressor(patch: Partial<CompressorSettings>) {
    updateTrack(selectedTrack.id, {
      compressor: {
        ...selectedTrack.compressor,
        ...patch,
      },
    });
  }

  function detectClipBpm() {
    if (!selectedClip) {
      return;
    }

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

      updateClip(selectedClip.id, { sourceBpm: detected });
      updateAudioAsset(selectedClip.audioBufferId, { detectedBpm: detected });
      setBpmStatus(`추정 BPM ${detected}`);
    }, 30);
  }

  if (!selectedTrack) {
    return <aside className="inspector" />;
  }

  return (
    <aside className="inspector">
      <section className="panel">
        <div className="panel-heading">
          <h2>클립</h2>
          {selectedClip && (
            <button
              className="icon-button danger"
              onClick={() => deleteClip(selectedClip.id)}
              title="클립 삭제"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        {selectedClip ? (
          <div className="control-stack">
            <label>
              이름
              <input
                value={selectedClip.name}
                onChange={(event) =>
                  updateClip(selectedClip.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              소스 BPM
              <input
                min={20}
                max={300}
                type="number"
                value={selectedClip.sourceBpm}
                onChange={(event) =>
                  updateClip(selectedClip.id, {
                    sourceBpm: Number(event.target.value) || bpm,
                  })
                }
              />
            </label>
            <label>
              게인
              <input
                max={2}
                min={0}
                step={0.01}
                type="range"
                value={selectedClip.gain}
                onChange={(event) =>
                  updateClip(selectedClip.id, { gain: Number(event.target.value) })
                }
              />
            </label>
            <button
              className={selectedClip.muted ? "toggle active danger" : "toggle"}
              onClick={() =>
                updateClip(selectedClip.id, { muted: !selectedClip.muted })
              }
            >
              클립 음소거
            </button>
            <label>
              스트레치
              <select
                value={selectedClip.stretchMode}
                onChange={(event) =>
                  updateClip(selectedClip.id, {
                    stretchMode: event.target.value as "none" | "resample",
                  })
                }
              >
                <option value="resample">실시간 재생 속도</option>
                <option value="none">원본 속도</option>
              </select>
            </label>
            <div className="mini-readout">
              <span>속도 {getClipPlaybackRate(bpm, selectedClip).toFixed(2)}x</span>
              <span>
                길이 {getClipTimelineDuration(bpm, selectedClip).toFixed(2)}초
              </span>
            </div>
            <button className="text-button full" onClick={detectClipBpm}>
              BPM 감지
            </button>
            {asset && (
              <p className="asset-meta">
                {asset.fileName} · {asset.duration.toFixed(2)}초 · {asset.sampleRate}Hz
              </p>
            )}
            {bpmStatus && <p className="asset-meta">{bpmStatus}</p>}
          </div>
        ) : (
          <p className="empty-state">클립을 선택하면 편집 값이 표시됩니다.</p>
        )}
      </section>

      <section className="panel">
        <h2>트랙 믹스</h2>
        <div className="control-stack">
          <label>
            볼륨
            <input
              max={1}
              min={0}
              step={0.01}
              type="range"
              value={selectedTrack.volume}
              onChange={(event) =>
                updateTrack(selectedTrack.id, { volume: Number(event.target.value) })
              }
            />
          </label>
          <label>
            팬
            <input
              max={1}
              min={-1}
              step={0.01}
              type="range"
              value={selectedTrack.pan}
              onChange={(event) =>
                updateTrack(selectedTrack.id, { pan: Number(event.target.value) })
              }
            />
          </label>
          <div className="button-row">
            <button
              className={selectedTrack.muted ? "toggle active danger" : "toggle"}
              onClick={() =>
                updateTrack(selectedTrack.id, { muted: !selectedTrack.muted })
              }
            >
              음소거
            </button>
            <button
              className={selectedTrack.solo ? "toggle active" : "toggle"}
              onClick={() =>
                updateTrack(selectedTrack.id, { solo: !selectedTrack.solo })
              }
            >
              솔로
            </button>
          </div>
        </div>
      </section>

      <section className="panel eq-panel">
        <h2>이퀄라이저</h2>
        <div className="eq-bands">
          <EqKnob
            label="LOW"
            value={selectedTrack.eq.lowGain}
            color="#4caf50"
            onChange={(v) => updateEq({ lowGain: v })}
          />
          <EqKnob
            label="MID"
            value={selectedTrack.eq.midGain}
            color="#c9b236"
            onChange={(v) => updateEq({ midGain: v })}
          />
          <EqKnob
            label="HIGH"
            value={selectedTrack.eq.highGain}
            color="#e05555"
            onChange={(v) => updateEq({ highGain: v })}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>컴프레서</h2>
          <button
            className={selectedTrack.compressor.enabled ? "toggle active" : "toggle"}
            onClick={() =>
              updateCompressor({ enabled: !selectedTrack.compressor.enabled })
            }
          >
            켜기
          </button>
        </div>
        <div className="control-stack">
          <label>
            임계값
            <input
              max={0}
              min={-60}
              step={1}
              type="range"
              value={selectedTrack.compressor.threshold}
              onChange={(event) =>
                updateCompressor({ threshold: Number(event.target.value) })
              }
            />
          </label>
          <label>
            비율
            <input
              max={20}
              min={1}
              step={0.5}
              type="range"
              value={selectedTrack.compressor.ratio}
              onChange={(event) =>
                updateCompressor({ ratio: Number(event.target.value) })
              }
            />
          </label>
          <label>
            어택
            <input
              max={1}
              min={0.001}
              step={0.001}
              type="range"
              value={selectedTrack.compressor.attack}
              onChange={(event) =>
                updateCompressor({ attack: Number(event.target.value) })
              }
            />
          </label>
          <label>
            릴리즈
            <input
              max={1}
              min={0.01}
              step={0.01}
              type="range"
              value={selectedTrack.compressor.release}
              onChange={(event) =>
                updateCompressor({ release: Number(event.target.value) })
              }
            />
          </label>
        </div>
      </section>
    </aside>
  );
}
