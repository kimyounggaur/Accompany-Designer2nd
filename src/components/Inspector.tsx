import { Trash2 } from "lucide-react";
import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { estimateBpm } from "../audio/bpmDetector";
import { audioEngine } from "../audio/audioEngine";
import { useDawStore } from "../store/useDawStore";
import { SpectrumAnalyzer } from "./SpectrumAnalyzer";
import { DelayPluginPanel } from "./DelayPluginPanel";
import { ReverbPluginPanel } from "./ReverbPluginPanel";
import type {
  CompressorSettings,
  DelaySettings,
  EqSettings,
  ReverbSettings,
} from "../types";
import {
  findClip,
  getClipPlaybackRate,
  getClipTimelineDuration,
} from "../utils/audioMath";

export function Inspector() {
  const [bpmStatus, setBpmStatus] = useState("");
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | undefined>(undefined);
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const bpm = useDawStore((state) => state.bpm);
  const updateClip = useDawStore((state) => state.updateClip);
  const updateTrack = useDawStore((state) => state.updateTrack);
  const updateAudioAsset = useDawStore((state) => state.updateAudioAsset);
  const deleteClip = useDawStore((state) => state.deleteClip);

  // AnalyserNode를 AudioContext 초기화 후 연결
  useEffect(() => {
    const tryGetAnalyser = () => {
      const node = audioEngine.getAnalyser();
      if (node) {
        setAnalyserNode(node);
      } else {
        // AudioContext가 아직 초기화 안 됐으면 잠시 후 재시도
        setTimeout(tryGetAnalyser, 500);
      }
    };
    tryGetAnalyser();
  }, []);

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

  function TraxKnob({
    label, value, min, max, displayVal, large = false, onChange,
  }: {
    label: string; value: number; min: number; max: number;
    displayVal: string; large?: boolean; onChange: (v: number) => void;
  }) {
    const startY = useRef(0);
    const startVal = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      startY.current = e.clientY;
      startVal.current = value;
      const range = max - min;
      const handleMouseMove = (ev: MouseEvent) => {
        const delta = (startY.current - ev.clientY) * (range / 180);
        onChange(Math.max(min, Math.min(max, startVal.current + delta)));
      };
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }, [value, min, max, onChange]);

    const norm = (value - min) / (max - min);
    const startAngle = -135;
    const endAngle = 135;
    const angle = startAngle + norm * (endAngle - startAngle);

    const size = large ? 80 : 64;
    const cx = size / 2, cy = size / 2;
    const tickR = large ? 36 : 28;
    const knobR = large ? 26 : 20;
    const innerR = large ? 22 : 17;
    const indicatorR = large ? 18 : 14;

    // 점선 아크 (T-RackS 스타일 흰 점선)
    const arcR = large ? 34 : 27;
    const toRad = (deg: number) => (deg - 90) * Math.PI / 180;
    const arcStart = toRad(startAngle);
    const arcEnd = toRad(endAngle);
    const arcX1 = cx + arcR * Math.cos(arcStart);
    const arcY1 = cy + arcR * Math.sin(arcStart);
    const arcX2 = cx + arcR * Math.cos(arcEnd);
    const arcY2 = cy + arcR * Math.sin(arcEnd);

    // 틱 마크 개수
    const ticks = large ? 13 : 11;
    const tickAngles = Array.from({ length: ticks }, (_, i) =>
      startAngle + (i / (ticks - 1)) * 270
    );

    // 인디케이터 선 (오렌지 스트라이프)
    const indRad = toRad(angle);
    const ix = cx + indicatorR * Math.cos(indRad);
    const iy = cy + indicatorR * Math.sin(indRad);

    return (
      <div className={`trax-knob-wrap ${large ? "large" : ""}`}>
        <svg
          width={size} height={size}
          viewBox={`0 0 ${size} ${size}`}
          onMouseDown={handleMouseDown}
          style={{ cursor: "ns-resize", userSelect: "none", display: "block" }}
        >
          {/* 틱 마크 */}
          {tickAngles.map((a, i) => {
            const r1 = tickR, r2 = tickR - (large ? 5 : 4);
            const rad = toRad(a);
            const isActive = i / (ticks - 1) <= norm;
            return (
              <line key={i}
                x1={cx + r1 * Math.cos(rad)} y1={cy + r1 * Math.sin(rad)}
                x2={cx + r2 * Math.cos(rad)} y2={cy + r2 * Math.sin(rad)}
                stroke={isActive ? "#f5a623" : "#5a4a2a"}
                strokeWidth={large ? "2" : "1.5"} strokeLinecap="round"
              />
            );
          })}
          {/* 점선 아크 */}
          <path
            d={`M ${arcX1} ${arcY1} A ${arcR} ${arcR} 0 1 1 ${arcX2} ${arcY2}`}
            fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"
            strokeDasharray="2 3" strokeLinecap="round"
          />
          {/* 노브 그라디언트 정의 */}
          <defs>
            <radialGradient id={`traxGrad_${label}`} cx="40%" cy="30%" r="65%" gradientUnits="userSpaceOnUse"
              x1="0" y1="0" x2={size} y2={size}>
              <stop offset="0%" stopColor="#4a3a1a" />
              <stop offset="50%" stopColor="#1a1510" />
              <stop offset="100%" stopColor="#0d0b08" />
            </radialGradient>
          </defs>
          {/* 노브 테두리 */}
          <circle cx={cx} cy={cy} r={knobR + 2} fill="#5a4a20" />
          {/* 노브 본체 */}
          <circle cx={cx} cy={cy} r={knobR} fill={`url(#traxGrad_${label})`} />
          <circle cx={cx} cy={cy} r={innerR} fill="#0f0d09" />
          {/* 오렌지 인디케이터 선 (T-RackS 스트라이프) */}
          <line
            x1={cx} y1={cy} x2={ix} y2={iy}
            stroke="#f5a623" strokeWidth={large ? "3" : "2.5"} strokeLinecap="round"
          />
          <circle cx={ix} cy={iy} r={large ? 2 : 1.5} fill="#f5a623" />
        </svg>
        <span className="trax-knob-label">{label}</span>
        <span className="trax-knob-val">{displayVal}</span>
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

  function updateDelay(patch: Partial<DelaySettings>) {
    updateTrack(selectedTrack.id, {
      delay: {
        ...selectedTrack.delay,
        ...patch,
      },
    });
  }

  function updateReverb(patch: Partial<ReverbSettings>) {
    updateTrack(selectedTrack.id, {
      reverb: {
        ...selectedTrack.reverb,
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

      <section className="panel trax-panel">
        <div className="trax-rack">
          {/* 헤더 */}
          <div className="trax-header">
            <span className="trax-brand">TRACK MIX</span>
            <div className="trax-toggles">
              <div className="trax-toggle-group">
                <button
                  className={`trax-switch ${selectedTrack.muted ? "on danger" : ""}`}
                  onClick={() => updateTrack(selectedTrack.id, { muted: !selectedTrack.muted })}
                >
                  <span className="trax-switch-lever" />
                </button>
                <span className="trax-switch-label">MUTE</span>
              </div>
              <div className="trax-toggle-group">
                <button
                  className={`trax-switch ${selectedTrack.solo ? "on solo" : ""}`}
                  onClick={() => updateTrack(selectedTrack.id, { solo: !selectedTrack.solo })}
                >
                  <span className="trax-switch-lever" />
                </button>
                <span className="trax-switch-label">SOLO</span>
              </div>
            </div>
          </div>

          {/* 노브 영역 */}
          <div className="trax-knobs">
            <TraxKnob
              label="VOLUME"
              value={selectedTrack.volume}
              min={0} max={1}
              displayVal={`${Math.round(selectedTrack.volume * 100)}%`}
              large
              onChange={(v) => updateTrack(selectedTrack.id, { volume: v })}
            />
            <TraxKnob
              label="PAN"
              value={selectedTrack.pan}
              min={-1} max={1}
              displayVal={
                selectedTrack.pan === 0 ? "C"
                : selectedTrack.pan > 0 ? `R${Math.round(selectedTrack.pan * 100)}`
                : `L${Math.round(Math.abs(selectedTrack.pan) * 100)}`
              }
              onChange={(v) => updateTrack(selectedTrack.id, { pan: Math.round(v * 100) / 100 })}
            />
          </div>
        </div>
      </section>

      <section className="panel delay-panel">
        <DelayPluginPanel
          bpm={bpm}
          delay={selectedTrack.delay}
          onChange={updateDelay}
        />
      </section>

      <section className="panel reverb-panel">
        <ReverbPluginPanel
          reverb={selectedTrack.reverb}
          onChange={updateReverb}
        />
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

      <section className="panel spec-panel">
        <SpectrumAnalyzer analyser={analyserNode} />
      </section>
    </aside>
  );
}
