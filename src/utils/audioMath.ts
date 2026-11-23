import type { Clip, ProjectDoc, Track } from "../domain/types";

export const MIN_CLIP_SOURCE_DURATION = 0.05;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(2).padStart(5, "0")}`;
}

export function getBeatSeconds(bpm: number) {
  return 60 / clamp(bpm || 120, 20, 300);
}

export function snapTime(
  seconds: number,
  bpm: number,
  enabled: boolean,
  division = 2,
) {
  if (!enabled) {
    return seconds;
  }

  const step = getBeatSeconds(bpm) / division;
  return Math.round(seconds / step) * step;
}

export function getClipPlaybackRate(projectBpm: number, clip: Clip) {
  if (clip.stretchMode !== "resample" || !clip.sourceBpm) {
    return 1;
  }

  return clamp(projectBpm / clip.sourceBpm, 0.25, 4);
}

export function getClipTimelineDuration(projectBpm: number, clip: Clip) {
  return clip.duration / getClipPlaybackRate(projectBpm, clip);
}

/** 마지막 클립이 끝나는 타임라인 위치(초). 클립이 없으면 0. */
export function getLastClipEnd(project: Pick<ProjectDoc, "bpm" | "tracks">) {
  return project.tracks.reduce((maxEnd, track) => {
    const trackEnd = track.clips.reduce((clipMax, clip) => {
      const end = clip.startTime + getClipTimelineDuration(project.bpm, clip);
      return Math.max(clipMax, end);
    }, 0);

    return Math.max(maxEnd, trackEnd);
  }, 0);
}

export function getProjectDuration(project: Pick<ProjectDoc, "bpm" | "tracks">) {
  return Math.max(8, getLastClipEnd(project) + getBeatSeconds(project.bpm) * 8);
}

export function findClip(
  tracks: Track[],
  clipId?: string,
): { track: Track; clip: Clip } | undefined {
  if (!clipId) {
    return undefined;
  }

  for (const track of tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return { track, clip };
    }
  }

  return undefined;
}
