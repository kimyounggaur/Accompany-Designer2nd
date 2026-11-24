import type { Clip, Track } from "../types";
import { clamp, getClipPlaybackRate, getClipTimelineDuration } from "../../utils/audioMath";

/** 클립 하나를 지금 위치에서 어떻게 재생할지 정한 계획. 소리 노드를 만들지 않는 순수한 값이다. */
export interface VoicePlan {
  /** 재생 배율(WARP를 켠 클립만 1이 아님) */
  rate: number;
  /** 음원 안에서 시작할 위치(초) */
  offset: number;
  /** 음원에서 재생할 길이(초) */
  duration: number;
  /** 클립 안에서 이미 지난 타임라인 시간(초). 클립이 시작되기 전이면 0 */
  elapsed: number;
  /** 클립 전체의 타임라인 길이(초) */
  timelineDuration: number;
  /** 소리를 시작할 오디오 시각(context 시간) */
  when: number;
  /** 클립 중간에서 시작하는가. 그렇다면 시작 클릭을 막는 짧은 페이드 인이 필요하다. */
  startsMidClip: boolean;
}

/**
 * `position`(타임라인 초)에서 재생을 이어 갈 때 이 클립을 어떻게 재생할지 계산한다. 더 재생할 소리가 없으면 `undefined`.
 * 옛 엔진의 `scheduleClip` 계산을 노드 만들기와 분리한 것이다.
 *
 * @param bufferDuration 음원 버퍼의 길이(초)
 * @param contextTimeAt 타임라인 위치 → 오디오 시각(재생 시계가 알려 준다)
 */
export function planVoice(
  clip: Clip,
  bpm: number,
  position: number,
  bufferDuration: number,
  contextTimeAt: (position: number) => number,
): VoicePlan | undefined {
  const rate = getClipPlaybackRate(bpm, clip);
  const timelineDuration = getClipTimelineDuration(bpm, clip);
  if (clip.startTime + timelineDuration <= position) return undefined;
  const elapsed = Math.max(0, position - clip.startTime);
  const offset = clip.offset + elapsed * rate;
  const duration = Math.min(clip.duration - elapsed * rate, bufferDuration - offset);
  if (!(duration > 0)) return undefined;
  return {
    rate,
    offset,
    duration,
    elapsed,
    timelineDuration,
    when: contextTimeAt(Math.max(position, clip.startTime)),
    startsMidClip: elapsed > 0,
  };
}

/** 클립 양끝에서 이만큼(초) 안쪽이어야 자를 수 있다(너무 짧은 조각이 생기지 않게) */
export const SLICE_EDGE_MARGIN = 0.03;

/** `time`(타임라인 초)에서 이 클립을 자를 수 있는가: 클립 양끝에서 `SLICE_EDGE_MARGIN`보다 안쪽이어야 한다. */
export function canSliceAt(clip: Clip, bpm: number, time: number): boolean {
  const local = time - clip.startTime;
  return local > SLICE_EDGE_MARGIN && local < getClipTimelineDuration(bpm, clip) - SLICE_EDGE_MARGIN;
}

/**
 * 클립 하나를 `time`(타임라인 초)에서 둘로 가른다. 자를 수 없으면(양끝 `SLICE_EDGE_MARGIN` 안쪽이 아니면) undefined.
 * 왼쪽 조각은 원래 클립(id·그룹 그대로, 길이만 줄어듦), 오른쪽 조각은 `rightId`를 받고 그룹에서 빠진다.
 */
export function splitClip(clip: Clip, bpm: number, time: number, rightId: string): { left: Clip; right: Clip } | undefined {
  if (!canSliceAt(clip, bpm, time)) return undefined;
  const rate = getClipPlaybackRate(bpm, clip);
  const sourceDelta = (time - clip.startTime) * rate;
  const leftDuration = clamp(sourceDelta, SLICE_EDGE_MARGIN, clip.duration - SLICE_EDGE_MARGIN);
  return {
    left: { ...clip, duration: leftDuration },
    right: {
      ...clip,
      id: rightId,
      name: `${clip.name} 조각`,
      startTime: clip.startTime + leftDuration / rate,
      offset: clip.offset + leftDuration,
      duration: clip.duration - leftDuration,
      groupId: undefined,
    },
  };
}

