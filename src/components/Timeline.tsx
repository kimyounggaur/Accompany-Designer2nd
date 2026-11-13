import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDawStore } from "../store/useDawStore";
import type { PlaylistTool } from "../types";
import {
  clamp,
  getBeatSeconds,
  getClipTimelineDuration,
  getProjectDuration,
  snapTime,
} from "../utils/audioMath";
import { playlistToolIcons } from "../utils/playlistToolIcons";
import { ClipView } from "./ClipView";
import { PlaylistToolbar } from "./PlaylistToolbar";

const TRACK_HEIGHT = 116;
const CLIP_TOP_OFFSET = 15;

interface PointerPosition {
  x: number;
  y: number;
  time: number;
  trackId: string;
  trackIndex: number;
}

interface DragBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CursorAccent {
  left: number;
  top: number;
}

interface LanePointerSession {
  mode: Extract<PlaylistTool, "draw" | "paint" | "select" | "zoom">;
  pointerId: number;
  startX: number;
  startY: number;
  sourceClipId?: string;
  clipId?: string;
  lastPaintKey?: string;
  additive?: boolean;
}

function makeBox(startX: number, startY: number, endX: number, endY: number): DragBox {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function Timeline() {
  const lanesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const sessionRef = useRef<LanePointerSession | undefined>(undefined);
  const [dragBox, setDragBox] = useState<DragBox | undefined>();
  const [cursorAccent, setCursorAccent] = useState<CursorAccent | undefined>();
  // 룰러 드래그 줌용
  const rulerDragRef = useRef<{ startX: number; startZoom: number } | null>(null);
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const timeMarkers = useDawStore((state) => state.timeMarkers);
  const bpm = useDawStore((state) => state.bpm);
  const playhead = useDawStore((state) => state.playhead);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const gridDivision = useDawStore((state) => state.gridDivision);
  const playlistTool = useDawStore((state) => state.playlistTool);
  const selectedTrackId = useDawStore((state) => state.selectedTrackId);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const performanceMode = useDawStore((state) => state.performanceMode);
  const recording = useDawStore((state) => state.recording);
  const isPlaying = useDawStore((state) => state.isPlaying);
  const captureHistory = useDawStore((state) => state.captureHistory);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const clearSelection = useDawStore((state) => state.clearSelection);
  const setSelectedClips = useDawStore((state) => state.setSelectedClips);
  const addClipFromSource = useDawStore((state) => state.addClipFromSource);
  const moveClip = useDawStore((state) => state.moveClip);
  const addTrack = useDawStore((state) => state.addTrack);
  const deleteTrack = useDawStore((state) => state.deleteTrack);
  const reorderTrack = useDawStore((state) => state.reorderTrack);
  const beginHistoryGroup = useDawStore((state) => state.beginHistoryGroup);
  const endHistoryGroup = useDawStore((state) => state.endHistoryGroup);
  const isRecording = ["counting-in", "recording", "stopping"].includes(recording.status);
  useEffect(() => {
    document.addEventListener("pointerup", endHistoryGroup);
    document.addEventListener("pointercancel", endHistoryGroup);
    return () => { document.removeEventListener("pointerup", endHistoryGroup); document.removeEventListener("pointercancel", endHistoryGroup); };
  }, [endHistoryGroup]);
  const updateTrack = useDawStore((state) => state.updateTrack);
  const selectTrack = useDawStore((state) => state.selectTrack);
  const toggleRecordingArm = useDawStore((state) => state.toggleRecordingArm);
  const setZoom = useDawStore((state) => state.setZoom);

  const CLIP_HEIGHT = TRACK_HEIGHT - 32;

  // A ruler click seeks; dragging still adjusts the zoom.
  function beginRulerDrag(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    rulerDragRef.current = { startX: e.clientX, startZoom: zoomPxPerSecond };

    function onMove(ev: MouseEvent) {
      if (!rulerDragRef.current) return;
      // 오른쪽으로 드래그 → 확대, 왼쪽 → 축소
      const delta = ev.clientX - rulerDragRef.current.startX;
      const factor = Math.pow(1.008, delta);          // 부드러운 지수 스케일
      setZoom(rulerDragRef.current.startZoom * factor);
    }
    function onUp(ev: MouseEvent) {
      const scroll = scrollRef.current;
      if (rulerDragRef.current && Math.abs(ev.clientX - rulerDragRef.current.startX) < 4 && scroll) {
        const left = scroll.getBoundingClientRect().left;
        seekTo(Math.max(0, (ev.clientX - left + scroll.scrollLeft) / zoomPxPerSecond));
      }
      rulerDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Native non-passive listener prevents browser zoom only for Ctrl+wheel.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      const cursor = event.clientX - scroll.getBoundingClientRect().left;
      const time = (scroll.scrollLeft + cursor) / useDawStore.getState().zoomPxPerSecond;
      const currentZoom = useDawStore.getState().zoomPxPerSecond;
      setZoom(currentZoom * (event.deltaY > 0 ? 0.88 : 1.14));
      const nextZoom = useDawStore.getState().zoomPxPerSecond;
      requestAnimationFrame(() => { scroll.scrollLeft = time * nextZoom - cursor; });
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !followPlayhead || !isPlaying) return;
    const x = playhead * zoomPxPerSecond;
    if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 30) {
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.2);
    }
  }, [followPlayhead, isPlaying, playhead, zoomPxPerSecond]);

  const projectDuration = useMemo(
    () => getProjectDuration({ bpm, tracks }),
    [bpm, tracks],
  );
  const width = Math.max(1200, projectDuration * zoomPxPerSecond);
  const beatSeconds = getBeatSeconds(bpm);
  const beatWidth = beatSeconds * zoomPxPerSecond;
  const subdivisionWidth = beatWidth / gridDivision;

  const rulerTicks = useMemo(() => {
    // projectDuration 대신 실제 표시 너비 기준으로 틱 생성 → 트랙 끝까지 번호 표시
    const visibleDuration = width / zoomPxPerSecond;
    const totalBeats = Math.ceil(visibleDuration / beatSeconds);
    return Array.from({ length: totalBeats + 1 }, (_, beat) => ({
      beat,
      left: beat * beatWidth,
      label: beat % 4 === 0 ? String(beat / 4 + 1) : "",
    }));
  }, [beatSeconds, beatWidth, width, zoomPxPerSecond]);
  const timelineClips = useMemo(
    () =>
      tracks.flatMap((track, trackIndex) =>
        track.clips.map((clip) => ({
          clip,
          trackIndex,
        })),
      ),
    [tracks],
  );
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const playlistCursorStyle = {
    "--playlist-tool-cursor": `url("${playlistToolIcons[playlistTool]}") ${
      playlistTool === "move" ? "1 1" : "8 8"
    }, auto`,
  } as CSSProperties;

  function getPointerPosition(event: React.PointerEvent<HTMLElement>): PointerPosition | undefined {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect || !tracks.length) {
      return undefined;
    }

    const x = Math.max(0, event.clientX - rect.left);
    const y = Math.max(0, event.clientY - rect.top);
    const rawTime = x / zoomPxPerSecond;
    const trackIndex = clamp(
      Math.floor(y / TRACK_HEIGHT),
      0,
      Math.max(0, tracks.length - 1),
    );
    const trackId = tracks[trackIndex]?.id ?? tracks[0].id;

    return {
      x,
      y,
      time: snapTime(rawTime, bpm, snapEnabled && !event.altKey, gridDivision),
      trackId,
      trackIndex,
    };
  }

  function getPaintKey(position: PointerPosition) {
    const snapStep = snapEnabled ? beatSeconds / gridDivision : 0.25;
    return `${position.trackId}:${Math.round(position.time / snapStep)}`;
  }

  function seekTo(time: number) {
    if (useDawStore.getState().isPlaying) {
      window.dispatchEvent(new CustomEvent("playlist-play-from", { detail: time }));
    } else {
      setPlayhead(time);
    }
  }

  function seekFromPointer(event: React.PointerEvent<HTMLElement>) {
    const position = getPointerPosition(event);
    if (!position) {
      return;
    }

    seekTo(position.time);
  }

  function getClipIdsInsideBox(box: DragBox) {
    const boxRight = box.left + box.width;
    const boxBottom = box.top + box.height;

    return timelineClips
      .filter(({ clip, trackIndex }) => {
        const clipLeft = clip.startTime * zoomPxPerSecond;
        const clipRight =
          clipLeft + getClipTimelineDuration(bpm, clip) * zoomPxPerSecond;
        const clipTop = trackIndex * TRACK_HEIGHT + CLIP_TOP_OFFSET;
        const clipBottom = clipTop + CLIP_HEIGHT;

        return (
          clipLeft <= boxRight &&
          clipRight >= box.left &&
          clipTop <= boxBottom &&
          clipBottom >= box.top
        );
      })
      .map(({ clip }) => clip.id);
  }

  function beginLanePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const position = getPointerPosition(event);
    if (!position) {
      return;
    }

    if (playlistTool === "draw" || playlistTool === "paint") {
      event.preventDefault();
      const sourceClipId = selectedClipId;
      captureHistory();
      const clipId = addClipFromSource(
        sourceClipId,
        position.trackId,
        position.time,
        { history: false },
      );

      if (!clipId) {
        return;
      }

      sessionRef.current = {
        mode: playlistTool,
        pointerId: event.pointerId,
        startX: position.x,
        startY: position.y,
        sourceClipId,
        clipId,
        lastPaintKey: getPaintKey(position),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (playlistTool === "select" || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      if (!event.shiftKey && !event.ctrlKey) {
        clearSelection();
      }

      sessionRef.current = {
        mode: "select",
        pointerId: event.pointerId,
        startX: position.x,
        startY: position.y,
        additive: event.shiftKey || event.ctrlKey,
      };
      setDragBox(makeBox(position.x, position.y, position.x, position.y));
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (playlistTool === "zoom") {
      event.preventDefault();
      sessionRef.current = {
        mode: "zoom",
        pointerId: event.pointerId,
        startX: position.x,
        startY: position.y,
      };
      setDragBox(makeBox(position.x, position.y, position.x, position.y));
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    clearSelection();
    seekFromPointer(event);
  }

  function updateLanePointer(event: React.PointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const position = getPointerPosition(event);
    if (!position) {
      return;
    }

    if (session.mode === "draw" && session.clipId) {
      moveClip(
        session.clipId,
        position.trackId,
        { startTime: position.time },
        { history: false },
      );
      return;
    }

    if (session.mode === "paint") {
      const paintKey = getPaintKey(position);
      if (paintKey !== session.lastPaintKey) {
        addClipFromSource(
          session.sourceClipId,
          position.trackId,
          position.time,
          { history: false },
        );
        session.lastPaintKey = paintKey;
      }
      return;
    }

    setDragBox(makeBox(session.startX, session.startY, position.x, position.y));
  }

  function handleLanePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    setCursorAccent({
      left: event.clientX - 8,
      top: event.clientY - 8,
    });
    updateLanePointer(event);
  }

  function endLanePointer(event: React.PointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const finalBox = dragBox;

    if (finalBox && session.mode === "select") {
      const selectedIds =
        finalBox.width > 4 || finalBox.height > 4 ? getClipIdsInsideBox(finalBox) : [];
      const currentIds = session.additive
        ? useDawStore.getState().selectedClipIds
        : [];
      setSelectedClips([...currentIds, ...selectedIds]);
    }

    if (finalBox && session.mode === "zoom") {
      if (finalBox.width > 8) {
        const viewportWidth = lanesRef.current?.parentElement?.clientWidth ?? 760;
        const startTime = finalBox.left / zoomPxPerSecond;
        const endTime = (finalBox.left + finalBox.width) / zoomPxPerSecond;
        const duration = Math.max(0.25, endTime - startTime);

        setPlayhead(Math.max(0, startTime));
        setZoom(viewportWidth / duration);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollLeft = startTime * useDawStore.getState().zoomPxPerSecond;
        });
      } else {
        setZoom(zoomPxPerSecond + 24);
      }
    }

    sessionRef.current = undefined;
    setDragBox(undefined);
  }

  return (
    <section
      className={`playlist ${performanceMode ? "performance-mode" : ""}`}
      aria-label="플레이리스트"
      style={playlistCursorStyle}
    >
      <PlaylistToolbar />
      <div className="track-column" ref={headersRef}>
        <div className="ruler-corner">
          <button type="button" className="follow-toggle" aria-pressed={followPlayhead} onClick={() => setFollowPlayhead(!followPlayhead)} title="재생선 따라가기 켜기/끄기">{followPlayhead ? "따라가기 켬" : "따라가기 끔"}</button>
          <button className="add-track-button" onClick={addTrack} title="트랙 추가">
            <Plus size={15} />
            <span>트랙</span>
          </button>
        </div>
        {tracks.map((track, index) => (
          <div
            className={`track-header ${selectedTrackId === track.id ? "selected" : ""}`}
            key={track.id}
            onClick={() => selectTrack(track.id)}
          >
            <div className="track-heading">
              <input
                aria-label={`${track.name} 트랙 이름`}
                value={track.name}
                onFocus={beginHistoryGroup}
                onBlur={endHistoryGroup}
                onChange={(event) => updateTrack(track.id, { name: event.target.value })}
              />
              <button type="button" className="track-order-button" disabled={index === 0 || isRecording}
                aria-label={`${track.name} 위로 이동`} title="트랙 위로 이동"
                onClick={(event) => { event.stopPropagation(); reorderTrack(track.id, -1); }}><ArrowUp size={14} /></button>
              <button type="button" className="track-order-button" disabled={index === tracks.length - 1 || isRecording}
                aria-label={`${track.name} 아래로 이동`} title="트랙 아래로 이동"
                onClick={(event) => { event.stopPropagation(); reorderTrack(track.id, 1); }}><ArrowDown size={14} /></button>
              <button type="button" className="track-order-button" disabled={tracks.length <= 1 || isRecording}
                aria-label={`${track.name} 삭제`} title={tracks.length <= 1 ? "트랙은 하나 이상 필요합니다" : "트랙 삭제"}
                onClick={(event) => { event.stopPropagation(); if (window.confirm(`'${track.name}' 트랙과 클립 ${track.clips.length}개를 삭제할까요? 실행 취소로 복원할 수 있습니다.`)) deleteTrack(track.id); }}><Trash2 size={14} /></button>
            </div>
            <div className="track-toggles">
              <button
                className={
                  recording.armedTrackId === track.id
                    ? "toggle arm-toggle active"
                    : "toggle arm-toggle"
                }
                disabled={
                  recording.status === "counting-in" ||
                  recording.status === "recording" ||
                  recording.status === "stopping"
                }
                onClick={() => toggleRecordingArm(track.id)}
                title="Arm this track for vocal recording"
                aria-label={`${track.name} 녹음 대기`}
                aria-pressed={recording.armedTrackId === track.id}
                type="button"
              >
                ARM
              </button>
              <button
                className={track.muted ? "toggle active danger" : "toggle"}
                onClick={() => updateTrack(track.id, { muted: !track.muted })}
                aria-label={`${track.name} 음소거`}
                aria-pressed={track.muted}
                type="button"
              >
                M
              </button>
              <button
                className={track.solo ? "toggle active" : "toggle"}
                onClick={() => updateTrack(track.id, { solo: !track.solo })}
                aria-label={`${track.name} 솔로`}
                aria-pressed={track.solo}
                type="button"
              >
                S
              </button>
            </div>
            <label>
              Vol
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.volume}
                aria-label={`${track.name} 볼륨`}
                onPointerDown={beginHistoryGroup}
                onChange={(event) =>
                  updateTrack(track.id, { volume: Number(event.target.value) })
                }
              />
            </label>
          </div>
        ))}
      </div>

      <div className="timeline-scroll" ref={scrollRef} onScroll={(event) => { if (headersRef.current) headersRef.current.scrollTop = event.currentTarget.scrollTop; }}>
        <div
          className="ruler"
          style={{ width, cursor: "ew-resize", userSelect: "none" }}
          onMouseDown={beginRulerDrag}
          title="클릭하여 재생 위치 이동, 좌우 드래그로 확대/축소"
        >
          {rulerTicks.map((tick) => (
            <div
              className={`ruler-tick ${tick.label ? "major" : ""}`}
              key={tick.beat}
              style={{ left: tick.left }}
            >
              {tick.label && <span>{tick.label}</span>}
            </div>
          ))}
          {timeMarkers.map((marker) => (
            <div
              className="ruler-marker"
              key={marker.id}
              style={{ left: marker.time * zoomPxPerSecond }}
            >
              <span>{marker.name}</span>
            </div>
          ))}
        </div>

        <div
          className="lanes"
          ref={lanesRef}
          style={{
            width,
            minHeight: tracks.length * TRACK_HEIGHT,
            backgroundSize: `${subdivisionWidth}px 100%`,
          }}
          onPointerDown={beginLanePointer}
          onPointerMove={handleLanePointerMove}
          onPointerUp={endLanePointer}
          onPointerCancel={endLanePointer}
          onPointerLeave={() => setCursorAccent(undefined)}
        >
          {timeMarkers.map((marker) => (
            <div
              className="time-marker"
              key={marker.id}
              style={{
                left: marker.time * zoomPxPerSecond,
                height: tracks.length * TRACK_HEIGHT,
              }}
            />
          ))}
          <div
            className="playhead"
            style={{
              left: playhead * zoomPxPerSecond,
              height: tracks.length * TRACK_HEIGHT,
            }}
          />
          {tracks.map((track, index) => (
            <div
              className="track-lane"
              key={track.id}
              style={{
                height: TRACK_HEIGHT,
                top: index * TRACK_HEIGHT,
              }}
            />
          ))}
          {timelineClips.map(({ clip, trackIndex }) => (
            <ClipView
              asset={audioAssets[clip.audioBufferId]}
              clip={clip}
              key={clip.id}
              lanesRef={lanesRef}
              trackHeight={TRACK_HEIGHT}
              trackIndex={trackIndex}
              trackIds={trackIds}
            />
          ))}
          {dragBox && (
            <div
              className={`selection-box ${playlistTool === "zoom" ? "zoom-box" : ""}`}
              style={dragBox}
            />
          )}
          {cursorAccent && (
            <div className="playlist-cursor-accent" style={cursorAccent} />
          )}
        </div>
      </div>
    </section>
  );
}
