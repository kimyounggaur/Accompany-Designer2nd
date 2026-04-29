import { create } from "zustand";
import type {
  AudioAsset,
  Clip,
  DawProject,
  PlaylistSnap,
  PlaylistTool,
  RecordingState,
  TimeMarker,
  Track,
} from "../types";
import {
  clamp,
  createId,
  findClip,
  getClipPlaybackRate,
  getClipTimelineDuration,
  snapTime,
} from "../utils/audioMath";
import { DEFAULT_DELAY_SETTINGS, normalizeDelaySettings } from "../utils/delay";
import { DEFAULT_REVERB_SETTINGS, normalizeReverbSettings } from "../utils/reverb";

type LegacyEqSettings = Partial<Track["eq"]> & {
  lowGain?: number;
  midGain?: number;
};

const DEFAULT_RECORDING_STATE: RecordingState = {
  status: "idle",
  startedAtProjectTime: 0,
  elapsed: 0,
  monitoringEnabled: false,
  metronomeEnabled: false,
  countInBeats: 0,
  countInRemaining: 0,
  waveformPeaks: [],
};

const playlistToolLabels: Record<PlaylistTool, string> = {
  draw: "그리기",
  paint: "페인트",
  delete: "삭제",
  mute: "음소거",
  slip: "슬립 편집",
  slice: "자르기",
  select: "선택",
  zoom: "확대/축소",
  "play-selected": "선택 재생",
};

const snapLabels: Record<PlaylistSnap, string> = {
  main: "메인",
  line: "라인",
  beat: "박",
  halfBeat: "1/2박",
  quarterBeat: "1/4박",
  none: "없음",
};

