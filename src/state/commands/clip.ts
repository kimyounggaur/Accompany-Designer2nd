/** 클립에 대한 문서 변경 함수. 선택(selection) 같은 화면 상태는 다루지 않는다 — 부르는 쪽이 정해서 넘긴다. */
import { canSliceAt } from "../../domain/timeline/clipMath";
import type { Clip, ProjectDoc } from "../../domain/types";
import { clamp, createId, findClip, getClipPlaybackRate, getClipTimelineDuration, snapTime } from "../../utils/audioMath";
import { fail, ok, type CommandResult } from "../commandResult";
import { history, type EditOptions } from "../history";
import { getDoc } from "../projectStore";
import { editKey } from "./editKey";
import { baseOf, locateClip, locateTrack } from "./locate";

/** 편집 함수 안에서, 바꿀 클립들의 위치(트랙 번호, 클립 번호)를 원본에서 찾는다. */
function locateMany(base: ProjectDoc, clipIds: ReadonlySet<string>): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  base.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      if (clipIds.has(clip.id)) found.push([trackIndex, clipIndex]);
    });
  });
  return found;
}

/** 원본 클립을 복제한다. 원본이 없으면 첫 음원 전체로 새 클립을 만든다. 둘 다 없으면 undefined. */
function cloneClipFromSource(doc: ProjectDoc, sourceClipId: string | undefined, trackId: string, startTime: number): Clip | undefined {
  const selection = findClip(doc.tracks, sourceClipId);
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

  const firstAsset = Object.values(doc.assets)[0];
  if (!firstAsset) return undefined;

  return {
    id: createId("clip"),
    audioBufferId: firstAsset.id,
    name: firstAsset.fileName,
    trackId,
    startTime,
    offset: 0,
    duration: firstAsset.duration,
    sourceBpm: doc.bpm,
    stretchMode: "none",
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: "equalPower",
    muted: false,
  };
}

export function addClip(trackId: string, clip: Clip, options?: EditOptions): boolean {
  return history.edit("클립 추가", (doc) => {
    const index = locateTrack(baseOf(doc), trackId);
    if (index >= 0) doc.tracks[index].clips.push(clip);
  }, options);
}

/** 원본 클립(또는 첫 음원)을 복제해 트랙에 놓는다. 만든 클립 id, 만들 수 없으면 undefined. */
export function addClipFromSource(sourceClipId: string | undefined, trackId: string, startTime: number, options?: EditOptions): string | undefined {
  const doc = getDoc();
  const trackIndex = locateTrack(doc, trackId);
  if (trackIndex < 0) return undefined;
  const clip = cloneClipFromSource(doc, sourceClipId, trackId, startTime);
  if (!clip) return undefined;
  history.edit("클립 추가", (draft) => { draft.tracks[trackIndex].clips.push(clip); }, options);
  return clip.id;
}

/**
 * 클립의 값을 고친다. 값이 모두 같으면 아무것도 하지 않는다(재생 중 불필요한 다시 예약을 막는다).
 * 숫자만 바뀌면 같은 값을 800ms 안에 이어서 고친 편집을 한 단계로 묶는다.
 */
export function updateClip(clipId: string, patch: Partial<Clip>, options?: EditOptions): boolean {
  const doc = getDoc();
  const location = locateClip(doc, clipId);
  const current = location ? doc.tracks[location.trackIndex].clips[location.clipIndex] : undefined;
  const key = options?.key ?? (current ? editKey(`clip:${clipId}`, current, patch) : undefined);
  return history.edit("클립 변경", (draft) => {
    const base = baseOf(draft);
    const found = locateClip(base, clipId);
    if (!found) return;
    const before = base.tracks[found.trackIndex].clips[found.clipIndex] as unknown as Record<string, unknown>;
    const clip = draft.tracks[found.trackIndex].clips[found.clipIndex] as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(patch)) {
      if (before[field] !== value) clip[field] = value;
    }
  }, { ...options, key });
}

/**
 * 클립을 다른 트랙(또는 같은 트랙)으로 옮긴다. 옮긴 클립은 대상 트랙의 맨 뒤에 놓인다(예전과 같음).
 * 이미 맨 뒤에 있는 클립을 같은 트랙 안에서 옮길 때는 바뀐 값만 고친다. 끌기 한 번에 수백 번 불리는 경로라
 * 클립 목록을 통째로 바꾸면 이력 패치가 그만큼 커진다.
 */
export function moveClip(clipId: string, targetTrackId: string, patch: Partial<Clip> = {}, options?: EditOptions): boolean {
  const doc = getDoc();
  const start = locateClip(doc, clipId);
  const sameTrack = start !== undefined && doc.tracks[start.trackIndex].id === targetTrackId;
  const current = start ? doc.tracks[start.trackIndex].clips[start.clipIndex] : undefined;
  const key = options?.key ?? (sameTrack && current ? editKey(`clip:${clipId}`, current, patch) : undefined);
  return history.edit("클립 이동", (draft) => {
    const base = baseOf(draft);
    const location = locateClip(base, clipId);
    const targetIndex = locateTrack(base, targetTrackId);
    if (!location || targetIndex < 0) return;
    const sourceClips = base.tracks[location.trackIndex].clips;

    if (targetIndex === location.trackIndex && location.clipIndex === sourceClips.length - 1) {
      const before = sourceClips[location.clipIndex] as unknown as Record<string, unknown>;
      const clip = draft.tracks[location.trackIndex].clips[location.clipIndex] as unknown as Record<string, unknown>;
      for (const [field, value] of Object.entries({ ...patch, trackId: targetTrackId })) {
        if (before[field] !== value) clip[field] = value;
      }
      return;
    }

    const moving: Clip = { ...sourceClips[location.clipIndex], ...patch, trackId: targetTrackId };
    const remaining = sourceClips.filter((clip) => clip.id !== clipId);
    draft.tracks[location.trackIndex].clips = remaining;
    const targetClips = targetIndex === location.trackIndex ? remaining : base.tracks[targetIndex].clips;
    draft.tracks[targetIndex].clips = [...targetClips, moving];
  }, { ...options, key });
}

