/** 클립에 대한 문서 변경 함수. 선택(selection) 같은 화면 상태는 다루지 않는다 — 부르는 쪽이 정해서 넘긴다. */
import { createDefaultTrack } from "../../domain/project/defaults";
import { regroupCopies, splitClip, type ClipPlacement } from "../../domain/timeline/clipMath";
import type { Clip, ProjectDoc, Track } from "../../domain/types";
import { createId, findClip, snapTime } from "../../utils/audioMath";
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
  const parts = splitClip(clip, doc.bpm, splitTime, createId("clip"));
  if (!parts) return fail("outside-clip");
  history.edit("클립 자르기", (draft) => {
    draft.tracks[location.trackIndex].clips.splice(location.clipIndex, 1, parts.left, parts.right);
  }, options);
  return ok({ rightClipId: parts.right.id });
}

/**
 * 여러 클립을 같은 자리(splitTime, 타임라인 초)에서 한꺼번에 자른다(재생선에서 자르기, Ctrl+E). 실행 취소 한 단계다.
 * 그 자리에서 자를 수 없는 클립(클립 밖이거나 가장자리 가까이)은 건너뛰고, 하나도 자르지 못하면 실패한다.
 * 오른쪽 조각들의 id를 잘린 순서(트랙·클립 순서)대로 돌려준다.
 */
export function sliceClipsAt(clipIds: readonly string[], splitTime: number, options?: EditOptions): CommandResult<"none-cuttable", { rightClipIds: string[] }> {
  const doc = getDoc();
  const wanted = new Set(clipIds);
  const cuts: Array<{ trackIndex: number; clipIndex: number; left: Clip; right: Clip }> = [];
  doc.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      if (!wanted.has(clip.id)) return;
      const parts = splitClip(clip, doc.bpm, splitTime, createId("clip"));
      if (parts) cuts.push({ trackIndex, clipIndex, ...parts });
    });
  });
  if (!cuts.length) return fail("none-cuttable");
  history.edit("클립 자르기", (draft) => {
    // 한 트랙에서 여러 개를 자를 때는 뒤쪽 번호부터 바꿔야 앞쪽 번호가 밀리지 않는다.
    for (const cut of [...cuts].reverse()) draft.tracks[cut.trackIndex].clips.splice(cut.clipIndex, 1, cut.left, cut.right);
  }, options);
  return ok({ rightClipIds: cuts.map((cut) => cut.right.id) });
}

/** 클립 하나가 가야 할 자리(트랙과 시작 시간) */
export interface ClipMove {
  clipId: string;
  trackId: string;
  startTime: number;
}

/**
 * 클립 여러 개를 한 번에 옮긴다(여러 클립·그룹 끌기). 옮긴 클립은 대상 트랙의 맨 뒤에 놓인다(`moveClip`과 같음).
 * 목록에서 뒤에 있는 클립이 더 뒤에(화면에서 더 위에) 놓인다. 하나의 편집이라서 끌기 묶음 안에서는 이력 한 단계에 묶인다.
 * 이미 그 순서로 놓여 있으면(끌기의 둘째 프레임부터) 바뀐 값만 고쳐 패치를 작게 유지한다.
 */
export function moveClips(moves: readonly ClipMove[], options?: EditOptions): boolean {
  return history.edit("클립 이동", (draft) => {
    const base = baseOf(draft);
    const movingIds = new Set<string>();
    const arrivals = new Map<number, Clip[]>();
    for (const move of moves) {
      const location = locateClip(base, move.clipId);
      const targetIndex = locateTrack(base, move.trackId);
      if (!location || targetIndex < 0) continue;
      const clip = base.tracks[location.trackIndex].clips[location.clipIndex];
      movingIds.add(clip.id);
      const moved = clip.trackId === move.trackId && clip.startTime === move.startTime ? clip : { ...clip, trackId: move.trackId, startTime: move.startTime };
      arrivals.set(targetIndex, [...(arrivals.get(targetIndex) ?? []), moved]);
    }
    if (!movingIds.size) return;

    const affected = new Set<number>(arrivals.keys());
    base.tracks.forEach((track, trackIndex) => {
      if (track.clips.some((clip) => movingIds.has(clip.id))) affected.add(trackIndex);
    });
    for (const trackIndex of affected) {
      const current = base.tracks[trackIndex].clips;
      const next = [...current.filter((clip) => !movingIds.has(clip.id)), ...(arrivals.get(trackIndex) ?? [])];
      const sameOrder = next.length === current.length && next.every((clip, index) => clip.id === current[index].id);
      if (sameOrder) {
        next.forEach((clip, index) => {
          if (clip !== current[index]) draft.tracks[trackIndex].clips[index].startTime = clip.startTime;
        });
      } else {
        draft.tracks[trackIndex].clips = next;
      }
    }
  }, options);
}

/**
 * 계획대로 새 클립들을 놓는다. 계획이 가리키는 트랙 칸이 지금 트랙 수를 넘으면 모자란 트랙을 같은 편집 안에서 만든다(실행 취소 한 단계).
 * 같은 그룹이던 클립이 사본에도 둘 이상 있으면 사본끼리 새 그룹으로 묶는다. 놓은 클립들의 id를 계획 순서대로 돌려준다.
 */
function placeClips(label: string, placements: readonly ClipPlacement[], rename: (name: string) => string, options?: EditOptions): string[] {
  if (!placements.length) return [];
  const doc = getDoc();
  const needed = Math.max(...placements.map((placement) => placement.trackIndex)) + 1;
  const created: Track[] = [];
  for (let index = doc.tracks.length; index < needed; index += 1) created.push(createDefaultTrack(index + 1));
  const trackIdAt = (index: number) => (doc.tracks[index] ?? created[index - doc.tracks.length]).id;
  const groups = regroupCopies(placements.map((placement) => placement.source), () => createId("group"));
  const clips: Clip[] = placements.map((placement) => ({
    ...placement.source,
    id: createId("clip"),
    name: rename(placement.source.name),
    trackId: trackIdAt(placement.trackIndex),
    startTime: placement.startTime,
    groupId: placement.source.groupId === undefined ? undefined : groups.get(placement.source.groupId),
  }));
  history.edit(label, (draft) => {
    if (created.length) draft.tracks.push(...created);
    clips.forEach((clip, index) => draft.tracks[placements[index].trackIndex].clips.push(clip));
  }, options);
  return clips.map((clip) => clip.id);
}

/** 복제(Ctrl+D): 계획대로 클립 사본을 놓는다. 사본 이름 끝에 "복사본"이 붙는다. 새로 놓은 클립 id들을 돌려준다. */
export function duplicateClips(placements: readonly ClipPlacement[], options?: EditOptions): string[] {
  return placeClips("클립 복제", placements, (name) => `${name} 복사본`, options);
}

/** 붙여넣기(Ctrl+V): 계획대로 복사해 둔 클립을 놓는다. 이름은 그대로. 새로 놓은 클립 id들을 돌려준다. */
export function pasteClips(placements: readonly ClipPlacement[], options?: EditOptions): string[] {
  return placeClips("클립 붙여넣기", placements, (name) => name, options);
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