interface DawStore extends DawProject {
  selectedClipId?: string;
  selectedClipIds: string[];
  isPlaying: boolean;
  playhead: number;
  zoomPxPerSecond: number;
  snapEnabled: boolean;
  gridDivision: number;
  playlistTool: PlaylistTool;
  playlistSnap: PlaylistSnap;
  globalSnap: Exclude<PlaylistSnap, "main">;
  performanceMode: boolean;
  playlistDetached: boolean;
  recording: RecordingState;
  commandMessage: string;
  setBpm: (bpm: number) => void;
  setProjectName: (name: string) => void;
  setPlayhead: (playhead: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setZoom: (zoomPxPerSecond: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setPlaylistTool: (tool: PlaylistTool) => void;
  setPlaylistSnap: (snap: PlaylistSnap) => void;
  setGlobalSnap: (snap: Exclude<PlaylistSnap, "main">) => void;
  setCommandMessage: (message: string) => void;
  setRecordingState: (patch: Partial<RecordingState>) => void;
  resetRecordingState: () => void;
  toggleRecordingArm: (trackId: string) => void;
  setRecordingInputDevice: (inputDeviceId?: string) => void;
  setRecordingMonitoring: (monitoringEnabled: boolean) => void;
  setRecordingMetronome: (metronomeEnabled: boolean) => void;
  setRecordingCountIn: (countInBeats: number) => void;
  addAudioAsset: (asset: AudioAsset) => void;
  updateAudioAsset: (assetId: string, patch: Partial<AudioAsset>) => void;
  addClip: (trackId: string, clip: Clip) => void;
  addClipFromSource: (
    sourceClipId: string | undefined,
    trackId: string,
    startTime: number,
  ) => string | undefined;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  moveClip: (clipId: string, targetTrackId: string, patch?: Partial<Clip>) => void;
  deleteClip: (clipId: string) => void;
  deleteSelectedClips: () => void;
  toggleClipMuted: (clipId: string) => void;
  sliceClipAt: (clipId: string, splitTime: number) => void;
  selectClip: (clipId?: string, additive?: boolean) => void;
  setSelectedClips: (clipIds: string[]) => void;
  toggleClipSelection: (clipId: string) => void;
  selectAllClips: () => void;
  clearSelection: () => void;
  quantizeSelectedClips: () => void;
  groupSelectedClips: () => void;
  ungroupSelectedClips: () => void;
  zoomToSelectedClips: () => void;
  resetSelectedClipSource: () => void;
  addTimeMarker: (time?: number) => void;
  clearTimeMarkers: () => void;
  togglePerformanceMode: () => void;
  togglePlaylistDetached: () => void;
  addTrack: () => void;
  updateTrack: (trackId: string, patch: Partial<Omit<Track, "clips">>) => void;
  importProject: (project: DawProject) => void;
  resetProject: () => void;
}

function createDefaultTrack(index = 1): Track {
  return {
    id: createId("track"),
    name: `트랙 ${index}`,
    volume: 0.86,
    pan: 0,
    muted: false,
    solo: false,
    eq: {
      bassGain: 0,
      middleLowGain: 0,
      middleHighGain: 0,
      highGain: 0,
      presenceGain: 0,
    },
    compressor: {
      enabled: false,
      threshold: -18,
      ratio: 3,
      attack: 0.012,
      release: 0.2,
    },
    delay: { ...DEFAULT_DELAY_SETTINGS },
    reverb: { ...DEFAULT_REVERB_SETTINGS },
    clips: [],
  };
}

function createDefaultProject(): DawProject {
  return {
    id: createId("project"),
    name: "새 세션",
    bpm: 120,
    sampleRate: 44100,
    tracks: [createDefaultTrack(1)],
    audioAssets: {},
    timeMarkers: [],
  };
}

function resolveSnap(snap: PlaylistSnap, globalSnap: Exclude<PlaylistSnap, "main">) {
  return snap === "main" ? globalSnap : snap;
}

function getSnapDivision(snap: PlaylistSnap) {
  if (snap === "beat") {
    return 1;
  }

  if (snap === "quarterBeat") {
    return 4;
  }

  return 2;
}

function normalizeTrack(track: Track, index: number): Track {
  const fallback = createDefaultTrack(index + 1);

  return {
    ...fallback,
    ...track,
    eq: normalizeEqSettings(track.eq, fallback.eq),
    compressor: {
      ...fallback.compressor,
      ...track.compressor,
    },
    delay: normalizeDelaySettings(track.delay),
    reverb: normalizeReverbSettings(track.reverb),
    clips: track.clips ?? [],
  };
}

function normalizeEqSettings(
  eq: LegacyEqSettings | undefined,
  fallback: Track["eq"],
): Track["eq"] {
  return {
    ...fallback,
    ...eq,
    bassGain: clamp(eq?.bassGain ?? eq?.lowGain ?? fallback.bassGain, -12, 12),
    middleLowGain: clamp(
      eq?.middleLowGain ?? eq?.midGain ?? fallback.middleLowGain,
      -12,
      12,
    ),
    middleHighGain: clamp(
      eq?.middleHighGain ?? eq?.midGain ?? fallback.middleHighGain,
      -12,
      12,
    ),
    highGain: clamp(eq?.highGain ?? fallback.highGain, -12, 12),
    presenceGain: clamp(eq?.presenceGain ?? fallback.presenceGain, -12, 12),
  };
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

function cloneClipFromSource(
  state: DawStore,
  sourceClipId: string | undefined,
  trackId: string,
  startTime: number,
): Clip | undefined {
  const selection = findClip(state.tracks, sourceClipId);

  if (selection) {
    return {
      ...selection.clip,
      id: createId("clip"),
      name: `${selection.clip.name} 복사본`,
      trackId,
      startTime,
      muted: false,
      groupId: undefined,
    };
  }

  const firstAsset = Object.values(state.audioAssets)[0];
  if (!firstAsset) {
    return undefined;
  }

  return {
    id: createId("clip"),
    audioBufferId: firstAsset.id,
    name: firstAsset.fileName,
    trackId,
    startTime,
    offset: 0,
    duration: firstAsset.duration,
    sourceBpm: state.bpm,
    stretchMode: "resample",
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    muted: false,
  };
}

export const useDawStore = create<DawStore>((set) => ({
  ...createDefaultProject(),
  selectedClipId: undefined,
  selectedClipIds: [],
  isPlaying: false,
  playhead: 0,
  zoomPxPerSecond: 96,
  snapEnabled: true,
  gridDivision: 2,
  playlistTool: "draw",
  playlistSnap: "line",
  globalSnap: "line",
  performanceMode: false,
  playlistDetached: false,
  recording: DEFAULT_RECORDING_STATE,
  commandMessage: "",
  setBpm: (bpm) => set({ bpm: clamp(Number(bpm) || 120, 20, 300) }),
  setProjectName: (name) => set({ name }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setZoom: (zoomPxPerSecond) =>
    set({ zoomPxPerSecond: clamp(zoomPxPerSecond, 40, 320) }),
  setSnapEnabled: (snapEnabled) =>
    set({
      snapEnabled,
      playlistSnap: snapEnabled ? "line" : "none",
      gridDivision: snapEnabled ? getSnapDivision("line") : 2,
    }),
  setPlaylistTool: (playlistTool) =>
    set({
      playlistTool,
      commandMessage: `${playlistToolLabels[playlistTool]} 도구 선택됨`,
    }),
  setPlaylistSnap: (playlistSnap) =>
    set((state) => {
      const effectiveSnap = resolveSnap(playlistSnap, state.globalSnap);
      return {
        playlistSnap,
        snapEnabled: effectiveSnap !== "none",
        gridDivision: getSnapDivision(effectiveSnap),
        commandMessage: `스냅: ${snapLabels[playlistSnap]}`,
      };
    }),
  setGlobalSnap: (globalSnap) =>
    set((state) => {
      const effectiveSnap = resolveSnap(state.playlistSnap, globalSnap);
      return {
        globalSnap,
        snapEnabled: effectiveSnap !== "none",
        gridDivision: getSnapDivision(effectiveSnap),
        commandMessage: `글로벌 스냅: ${snapLabels[globalSnap]}`,
      };
    }),
  setCommandMessage: (commandMessage) => set({ commandMessage }),
  setRecordingState: (patch) =>
    set((state) => ({
      recording: {
        ...state.recording,
        ...patch,
      },
    })),
  resetRecordingState: () =>
    set((state) => ({
      recording: {
        ...DEFAULT_RECORDING_STATE,
        armedTrackId: state.recording.armedTrackId,
        inputDeviceId: state.recording.inputDeviceId,
        monitoringEnabled: state.recording.monitoringEnabled,
        metronomeEnabled: state.recording.metronomeEnabled,
        countInBeats: state.recording.countInBeats,
        status: state.recording.armedTrackId ? "armed" : "idle",
        countInRemaining: 0,
        waveformPeaks: [],
      },
    })),
  toggleRecordingArm: (trackId) =>
    set((state) => {
      if (
        state.recording.status === "counting-in" ||
        state.recording.status === "recording" ||
        state.recording.status === "stopping"
      ) {
        return {
          commandMessage: "Stop recording before changing armed track.",
        };
      }

      const armedTrackId =
        state.recording.armedTrackId === trackId ? undefined : trackId;

      return {
        recording: {
          ...state.recording,
          armedTrackId,
          trackId: undefined,
          clipId: undefined,
          status: armedTrackId ? "armed" : "idle",
          startedAtProjectTime: 0,
          elapsed: 0,
          countInRemaining: 0,
          waveformPeaks: [],
        },
        commandMessage: armedTrackId ? "Track armed for recording." : "Recording arm cleared.",
      };
    }),
  setRecordingInputDevice: (inputDeviceId) =>
    set((state) => ({
      recording: {
        ...state.recording,
        inputDeviceId,
      },
      commandMessage: "Recording input changed.",
    })),
  setRecordingMonitoring: (monitoringEnabled) =>
    set((state) => ({
      recording: {
        ...state.recording,
        monitoringEnabled,
      },
      commandMessage: monitoringEnabled
        ? "Input monitoring enabled."
        : "Input monitoring disabled.",
    })),
  setRecordingMetronome: (metronomeEnabled) =>
    set((state) => ({
      recording: {
        ...state.recording,
        metronomeEnabled,
      },
      commandMessage: metronomeEnabled ? "Metronome enabled." : "Metronome disabled.",
    })),
  setRecordingCountIn: (countInBeats) =>
    set((state) => ({
      recording: {
        ...state.recording,
        countInBeats: clamp(Math.round(countInBeats), 0, 8),
        countInRemaining: 0,
      },
      commandMessage: countInBeats > 0 ? "Count-in enabled." : "Count-in disabled.",
    })),
  addAudioAsset: (asset) =>
    set((state) => ({
      audioAssets: {
        ...state.audioAssets,
        [asset.id]: asset,
      },
    })),
  updateAudioAsset: (assetId, patch) =>
    set((state) => ({
      audioAssets: {
        ...state.audioAssets,
        [assetId]: {
          ...state.audioAssets[assetId],
          ...patch,
        },
      },
    })),
  addClip: (trackId, clip) =>
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? { ...track, clips: [...track.clips, clip] }
          : track,
      ),
      selectedClipId: clip.id,
      selectedClipIds: [clip.id],
      commandMessage: `${clip.name} 추가됨`,
    })),
  addClipFromSource: (sourceClipId, trackId, startTime) => {
    let createdId: string | undefined;

    set((state) => {
      const targetTrack = state.tracks.find((track) => track.id === trackId);
      const clip = targetTrack
        ? cloneClipFromSource(state, sourceClipId, trackId, startTime)
        : undefined;

      if (!clip) {
        return {
          commandMessage: "오디오를 업로드하거나 클립을 선택한 뒤 그리세요.",
        };
      }

      createdId = clip.id;
      return {
        tracks: state.tracks.map((track) =>
          track.id === trackId
            ? { ...track, clips: [...track.clips, clip] }
            : track,
        ),
        selectedClipId: clip.id,
        selectedClipIds: [clip.id],
        commandMessage: `${clip.name} 추가됨`,
      };
    });

    return createdId;
  },
  updateClip: (clipId, patch) =>
    set((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? { ...clip, ...patch } : clip,
        ),
      })),
    })),
  moveClip: (clipId, targetTrackId, patch = {}) =>
    set((state) => {
      let movingClip: Clip | undefined;
      const tracksWithoutClip = state.tracks.map((track) => {
        const clip = track.clips.find((candidate) => candidate.id === clipId);

        if (!clip) {
          return track;
        }

        movingClip = {
          ...clip,
          ...patch,
          trackId: targetTrackId,
        };

        return {
          ...track,
          clips: track.clips.filter((candidate) => candidate.id !== clipId),
        };
      });

      if (!movingClip) {
        return { tracks: state.tracks };
      }

      const clipToInsert = movingClip;

      return {
        tracks: tracksWithoutClip.map((track) =>
          track.id === targetTrackId
            ? { ...track, clips: [...track.clips, clipToInsert] }
            : track,
        ),
        selectedClipId: clipId,
        selectedClipIds: state.selectedClipIds.includes(clipId)
          ? state.selectedClipIds
          : [clipId],
      };
    }),
  deleteClip: (clipId) =>
    set((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.id !== clipId),
      })),
      selectedClipId: state.selectedClipId === clipId ? undefined : state.selectedClipId,
      selectedClipIds: state.selectedClipIds.filter((selectedId) => selectedId !== clipId),
      commandMessage: "클립 삭제됨",
    })),
  deleteSelectedClips: () =>
    set((state) => {
      const deleting = new Set(state.selectedClipIds);
      if (!deleting.size) {
        return { commandMessage: "선택된 클립이 없습니다." };
      }

      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((clip) => !deleting.has(clip.id)),
        })),
        selectedClipId: undefined,
        selectedClipIds: [],
        commandMessage: `클립 ${deleting.size}개 삭제됨`,
      };
    }),
  toggleClipMuted: (clipId) =>
    set((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? { ...clip, muted: !clip.muted } : clip,
        ),
      })),
      selectedClipId: clipId,
      selectedClipIds: state.selectedClipIds.includes(clipId)
        ? state.selectedClipIds
        : [clipId],
      commandMessage: "클립 음소거 전환됨",
    })),
  sliceClipAt: (clipId, splitTime) =>
    set((state) => {
      const selection = findClip(state.tracks, clipId);
      if (!selection) {
        return { commandMessage: "자를 클립을 선택하세요." };
      }

      const { clip } = selection;
      const playbackRate = getClipPlaybackRate(state.bpm, clip);
      const timelineDuration = getClipTimelineDuration(state.bpm, clip);
      const localTime = splitTime - clip.startTime;

      if (localTime <= 0.03 || localTime >= timelineDuration - 0.03) {
        return { commandMessage: "클립 내부를 클릭해 자르세요." };
      }

      const sourceDelta = localTime * playbackRate;
      const leftDuration = clamp(sourceDelta, 0.03, clip.duration - 0.03);
      const rightDuration = clip.duration - leftDuration;
      const rightClip: Clip = {
        ...clip,
        id: createId("clip"),
        name: `${clip.name} 조각`,
        startTime: clip.startTime + leftDuration / playbackRate,
        offset: clip.offset + leftDuration,
        duration: rightDuration,
        groupId: undefined,
      };

      return {
        tracks: state.tracks.map((track) =>
          track.id === selection.track.id
            ? {
                ...track,
                clips: track.clips.flatMap((candidate) =>
                  candidate.id === clipId
                    ? [{ ...candidate, duration: leftDuration }, rightClip]
                    : [candidate],
                ),
              }
            : track,
        ),
        selectedClipId: rightClip.id,
        selectedClipIds: [rightClip.id],
        commandMessage: "클립 자르기 완료",
      };
    }),
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
        commandMessage: selectedClipIds.length
          ? `클립 ${selectedClipIds.length}개 선택됨`
          : "선택 해제됨",
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
        commandMessage: `클립 ${selectedClipIds.length}개 선택됨`,
      };
    }),
  clearSelection: () =>
    set({
      selectedClipId: undefined,
      selectedClipIds: [],
      commandMessage: "선택 해제됨",
    }),
  quantizeSelectedClips: () =>
    set((state) => {
      const selected = new Set(state.selectedClipIds);
      if (!selected.size) {
        return { commandMessage: "퀀타이즈할 클립이 없습니다." };
      }

      const division = state.snapEnabled ? state.gridDivision : getSnapDivision("line");
      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            selected.has(clip.id)
              ? {
                  ...clip,
                  startTime: Math.max(0, snapTime(clip.startTime, state.bpm, true, division)),
                }
              : clip,
          ),
        })),
        commandMessage: `클립 ${selected.size}개 퀀타이즈됨`,
      };
    }),
  groupSelectedClips: () =>
    set((state) => {
      if (state.selectedClipIds.length < 2) {
        return { commandMessage: "그룹화할 클립을 두 개 이상 선택하세요." };
      }

      const groupId = createId("group");
      const selected = new Set(state.selectedClipIds);
      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            selected.has(clip.id) ? { ...clip, groupId } : clip,
          ),
        })),
        commandMessage: `클립 ${selected.size}개 그룹화됨`,
      };
    }),
  ungroupSelectedClips: () =>
    set((state) => {
      const selected = new Set(state.selectedClipIds);
      if (!selected.size) {
        return { commandMessage: "해제할 선택 그룹이 없습니다." };
      }

      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            selected.has(clip.id) ? { ...clip, groupId: undefined } : clip,
          ),
        })),
        commandMessage: "선택 클립 그룹 해제됨",
      };
    }),
  zoomToSelectedClips: () =>
    set((state) => {
      const selected = getClipsByIds(state.tracks, state.selectedClipIds);
      if (!selected.length) {
        return { commandMessage: "확대할 클립을 선택하세요." };
      }

      const start = Math.min(...selected.map(({ clip }) => clip.startTime));
      const end = Math.max(
        ...selected.map(
          ({ clip }) => clip.startTime + getClipTimelineDuration(state.bpm, clip),
        ),
      );
      const span = Math.max(0.25, end - start);

      return {
        playhead: start,
        zoomPxPerSecond: clamp(760 / span, 40, 320),
        commandMessage: "선택 항목으로 확대됨",
      };
    }),
  resetSelectedClipSource: () =>
    set((state) => {
      const selected = getClipsByIds(state.tracks, state.selectedClipIds);
      if (!selected.length) {
        return { commandMessage: "소스를 초기화할 클립을 선택하세요." };
      }

      const selectedIds = new Set(selected.map(({ clip }) => clip.id));
      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (!selectedIds.has(clip.id)) {
              return clip;
            }

            const asset = state.audioAssets[clip.audioBufferId];
            return {
              ...clip,
              offset: 0,
              duration: asset?.duration ?? clip.duration,
            };
          }),
        })),
        commandMessage: "선택 클립 소스 초기화됨",
      };
    }),
  addTimeMarker: (time) =>
    set((state) => {
      const markerTime = Math.max(0, time ?? state.playhead);
      const marker: TimeMarker = {
        id: createId("marker"),
        time: markerTime,
        name: `마커 ${state.timeMarkers.length + 1}`,
      };

      return {
        timeMarkers: [...state.timeMarkers, marker],
        commandMessage: `${marker.name} 추가됨`,
      };
    }),
  clearTimeMarkers: () =>
    set({
      timeMarkers: [],
      commandMessage: "타임 마커 삭제됨",
    }),
  togglePerformanceMode: () =>
    set((state) => ({
      performanceMode: !state.performanceMode,
      commandMessage: state.performanceMode
        ? "퍼포먼스 모드 꺼짐"
        : "퍼포먼스 모드 켜짐",
    })),
  togglePlaylistDetached: () =>
    set((state) => ({
      playlistDetached: !state.playlistDetached,
      commandMessage: state.playlistDetached
        ? "플레이리스트 붙음"
        : "플레이리스트 분리됨",
    })),
  addTrack: () =>
    set((state) => ({
      tracks: [...state.tracks, createDefaultTrack(state.tracks.length + 1)],
      selectedClipId: undefined,
      selectedClipIds: [],
    })),
  updateTrack: (trackId, patch) =>
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    })),
  importProject: (project) =>
    set({
      id: project.id || createId("project"),
      name: project.name || "가져온 세션",
      bpm: clamp(project.bpm || 120, 20, 300),
      sampleRate: project.sampleRate || 44100,
      tracks: project.tracks?.length
        ? project.tracks.map((track, index) => normalizeTrack(track, index))
        : [createDefaultTrack(1)],
      audioAssets: project.audioAssets || {},
      timeMarkers: project.timeMarkers || [],
      selectedClipId: undefined,
      selectedClipIds: [],
      isPlaying: false,
      playhead: 0,
      snapEnabled: true,
      gridDivision: getSnapDivision("line"),
      playlistTool: "draw",
      playlistSnap: "line",
      globalSnap: "line",
      performanceMode: false,
      playlistDetached: false,
      recording: {
        ...DEFAULT_RECORDING_STATE,
        waveformPeaks: [],
      },
      commandMessage: "프로젝트 불러옴",
    }),
  resetProject: () =>
    set({
      ...createDefaultProject(),
      selectedClipId: undefined,
      selectedClipIds: [],
      isPlaying: false,
      playhead: 0,
      zoomPxPerSecond: 96,
      snapEnabled: true,
      gridDivision: 2,
      playlistTool: "draw",
      playlistSnap: "line",
      globalSnap: "line",
      performanceMode: false,
      playlistDetached: false,
      recording: {
        ...DEFAULT_RECORDING_STATE,
        waveformPeaks: [],
      },
      commandMessage: "프로젝트 초기화됨",
    }),
}));
