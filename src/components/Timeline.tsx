import { Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useRef, useState } from "react";
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
const CLIP_HEIGHT = 84;

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
  const sessionRef = useRef<LanePointerSession | undefined>(undefined);
  const [dragBox, setDragBox] = useState<DragBox | undefined>();
  const [cursorAccent, setCursorAccent] = useState<CursorAccent | undefined>();
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const timeMarkers = useDawStore((state) => state.timeMarkers);
  const bpm = useDawStore((state) => state.bpm);
  const playhead = useDawStore((state) => state.playhead);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const gridDivision = useDawStore((state) => state.gridDivision);
  const playlistTool = useDawStore((state) => state.playlistTool);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const performanceMode = useDawStore((state) => state.performanceMode);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const clearSelection = useDawStore((state) => state.clearSelection);
  const setSelectedClips = useDawStore((state) => state.setSelectedClips);
  const addClipFromSource = useDawStore((state) => state.addClipFromSource);
  const moveClip = useDawStore((state) => state.moveClip);
  const addTrack = useDawStore((state) => state.addTrack);
  const updateTrack = useDawStore((state) => state.updateTrack);
  const setZoom = useDawStore((state) => state.setZoom);

  const projectDuration = useMemo(
    () => getProjectDuration({ bpm, tracks }),
    [bpm, tracks],
  );
  const width = Math.max(1200, projectDuration * zoomPxPerSecond);
  const beatSeconds = getBeatSeconds(bpm);
  const beatWidth = beatSeconds * zoomPxPerSecond;
  const subdivisionWidth = beatWidth / gridDivision;

  const rulerTicks = useMemo(() => {
    const totalBeats = Math.ceil(projectDuration / beatSeconds);
    return Array.from({ length: totalBeats + 1 }, (_, beat) => ({
      beat,
      left: beat * beatWidth,
      label: beat % 4 === 0 ? String(beat / 4 + 1) : "",
    }));
  }, [beatSeconds, beatWidth, projectDuration]);
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
    "--playlist-tool-cursor": `url("${playlistToolIcons[playlistTool]}") 8 8, auto`,
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

  function seekFromPointer(event: React.PointerEvent<HTMLElement>) {
    const position = getPointerPosition(event);
    if (!position) {
      return;
    }

    setPlayhead(position.time);
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
      const clipId = addClipFromSource(sourceClipId, position.trackId, position.time);

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
      moveClip(session.clipId, position.trackId, { startTime: position.time });
      return;
    }

    if (session.mode === "paint") {
      const paintKey = getPaintKey(position);
      if (paintKey !== session.lastPaintKey) {
        addClipFromSource(session.sourceClipId, position.trackId, position.time);
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
      aria-label="Playlist"
      style={playlistCursorStyle}
    >
      <PlaylistToolbar />
      <div className="track-column">
        <div className="ruler-corner">
          <span>Playlist</span>
          <button className="add-track-button" onClick={addTrack} title="Add track">
            <Plus size={15} />
            <span>Track</span>
          </button>
        </div>
        {tracks.map((track) => (
          <div className="track-header" key={track.id}>
            <input
              value={track.name}
              onChange={(event) => updateTrack(track.id, { name: event.target.value })}
            />
            <div className="track-toggles">
              <button
                className={track.muted ? "toggle active danger" : "toggle"}
                onClick={() => updateTrack(track.id, { muted: !track.muted })}
              >
                M
              </button>
              <button
                className={track.solo ? "toggle active" : "toggle"}
                onClick={() => updateTrack(track.id, { solo: !track.solo })}
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
                onChange={(event) =>
                  updateTrack(track.id, { volume: Number(event.target.value) })
                }
              />
            </label>
          </div>
        ))}
      </div>

      <div className="timeline-scroll">
        <div className="ruler" style={{ width }}>
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