/**
 * 재생선(편집 커서) 자리에서 자를 클립들(Ctrl+E). 고른 클립이 있으면 그중 재생선이 안쪽에 있는 것만,
 * 고른 클립이 없으면 모든 트랙에서 재생선이 지나는 클립 전부. 자를 수 없는 클립(재생선이 클립 밖이거나 가장자리 가까이)은 뺀다.
 */
export function clipsToCutAt(tracks: readonly Pick<Track, "clips">[], bpm: number, selectedIds: readonly string[], time: number): string[] {
  const selected = new Set(selectedIds);
  return tracks.flatMap((track) =>
    track.clips.filter((clip) => (selected.size === 0 || selected.has(clip.id)) && canSliceAt(clip, bpm, time)).map((clip) => clip.id),
  );
}

/** 끌어서 옮기는 클립 하나의 자리: 트랙 칸 번호(위에서 0)와 시작 시간(초) */
export interface MoveItem {
  readonly id: string;
  readonly trackIndex: number;
  readonly startTime: number;
}

/**
 * 끌기 대상에 같은 그룹의 클립을 모두 더한다(그룹 함께 옮기기). `ids`에 든 클립이 groupId를 가졌으면 그 그룹 전체가 들어온다.
 * 돌려주는 목록은 트랙·클립 순서(문서 순서)를 따른다.
 */
export function withGroupMembers(tracks: readonly Pick<Track, "clips">[], ids: Iterable<string>): string[] {
  const chosen = new Set(ids);
  const groups = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) if (chosen.has(clip.id) && clip.groupId !== undefined) groups.add(clip.groupId);
  }
  return tracks.flatMap((track) =>
    track.clips.filter((clip) => chosen.has(clip.id) || (clip.groupId !== undefined && groups.has(clip.groupId))).map((clip) => clip.id),
  );
}

/**
 * 끌기를 시작할 때 함께 움직일 클립들의 처음 자리. 누른 클립(`leadId`)이 선택에 들어 있으면 선택 전체, 아니면 누른 클립 하나이고,
 * 거기에 같은 그룹의 클립이 모두 더해진다. 누른 클립이 맨 뒤에 오게 해서(옮긴 뒤 가장 위에 그려지도록) 문서 순서로 돌려준다.
 */
export function movingItems(tracks: readonly Pick<Track, "clips">[], selectedIds: readonly string[], leadId: string): MoveItem[] {
  const base = selectedIds.includes(leadId) ? selectedIds : [leadId];
  const chosen = new Set(withGroupMembers(tracks, base));
  chosen.add(leadId);
  const items: MoveItem[] = [];
  tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) if (chosen.has(clip.id)) items.push({ id: clip.id, trackIndex, startTime: clip.startTime });
  });
  return [...items.filter((item) => item.id !== leadId), ...items.filter((item) => item.id === leadId)];
}

/**
 * 여러 클립을 함께 옮길 때의 새 자리. 모두 같은 시간(`deltaTime`)·같은 트랙 칸 수(`deltaRows`)만큼 움직이고,
 * 어느 한 클립이라도 곡 시작(0초) 앞이나 맨 위·맨 아래 트랙 밖으로 나가게 되면 그 자리에서 전체가 함께 멈춘다(서로의 간격이 흐트러지지 않게).
 */
export function planMultiMove(items: readonly MoveItem[], deltaTime: number, deltaRows: number, trackCount: number): MoveItem[] {
  if (!items.length) return [];
  const minStart = Math.min(...items.map((item) => item.startTime));
  const minRow = Math.min(...items.map((item) => item.trackIndex));
  const maxRow = Math.max(...items.map((item) => item.trackIndex));
  const time = Math.max(Number.isFinite(deltaTime) ? deltaTime : 0, -minStart);
  const rows = clamp(Math.round(Number.isFinite(deltaRows) ? deltaRows : 0), -minRow, Math.max(0, trackCount - 1 - maxRow));
  return items.map((item) => ({ id: item.id, trackIndex: item.trackIndex + rows, startTime: item.startTime + time }));
}

/** 새 클립을 놓을 계획 하나: 무엇을(`source`) 어느 트랙 칸(`trackIndex`)의 몇 초에 놓을지 */
export interface ClipPlacement {
  readonly source: Clip;
  readonly trackIndex: number;
  readonly startTime: number;
}

