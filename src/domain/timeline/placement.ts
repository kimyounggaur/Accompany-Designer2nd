/**
 * 새 클립(올린 음원·녹음)을 어느 트랙에 놓을지 정하는 규칙(P4-5, 보고서 B7·B8).
 * 화면·소리·저장소를 모르는 순수한 계산이라 문서만 넘기면 시험할 수 있다. 트랙을 만들거나 클립을 놓는 일은 부르는 쪽이 한다.
 *
 * - 올리기: 선택한 트랙(없으면 첫 트랙)의 그 구간이 비어 있으면 그 트랙, 아니면 새 트랙.
 *   여러 파일은 하나씩 차례로 이 규칙을 적용한다(앞 파일이 놓인 뒤의 문서로 다음 파일을 판단).
 * - 녹음: 녹음 대기 트랙 → 클립이 하나도 없는 첫 트랙 → 새 트랙.
 *   녹음 대기 트랙은 사용자가 직접 고른 곳이라 그 구간에 다른 클립이 있어도 거기에 놓는다(구간은 녹음이 끝나야 알 수 있기도 하다).
 * - 구간이 비었는지는 타임라인 길이로 본다: 템포 맞춤을 켠 클립은 원본 길이(`clip.duration`)가 아니라
 *   빨라지거나 느려진 길이만큼 자리를 차지한다. 맞닿기만 한 클립(앞 클립 끝 = 새 클립 시작)은 겹친 것이 아니다.
 */
import { getClipTimelineDuration } from "../../utils/audioMath";
import type { ProjectDoc, Track } from "../types";

export type PlacementPurpose = "upload" | "recording";

export interface PlacementRequest {
  purpose: PlacementPurpose;
  /** 지금 선택한 트랙. 올리기만 본다. 없거나 문서에 없는 트랙이면 첫 트랙을 쓴다. */
  selectedTrackId?: string;
  /** 녹음 대기 트랙. 녹음만 본다. */
  armedTrackId?: string;
  /** 새 클립이 시작할 곡 위치(초) */
  start: number;
  /** 새 클립의 타임라인 길이(초, 템포 맞춤 반영). 올리기만 본다(녹음은 끝나기 전에는 길이를 모른다). */
  length: number;
}

/** 놓을 트랙을 정한 결과: 있는 트랙의 id, 또는 새 트랙을 만들어야 함 */
export type PlacementChoice = { trackId: string } | { newTrack: true };

/** 맞닿은 클립을 겹친 것으로 보지 않게 하는 여유(초). 소수 계산의 어긋남(0.1 + 0.2 같은)을 흡수한다. */
const EPSILON = 1e-6;

/** 트랙의 `start`부터 `length`초 구간에 클립이 하나도 걸치지 않으면 true. 길이는 타임라인 길이로 잰다. */
export function isIntervalFree(track: Pick<Track, "clips">, bpm: number, start: number, length: number): boolean {
  const end = start + Math.max(0, length);
  return !track.clips.some((clip) => {
    const clipEnd = clip.startTime + getClipTimelineDuration(bpm, clip);
    return clip.startTime < end - EPSILON && clipEnd > start + EPSILON;
  });
}

/** 새 클립을 놓을 트랙을 정한다. 문서는 읽기만 한다. */
export function chooseTrack(doc: Pick<ProjectDoc, "bpm" | "tracks">, request: PlacementRequest): PlacementChoice {
  const { tracks } = doc;

  if (request.purpose === "recording") {
    const armed = tracks.find((track) => track.id === request.armedTrackId);
    if (armed) return { trackId: armed.id };
    const empty = tracks.find((track) => track.clips.length === 0);
    return empty ? { trackId: empty.id } : { newTrack: true };
  }

  const preferred = tracks.find((track) => track.id === request.selectedTrackId) ?? tracks[0];
  if (preferred && isIntervalFree(preferred, doc.bpm, request.start, request.length)) return { trackId: preferred.id };
  return { newTrack: true };
}
