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
  TimeSignature,
  Track,
} from "../domain/types";
import { pasteBaseRow, planDuplicate, planPaste } from "../domain/timeline/clipMath";
import { DEFAULT_SNAP, snapDivisionOf, snapSettings } from "../domain/timeline/snap";
import { clampZoom, minZoomFor, zoomToFitValue } from "../domain/timeline/zoom";
import type { ClipboardContent } from "../services/clipboard";
import { clamp, createId, getClipTimelineDuration, getProjectDuration } from "../utils/audioMath";
import { fail, ok, type CommandResult } from "../state/commandResult";
import * as commands from "../state/commands/index";
import { history, type EditOptions } from "../state/history";
import { getDoc, projectStore } from "../state/projectStore";
import { isRecordingBusy, useRecordingStore } from "../state/recordingStore";

type HistoryOptions = {
  history?: boolean;
};

interface DawStore extends ProjectDoc {
  selectedTrackId?: string;
  selectedClipId?: string;
  selectedClipIds: string[];
  isPlaying: boolean;
  /** 편집 커서 = 재생을 시작할 자리(초). 정지·일시정지·이동할 때만 바뀌고 재생 중에는 프레임마다 바뀌지 않는다. 지금 흐르는 위치는 `app/playhead.ts`의 `readPlayhead()`로 읽는다. */
  cursor: number;
  zoomPxPerSecond: number;
  /** 타임라인이 화면에 보이는 가로 폭(px). 확대 범위의 아래쪽 끝(전체 보기)을 정하는 데 쓴다. 아직 모르면 0. */
  timelineViewportWidth: number;
  snapEnabled: boolean;
  gridDivision: number;
  playlistTool: PlaylistTool;
  playlistSnap: PlaylistSnap;
  performanceMode: boolean;
  playlistDetached: boolean;
  undo: () => CommandResult<"empty" | "recording">;
  redo: () => CommandResult<"empty" | "recording">;
  setBpm: (bpm: number) => void;
  setTimeSignature: (signature: TimeSignature) => void;
  setMasterVolumeDb: (volumeDb: number) => void;
  setProjectName: (name: string) => void;
  setCursor: (cursor: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setZoom: (zoomPxPerSecond: number) => void;
  setTimelineViewportWidth: (width: number) => void;
  /** 프로젝트 전체가 화면 폭에 들어오게 확대 배율을 정한다("전체 보기"). 화면 폭을 아직 모르면 실패. */
  zoomToFit: () => CommandResult<"unknown-size">;
  setSnapEnabled: (enabled: boolean) => void;
  setPlaylistTool: (tool: PlaylistTool) => void;
  setPlaylistSnap: (snap: PlaylistSnap) => void;
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
  /** 여러 클립을 같은 자리에서 한꺼번에 자른다(Ctrl+E). 오른쪽 조각들이 선택된다. */
  sliceClipsAt: (clipIds: string[], splitTime: number) => CommandResult<"none-cuttable", { count: number }>;
  /** 클립 여러 개를 한 번에 옮긴다(여러 클립·그룹 끌기). 마지막 이동이 쥔 클립이며, 선택에 없으면 그 클립을 선택한다. */
  moveClips: (moves: commands.ClipMove[]) => void;
  /** 선택한 클립들을 바로 뒤에 복제한다(Ctrl+D). 복제본이 선택된다. */
  duplicateSelectedClips: () => CommandResult<"none-selected", { count: number }>;
  /** 복사해 둔 클립을 `at`(초)에 붙인다(Ctrl+V). 붙인 클립이 선택된다. 트랙이 모자라면 새 트랙을 만든다. */
  pasteClips: (content: ClipboardContent, at: number) => CommandResult<"empty" | "no-source", { count: number; newTracks: number }>;
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
    cursor: 0,
    snapEnabled: true,
    playlistTool: "move" as PlaylistTool,
    playlistSnap: DEFAULT_SNAP,
    performanceMode: false,
    playlistDetached: false,
  };
}

/** 스냅 선택과 박자표에서 나오는 화면 설정: 잡을지(`snapEnabled`)와 격자 분할 수(`gridDivision`, 마디 스냅은 박자표를 따른다) */
function snapView(snap: PlaylistSnap, timeSignature: TimeSignature) {
  const { enabled, division } = snapSettings(snap, timeSignature);
  return { snapEnabled: enabled, gridDivision: division };
}