/**
 * 복제(Ctrl+D): 고른 클립들을 한 덩어리로 보고, 덩어리가 끝나는 자리(가장 늦게 끝나는 클립의 끝) 바로 뒤에
 * 같은 트랙·같은 간격으로 놓는다. 클립 하나면 그 클립이 끝난 자리에 놓인다.
 */
export function planDuplicate(items: ReadonlyArray<{ clip: Clip; trackIndex: number }>, bpm: number): ClipPlacement[] {
  if (!items.length) return [];
  const start = Math.min(...items.map(({ clip }) => clip.startTime));
  const end = Math.max(...items.map(({ clip }) => clip.startTime + getClipTimelineDuration(bpm, clip)));
  const shift = end - start;
  return items.map(({ clip, trackIndex }) => ({ source: clip, trackIndex, startTime: clip.startTime + shift }));
}

/** 복사해 둔 클립 하나: 클립의 사본과, 복사한 클립들 중 가장 위 트랙을 0으로 센 트랙 칸 */
export interface PasteItem {
  readonly clip: Clip;
  readonly row: number;
}

/** 붙여넣기 계획: 놓을 클립들과, 그것을 놓으려면 있어야 하는 트랙 수 */
export interface PastePlan {
  readonly placements: ClipPlacement[];
  /** 필요한 트랙 수. 지금 트랙 수보다 크면 모자란 만큼 새 트랙을 만들어야 한다. */
  readonly trackCount: number;
}

/**
 * 붙여넣기(Ctrl+V): 복사한 것 중 가장 앞의 클립이 `at`(재생 위치)에 오고, 나머지는 서로의 시간 간격과 트랙 칸 간격을 지킨다.
 * 가장 위 클립이 놓일 트랙 칸이 `baseRow`다. 아래로 이어지는 칸이 지금 트랙 수를 넘으면 `trackCount`가 그만큼 커진다(새 트랙).
 */
export function planPaste(items: readonly PasteItem[], at: number, baseRow: number): PastePlan {
  if (!items.length) return { placements: [], trackCount: 0 };
  const first = Math.min(...items.map(({ clip }) => clip.startTime));
  const placements = items.map(({ clip, row }) => ({ source: clip, trackIndex: Math.max(0, baseRow) + row, startTime: Math.max(0, at) + clip.startTime - first }));
  return { placements, trackCount: Math.max(...placements.map((placement) => placement.trackIndex)) + 1 };
}

/**
 * 붙여넣기에서 가장 위 클립이 놓일 트랙 칸. 클립은 고르지 않고 트랙만 골라 두었다면 그 트랙,
 * 아니면 복사한 클립이 있던 트랙(아직 있으면), 둘 다 없으면 첫 트랙이다.
 * (클립을 고른 채로 남아 있는 트랙 선택은 옛 선택일 수 있어서 따르지 않는다.)
 */
export function pasteBaseRow(
  trackIds: readonly string[],
  context: { selectedTrackId?: string; clipsSelected: boolean; originTrackId?: string },
): number {
  const chosen = context.clipsSelected ? -1 : trackIds.indexOf(context.selectedTrackId ?? "");
  if (chosen >= 0) return chosen;
  const origin = trackIds.indexOf(context.originTrackId ?? "");
  return origin >= 0 ? origin : 0;
}

/**
 * 복제·붙여넣기로 만든 사본들의 그룹 정리: 같은 그룹이던 클립이 사본에도 둘 이상 들어 있으면 사본끼리 새 그룹으로 묶고
 * (원래 그룹과는 따로), 하나뿐이면 그룹에서 뺀다. 원본 groupId → 사본 groupId 대응표를 돌려준다(묶이지 않는 그룹은 빠진다).
 */
export function regroupCopies(sources: readonly Clip[], newGroupId: () => string): Map<string, string> {
  const counts = new Map<string, number>();
  for (const clip of sources) if (clip.groupId !== undefined) counts.set(clip.groupId, (counts.get(clip.groupId) ?? 0) + 1);
  const mapping = new Map<string, string>();
  for (const [groupId, count] of counts) if (count >= 2) mapping.set(groupId, newGroupId());
  return mapping;
}
