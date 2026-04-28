import { useEffect, useRef, useState, useCallback } from "react";

// 로그 스케일 주파수 밴드 (Spear 32 스타일)
const FREQ_BANDS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

const FREQ_LABELS: Record<number, string> = {
  20: "20", 40: "40", 80: "80", 160: "160", 315: "315",
  630: "630", 1250: "1K25", 2500: "2K5", 5000: "5K",
  10000: "10K", 20000: "20K",
};

const DB_LINES = [-10, -18, -26, -34, -40];
const MIN_DB = -48;
const MAX_DB = -6;

type Mode = "M" | "L" | "R";
type Resp = 1 | 2 | 3;

const SMOOTHING: Record<Resp, number> = { 1: 0.92, 2: 0.8, 3: 0.6 };

interface Props {
  analyser: AnalyserNode | undefined;
}

export function SpectrumAnalyzer({ analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const barsRef = useRef<number[]>(new Array(FREQ_BANDS.length).fill(MIN_DB));
  const [mode, setMode] = useState<Mode>("M");
  const [resp, setResp] = useState<Resp>(2);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD_L = 0;
    const PAD_B = 18;
    const plotH = H - PAD_B;

    // 배경
    ctx.fillStyle = "#1a0e0a";
    ctx.fillRect(0, 0, W, H);

    // 그리드 수평선
    DB_LINES.forEach((db) => {
      const y = ((db - MAX_DB) / (MIN_DB - MAX_DB)) * plotH;
      ctx.strokeStyle = "rgba(180,80,60,0.35)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    });

    // FFT 데이터 읽기
    if (analyser) {
      const bufLen = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(dataArray);
      const sampleRate = analyser.context.sampleRate;
      const binHz = sampleRate / (bufLen * 2);
      const smooth = SMOOTHING[resp];

      FREQ_BANDS.forEach((freq, i) => {
        const nextFreq = FREQ_BANDS[i + 1] ?? freq * 1.3;
        const binStart = Math.floor(freq / binHz);
        const binEnd = Math.min(Math.ceil(nextFreq / binHz), bufLen - 1);
        let max = 0;
        for (let b = binStart; b <= binEnd; b++) max = Math.max(max, dataArray[b]);
        const db = max > 0 ? 20 * Math.log10(max / 255) * 2 - 6 : MIN_DB;
        const target = Math.max(MIN_DB, Math.min(MAX_DB, db));
        // decay
        barsRef.current[i] =
          target > barsRef.current[i]
            ? target
            : barsRef.current[i] * smooth + target * (1 - smooth);
      });
    }

    // 바 그리기 (LED 도트 스타일)
    const barW = Math.floor((W - PAD_L) / FREQ_BANDS.length) - 1;
    const dotRows = 18;

    FREQ_BANDS.forEach((_, i) => {
      const dbVal = barsRef.current[i];
      const fillRatio = Math.max(0, (dbVal - MIN_DB) / (MAX_DB - MIN_DB));
      const activeDots = Math.round(fillRatio * dotRows);
      const x = PAD_L + i * ((W - PAD_L) / FREQ_BANDS.length);
      const dotH = plotH / dotRows;

      for (let d = 0; d < dotRows; d++) {
        const dotY = plotH - (d + 1) * dotH + 2;
        if (d < activeDots) {
          const intensity = d < activeDots - 2 ? 0.85 : 1;
          const r = Math.round(220 + (d / dotRows) * 20);
          const g = Math.round(30 + (d / dotRows) * 20);
          ctx.fillStyle = `rgba(${r},${g},10,${intensity})`;
        } else {
          ctx.fillStyle = "rgba(80,20,10,0.4)";
        }
        ctx.beginPath();
        ctx.arc(x + barW / 2, dotY + dotH / 2 - 1, Math.max(1.5, barW * 0.32), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 주파수 레이블
    ctx.fillStyle = "#aaa";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    FREQ_BANDS.forEach((freq, i) => {
      const label = FREQ_LABELS[freq];
      if (!label) return;
      const x = PAD_L + i * ((W - PAD_L) / FREQ_BANDS.length) + barW / 2;
      ctx.fillText(label, x, H - 3);
    });

    rafRef.current = requestAnimationFrame(draw);
  }, [analyser, resp]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // 캔버스 DPI 대응
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    const ctx = canvas.getContext("2d");
    ctx?.scale(devicePixelRatio, devicePixelRatio);
  }, []);

  return (
    <div className="spec-wrap">
      {/* 헤더 */}
      <div className="spec-header">
        <span className="spec-title-script">Specan 32</span>
        <span className="spec-title-main">REAL TIME SPECTRUM ANALYSER</span>
        <span className="spec-micro">Microprocessor Controlled</span>
      </div>

      {/* 캔버스 */}
      <div className="spec-display">
        <div className="spec-db-scale">
          {DB_LINES.map((db) => (
            <span key={db}>{db}</span>
          ))}
        </div>
        <canvas ref={canvasRef} className="spec-canvas" />
      </div>

      {/* 하단 컨트롤 */}
      <div className="spec-controls">
        <div className="spec-btn-group">
          <span className="spec-btn-label">MODE</span>
          <div className="spec-btn-row">
            {(["L", "M", "R"] as Mode[]).map((m) => (
              <button
                key={m}
                className={`spec-led-btn ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
              >{m}</button>
            ))}
          </div>
        </div>
        <div className="spec-btn-group">
          <span className="spec-btn-label">RESP</span>
          <div className="spec-btn-row">
            {([1, 2, 3] as Resp[]).map((r) => (
              <button
                key={r}
                className={`spec-led-btn ${resp === r ? "active" : ""}`}
                onClick={() => setResp(r)}
              >{r}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
