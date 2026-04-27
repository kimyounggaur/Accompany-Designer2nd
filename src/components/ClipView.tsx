import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import type { AudioAsset, Clip } from "../types";
import { useDawStore } from "../store/useDawStore";
import {
  clamp,
  getClipPlaybackRate,
  getClipTimelineDuration,
  MIN_CLIP_SOURCE_DURATION,
  snapTime,
} from "../utils/audioMath";

type DragMode = "move" | "trim-left" | "trim-right";

interface ClipViewProps {
  asset?: AudioAsset;
  clip: Clip;
  lanesRef: RefObject<HTMLDivElement | null>;
  trackHeight: number;
  trackIds: string[];
  trackIndex: number;
}

interface PointerSession {
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  originalClip: Clip;
}

export function ClipView({
  asset,
  clip,
  lanesRef,
  trackHeight,
  trackIds,
  trackIndex,
}: ClipViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<PointerSession | undefined>(undefined);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const updateClip = useDawStore((state) => state.updateClip);
  const moveClip = useDawStore((state) => state.moveClip);
  const selectClip = useDawStore((state) => state.selectClip);
  const bpm = useDawStore((state) => state.bpm);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const gridDivision = useDawStore((state) => state.gridDivision);
  const isSelected = selectedClipId === clip.id;
  const playbackRate = getClipPlaybackRate(bpm, clip);
  const timelineDuration = getClipTimelineDuration(bpm, clip);
  const width = Math.max(48, timelineDuration * zoomPxPerSecond);
  const left = clip.startTime * zoomPxPerSecond;
  const top = trackIndex * trackHeight + 15;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset) {
      return;
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(218, 255, 239, 0.82)";
      const middle = canvas.height / 2;
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const peakStep = asset.waveformPeaks.length / cssWidth;

      for (let x = 0; x < cssWidth; x += 1) {
        const peak = asset.waveformPeaks[Math.floor(x * peakStep)] || 0;
        const barHeight = Math.max(1, peak * canvas.height * 0.43);
        context.fillRect(
          Math.floor(x * dpr),
          middle - barHeight,
          Math.max(1, dpr),
          barHeight * 2,
        );
      }
    };

    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [asset, width]);

  function beginDrag(mode: DragMode, event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    selectClip(clip.id);
    sessionRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originalClip: clip,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: React.PointerEvent<HTMLElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const deltaTimeline = (event.clientX - session.startClientX) / zoomPxPerSecond;
    const original = session.originalClip;
    const originalRate = getClipPlaybackRate(bpm, original);
    const assetDuration = asset?.duration ?? original.offset + original.duration;

    if (session.mode === "move") {
      const moved = snapTime(
        original.startTime + deltaTimeline,
        bpm,
        snapEnabled,
        gridDivision,
      );
      const lanesRect = lanesRef.current?.getBoundingClientRect();
      const targetTrackIndex = lanesRect
        ? clamp(
            Math.floor((event.clientY - lanesRect.top) / trackHeight),
            0,
            Math.max(0, trackIds.length - 1),
          )
        : trackIndex;
      const targetTrackId = trackIds[targetTrackIndex] ?? original.trackId;

      moveClip(original.id, targetTrackId, { startTime: Math.max(0, moved) });
      return;
    }

    if (session.mode === "trim-left") {
      const desiredStart = snapTime(
        original.startTime + deltaTimeline,
        bpm,
        snapEnabled,
        gridDivision,
      );
      let deltaSource = (desiredStart - original.startTime) * originalRate;
      deltaSource = clamp(
        deltaSource,
        Math.max(-original.offset, -original.startTime * originalRate),
        original.duration - MIN_CLIP_SOURCE_DURATION,
      );

      const nextOffset = original.offset + deltaSource;
      const nextDuration = original.duration - deltaSource;
      updateClip(original.id, {
        startTime: original.startTime + deltaSource / originalRate,
        offset: nextOffset,
        duration: nextDuration,
      });
      return;
    }

    const currentDisplayDuration = original.duration / originalRate;
    const desiredDisplayDuration = snapTime(
      currentDisplayDuration + deltaTimeline,
      bpm,
      snapEnabled,
      gridDivision,
    );
    const nextDuration = clamp(
      desiredDisplayDuration * originalRate,
      MIN_CLIP_SOURCE_DURATION,
      assetDuration - original.offset,
    );
    updateClip(original.id, { duration: nextDuration });
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const session = sessionRef.current;
    if (session && session.pointerId === event.pointerId) {
      sessionRef.current = undefined;
    }
  }

  return (
    <article
      className={`clip ${isSelected ? "selected" : ""}`}
      style={{ left, top, width }}
      onPointerDown={(event) => beginDrag("move", event)}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        aria-label="Trim clip start"
        className="trim-handle left"
        onPointerDown={(event) => beginDrag("trim-left", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <canvas ref={canvasRef} />
      <div className="clip-label">
        <strong>{clip.name}</strong>
        <span>{playbackRate.toFixed(2)}x</span>
      </div>
      <button
        aria-label="Trim clip end"
        className="trim-handle right"
        onPointerDown={(event) => beginDrag("trim-right", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </article>
  );
}