export const useDawStore = create<DawStore>((set, get) => ({
  ...docFields(getDoc()),
  selectedTrackId: undefined,
  selectedClipId: undefined,
  selectedClipIds: [],
  isPlaying: false,
  cursor: 0,
  zoomPxPerSecond: 96,
  timelineViewportWidth: 0,
  snapEnabled: true,
  gridDivision: 2,
  playlistTool: "move",
  playlistSnap: DEFAULT_SNAP,
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
  setTimeSignature: (signature) => {
    commands.setTimeSignature(signature);
  },
  setMasterVolumeDb: (volumeDb) => {
    commands.setMasterVolumeDb(volumeDb);
  },
  setProjectName: (name) => {
    commands.setProjectName(name);
  },
  setCursor: (cursor) => set({ cursor: Math.max(0, cursor) }),
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
    set((state) => {
      const playlistSnap = snapEnabled ? DEFAULT_SNAP : "none";
      return { playlistSnap, ...snapView(playlistSnap, state.timeSignature) };
    }),
  setPlaylistTool: (playlistTool) => set({ playlistTool }),
  setPlaylistSnap: (playlistSnap) =>
    set((state) => ({ playlistSnap, ...snapView(playlistSnap, state.timeSignature) })),
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
  sliceClipsAt: (clipIds, splitTime) => {
    const result = commands.sliceClipsAt(clipIds, splitTime);
    if (!result.ok) return result;
    set({ selectedClipId: result.rightClipIds[result.rightClipIds.length - 1], selectedClipIds: result.rightClipIds });
    return ok({ count: result.rightClipIds.length });
  },
  moveClips: (moves) => {
    if (!commands.moveClips(moves)) return;
    // 마지막 이동이 사용자가 쥔 클립이다(`movingItems`가 맨 뒤에 둔다). 단일 `moveClip`처럼, 쥔 클립이 선택에 없으면 그 클립을 선택한다.
    const held = moves[moves.length - 1]?.clipId;
    if (held === undefined) return;
    set((state) => ({
      selectedClipId: held,
      selectedClipIds: state.selectedClipIds.includes(held) ? state.selectedClipIds : [held],
    }));
  },
  duplicateSelectedClips: () => {
    const state = get();
    const chosen = new Set(state.selectedClipIds);
    const items = state.tracks.flatMap((track, trackIndex) => track.clips.filter((clip) => chosen.has(clip.id)).map((clip) => ({ clip, trackIndex })));
    if (!items.length) return fail("none-selected");
    const ids = commands.duplicateClips(planDuplicate(items, state.bpm));
    set({ selectedClipId: ids[ids.length - 1], selectedClipIds: ids });
    return ok({ count: ids.length });
  },
  pasteClips: (content, at) => {
    const state = get();
    // 이 프로젝트에 음원이 없는 클립(다른 프로젝트에서 복사한 것)은 붙이지 않는다: 소리도 파형도 없는 클립이 생기기 때문이다.
    const items = content.items.filter(({ clip }) => state.assets[clip.audioBufferId] !== undefined);
    if (!content.items.length) return fail("empty");
    if (!items.length) return fail("no-source");
    const baseRow = pasteBaseRow(
      state.tracks.map((track) => track.id),
      { selectedTrackId: state.selectedTrackId, clipsSelected: state.selectedClipIds.length > 0, originTrackId: content.originTrackId },
    );
    const plan = planPaste(items, at, baseRow);
    const ids = commands.pasteClips(plan.placements);
    set({ selectedClipId: ids[ids.length - 1], selectedClipIds: ids });
    return ok({ count: ids.length, newTracks: Math.max(0, plan.trackCount - state.tracks.length) });
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
    const division = state.snapEnabled ? state.gridDivision : snapDivisionOf(DEFAULT_SNAP);
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
      cursor: start,
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
    commands.addTimeMarker(time ?? get().cursor);
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
    set({ ...freshViewState(), ...snapView(DEFAULT_SNAP, getDoc().timeSignature) });
  },
  resetProject: () => {
    commands.resetDoc();
    useRecordingStore.getState().resetForNewProject();
    set({ ...freshViewState(), zoomPxPerSecond: 96, ...snapView(DEFAULT_SNAP, getDoc().timeSignature) });
  },
}));

// 문서가 바뀔 때마다 이 저장소의 문서 필드를 맞춘다(같은 호출 안에서 바로). 화면 부품은 예전처럼 useDawStore로 읽는다.
projectStore.subscribe((state, previous) => {
  if (state.doc === previous.doc) return;
  const fields = docFields(state.doc);
  if (state.doc.timeSignature === previous.doc.timeSignature) {
    useDawStore.setState(fields);
    return;
  }
  // 박자표가 바뀌면(직접 고르기·실행 취소·프로젝트 열기) 마디 스냅의 칸 길이도 따라 바뀐다.
  const view = useDawStore.getState();
  useDawStore.setState({ ...fields, ...snapView(view.playlistSnap, state.doc.timeSignature) });
});
