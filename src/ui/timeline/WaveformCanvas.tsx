import { useEffect, useRef } from "react";
import { audioEngine } from "../../audio/currentEngine";
import type { AssetMeta, Clip } from "../../domain/types";
import { waveformColumns } from "../../domain/waveform/columns";
import { usePeakSet } from "./usePeakSet";

interface WaveformCanvasProps {
  asset?: AssetMeta;
  clip: Pick<Clip, "offset" | "duration" | "muted">;
  /** 클립이 화면에서 차지하는 너비(px). 클립의 왼쪽 끝~오른쪽 끝이 음원의 `offset`부터 `duration`초에 해당한다. */
  width: number;
  /** 클립 왼쪽 끝의 가로 위치(px). 옮기면 보이는 범위가 달라지므로 다시 그린다. */
  left: number;
}

/** 칸의 높이(px, CSS). `.clip canvas`의 높이와 같다. */
const CANVAS_HEIGHT = 53;
/** 가장 큰 소리가 중심에서 위·아래로 차지하는 비율 */
const AMPLITUDE = 0.43;
/** 막대의 가장 낮은 높이(장치 픽셀) */
const MIN_BAR = 2;

/**
 * 클립 하나의 파형(설계서 §P4-3). 화면에 보이는 칸만 그린다 — 한 시간짜리 클립도 캔버스는 화면 너비만큼이다.
 * 칸마다 최소·최대는 `domain/waveform/columns`가 다단계 파형 자료(+ 아주 확대했을 때는 원본 샘플)에서 정한다.
 */
export function WaveformCanvas({ asset, clip, width, left }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const set = usePeakSet(asset?.id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset || !set) return;
    const scroll = canvas.closest(".timeline-scroll");
    if (!scroll) return;
    const assetId = asset.id;

    const draw = () => {
      const clipElement = canvas.parentElement;
      if (!clipElement) return;
      const clipRect = clipElement.getBoundingClientRect();
      const viewport = scroll.getBoundingClientRect();
      // 화면 밖은 그리지 않는다(한 시간짜리 클립도 캔버스는 화면 너비만큼).
      const start = Math.max(0, Math.floor(viewport.left - clipRect.left - 2));
      const end = Math.min(clipRect.width, Math.ceil(viewport.right - clipRect.left + 2));
      const cssWidth = Math.max(1, end - start);
      canvas.style.left = `${start}px`;
      canvas.style.width = `${cssWidth}px`;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(CANVAS_HEIGHT * dpr));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);

      const columns = waveformColumns(
        set,
        { offset: clip.offset, duration: clip.duration, widthPx: Math.max(1, width), fromPx: start, count: cssWidth },
        audioEngine.getBuffer(assetId),
      );
      context.fillStyle = clip.muted ? "rgba(188, 196, 185, 0.52)" : "rgba(218, 255, 239, 0.82)";
      const middle = canvas.height / 2;
      const amplitude = canvas.height * AMPLITUDE;
      const barWidth = Math.max(1, dpr);
      for (let x = 0; x < cssWidth; x += 1) {
        // 칸마다 최소~최대를 잇는 막대. 아주 확대하면 한쪽에만 걸친 칸이 생긴다(중심을 안 지나는 막대).
        let top = middle - columns.max[x] * amplitude;
        let bottom = middle - columns.min[x] * amplitude;
        if (bottom - top < MIN_BAR) {
          // 무음·아주 작은 소리도 중심선은 보이게 한다.
          const center = (top + bottom) / 2;
          top = center - MIN_BAR / 2;
          bottom = center + MIN_BAR / 2;
        }
        context.fillRect(Math.floor(x * dpr), top, barWidth, bottom - top);
      }
    };

    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(scroll);
    scroll.addEventListener("scroll", draw, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scroll.removeEventListener("scroll", draw);
    };
  }, [asset, set, clip.muted, clip.offset, clip.duration, width, left]);

  return <canvas ref={canvasRef} data-testid="clip-waveform" />;
}
