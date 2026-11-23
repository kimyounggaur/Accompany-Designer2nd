import { create } from "zustand";
import type {
  AudioAsset,
  Clip,
  DawProject,
  EffectSlot,
  EffectSlotType,
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
import { fail, ok, type CommandResult } from "../state/commandResult";

type LegacyEqSettings = Partial<Track["eq"]> & {
  lowGain?: number;
  midGain?: number;
};

type HistorySnapshot = Pick<
  DawProject,
  "name" | "bpm" | "tracks" | "audioAssets" | "timeMarkers"
>;

type HistoryOptions = {
  history?: boolean;
};

const HISTORY_LIMIT = 100;
const HISTORY_KEYS = ["name", "bpm", "tracks", "audioAssets", "timeMarkers"] as const;
const DEFAULT_EFFECT_ORDER: EffectSlotType[] = ["eq", "comp", "delay", "reverb"];

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

function createDefaultEffectChain(settings: {
  eq: Track["eq"];
  compressor: Track["compressor"];
  delay: Track["delay"];
  reverb: Track["reverb"];
}): EffectSlot[] {
  return DEFAULT_EFFECT_ORDER.map((type) => ({
    id: createId("fx"),
    type,
    enabled: getEffectSettingsEnabled(type, settings),
  }));
}

interface DawStore extends DawProject {
  selectedTrackId?: string;
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
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  captureHistory: () => void;
  beginHistoryGroup: () => void;
  endHistoryGroup: () => void;
  undo: () => CommandResult<"empty">;
  redo: () => CommandResult<"empty">;
  setBpm: (bpm: number) => void;
  setProjectName: (name: string) => void;
  setPlayhead: (playhead: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setZoom: (zoomPxPerSecond: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setPlaylistTool: (tool: PlaylistTool) => void;
  setPlaylistSnap: (snap: PlaylistSnap) => void;
  setGlobalSnap: (snap: Exclude<PlaylistSnap, "main">) => void;
  setRecordingState: (patch: Partial<RecordingState>) => void;
  resetRecordingState: () => void;
  toggleRecordingArm: (trackId: string) => CommandResult<"recording", { armed: boolean }>;
  setRecordingInputDevice: (inputDeviceId?: string) => void;
  setRecordingMonitoring: (monitoringEnabled: boolean) => void;
  setRecordingMetronome: (metronomeEnabled: boolean) => void;
  setRecordingCountIn: (countInBeats: number) => void;
  addAudioAsset: (asset: AudioAsset, options?: HistoryOptions) => void;
  updateAudioAsset: (
    assetId: string,
    patch: Partial<AudioAsset>,
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
  importProject: (project: DawProject) => void;
  resetProject: () => void;
}

function createDefaultTrack(index = 1): Track {
  const eq = {
    enabled: true,
    bassGain: 0,
    middleLowGain: 0,
    middleHighGain: 0,
    highGain: 0,
    presenceGain: 0,
  };
  const compressor = {
    enabled: false,
    threshold: -18,
    ratio: 3,
    attack: 0.012,
    release: 0.2,
  };
  const delay = { ...DEFAULT_DELAY_SETTINGS };
  const reverb = { ...DEFAULT_REVERB_SETTINGS };

  return {
    id: createId("track"),
    name: `트랙 ${index}`,
    volume: 0.86,
    pan: 0,
    muted: false,
    solo: false,
    eq,
    compressor,
    delay,
    reverb,
    effectChain: createDefaultEffectChain({ eq, compressor, delay, reverb }),
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
  const eq = normalizeEqSettings(track.eq, fallback.eq);
  const compressor = {
    ...fallback.compressor,
    ...track.compressor,
  };
  const delay = normalizeDelaySettings(track.delay);
  const reverb = normalizeReverbSettings(track.reverb);
  const normalizedTrack = {
    ...fallback,
    ...track,
    eq,
    compressor,
    delay,
    reverb,
  };

  return {
    ...normalizedTrack,
    effectChain: normalizeEffectChain(normalizedTrack, fallback.effectChain),
    clips: (track.clips ?? []).map(normalizeClip),
  };
}

function normalizeClip(clip: Clip): Clip {
  return {
    ...clip,
    fadeIn: clamp(clip.fadeIn ?? 0, 0, Math.max(0, clip.duration / 2)),
    fadeOut: clamp(clip.fadeOut ?? 0, 0, Math.max(0, clip.duration / 2)),
    fadeCurve: clip.fadeCurve ?? "equalPower",
  };
}

function normalizeEqSettings(
  eq: LegacyEqSettings | undefined,
  fallback: Track["eq"],
): Track["eq"] {
  return {
    ...fallback,
    ...eq,
    enabled: eq?.enabled ?? fallback.enabled,
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

function getEffectSettingsEnabled(
  type: EffectSlotType,
  settings: {
    eq: Track["eq"];
    compressor: Track["compressor"];
    delay: Track["delay"];
    reverb: Track["reverb"];
  },
) {
  if (type === "eq") {
    return settings.eq.enabled;
  }

  if (type === "comp") {
    return settings.compressor.enabled;
  }

  if (type === "delay") {
    return settings.delay.enabled;
  }

  return settings.reverb.enabled;
}

function normalizeEffectChain(track: Track, fallback: EffectSlot[]): EffectSlot[] {
  const existingSlots = Array.isArray(track.effectChain) ? track.effectChain : [];
  const settings = {
    eq: track.eq,
    compressor: track.compressor,
    delay: track.delay,
    reverb: track.reverb,
  };
  const byType = new Map<EffectSlotType, EffectSlot>();

  for (const slot of existingSlots) {
    if (DEFAULT_EFFECT_ORDER.includes(slot.type) && !byType.has(slot.type)) {
      byType.set(slot.type, {
        id: slot.id || createId("fx"),
        type: slot.type,
        enabled: slot.enabled ?? getEffectSettingsEnabled(slot.type, settings),
      });
    }
  }

  const orderedTypes = [
    ...existingSlots
      .map((slot) => slot.type)
      .filter((type): type is EffectSlotType => DEFAULT_EFFECT_ORDER.includes(type)),
    ...DEFAULT_EFFECT_ORDER,
  ];
  const seen = new Set<EffectSlotType>();

  return orderedTypes
    .filter((type) => {
      if (seen.has(type)) {
        return false;
      }
      seen.add(type);
      return true;
    })
    .map((type) => {
      const fallbackSlot = fallback.find((slot) => slot.type === type);
      return byType.get(type) ?? {
        id: fallbackSlot?.id || createId("fx"),
        type,
        enabled: getEffectSettingsEnabled(type, settings),
      };
    });
}

function cloneHistorySnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HistorySnapshot;
}

function createHistorySnapshot(state: DawStore): HistorySnapshot {
  return cloneHistorySnapshot({
    name: state.name,
    bpm: state.bpm,
    tracks: state.tracks,
    audioAssets: state.audioAssets,
    timeMarkers: state.timeMarkers,
  });
}

function restoreHistorySnapshot(snapshot: HistorySnapshot) {
  const restored = cloneHistorySnapshot(snapshot);

  return {
    name: restored.name,
    bpm: restored.bpm,
    tracks: restored.tracks.map((track, index) => normalizeTrack(track, index)),
    audioAssets: restored.audioAssets,
    timeMarkers: restored.timeMarkers,
  };
}

function trimHistory(history: HistorySnapshot[]) {
  return history.slice(Math.max(0, history.length - HISTORY_LIMIT));
}

function patchTouchesHistory(patch: Partial<DawStore>) {
  return HISTORY_KEYS.some((key) => key in patch);
}

function withHistoryPatch(state: DawStore, patch: Partial<DawStore>) {
  if (!patchTouchesHistory(patch)) {
    return patch;
  }

  return {
    ...patch,
    past: trimHistory([...state.past, createHistorySnapshot(state)]),
    future: [],
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
    stretchMode: "none",
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: "equalPower",
    muted: false,
  };
}

export const useDawStore = create<DawStore>((set) => {
  let groupingHistory = false;
  let groupRecorded = false;
  const setWithHistory = (
    updater: (state: DawStore) => Partial<DawStore>,
    options?: HistoryOptions,
  ) => {
    set((state) => {
      const patch = updater(state);
      if (options?.history === false || (groupingHistory && groupRecorded)) return patch;
      if (groupingHistory && patchTouchesHistory(patch)) groupRecorded = true;
      return withHistoryPatch(state, patch);
    });
  };

  return {
  ...createDefaultProject(),
  selectedTrackId: undefined,
  selectedClipId: undefined,
  selectedClipIds: [],
  isPlaying: false,
  playhead: 0,
  zoomPxPerSecond: 96,
  snapEnabled: true,
  gridDivision: 2,
  playlistTool: "move",
  playlistSnap: "line",
  globalSnap: "line",
  performanceMode: false,
  playlistDetached: false,
  recording: DEFAULT_RECORDING_STATE,
  past: [],
  future: [],
  beginHistoryGroup: () => { groupingHistory = true; groupRecorded = false; },
  endHistoryGroup: () => { groupingHistory = false; groupRecorded = false; },
  captureHistory: () =>
    set((state) => ({
      past: trimHistory([...state.past, createHistorySnapshot(state)]),
      future: [],
    })),
  undo: () => {
    let result = ok() as CommandResult<"empty">;
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) {
        result = fail("empty");
        return {};
      }

      return {
        ...restoreHistorySnapshot(previous),
        past: state.past.slice(0, -1),
        future: trimHistory([createHistorySnapshot(state), ...state.future]),
        selectedTrackId: undefined,
        selectedClipId: undefined,
        selectedClipIds: [],
      };
    });
    return result;
  },
  redo: () => {
    let result = ok() as CommandResult<"empty">;
    set((state) => {
      const next = state.future[0];
      if (!next) {
        result = fail("empty");
        return {};
      }

      return {
        ...restoreHistorySnapshot(next),
        past: trimHistory([...state.past, createHistorySnapshot(state)]),
        future: state.future.slice(1),
        selectedTrackId: undefined,
        selectedClipId: undefined,
        selectedClipIds: [],
      };
    });
    return result;
  },
  setBpm: (bpm) =>
    setWithHistory((state) => { const value = clamp(Number(bpm) || 120, 20, 300); return value === state.bpm ? {} : { bpm: value }; }),
  setProjectName: (name) => setWithHistory((state) => state.name === name ? {} : { name }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setZoom: (zoomPxPerSecond) =>
    set({ zoomPxPerSecond: clamp(zoomPxPerSecond, 1, 320) }),
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
  toggleRecordingArm: (trackId) => {
    let result = ok({ armed: false }) as CommandResult<"recording", { armed: boolean }>;
    set((state) => {
      if (
        state.recording.status === "counting-in" ||
        state.recording.status === "recording" ||
        state.recording.status === "stopping"
      ) {
        result = fail("recording");
        return {};
      }

      const armedTrackId =
        state.recording.armedTrackId === trackId ? undefined : trackId;
      result = ok({ armed: Boolean(armedTrackId) });

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
      };
    });
    return result;
  },
  setRecordingInputDevice: (inputDeviceId) =>
    set((state) => ({
      recording: {
        ...state.recording,
        inputDeviceId,
      },
    })),
  setRecordingMonitoring: (monitoringEnabled) =>
    set((state) => ({
      recording: {
        ...state.recording,
        monitoringEnabled,
      },
    })),
  setRecordingMetronome: (metronomeEnabled) =>
    set((state) => ({
      recording: {
        ...state.recording,
        metronomeEnabled,
      },
    })),
  setRecordingCountIn: (countInBeats) =>
    set((state) => ({
      recording: {
        ...state.recording,
        countInBeats: clamp(Math.round(countInBeats), 0, 8),
        countInRemaining: 0,
      },
    })),
  addAudioAsset: (asset, options) =>
    setWithHistory((state) => ({
      audioAssets: {
        ...state.audioAssets,
        [asset.id]: asset,
      },
    }), options),
  updateAudioAsset: (assetId, patch, options) =>
    setWithHistory((state) => ({
      audioAssets: {
        ...state.audioAssets,
        [assetId]: {
          ...state.audioAssets[assetId],
          ...patch,
        },
      },
    }), options),
  addClip: (trackId, clip, options) =>
    setWithHistory((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? { ...track, clips: [...track.clips, clip] }
          : track,
      ),
      selectedClipId: clip.id,
      selectedClipIds: [clip.id],
    }), options),
  addClipFromSource: (sourceClipId, trackId, startTime, options) => {
    let createdId: string | undefined;

    setWithHistory((state) => {
      const targetTrack = state.tracks.find((track) => track.id === trackId);
      const clip = targetTrack
        ? cloneClipFromSource(state, sourceClipId, trackId, startTime)
        : undefined;

      if (!clip) {
        return {};
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
      };
    }, options);

    return createdId;
  },
  updateClip: (clipId, patch, options) =>
    setWithHistory((state) => {
      const existing = findClip(state.tracks, clipId)?.clip;
      if (!existing || Object.entries(patch).every(([key, value]) => existing[key as keyof Clip] === value)) return {};
      return {
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? { ...clip, ...patch } : clip,
        ),
      })),
    }; }, options),
  moveClip: (clipId, targetTrackId, patch = {}, options) =>
    setWithHistory((state) => {
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
    }, options),
  deleteClip: (clipId, options) =>
    setWithHistory((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.id !== clipId),
      })),
      selectedClipId: state.selectedClipId === clipId ? undefined : state.selectedClipId,
      selectedClipIds: state.selectedClipIds.filter((selectedId) => selectedId !== clipId),
    }), options),
  deleteSelectedClips: () => {
    let result = fail("none-selected") as CommandResult<"none-selected", { count: number }>;
    setWithHistory((state) => {
      const deleting = new Set(state.selectedClipIds);
      if (!deleting.size) {
        return {};
      }
      result = ok({ count: deleting.size });

      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((clip) => !deleting.has(clip.id)),
        })),
        selectedClipId: undefined,
        selectedClipIds: [],
      };
    });
    return result;
  },
  toggleClipMuted: (clipId) =>
    setWithHistory((state) => ({
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
    })),
  sliceClipAt: (clipId, splitTime) => {
    let result = ok() as CommandResult<"not-found" | "outside-clip">;
    setWithHistory((state) => {
      const selection = findClip(state.tracks, clipId);
      if (!selection) {
        result = fail("not-found");
        return {};
      }

      const { clip } = selection;
      const playbackRate = getClipPlaybackRate(state.bpm, clip);
      const timelineDuration = getClipTimelineDuration(state.bpm, clip);
      const localTime = splitTime - clip.startTime;

      if (localTime <= 0.03 || localTime >= timelineDuration - 0.03) {
        result = fail("outside-clip");
        return {};
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
      };
    });
    return result;
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
    let result = fail("none-selected") as CommandResult<"none-selected", { count: number }>;
    setWithHistory((state) => {
      const selected = new Set(state.selectedClipIds);
      if (!selected.size) {
        return {};
      }
      result = ok({ count: selected.size });

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
      };
    });
    return result;
  },
  groupSelectedClips: () => {
    let result = fail("too-few") as CommandResult<"too-few", { count: number }>;
    setWithHistory((state) => {
      if (state.selectedClipIds.length < 2) {
        return {};
      }

      const groupId = createId("group");
      const selected = new Set(state.selectedClipIds);
      result = ok({ count: selected.size });
      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            selected.has(clip.id) ? { ...clip, groupId } : clip,
          ),
        })),
      };
    });
    return result;
  },
  ungroupSelectedClips: () => {
    let result = fail("none-selected") as CommandResult<"none-selected", { count: number }>;
    setWithHistory((state) => {
      const selected = new Set(state.selectedClipIds);
      if (!selected.size) {
        return {};
      }
      result = ok({ count: selected.size });

      return {
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            selected.has(clip.id) ? { ...clip, groupId: undefined } : clip,
          ),
        })),
      };
    });
    return result;
  },
  zoomToSelectedClips: () => {
    let result = fail("none-selected") as CommandResult<"none-selected">;
    set((state) => {
      const selected = getClipsByIds(state.tracks, state.selectedClipIds);
      if (!selected.length) {
        return {};
      }
      result = ok();

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
      };
    });
    return result;
  },
  resetSelectedClipSource: () => {
    let result = fail("none-selected") as CommandResult<"none-selected", { count: number }>;
    setWithHistory((state) => {
      const selected = getClipsByIds(state.tracks, state.selectedClipIds);
      if (!selected.length) {
        return {};
      }
      result = ok({ count: selected.length });

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
      };
    });
    return result;
  },
  addTimeMarker: (time) =>
    setWithHistory((state) => {
      const markerTime = Math.max(0, time ?? state.playhead);
      const marker: TimeMarker = {
        id: createId("marker"),
        time: markerTime,
        name: `마커 ${state.timeMarkers.length + 1}`,
      };

      return {
        timeMarkers: [...state.timeMarkers, marker],
      };
    }),
  clearTimeMarkers: () =>
    setWithHistory(() => ({
      timeMarkers: [],
    })),
  togglePerformanceMode: () =>
    set((state) => ({ performanceMode: !state.performanceMode })),
  togglePlaylistDetached: () =>
    set((state) => ({ playlistDetached: !state.playlistDetached })),
  addTrack: () =>
    setWithHistory((state) => {
      const track = createDefaultTrack(state.tracks.length + 1);
      return {
        tracks: [...state.tracks, track],
        selectedTrackId: track.id,
        selectedClipId: undefined,
        selectedClipIds: [],
      };
    }),
  deleteTrack: (trackId) => {
    let result = fail("not-found") as CommandResult<"last-track" | "recording" | "not-found", { name: string }>;
    setWithHistory((state) => {
      if (["counting-in", "recording", "stopping"].includes(state.recording.status)) {
        result = fail("recording");
        return {};
      }
      if (state.tracks.length <= 1) {
        result = fail("last-track");
        return {};
      }
      const track = state.tracks.find((item) => item.id === trackId);
      if (!track) return {};
      result = ok({ name: track.name });
      const removedIds = new Set(track.clips.map((clip) => clip.id));
      const tracks = state.tracks.filter((item) => item.id !== trackId);
      const selectedClipIds = state.selectedClipIds.filter((id) => !removedIds.has(id));
      return {
        tracks,
        selectedTrackId: state.selectedTrackId === trackId ? tracks[0].id : state.selectedTrackId,
        selectedClipId: state.selectedClipId && removedIds.has(state.selectedClipId) ? selectedClipIds[selectedClipIds.length - 1] : state.selectedClipId,
        selectedClipIds,
        recording: state.recording.armedTrackId === trackId ? { ...state.recording, armedTrackId: undefined, status: "idle" } : state.recording,
      };
    });
    return result;
  },
  reorderTrack: (trackId, direction) =>
    setWithHistory((state) => {
      if (["counting-in", "recording", "stopping"].includes(state.recording.status)) return {};
      const index = state.tracks.findIndex((track) => track.id === trackId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= state.tracks.length) return {};
      const tracks = [...state.tracks];
      [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
      return { tracks };
    }),
  updateTrack: (trackId, patch) =>
    setWithHistory((state) => {
      const existing = state.tracks.find((track) => track.id === trackId);
      if (!existing || Object.entries(patch).every(([key, value]) => existing[key as keyof Track] === value)) return {};
      return {
      tracks: state.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    }; }),
  importProject: (project) =>
    setWithHistory(() => ({
      id: project.id || createId("project"),
      name: project.name || "가져온 세션",
      bpm: clamp(project.bpm || 120, 20, 300),
      sampleRate: project.sampleRate || 44100,
      tracks: project.tracks?.length
        ? project.tracks.map((track, index) => normalizeTrack(track, index))
        : [createDefaultTrack(1)],
      audioAssets: project.audioAssets || {},
      timeMarkers: project.timeMarkers || [],
      selectedTrackId: undefined,
      selectedClipId: undefined,
      selectedClipIds: [],
      isPlaying: false,
      playhead: 0,
      snapEnabled: true,
      gridDivision: getSnapDivision("line"),
      playlistTool: "move",
      playlistSnap: "line",
      globalSnap: "line",
      performanceMode: false,
      playlistDetached: false,
      recording: {
        ...DEFAULT_RECORDING_STATE,
        waveformPeaks: [],
      },
    })),
  resetProject: () =>
    setWithHistory(() => ({
      ...createDefaultProject(),
      selectedTrackId: undefined,
      selectedClipId: undefined,
      selectedClipIds: [],
      isPlaying: false,
      playhead: 0,
      zoomPxPerSecond: 96,
      snapEnabled: true,
      gridDivision: 2,
      playlistTool: "move",
      playlistSnap: "line",
      globalSnap: "line",
      performanceMode: false,
      playlistDetached: false,
      recording: {
        ...DEFAULT_RECORDING_STATE,
        waveformPeaks: [],
      },
    })),
  };
});
