/**
 * 화면 부품이 쓰는 저장소(과도기 어댑터, P3-1).
 *
 * 프로젝트 문서(이름·템포·트랙·음원·마커)는 이제 state/projectStore가 가진다.
 * 이 저장소의 문서 필드(tracks, bpm …)는 projectStore.doc을 그대로 비추는 읽기 전용 거울이다.
 * 문서를 바꾸는 함수(addClip, updateTrack …)는 예전 이름과 모양을 그대로 두고 안에서 state/commands를 부른다.
 * 그래서 화면 부품은 한 번에 고치지 않아도 되고, 부품을 고칠 때마다 useProject로 옮긴다.
 *
 * 이 저장소에 남는 것: 선택, 재생 상태, 확대, 스냅, 도구, 화면 모드 (화면 상태). 녹음 상태는 state/recordingStore가 가진다(P3-5).
 * 실행 취소 이력은 state/history가 가진다.
 */
import { create } from "zustand";
import type {
  AssetMeta,
  Clip,
  PlaylistSnap,
  PlaylistTool,
  ProjectDoc,
  Track,
} from "../domain/types";
import { clampZoom, minZoomFor, zoomToFitValue } from "../domain/timeline/zoom";
import { clamp, createId, getClipTimelineDuration, getProjectDuration } from "../utils/audioMath";
import { fail, ok, type CommandResult } from "../state/commandResult";
import * as commands from "../state/commands/index";
import { history, type EditOptions } from "../state/history";
import { getDoc, projectStore } from "../state/projectStore";
import { isRecordingBusy, useRecordingStore } from "../state/recordingStore";
import { getSnapDivision, resolveSnap } from "../state/snap";

type HistoryOptions = {
  history?: boolean;
};

