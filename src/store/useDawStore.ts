import { create } from "zustand";
import type { AudioAsset, Clip, DawProject, Track } from "../types";
import { clamp, createId } from "../utils/audioMath";

interface DawStore extends DawProject {
  selectedClipId?: string;
  isPlaying: boolean;
  playhead: number;
  zoomPxPerSecond: number;
  snapEnabled: boolean;
  gridDivision: number;
  setBpm: (bpm: number) => void;
  setProjectName: (name: string) => void;
  setPlayhead: (playhead: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setZoom: (zoomPxPerSecond: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  addAudioAsset: (asset: AudioAsset) => void;
  updateAudioAsset: (assetId: string, patch: Partial<AudioAsset>) => void;
  addClip: (trackId: string, clip: Clip) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  moveClip: (clipId: string, targetTrackId: string, patch?: Partial<Clip>) => void;
  deleteClip: (clipId: string) => void;
  selectClip: (clipId?: string) => void;
  addTrack: () => void;
  updateTrack: (trackId: string, patch: Partial<Omit<Track, "clips">>) => void;
  importProject: (project: DawProject) => void;
  resetProject: () => void;
}

function createDefaultTrack(index = 1): Track {
  return {
    id: createId("track"),
    name: `Track ${index}`,
    volume: 0.86,
    pan: 0,
    muted: false,
    solo: false,
    eq: {
      lowGain: 0,
      midGain: 0,
      highGain: 0,
    },
    compressor: {
      enabled: false,
      threshold: -18,
      ratio: 3,
      attack: 0.012,
      release: 0.2,
    },
    clips: [],
  };
}

function createDefaultProject(): DawProject {
  return {
    id: createId("project"),
    name: "Untitled Session",
    bpm: 120,
    sampleRate: 44100,
    tracks: [createDefaultTrack(1)],
    audioAssets: {},
  };
}

export const useDawStore = create<DawStore>((set) => ({
  ...createDefaultProject(),
  selectedClipId: undefined,
  isPlaying: false,
  playhead: 0,
  zoomPxPerSecond: 96,
  snapEnabled: true,
  gridDivision: 2,
  setBpm: (bpm) => set({ bpm: clamp(Number(bpm) || 120, 20, 300) }),
  setProjectName: (name) => set({ name }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setZoom: (zoomPxPerSecond) =>
    set({ zoomPxPerSecond: clamp(zoomPxPerSecond, 40, 320) }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
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
    })),
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
      };
    }),
  deleteClip: (clipId) =>
    set((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.id !== clipId),
      })),
      selectedClipId:
        state.selectedClipId === clipId ? undefined : state.selectedClipId,
    })),
  selectClip: (selectedClipId) => set({ selectedClipId }),
  addTrack: () =>
    set((state) => ({
      tracks: [...state.tracks, createDefaultTrack(state.tracks.length + 1)],
      selectedClipId: undefined,
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
      name: project.name || "Imported Session",
      bpm: clamp(project.bpm || 120, 20, 300),
      sampleRate: project.sampleRate || 44100,
      tracks: project.tracks?.length ? project.tracks : [createDefaultTrack(1)],
      audioAssets: project.audioAssets || {},
      selectedClipId: undefined,
      isPlaying: false,
      playhead: 0,
    }),
  resetProject: () =>
    set({
      ...createDefaultProject(),
      selectedClipId: undefined,
      isPlaying: false,
      playhead: 0,
      zoomPxPerSecond: 96,
      snapEnabled: true,
      gridDivision: 2,
    }),
}));
