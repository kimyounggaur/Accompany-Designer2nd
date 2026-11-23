import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { audioEngine } from "../audio/currentEngine";
import { ko } from "../i18n/ko";
import { useDawStore } from "../store/useDawStore";
import { SpectrumAnalyzer } from "./SpectrumAnalyzer";
import { DelayPluginPanel } from "./DelayPluginPanel";
import { ReverbPluginPanel } from "./ReverbPluginPanel";
import { LevelMeterRack } from "./LevelMeter";
import { EffectRack } from "./EffectRack";
import { ClipPanel } from "../ui/inspector/ClipPanel";
import { MasterPanel } from "../ui/inspector/MasterPanel";
import { PanelSection } from "../ui/inspector/PanelSection";
import type {
  CompressorSettings,
  DelaySettings,
  EffectSlotType,
  EqSettings,
  ReverbSettings,
} from "../domain/types";
import { findClip } from "../utils/audioMath";

export function Inspector() {
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | undefined>(undefined);
  const tracks = useDawStore((state) => state.tracks);
  const selectedTrackId = useDawStore((state) => state.selectedTrackId);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const bpm = useDawStore((state) => state.bpm);
  const beginHistoryGroup = useDawStore((state) => state.beginHistoryGroup);
  const endHistoryGroup = useDawStore((state) => state.endHistoryGroup);
  useEffect(() => {
    document.addEventListener("pointerup", endHistoryGroup);
    document.addEventListener("pointercancel", endHistoryGroup);
    return () => { document.removeEventListener("pointerup", endHistoryGroup); document.removeEventListener("pointercancel", endHistoryGroup); };
  }, [endHistoryGroup]);
  const updateTrack = useDawStore((state) => state.updateTrack);

  // AnalyserNode를 AudioContext 초기화 후 연결
  useEffect(() => {
    let timer: number | undefined;
    const tryGetAnalyser = () => {
      const node = audioEngine.getAnalyser();
      if (node) {
        setAnalyserNode(node);
      } else {
        // AudioContext가 아직 초기화 안 됐으면 잠시 후 재시도
        timer = window.setTimeout(tryGetAnalyser, 500);
      }
    };
    tryGetAnalyser();
    return () => window.clearTimeout(timer);
  }, []);

  const selection = useMemo(
    () => findClip(tracks, selectedClipId),
    [selectedClipId, tracks],
  );
  const selectedTrack =
    selection?.track ??
    tracks.find((track) => track.id === selectedTrackId) ??
    tracks[0];

  function syncEffectSlot(type: EffectSlotType, enabled: boolean) {
    return selectedTrack.effectChain.map((slot) =>
      slot.type === type ? { ...slot, enabled } : slot,
    );
  }

  function updateEq(patch: Partial<EqSettings>) {
    updateTrack(selectedTrack.id, {
      eq: {
        ...selectedTrack.eq,
        ...patch,
      },
      ...(typeof patch.enabled === "boolean"
        ? { effectChain: syncEffectSlot("eq", patch.enabled) }
        : {}),
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

    const handleMouseDown = useCallback((e: React.PointerEvent) => {
      startY.current = e.clientY;
      startVal.current = value;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = (startY.current - moveEvent.clientY) * 0.15;
        const next = Math.max(-12, Math.min(12, startVal.current + delta));
        onChange(Math.round(next * 2) / 2);
      };

      const handleMouseUp = () => {
        document.removeEventListener('pointermove', handleMouseMove);
        document.removeEventListener('pointerup', handleMouseUp);
      };

      document.addEventListener('pointermove', handleMouseMove);
      document.addEventListener('pointerup', handleMouseUp);
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
          onPointerDown={handleMouseDown}
          role="slider" tabIndex={0} aria-label={`${label} 이퀄라이저`} aria-valuemin={-12} aria-valuemax={12} aria-valuenow={value}
          onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); onChange(Math.max(-12, Math.min(12, value + (event.key === "ArrowUp" || event.key === "ArrowRight" ? 0.5 : -0.5)))); } }}
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

    const handleMouseDown = useCallback((e: React.PointerEvent) => {
      startY.current = e.clientY;
      startVal.current = value;
      const range = max - min;
      const handleMouseMove = (ev: MouseEvent) => {
        const delta = (startY.current - ev.clientY) * (range / 180);
        onChange(Math.max(min, Math.min(max, startVal.current + delta)));
      };
      const handleMouseUp = () => {
        document.removeEventListener('pointermove', handleMouseMove);
        document.removeEventListener('pointerup', handleMouseUp);
      };
      document.addEventListener('pointermove', handleMouseMove);
      document.addEventListener('pointerup', handleMouseUp);
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
          onPointerDown={handleMouseDown}
          role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={displayVal}
          onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); onChange(Math.max(min, Math.min(max, value + (max - min) / 100 * (event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1)))); } }}
          style={{ cursor: "ns-resize", touchAction: "none", userSelect: "none", display: "block" }}
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
            <radialGradient id={`traxGrad_${large ? "large" : "small"}`} cx="40%" cy="30%" r="65%" gradientUnits="userSpaceOnUse"
              x1="0" y1="0" x2={size} y2={size}>
              <stop offset="0%" stopColor="#4a3a1a" />
              <stop offset="50%" stopColor="#1a1510" />
              <stop offset="100%" stopColor="#0d0b08" />
            </radialGradient>
          </defs>
          {/* 노브 테두리 */}
          <circle cx={cx} cy={cy} r={knobR + 2} fill="#5a4a20" />
          {/* 노브 본체 */}
          <circle cx={cx} cy={cy} r={knobR} fill={`url(#traxGrad_${large ? "large" : "small"})`} />
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

    const handleMouseDown = useCallback((e: React.PointerEvent) => {
      startY.current = e.clientY;
      startVal.current = value;
      const range = max - min;
      const handleMouseMove = (ev: MouseEvent) => {
        const delta = (startY.current - ev.clientY) * (range / 200);
        const next = Math.max(min, Math.min(max, startVal.current + delta));
        onChange(Math.round(next * 100) / 100);
      };
      const handleMouseUp = () => {
        document.removeEventListener('pointermove', handleMouseMove);
        document.removeEventListener('pointerup', handleMouseUp);
      };
      document.addEventListener('pointermove', handleMouseMove);
      document.addEventListener('pointerup', handleMouseUp);
    }, [value, min, max, onChange]);

    const norm = (value - min) / (max - min);
    const angle = -135 + norm * 270;
    const tickAngles = [-135, -90, -45, 0, 45, 90, 135];

    return (
      <div className="comp-knob-wrap">
        <svg
          className="comp-knob-svg"
          viewBox="0 0 80 80"
          onPointerDown={handleMouseDown}
          role="slider" tabIndex={0} aria-label={`${label} 컴프레서`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={sub}
          onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); onChange(Math.max(min, Math.min(max, value + (max - min) / 100 * (event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1)))); } }}
          style={{ cursor: "ns-resize", touchAction: "none", userSelect: "none" }}
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
      ...(typeof patch.enabled === "boolean"
        ? { effectChain: syncEffectSlot("comp", patch.enabled) }
        : {}),
    });
  }

  function updateDelay(patch: Partial<DelaySettings>) {
    updateTrack(selectedTrack.id, {
      delay: {
        ...selectedTrack.delay,
        ...patch,
      },
      ...(typeof patch.enabled === "boolean"
        ? { effectChain: syncEffectSlot("delay", patch.enabled) }
        : {}),
    });
  }

  function updateReverb(patch: Partial<ReverbSettings>) {
    updateTrack(selectedTrack.id, {
      reverb: {
        ...selectedTrack.reverb,
        ...patch,
      },
      ...(typeof patch.enabled === "boolean"
        ? { effectChain: syncEffectSlot("reverb", patch.enabled) }
        : {}),
    });
  }

  if (!selectedTrack) {
    return <aside className="inspector" data-testid="inspector" />;
  }

  return (
    <aside className="inspector" data-testid="inspector" aria-label="클립과 트랙 설정" onPointerDownCapture={(event) => {
      const target = event.target as Element;
      if (target.closest("svg") || target.matches('input[type="range"]')) beginHistoryGroup();
    }}>
      <ClipPanel />

      <PanelSection id="trax" title="트랙 믹스" className="trax-panel">
        <div className="trax-rack">
          {/* 헤더 */}
          <div className="trax-header">
            <span className="trax-brand">{ko.trackMix.title}</span>
            <div className="trax-toggles">
              <div className="trax-toggle-group">
                <button
                  className={`trax-switch ${selectedTrack.muted ? "on danger" : ""}`}
                  aria-label="트랙 음소거" aria-pressed={selectedTrack.muted}
                  onClick={() => updateTrack(selectedTrack.id, { muted: !selectedTrack.muted })}
                >
                  <span className="trax-switch-lever" />
                </button>
                <span className="trax-switch-label">{ko.trackMix.mute}</span>
              </div>
              <div className="trax-toggle-group">
                <button
                  className={`trax-switch ${selectedTrack.solo ? "on solo" : ""}`}
                  aria-label="트랙 솔로" aria-pressed={selectedTrack.solo}
                  onClick={() => updateTrack(selectedTrack.id, { solo: !selectedTrack.solo })}
                >
                  <span className="trax-switch-lever" />
                </button>
                <span className="trax-switch-label">{ko.trackMix.solo}</span>
              </div>
            </div>
          </div>

          {/* 노브 영역 */}
          <div className="trax-knobs">
            <TraxKnob
              label={ko.trackMix.volume}
              value={selectedTrack.volume}
              min={0} max={1}
              displayVal={`${Math.round(selectedTrack.volume * 100)}%`}
              large
              onChange={(v) => updateTrack(selectedTrack.id, { volume: v })}
            />
            <TraxKnob
              label={ko.trackMix.pan}
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
      </PanelSection>

      <MasterPanel />

      <PanelSection id="meter" title="레벨 미터" className="meter-panel">
        <LevelMeterRack />
      </PanelSection>

      <PanelSection id="effect-rack" title="이펙트 랙" className="effect-rack-panel">
        <EffectRack
          track={selectedTrack}
          onChange={(patch) => updateTrack(selectedTrack.id, patch)}
        />
      </PanelSection>

      <PanelSection
        id="eq"
        title="이퀄라이저"
        className="eq-panel"
        actions={
          <button
            className={`plugin-power-button ${selectedTrack.eq.enabled ? "on" : ""}`}
            onClick={() => updateEq({ enabled: !selectedTrack.eq.enabled })}
            aria-pressed={selectedTrack.eq.enabled}
            aria-label="이퀄라이저 켜기"
            type="button"
          >
            {selectedTrack.eq.enabled ? ko.state.on : ko.state.off}
          </button>
        }
      >
        <div className="eq-bands">
          <EqKnob
            label={ko.eq.bass}
            value={selectedTrack.eq.bassGain}
            color="#3fb46b"
            onChange={(v) => updateEq({ bassGain: v })}
          />
          <EqKnob
            label={ko.eq.middleLow}
            value={selectedTrack.eq.middleLowGain}
            color="#9dbd3a"
            onChange={(v) => updateEq({ middleLowGain: v })}
          />
          <EqKnob
            label={ko.eq.middleHigh}
            value={selectedTrack.eq.middleHighGain}
            color="#d0a338"
            onChange={(v) => updateEq({ middleHighGain: v })}
          />
          <EqKnob
            label={ko.eq.high}
            value={selectedTrack.eq.highGain}
            color="#df7148"
            onChange={(v) => updateEq({ highGain: v })}
          />
          <EqKnob
            label={ko.eq.presence}
            value={selectedTrack.eq.presenceGain}
            color="#d75c6f"
            onChange={(v) => updateEq({ presenceGain: v })}
          />
        </div>
      </PanelSection>

      <PanelSection id="comp" title="컴프레서" className="comp-panel">
        <div className="comp-rack">
          {/* 상단 VU 미터 */}
          <div className="comp-vu-row">
            <span className="comp-title">{ko.compressor.title}</span>
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
              <div className="comp-vu-label">{ko.compressor.gainReduction}</div>
            </div>
            <button
              className={`comp-power-btn ${selectedTrack.compressor.enabled ? "on" : ""}`}
              onClick={() => updateCompressor({ enabled: !selectedTrack.compressor.enabled })}
            >
              <span className="comp-power-ring">
                <span className="comp-power-dot" />
              </span>
              <span className="comp-power-label">{selectedTrack.compressor.enabled ? ko.state.on : ko.state.off}</span>
            </button>
          </div>

          {/* 하단 노브 열 */}
          <div className="comp-knobs-row">
            {(
              [
                {
                  label: ko.compressor.threshold,
                  sub: `${selectedTrack.compressor.threshold}dB`,
                  value: selectedTrack.compressor.threshold,
                  min: -60, max: 0,
                  onChange: (v: number) => updateCompressor({ threshold: v }),
                },
                {
                  label: ko.compressor.ratio,
                  sub: `${selectedTrack.compressor.ratio}:1`,
                  value: selectedTrack.compressor.ratio,
                  min: 1, max: 20,
                  onChange: (v: number) => updateCompressor({ ratio: v }),
                },
                {
                  label: ko.compressor.attack,
                  sub: `${Math.round(selectedTrack.compressor.attack * 1000)}ms`,
                  value: selectedTrack.compressor.attack,
                  min: 0.001, max: 1,
                  onChange: (v: number) => updateCompressor({ attack: v }),
                },
                {
                  label: ko.compressor.release,
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
      </PanelSection>

      <PanelSection id="delay" title="딜레이" className="delay-panel">
        <DelayPluginPanel
          bpm={bpm}
          delay={selectedTrack.delay}
          onChange={updateDelay}
        />
      </PanelSection>

      <PanelSection id="reverb" title="리버브" className="reverb-panel">
        <ReverbPluginPanel
          reverb={selectedTrack.reverb}
          onChange={updateReverb}
        />
      </PanelSection>

      <PanelSection id="spectrum" title="분석기" className="spec-panel">
        <SpectrumAnalyzer analyser={analyserNode} />
      </PanelSection>
    </aside>
  );
}
