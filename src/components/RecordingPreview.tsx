import { useEffect, useRef } from "react";
import { useRecordingStore } from "../state/recordingStore";
import { useDawStore } from "../store/useDawStore";

interface RecordingPreviewProps {
  trackIndex: number;
  trackHeight: number;
}

/** 파형이 너무 작아 안 보이지 않도록, 지금까지 들어온 가장 큰 값을 기준으로 키운다(바닥 0.1). */
function peakScale(peaks: readonly number[]): number {
  let max = 0;
  for (const peak of peaks) if (peak > max) max = peak;
  return 1 / Math.max(0.1, max);
}

/**
 * 녹음하는 동안 타임라인에 보이는 임시 클립. 프로젝트 문서에는 없다: 파형은 `recordingStore`에서 와서
 * 초당 20회 이하로 갱신되고, 녹음이 끝나면 이것이 사라지면서 진짜 클립이 한 번에 들어온다.
 */
export function RecordingPreview({ trackIndex, trackHeight }: RecordingPreviewProps) {
  const startedAt = useRecordingStore((state) => state.startedAtProjectTime);
  const elapsed = useRecordingStore((state) => state.elapsed);
  const peaks = useRecordingStore((state) => state.waveformPeaks);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const left = startedAt * zoomPxPerSecond;
  const width = Math.max(6, elapsed * zoomPxPerSecond);
  const top = trackIndex * trackHeight + 15;

  useEffect(() => {
    const canvas = canvasRef.current;
    const scroll = canvas?.closest(".timeline-scroll");
    if (!canvas || !scroll) return;
    const draw = () => {
      const element = canvas.parentElement;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const viewport = scroll.getBoundingClientRect();
      // 오래 녹음해도 화면에 보이는 부분만 그린다(캔버스 크기 제한).
      const start = Math.max(0, viewport.left - rect.left - 2);
      const end = Math.min(rect.width, viewport.right - rect.left + 2);
      const cssWidth = Math.max(1, Math.ceil(end - start));
      canvas.style.left = `${start}px`;
      canvas.style.width = `${cssWidth}px`;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(53 * dpr));
      const context = canvas.getContext("2d");
      if (!context || peaks.length === 0) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(255, 226, 222, 0.88)";
      const scale = peakScale(peaks);
      const middle = canvas.height / 2;
      for (let x = 0; x < cssWidth; x += 1) {
        const index = Math.min(peaks.length - 1, Math.floor(((start + x) / Math.max(1, width)) * peaks.length));
        const barHeight = Math.max(1, Math.min(1, peaks[index] * scale) * canvas.height * 0.43);
        context.fillRect(Math.floor(x * dpr), middle - barHeight, Math.max(1, dpr), barHeight * 2);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(scroll);
    scroll.addEventListener("scroll", draw, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", draw);
    };
  }, [peaks, width, left]);

  return (
    <article
      className="clip recording recording-preview"
      data-testid="recording-preview"
      style={{ left, top, width }}
      aria-label="녹음 중인 클립"
    >
      <canvas ref={canvasRef} />
      <div className="clip-label">
        <strong>녹음 중</strong>
        <span>녹음</span>
      </div>
    </article>
  );
}
