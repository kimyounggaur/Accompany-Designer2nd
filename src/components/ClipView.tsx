import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import { canSliceAt } from "../domain/timeline/clipMath";
import { runClipAction, trimHandleActionFor } from "../domain/timeline/toolBehavior";
import type { AssetMeta, Clip } from "../domain/types";
import { ko } from "../i18n/ko";
import { keyLabel } from "../services/shortcuts";
import { history } from "../state/history";
import { useDawStore } from "../store/useDawStore";
import {
  copySelectedClips,
  deleteClip,
  deleteSelectedClips,
  duplicateClip,
  renameClip,
  sliceClipAt,
  sliceClipAtPlayhead,
  toggleSelectedClipsMuted,
  ungroupSelectedClips,
} from "../app/actions";
import { readPlayhead } from "../app/playhead";
import { ContextMenu } from "../ui/controls/ContextMenu";
import type { Point } from "../ui/controls/menuMath";
import { useLongPress } from "../ui/controls/useLongPress";
import { ClipNameEditor } from "../ui/timeline/ClipNameEditor";
import { buildClipMenuItems } from "../ui/timeline/menuItems";
import { WaveformCanvas } from "../ui/timeline/WaveformCanvas";
import {
  clamp,
  getClipPlaybackRate,
  getClipTimelineDuration,
  MIN_CLIP_SOURCE_DURATION,
  snapTime,
} from "../utils/audioMath";

type DragMode = "move" | "trim-left" | "trim-right" | "slip" | "fade-in" | "fade-out";

interface ClipViewProps {
  asset?: AssetMeta;
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
  /** 열려 있는 우클릭 메뉴: 누른 자리와, 열 때 정한 "재생선이 클립 안인가"·"그룹에 묶인 선택이 있는가" */
  const [menu, setMenu] = useState<{ anchor: Point; playheadInside: boolean; hasGroupedClip: boolean } | undefined>();
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const sessionRef = useRef<PointerSession | undefined>(undefined);
  const selectedClipIds = useDawStore((state) => state.selectedClipIds);
  const playlistTool = useDawStore((state) => state.playlistTool);
  const updateClip = useDawStore((state) => state.updateClip);
  const moveClip = useDawStore((state) => state.moveClip);
  const toggleClipMuted = useDawStore((state) => state.toggleClipMuted);
  const selectClip = useDawStore((state) => state.selectClip);
  const setCursor = useDawStore((state) => state.setCursor);
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

  /**
   * 메뉴를 연다. 이 클립이 선택에 없으면 이 클립만 선택하고(메뉴의 일이 눈에 보이는 선택을 대상으로 하도록),
   * 이미 선택에 들어 있으면 선택은 그대로 둔다(복사·삭제·음소거·그룹 해제는 선택 전체에 한다).
   */
  function openMenu(anchor: Point) {
    if (!useDawStore.getState().selectedClipIds.includes(clip.id)) selectClip(clip.id);
    const state = useDawStore.getState();
    const chosen = new Set(state.selectedClipIds);
    setMenu({
      anchor,
      playheadInside: canSliceAt(clip, state.bpm, readPlayhead()),
      hasGroupedClip: state.tracks.some((track) => track.clips.some((item) => chosen.has(item.id) && item.groupId !== undefined)),
    });
  }

  // 터치에서 500 ms 길게 누르면 우클릭과 같은 메뉴(삭제가 아니라 메뉴)
  const longPress = useLongPress(openMenu);

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

