import { isDraft, original, type Draft } from "immer";
import type { ProjectDoc } from "../../types";

/**
 * 편집 함수(recipe) 안에서 "바꾸기 전 문서"를 프록시 없이 읽기 위한 도우미.
 * 트랙·클립을 찾을 때 초안(draft)을 훑으면 훑은 항목마다 프록시가 만들어져 느려진다. 먼저 원본에서 위치를 찾고, 바꿀 곳만 초안으로 접근한다.
 */
export function baseOf(doc: Draft<ProjectDoc> | ProjectDoc): ProjectDoc {
  return (isDraft(doc) ? original(doc) : doc) as ProjectDoc;
}

export interface ClipLocation {
  trackIndex: number;
  clipIndex: number;
}

export function locateClip(doc: ProjectDoc, clipId: string): ClipLocation | undefined {
  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex += 1) {
    const clipIndex = doc.tracks[trackIndex].clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex >= 0) return { trackIndex, clipIndex };
  }
  return undefined;
}

export function locateTrack(doc: ProjectDoc, trackId: string): number {
  return doc.tracks.findIndex((track) => track.id === trackId);
}
