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
    const containerRef = useRef<HTMLDivElement>(null);
    const startY = useRef(0);
    const startVal = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      startY.current = e.clientY;
      startVal.current = value;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = (startY.current - moveEvent.clientY) * 0.15;
        const next = Math.max(-12, Math.min(12, startVal.current + delta));
        onChange(Math.round(next * 2) / 2);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }, [value, onChange]);

    const angle = (value / 12) * 135;
    const rad = (angle - 90) * (Math.PI / 180);
    const cx = 32, cy = 32, r = 20;
    const tx = cx + r * Math.cos(rad);
    const ty = cy + r * Math.sin(rad);

    return (
      <div className="eq-band" style={{ background: color }} ref={containerRef}>
        <svg
          className="eq-knob"
          viewBox="0 0 64 64"
          onMouseDown={handleMouseDown}
          style={{ cursor: "ns-resize", touchAction: "none", userSelect: "none" }}
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

  function CompKnob({
    label, sub, value, min, max, onChange,
  }: {
    label: string; sub: string; value: number;
    min: number; max: number; onChange: (v: number) => void;
  }) {
    const startY = useRef(0);
    const startVal = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      startY.current = e.clientY;
      startVal.current = value;
      const range = max - min;
      const handleMouseMove = (ev: MouseEvent) => {
        const delta = (startY.current - ev.clientY) * (range / 200);
        const next = Math.max(min, Math.min(max, startVal.current + delta));
        onChange(Math.round(next * 100) / 100);
      };
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }, [value, min, max, onChange]);

    const norm = (value - min) / (max - min);
    const angle = -135 + norm * 270;
    const tickAngles = [-135, -90, -45, 0, 45, 90, 135];

    return (
      <div className="comp-knob-wrap">
        <svg
          className="comp-knob-svg"
          viewBox="0 0 80 80"
          onMouseDown={handleMouseDown}
          style={{ cursor: "ns-resize", userSelect: "none" }}
        >
          {/* 틱 마크 */}
          {tickAngles.map((a, i) => {
            const r1 = 37, r2 = 33;
            const rad = (a - 90) * Math.PI / 180;
            return (
              <line
                key={i}
                x1={40 + r1 * Math.cos(rad)} y1={40 + r1 * Math.sin(rad)}
                x2={40 + r2 * Math.cos(rad)} y2={40 + r2 * Math.sin(rad)}
                stroke="#888" strokeWidth="1.5" strokeLinecap="round"
              />
            );
          })}
          {/* 노브 본체 */}
          <circle cx="40" cy="40" r="28" fill="url(#compKnobGrad)" />
          <circle cx="40" cy="40" r="24" fill="#1a1a1a" />
          <circle cx="40" cy="40" r="22" fill="#222" />
          {/* 지시선 */}
          {(() => {
            const rad = (angle - 90) * Math.PI / 180;
            return (
              <line
                x1="40" y1="40"
                x2={40 + 17 * Math.cos(rad)} y2={40 + 17 * Math.sin(rad)}
                stroke="#ddd" strokeWidth="2.5" strokeLinecap="round"
              />
            );
          })()}
          <defs>
            <radialGradient id="compKnobGrad" cx="40%" cy="35%" r="60%" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#555" />
              <stop offset="100%" stopColor="#1c1c1c" />
            </radialGradient>
          </defs>
        </svg>
        <span className="comp-knob-label">{label}</span>
        <span className="comp-knob-sub">{sub}</span>
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

      <section className="panel comp-panel">
        <div className="comp-rack">
          {/* 상단 VU 미터 */}
          <div className="comp-vu-row">
            <span className="comp-title">COMPRESSOR</span>
            <div className="comp-vu-meter">
              <div className="comp-vu-scale">
                {["20","15","10","7","5","3","1","0"].map(v => (
                  <span key={v}>{v}</span>
                ))}
              </div>
              <div className="comp-vu-needle-wrap">
                <div
                  className="comp-vu-needle"
                  style={{
                    transform: `rotate(${selectedTrack.compressor.enabled
                      ? Math.min(80, Math.max(-80, ((selectedTrack.compressor.threshold + 60) / 60) * -80))
                      : -80}deg)`
                  }}
                />
              </div>
              <div className="comp-vu-label">DB GAIN REDUCTION</div>
            </div>
            <button
              className={`comp-power-btn ${selectedTrack.compressor.enabled ? "on" : ""}`}
              onClick={() => updateCompressor({ enabled: !selectedTrack.compressor.enabled })}
            >
              <span className="comp-power-ring">
                <span className="comp-power-dot" />
              </span>
              <span className="comp-power-label">{selectedTrack.compressor.enabled ? "ON" : "OFF"}</span>
            </button>
          </div>

          {/* 하단 노브 열 */}
          <div className="comp-knobs-row">
            {(
              [
                {
                  label: "THRESHOLD",
                  sub: `${selectedTrack.compressor.threshold}dB`,
                  value: selectedTrack.compressor.threshold,
                  min: -60, max: 0,
                  onChange: (v: number) => updateCompressor({ threshold: v }),
                },
                {
                  label: "RATIO",
                  sub: `${selectedTrack.compressor.ratio}:1`,
                  value: selectedTrack.compressor.ratio,
                  min: 1, max: 20,
                  onChange: (v: number) => updateCompressor({ ratio: v }),
                },
                {
                  label: "ATTACK",
                  sub: `${Math.round(selectedTrack.compressor.attack * 1000)}ms`,
                  value: selectedTrack.compressor.attack,
                  min: 0.001, max: 1,
                  onChange: (v: number) => updateCompressor({ attack: v }),
                },
                {
                  label: "RELEASE",
                  sub: `${Math.round(selectedTrack.compressor.release * 1000)}ms`,
                  value: selectedTrack.compressor.release,
                  min: 0.01, max: 1,
                  onChange: (v: number) => updateCompressor({ release: v }),
                },
              ] as const
            ).map(({ label, sub, value, min, max, onChange }) => (
              <CompKnob
                key={label}
                label={label}
                sub={sub}
                value={value}
                min={min}
                max={max}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      </section>
    </aside>
  );
}