    setCursor(startAt);
    window.dispatchEvent(new CustomEvent("playlist-play-from", { detail: startAt }));
  }

  function beginDrag(mode: DragMode, event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    selectClip(clip.id, event.shiftKey || event.ctrlKey);
    // 끌기 한 번 = 실행 취소 한 단계. 누르기만 하고 움직이지 않으면 단계가 생기지 않는다.
    history.beginGesture(`clip:${clip.id}:drag`);
    sessionRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originalClip: clip,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** 클립을 눌렀을 때: 무엇을 할지는 도구 동작 표(domain/timeline/toolBehavior)에서 찾고, 여기서는 그 일을 하는 방법만 안다. */
  function handleClipPointerDown(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();

    if (event.button === 2) return;
    const additive = event.shiftKey || event.ctrlKey;
    runClipAction(playlistTool, additive, {
      select: () => selectClip(clip.id, additive),
      "select-and-move": () => beginDrag("move", event),
      "select-and-slip": () => beginDrag("slip", event),
      delete: () => {
        event.preventDefault();
        deleteClip(clip.id);
      },
      "toggle-mute": () => toggleClipMuted(clip.id),
      slice: () => sliceClipAt(clip.id, getPointerTime(event)),
      "select-and-play": () => {
        selectClip(clip.id, additive);
        playFromPointer(event);
      },
    });
  }

  function beginTrim(mode: Extract<DragMode, "trim-left" | "trim-right">, event: React.PointerEvent<HTMLElement>) {
    if (trimHandleActionFor(playlistTool) === "same-as-clip") {
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

      moveClip(original.id, targetTrackId, { startTime: Math.max(0, moved) });
      return;
    }

    if (session.mode === "slip") {
      const nextOffset = clamp(
        original.offset + deltaTimeline * originalRate,
        0,
        Math.max(0, assetDuration - original.duration),
      );

      updateClip(original.id, { offset: nextOffset });
      return;
    }

    if (session.mode === "fade-in") {
      const originalTimelineDuration = getClipTimelineDuration(bpm, original);
      const maxFade = originalTimelineDuration / 2;
      updateClip(original.id, {
        fadeIn: Math.round(clamp(original.fadeIn + deltaTimeline, 0, maxFade) * 100) / 100,
        fadeCurve: original.fadeCurve ?? "equalPower",
      });
      return;
    }

    if (session.mode === "fade-out") {
      const originalTimelineDuration = getClipTimelineDuration(bpm, original);
      const maxFade = originalTimelineDuration / 2;
      updateClip(original.id, {
        fadeOut: Math.round(clamp(original.fadeOut - deltaTimeline, 0, maxFade) * 100) / 100,
        fadeCurve: original.fadeCurve ?? "equalPower",
      });
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
      });
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
      data-testid="clip"
      className={`clip ${isSelected ? "selected" : ""} ${
        clip.muted ? "muted" : ""
      } ${clip.groupId ? "grouped" : ""} ${clip.isRecording ? "recording" : ""}`}
      style={{ left, top, width }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
      tabIndex={0}
      aria-label={`${clip.name} 클립`}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectClip(clip.id, event.shiftKey || event.ctrlKey); } }}
      onPointerDown={(event) => {
        longPress.onPointerDown(event);
        handleClipPointerDown(event);
      }}
      onPointerMove={(event) => {
        longPress.onPointerMove(event);
        updateDrag(event);
      }}
      onPointerUp={(event) => {
        longPress.onPointerUp();
        endDrag(event);
      }}
      onPointerCancel={(event) => {
        longPress.onPointerCancel();
        endDrag(event);
      }}
    >
      <button
        aria-label="클립 시작점 다듬기"
        className="trim-handle left"
        onPointerDown={(event) => beginTrim("trim-left", event)}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <WaveformCanvas asset={asset} clip={clip} width={width} left={left} />
      {menu && (
        <ContextMenu
          label={ko.menu.clip.label}
          anchor={menu.anchor}
          onClose={closeMenu}
          items={buildClipMenuItems(
            { playheadInside: menu.playheadInside, hasGroupedClip: menu.hasGroupedClip },
            {
              sliceAtPlayhead: () => sliceClipAtPlayhead(clip.id),
              duplicate: () => duplicateClip(clip.id),
              copy: copySelectedClips,
              toggleMute: toggleSelectedClipsMuted,
              rename: () => setRenaming(true),
              ungroup: ungroupSelectedClips,
              remove: deleteSelectedClips,
            },
            { copy: keyLabel("copy"), remove: keyLabel("deleteClips") },
          )}
        />
      )}
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
      {renaming ? (
        <ClipNameEditor
          name={clip.name}
          label={ko.menu.renameClip(clip.name)}
          onCommit={(name) => {
            renameClip(clip.id, name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div className="clip-label">
          <strong>{clip.name}</strong>
          <span>{clip.muted ? "음소거" : `${playbackRate.toFixed(2)}x`}</span>
        </div>
      )}
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