interface DawStore extends ProjectDoc {
  selectedTrackId?: string;
  selectedClipId?: string;
  selectedClipIds: string[];
  isPlaying: boolean;
  playhead: number;
  zoomPxPerSecond: number;
  /** 타임라인이 화면에 보이는 가로 폭(px). 확대 범위의 아래쪽 끝(전체 보기)을 정하는 데 쓴다. 아직 모르면 0. */
  timelineViewportWidth: number;
  snapEnabled: boolean;
  gridDivision: number;
  playlistTool: PlaylistTool;
  playlistSnap: PlaylistSnap;
  globalSnap: Exclude<PlaylistSnap, "main">;
  performanceMode: boolean;
  playlistDetached: boolean;
  undo: () => CommandResult<"empty" | "recording">;
  redo: () => CommandResult<"empty" | "recording">;
  setBpm: (bpm: number) => void;
  setMasterVolumeDb: (volumeDb: number) => void;
  setProjectName: (name: string) => void;
  setPlayhead: (playhead: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setZoom: (zoomPxPerSecond: number) => void;
  setTimelineViewportWidth: (width: number) => void;
  /** 프로젝트 전체가 화면 폭에 들어오게 확대 배율을 정한다("전체 보기"). 화면 폭을 아직 모르면 실패. */
  zoomToFit: () => CommandResult<"unknown-size">;
  setSnapEnabled: (enabled: boolean) => void;
  setPlaylistTool: (tool: PlaylistTool) => void;
  setPlaylistSnap: (snap: PlaylistSnap) => void;
  setGlobalSnap: (snap: Exclude<PlaylistSnap, "main">) => void;
  addAudioAsset: (asset: AssetMeta, options?: HistoryOptions) => void;
  updateAudioAsset: (
    assetId: string,
    patch: Partial<AssetMeta>,
    options?: HistoryOptions,
  ) => void;
  addClip: (trackId: string, clip: Clip, options?: HistoryOptions) => void;
  addClipFromSource: (
    sourceClipId: string | undefined,
    trackId: string,
    startTime: number,
    options?: HistoryOptions,
  ) => string | undefined;
  updateClip: (clipId: string, patch: Partial<Clip>, options?: HistoryOptions) => void;
  moveClip: (
    clipId: string,
    targetTrackId: string,
    patch?: Partial<Clip>,
    options?: HistoryOptions,
  ) => void;
  deleteClip: (clipId: string, options?: HistoryOptions) => void;
  deleteSelectedClips: () => CommandResult<"none-selected", { count: number }>;
  toggleClipMuted: (clipId: string) => void;
  sliceClipAt: (clipId: string, splitTime: number) => CommandResult<"not-found" | "outside-clip">;
  selectClip: (clipId?: string, additive?: boolean) => void;
  selectTrack: (trackId?: string) => void;
  setSelectedClips: (clipIds: string[]) => void;
  toggleClipSelection: (clipId: string) => void;
  selectAllClips: () => void;
  clearSelection: () => void;
  quantizeSelectedClips: () => CommandResult<"none-selected", { count: number }>;
  groupSelectedClips: () => CommandResult<"too-few", { count: number }>;
  ungroupSelectedClips: () => CommandResult<"none-selected", { count: number }>;
  zoomToSelectedClips: () => CommandResult<"none-selected">;
  resetSelectedClipSource: () => CommandResult<"none-selected", { count: number }>;
  addTimeMarker: (time?: number) => void;
  clearTimeMarkers: () => void;
  togglePerformanceMode: () => void;
  togglePlaylistDetached: () => void;
  addTrack: () => void;
  deleteTrack: (trackId: string) => CommandResult<"last-track" | "recording" | "not-found", { name: string }>;
  reorderTrack: (trackId: string, direction: -1 | 1) => void;
  updateTrack: (trackId: string, patch: Partial<Omit<Track, "clips">>) => void;
  importProject: (project: ProjectDoc) => void;
  resetProject: () => void;
}

/** 이 저장소가 거울로 비추는 문서 필드 */
function docFields(doc: ProjectDoc) {
  return {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    name: doc.name,
    bpm: doc.bpm,
    timeSignature: doc.timeSignature,
    sampleRate: doc.sampleRate,
    master: doc.master,
    tracks: doc.tracks,
    assets: doc.assets,
    markers: doc.markers,
  };
}

/** 예전 옵션({ history: false })을 새 옵션으로 */
function editOptions(options?: HistoryOptions): EditOptions {
  return { record: options?.history !== false };
}

function getAllClipIds(tracks: Track[]) {
  return tracks.flatMap((track) => track.clips.map((clip) => clip.id));
}

function getClipsByIds(tracks: Track[], clipIds: string[]) {
  const selected = new Set(clipIds);
  return tracks.flatMap((track) =>
    track.clips
      .filter((clip) => selected.has(clip.id))
      .map((clip) => ({ track, clip })),
  );
}

function dedupeClipIds(clipIds: string[], tracks: Track[]) {
  const validIds = new Set(getAllClipIds(tracks));
  return Array.from(new Set(clipIds)).filter((clipId) => validIds.has(clipId));
}

/** 문서를 통째로 바꾼 뒤(불러오기·새 프로젝트) 화면 상태를 처음으로 돌린다. */
function freshViewState() {
  return {
    selectedTrackId: undefined,
    selectedClipId: undefined,
    selectedClipIds: [] as string[],
    isPlaying: false,
    playhead: 0,
    snapEnabled: true,
    playlistTool: "move" as PlaylistTool,
    playlistSnap: "line" as PlaylistSnap,
    globalSnap: "line" as const,
    performanceMode: false,
    playlistDetached: false,
  };
}

export const useDawStore = create<DawStore>((set, get) => ({
  ...docFields(getDoc()),
  selectedTrackId: undefined,
  selectedClipId: undefined,
  selectedClipIds: [],
  isPlaying: false,
  playhead: 0,
  zoomPxPerSecond: 96,
  timelineViewportWidth: 0,
  snapEnabled: true,
  gridDivision: 2,
  playlistTool: "move",
  playlistSnap: "line",
  globalSnap: "line",
  performanceMode: false,
  playlistDetached: false,
  undo: () => {
    // 녹음하는 동안에는 문서를 되돌리지 않는다(녹음할 트랙이 사라질 수 있다).
    if (isRecordingBusy()) return fail("recording");
    if (!history.undo()) return fail("empty");
    set({ selectedTrackId: undefined, selectedClipId: undefined, selectedClipIds: [] });
    return ok();
  },
  redo: () => {
    if (isRecordingBusy()) return fail("recording");
    if (!history.redo()) return fail("empty");
    set({ selectedTrackId: undefined, selectedClipId: undefined, selectedClipIds: [] });
    return ok();
  },
  setBpm: (bpm) => {
    commands.setBpm(bpm);
  },
  setMasterVolumeDb: (volumeDb) => {
    commands.setMasterVolumeDb(volumeDb);
  },
  setProjectName: (name) => {
    commands.setProjectName(name);
  },
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setZoom: (zoomPxPerSecond) =>
    set((state) => ({
      zoomPxPerSecond: clampZoom(
        zoomPxPerSecond,
        minZoomFor(getProjectDuration({ bpm: state.bpm, tracks: state.tracks }), state.timelineViewportWidth),
      ),
    })),
  setTimelineViewportWidth: (width) => {
    const next = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    if (next !== get().timelineViewportWidth) set({ timelineViewportWidth: next });
  },
  zoomToFit: () => {
    const state = get();
    const zoom = zoomToFitValue(getProjectDuration({ bpm: state.bpm, tracks: state.tracks }), state.timelineViewportWidth);
    if (zoom === undefined) return fail("unknown-size");
    set({ zoomPxPerSecond: zoom });
    return ok();
  },
  setSnapEnabled: (snapEnabled) =>
    set({
      snapEnabled,
      playlistSnap: snapEnabled ? "line" : "none",
      gridDivision: snapEnabled ? getSnapDivision("line") : 2,
    }),
  setPlaylistTool: (playlistTool) => set({ playlistTool }),
  setPlaylistSnap: (playlistSnap) =>
    set((state) => {
      const effectiveSnap = resolveSnap(playlistSnap, state.globalSnap);
      return {
        playlistSnap,
        snapEnabled: effectiveSnap !== "none",
        gridDivision: getSnapDivision(effectiveSnap),
      };
    }),
  setGlobalSnap: (globalSnap) =>
    set((state) => {
      const effectiveSnap = resolveSnap(state.playlistSnap, globalSnap);
      return {
        globalSnap,
        snapEnabled: effectiveSnap !== "none",
        gridDivision: getSnapDivision(effectiveSnap),
      };
    }),
  addAudioAsset: (asset, options) => {
    commands.addAudioAsset(asset, editOptions(options));
  },
  updateAudioAsset: (assetId, patch, options) => {
    commands.updateAudioAsset(assetId, patch, editOptions(options));
  },
  addClip: (trackId, clip, options) => {
    commands.addClip(trackId, clip, editOptions(options));
    set({ selectedClipId: clip.id, selectedClipIds: [clip.id] });
  },
  addClipFromSource: (sourceClipId, trackId, startTime, options) => {
    const clipId = commands.addClipFromSource(sourceClipId, trackId, startTime, editOptions(options));
    if (clipId) set({ selectedClipId: clipId, selectedClipIds: [clipId] });
    return clipId;
  },
  updateClip: (clipId, patch, options) => {
    commands.updateClip(clipId, patch, editOptions(options));
  },
  moveClip: (clipId, targetTrackId, patch = {}, options) => {
    if (!commands.moveClip(clipId, targetTrackId, patch, editOptions(options))) return;
    set((state) => ({
      selectedClipId: clipId,
      selectedClipIds: state.selectedClipIds.includes(clipId) ? state.selectedClipIds : [clipId],
    }));
  },
  deleteClip: (clipId, options) => {
    commands.deleteClips([clipId], editOptions(options));
    set((state) => ({
      selectedClipId: state.selectedClipId === clipId ? undefined : state.selectedClipId,
      selectedClipIds: state.selectedClipIds.filter((selectedId) => selectedId !== clipId),
    }));
  },
  deleteSelectedClips: () => {
    const { selectedClipIds } = get();
    const deleting = new Set(selectedClipIds);
    if (!deleting.size) return fail("none-selected");
    commands.deleteClips([...deleting]);
    set({ selectedClipId: undefined, selectedClipIds: [] });
    return ok({ count: deleting.size });
  },
  toggleClipMuted: (clipId) => {
    commands.toggleClipMuted(clipId);
    set((state) => ({
      selectedClipId: clipId,
      selectedClipIds: state.selectedClipIds.includes(clipId) ? state.selectedClipIds : [clipId],
    }));
  },
  sliceClipAt: (clipId, splitTime) => {
    const result = commands.sliceClipAt(clipId, splitTime);
    if (!result.ok) return result;
    set({ selectedClipId: result.rightClipId, selectedClipIds: [result.rightClipId] });
    return ok();
  },
  selectClip: (clipId, additive = false) =>
    set((state) => {
      if (!clipId) {
        return {
          selectedClipId: undefined,
          selectedClipIds: [],
        };
      }

      if (!additive) {
        return {
          selectedClipId: clipId,
          selectedClipIds: [clipId],
        };
      }

      const exists = state.selectedClipIds.includes(clipId);
      const selectedClipIds = exists
        ? state.selectedClipIds.filter((selectedId) => selectedId !== clipId)
        : [...state.selectedClipIds, clipId];

      return {
        selectedClipId: selectedClipIds[selectedClipIds.length - 1],
        selectedClipIds,
      };
    }),
  setSelectedClips: (clipIds) =>
    set((state) => {
      const selectedClipIds = dedupeClipIds(clipIds, state.tracks);
      return {
        selectedClipId: selectedClipIds[selectedClipIds.length - 1],
        selectedClipIds,
      };
    }),
  toggleClipSelection: (clipId) =>
    set((state) => {
      const selectedClipIds = state.selectedClipIds.includes(clipId)
        ? state.selectedClipIds.filter((selectedId) => selectedId !== clipId)
        : [...state.selectedClipIds, clipId];

      return {
        selectedClipId: selectedClipIds[selectedClipIds.length - 1],
        selectedClipIds,
      };
    }),
  selectAllClips: () =>
    set((state) => {
      const selectedClipIds = getAllClipIds(state.tracks);
      return {
        selectedClipId: selectedClipIds[selectedClipIds.length - 1],
        selectedClipIds,
      };
    }),
  clearSelection: () =>
    set({
      selectedClipId: undefined,
      selectedClipIds: [],
    }),
  selectTrack: (trackId) =>
    set({
      selectedTrackId: trackId,
      selectedClipId: undefined,
      selectedClipIds: [],
    }),
  quantizeSelectedClips: () => {
    const state = get();
    const selected = new Set(state.selectedClipIds);
    if (!selected.size) return fail("none-selected");
    const division = state.snapEnabled ? state.gridDivision : getSnapDivision("line");
    commands.quantizeClips([...selected], division);
    return ok({ count: selected.size });
  },
  groupSelectedClips: () => {
    const { selectedClipIds } = get();
    if (selectedClipIds.length < 2) return fail("too-few");
    const selected = new Set(selectedClipIds);
    commands.groupClips([...selected], createId("group"));
    return ok({ count: selected.size });
  },
  ungroupSelectedClips: () => {
    const selected = new Set(get().selectedClipIds);
    if (!selected.size) return fail("none-selected");
    commands.ungroupClips([...selected]);
    return ok({ count: selected.size });
  },
  zoomToSelectedClips: () => {
    const state = get();
    const selected = getClipsByIds(state.tracks, state.selectedClipIds);
    if (!selected.length) return fail("none-selected");

    const start = Math.min(...selected.map(({ clip }) => clip.startTime));
    const end = Math.max(
      ...selected.map(({ clip }) => clip.startTime + getClipTimelineDuration(state.bpm, clip)),
    );
    const span = Math.max(0.25, end - start);
    set({
      playhead: start,
      zoomPxPerSecond: clamp(760 / span, 40, 320),
    });
    return ok();
  },
  resetSelectedClipSource: () => {
    const state = get();
    const selected = getClipsByIds(state.tracks, state.selectedClipIds);
    if (!selected.length) return fail("none-selected");
    commands.resetClipSources(selected.map(({ clip }) => clip.id));
    return ok({ count: selected.length });
  },
  addTimeMarker: (time) => {
    commands.addTimeMarker(time ?? get().playhead);
  },
  clearTimeMarkers: () => {
    commands.clearTimeMarkers();
  },
  togglePerformanceMode: () =>
    set((state) => ({ performanceMode: !state.performanceMode })),
  togglePlaylistDetached: () =>
    set((state) => ({ playlistDetached: !state.playlistDetached })),
  addTrack: () => {
    const track = commands.addTrack();
    set({
      selectedTrackId: track.id,
      selectedClipId: undefined,
      selectedClipIds: [],
    });
  },
  deleteTrack: (trackId) => {
    const state = get();
    if (isRecordingBusy()) return fail("recording");
    if (state.tracks.length <= 1) return fail("last-track");
    const track = state.tracks.find((item) => item.id === trackId);
    if (!track) return fail("not-found");

    commands.removeTrack(trackId);
    const removedIds = new Set(track.clips.map((clip) => clip.id));
    const selectedClipIds = state.selectedClipIds.filter((id) => !removedIds.has(id));
    set({
      selectedTrackId: state.selectedTrackId === trackId ? get().tracks[0].id : state.selectedTrackId,
      selectedClipId: state.selectedClipId && removedIds.has(state.selectedClipId)
        ? selectedClipIds[selectedClipIds.length - 1]
        : state.selectedClipId,
      selectedClipIds,
    });
    useRecordingStore.getState().disarmTrack(trackId);
    return ok({ name: track.name });
  },
  reorderTrack: (trackId, direction) => {
    if (isRecordingBusy()) return;
    commands.reorderTrack(trackId, direction);
  },
  updateTrack: (trackId, patch) => {
    commands.updateTrack(trackId, patch);
  },
  importProject: (project) => {
    commands.replaceDoc(project);
    useRecordingStore.getState().resetForNewProject();
    set({ ...freshViewState(), gridDivision: getSnapDivision("line") });
  },
  resetProject: () => {
    commands.resetDoc();
    useRecordingStore.getState().resetForNewProject();
    set({ ...freshViewState(), zoomPxPerSecond: 96, gridDivision: 2 });
  },
}));

// 문서가 바뀔 때마다 이 저장소의 문서 필드를 맞춘다(같은 호출 안에서 바로). 화면 부품은 예전처럼 useDawStore로 읽는다.
projectStore.subscribe((state, previous) => {
  if (state.doc !== previous.doc) useDawStore.setState(docFields(state.doc));
});