/** 클립들을 지운다. 지운 개수를 돌려준다. */
export function deleteClips(clipIds: readonly string[], options?: EditOptions): number {
  const ids = new Set(clipIds);
  let removed = 0;
  history.edit("클립 삭제", (doc) => {
    const base = baseOf(doc);
    base.tracks.forEach((track, trackIndex) => {
      const kept = track.clips.filter((clip) => !ids.has(clip.id));
      if (kept.length === track.clips.length) return;
      removed += track.clips.length - kept.length;
      doc.tracks[trackIndex].clips = kept;
    });
  }, options);
  return removed;
}

export function toggleClipMuted(clipId: string, options?: EditOptions): boolean {
  return history.edit("클립 음소거", (doc) => {
    const location = locateClip(baseOf(doc), clipId);
    if (!location) return;
    const clip = doc.tracks[location.trackIndex].clips[location.clipIndex];
    clip.muted = !clip.muted;
  }, options);
}

/**
 * 클립을 splitTime(타임라인 초)에서 둘로 자른다. 오른쪽 조각의 id를 돌려준다.
 * 클립 양끝에서 0.03초 안쪽이면 거절한다.
 */
export function sliceClipAt(clipId: string, splitTime: number, options?: EditOptions): CommandResult<"not-found" | "outside-clip", { rightClipId: string }> {
  const doc = getDoc();
  const location = locateClip(doc, clipId);
  if (!location) return fail("not-found");
  const clip = doc.tracks[location.trackIndex].clips[location.clipIndex];
  const playbackRate = getClipPlaybackRate(doc.bpm, clip);
  if (!canSliceAt(clip, doc.bpm, splitTime)) return fail("outside-clip");
  const localTime = splitTime - clip.startTime;

  const sourceDelta = localTime * playbackRate;
  const leftDuration = clamp(sourceDelta, 0.03, clip.duration - 0.03);
  const rightClip: Clip = {
    ...clip,
    id: createId("clip"),
    name: `${clip.name} 조각`,
    startTime: clip.startTime + leftDuration / playbackRate,
    offset: clip.offset + leftDuration,
    duration: clip.duration - leftDuration,
    groupId: undefined,
  };
  history.edit("클립 자르기", (draft) => {
    draft.tracks[location.trackIndex].clips.splice(location.clipIndex, 1, { ...clip, duration: leftDuration }, rightClip);
  }, options);
  return ok({ rightClipId: rightClip.id });
}

/** 클립 시작 위치를 격자(division: 1박을 몇 칸으로 나눌지)에 맞춘다. */
export function quantizeClips(clipIds: readonly string[], division: number, options?: EditOptions): boolean {
  const ids = new Set(clipIds);
  return history.edit("퀀타이즈", (doc) => {
    const base = baseOf(doc);
    for (const [trackIndex, clipIndex] of locateMany(base, ids)) {
      const startTime = base.tracks[trackIndex].clips[clipIndex].startTime;
      doc.tracks[trackIndex].clips[clipIndex].startTime = Math.max(0, snapTime(startTime, base.bpm, true, division));
    }
  }, options);
}

/** 클립들을 한 그룹으로 묶는다(groupId 부여). groupId는 부르는 쪽이 만들어 넘긴다. */
export function groupClips(clipIds: readonly string[], groupId: string, options?: EditOptions): boolean {
  const ids = new Set(clipIds);
  return history.edit("클립 그룹", (doc) => {
    for (const [trackIndex, clipIndex] of locateMany(baseOf(doc), ids)) {
      doc.tracks[trackIndex].clips[clipIndex].groupId = groupId;
    }
  }, options);
}

export function ungroupClips(clipIds: readonly string[], options?: EditOptions): boolean {
  const ids = new Set(clipIds);
  return history.edit("그룹 해제", (doc) => {
    const base = baseOf(doc);
    for (const [trackIndex, clipIndex] of locateMany(base, ids)) {
      if (base.tracks[trackIndex].clips[clipIndex].groupId !== undefined) {
        doc.tracks[trackIndex].clips[clipIndex].groupId = undefined;
      }
    }
  }, options);
}

/** 클립이 음원 처음부터 끝까지를 쓰도록 되돌린다(offset 0, 길이 = 음원 길이). */
export function resetClipSources(clipIds: readonly string[], options?: EditOptions): boolean {
  const ids = new Set(clipIds);
  return history.edit("클립 원본 구간 복원", (doc) => {
    const base = baseOf(doc);
    for (const [trackIndex, clipIndex] of locateMany(base, ids)) {
      const before = base.tracks[trackIndex].clips[clipIndex];
      const clip = doc.tracks[trackIndex].clips[clipIndex];
      clip.offset = 0;
      clip.duration = base.assets[before.audioBufferId]?.duration ?? before.duration;
    }
  }, options);
}
