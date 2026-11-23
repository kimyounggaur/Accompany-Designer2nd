import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { AudioAsset, Clip } from "../types";
import { useDawStore } from "../store/useDawStore";
import {
  clamp,
  getClipPlaybackRate,
  getClipTimelineDuration,
  MIN_CLIP_SOURCE_DURATION,
  snapTime,
} from "../utils/audioMath";

type DragMode = "move" | "trim-left" | "trim-right" | "slip" | "fade-in" | "fade-out";

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
  const [showMenu, setShowMenu] = useState(false);
  const sessionRef = useRef<PointerSession | undefined>(undefined);
  const selectedClipIds = useDawStore((state) => state.selectedClipIds);
  const playlistTool = useDawStore((state) => state.playlistTool);
  const captureHistory = useDawStore((state) => state.captureHistory);
  const updateClip = useDawStore((state) => state.updateClip);
  const moveClip = useDawStore((state) => state.moveClip);
  const deleteClip = useDawStore((state) => state.deleteClip);
  const toggleClipMuted = useDawStore((state) => state.toggleClipMuted);
  const sliceClipAt = useDawStore((state) => state.sliceClipAt);
  const selectClip = useDawStore((state) => state.selectClip);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const bpm = useDawStore((state) => state.bpm);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const gridDivision = useDawStore((state) => state.gridDivision);
  const isSelected = selectedClipIds.includes(clip.id);
  const playbackRate = getClipPlaybackRate(bpm, clip);
  const timelineDuration = getClipTimelineDuration(bpm, clip);
  const width = Math.max(48, timelineDuration * zoomPxPerSecond);
  const left = clip.startTime * zoomPxPerSecond;
  const top = trackIndex * trackHeight + 15;
  const fadeInWidth = Math.min(width / 2, Math.max(0, clip.fadeIn || 0) * zoomPxPerSecond);
  const fadeOutWidth = Math.min(width / 2, Math.max(0, clip.fadeOut || 0) * zoomPxPerSecond);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset) {
      return;
    }

    const scroll = canvas.closest(".timeline-scroll");
    if (!scroll) return;
    const draw = () => {
      const clipElement = canvas.parentElement;
      if (!clipElement || !scroll) return;
      const clipRect = clipElement.getBoundingClientRect();
      const viewport = scroll.getBoundingClientRect();
      // Keep the canvas bounded by the viewport, even for hour-long clips.
      const start = Math.max(0, viewport.left - clipRect.left - 2);
      const end = Math.min(clipRect.width, viewport.right - clipRect.left + 2);
      const cssWidth = Math.max(1, Math.ceil(end - start));
      canvas.style.left = `${start}px`;
      canvas.style.width = `${cssWidth}px`;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(53 * dpr));
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = clip.muted
        ? "rgba(188, 196, 185, 0.52)"
        : "rgba(218, 255, 239, 0.82)";
      const middle = canvas.height / 2;
      for (let x = 0; x < cssWidth; x += 1) {
        const sourceStart = clip.offset + ((start + x) / Math.max(1, width)) * clip.duration;
        const sourceEnd = clip.offset + ((start + x + 1) / Math.max(1, width)) * clip.duration;
        const peakStart = Math.max(0, Math.floor(sourceStart / asset.duration * asset.waveformPeaks.length));
        const peakEnd = Math.min(asset.waveformPeaks.length, Math.max(peakStart + 1, Math.ceil(sourceEnd / asset.duration * asset.waveformPeaks.length)));
        let peak = 0;
        for (let i = peakStart; i < peakEnd; i += 1) peak = Math.max(peak, asset.waveformPeaks[i] || 0);
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
    resizeObserver.observe(scroll);
    scroll.addEventListener("scroll", draw, { passive: true });
    return () => { resizeObserver.disconnect(); scroll.removeEventListener("scroll", draw); };
  }, [asset, clip.muted, clip.offset, clip.duration, width, left]);

  function getPointerTime(event: React.PointerEvent<HTMLElement>) {
    const lanesRect = lanesRef.current?.getBoundingClientRect();
    if (!lanesRect) {
      return clip.startTime;
    }

    const rawTime = Math.max(0, (event.clientX - lanesRect.left) / zoomPxPerSecond);
    return snapTime(rawTime, bpm, snapEnabled && !event.altKey, gridDivision);
  }

  function playFromPointer(event: React.PointerEvent<HTMLElement>) {
    const startAt = clamp(
      getPointerTime(event),
      clip.startTime,
      clip.startTime + timelineDuration,
    );

    setPlayhead(startAt);
    window.dispatchEvent(new CustomEvent("playlist-play-from", { detail: startAt }));
  }

  function beginDrag(mode: DragMode, event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    selectClip(clip.id, event.shiftKey || event.ctrlKey);
    captureHistory();
    sessionRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originalClip: clip,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleClipPointerDown(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();

    if (event.button === 2) return;
    if (playlistTool === "delete") {
      event.preventDefault();
      deleteClip(clip.id);
      return;
    }

    if (playlistTool === "mute") {
      toggleClipMuted(clip.id);
      return;
    }

    if (playlistTool === "slice") {
      sliceClipAt(clip.id, getPointerTime(event));
      return;
    }

    if (playlistTool === "play-selected") {
      selectClip(clip.id, event.shiftKey || event.ctrlKey);
      playFromPointer(event);
      return;
    }

    if (playlistTool === "select" || event.ctrlKey || event.shiftKey) {
      selectClip(clip.id, event.shiftKey || event.ctrlKey);
      return;
    }

    beginDrag(playlistTool === "slip" ? "slip" : "move", event);
  }

  function beginTrim(mode: Extract<DragMode, "trim-left" | "trim-right">, event: React.PointerEvent<HTMLElement>) {
    if (["delete", "mute", "slice", "play-selected"].includes(playlistTool)) {
      handleClipPointerDown(event);
      return;
    }

    beginDrag(mode, event);
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
        snapEnabled && !event.altKey,
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

      moveClip(original.id, targetTrackId, { startTime: Math.max(0, moved) }, { history: false });
      return;
    }

    if (session.mode === "slip") {
      const nextOffset = clamp(
        original.offset + deltaTimeline * originalRate,
        0,
        Math.max(0, assetDuration - original.duration),
      );

      updateClip(original.id, { offset: nextOffset }, { history: false });
      return;
    }

    if (session.mode === "fade-in") {
      const originalTimelineDuration = getClipTimelineDuration(bpm, original);
      const maxFade = originalTimelineDuration / 2;
      updateClip(original.id, {
        fadeIn: Math.round(clamp(original.fadeIn + deltaTimeline, 0, maxFade) * 100) / 100,
        fadeCurve: original.fadeCurve ?? "equalPower",
      }, { history: false });
      return;
    }

    if (session.mode === "fade-out") {
      const originalTimelineDuration = getClipTimelineDuration(bpm, original);
      const maxFade = originalTimelineDuration / 2;
      updateClip(original.id, {
        fadeOut: Math.round(clamp(original.fadeOut - deltaTimeline, 0, maxFade) * 100) / 100,
        fadeCurve: original.fadeCurve ?? "equalPower",
      }, { history: false });
      return;
    }

    if (session.mode === "trim-left") {
      const desiredStart = snapTime(
        original.startTime + deltaTimeline,
        bpm,
        snapEnabled && !event.altKey,
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
      }, { history: false });
      return;
    }

    const currentDisplayDuration = original.duration / originalRate;
    const desiredDisplayDuration = snapTime(
      currentDisplayDuration + deltaTimeline,
      bpm,
      snapEnabled && !event.altKey,
      gridDivision,
    );
    const nextDuration = clamp(
      desiredDisplayDuration * originalRate,
      MIN_CLIP_SOURCE_DURATION,
      assetDuration - original.offset,
    );
    updateClip(original.id, { duration: nextDuration }, { history: false });
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const session = sessionRef.current;
    if (session && session.pointerId === event.pointerId) {
      sessionRef.current = undefined;
    }
  }

  return (
    <article
      className={`clip ${isSelected ? "selected" : ""} ${
        clip.muted ? "muted" : ""
      } ${clip.groupId ? "grouped" : ""} ${clip.isRecording ? "recording" : ""}`}
      style={{ left, top, width }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setShowMenu(true);
      }}
      tabIndex={0}
      aria-label={`${clip.name} 클립`}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectClip(clip.id, event.shiftKey || event.ctrlKey); } if (event.key === "Escape") setShowMenu(false); }}
      onPointerDown={handleClipPointerDown}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        aria-label="클립 시작점 다듬기"
        className="trim-handle left"
        onPointerDown={(event) => beginTrim("trim-left", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <canvas ref={canvasRef} />
      {showMenu && <div className="clip-context-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { deleteClip(clip.id); setShowMenu(false); }}>클립 삭제</button>
        <button type="button" role="menuitem" onClick={() => setShowMenu(false)}>닫기</button>
      </div>}
      {(fadeInWidth > 0 || fadeOutWidth > 0) && (
        <div className="clip-fade-overlays" aria-hidden="true">
          {fadeInWidth > 0 && (
            <span
              className="clip-fade-overlay fade-in"
              style={{ width: fadeInWidth }}
            />
          )}
          {fadeOutWidth > 0 && (
            <span
              className="clip-fade-overlay fade-out"
              style={{ width: fadeOutWidth }}
            />
          )}
        </div>
      )}
      <button
        aria-label="페이드 인 조절"
        className="fade-handle fade-in"
        onPointerDown={(event) => beginDrag("fade-in", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ left: Math.max(12, fadeInWidth) }}
        type="button"
      />
      <button
        aria-label="페이드 아웃 조절"
        className="fade-handle fade-out"
        onPointerDown={(event) => beginDrag("fade-out", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ right: Math.max(12, fadeOutWidth) }}
        type="button"
      />
      <div className="clip-label">
        <strong>{clip.name}</strong>
        <span>{clip.muted ? "음소거" : `${playbackRate.toFixed(2)}x`}</span>
      </div>
      <button
        aria-label="클립 끝점 다듬기"
        className="trim-handle right"
        onPointerDown={(event) => beginTrim("trim-right", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </article>
  );
}
