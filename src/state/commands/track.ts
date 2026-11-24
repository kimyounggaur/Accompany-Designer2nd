/** 트랙에 대한 문서 변경 함수 */
import type { Track } from "../../domain/types";
import { createDefaultTrack } from "../../domain/project/defaults";
import { history, type EditOptions } from "../history";
import { getDoc } from "../projectStore";
import { editKey } from "./editKey";
import { baseOf, locateTrack } from "./locate";

/** 기본 트랙을 맨 뒤에 더하고, 만든 트랙을 돌려준다. */
export function addTrack(options?: EditOptions): Track {
  const track = createDefaultTrack(getDoc().tracks.length + 1);
  history.edit("트랙 추가", (doc) => { doc.tracks.push(track); }, options);
  return track;
}

/** 트랙을 지운다(클립도 함께). 없는 트랙이면 false. 마지막 트랙·녹음 중 같은 규칙은 부르는 쪽이 정한다. */
export function removeTrack(trackId: string, options?: EditOptions): boolean {
  return history.edit("트랙 삭제", (doc) => {
    const index = locateTrack(baseOf(doc), trackId);
    if (index >= 0) doc.tracks.splice(index, 1);
  }, options);
}

/** 트랙을 위(-1)나 아래(+1)로 한 칸 옮긴다. */
export function reorderTrack(trackId: string, direction: -1 | 1, options?: EditOptions): boolean {
  return history.edit("트랙 순서 변경", (doc) => {
    const base = baseOf(doc);
    const index = locateTrack(base, trackId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= base.tracks.length) return;
    const tracks = [...base.tracks];
    [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    doc.tracks = tracks;
  }, options);
}

/**
 * 트랙의 값을 고친다(클립 제외). 값이 모두 같으면 아무것도 하지 않는다.
 * 숫자(볼륨·팬·이펙트 노브)만 바뀌면 같은 값을 800ms 안에 이어서 고친 편집을 한 단계로 묶는다(키보드로 여러 번 올리기).
 */
export function updateTrack(trackId: string, patch: Partial<Omit<Track, "clips">>, options?: EditOptions): boolean {
  const doc = getDoc();
  const current = doc.tracks[locateTrack(doc, trackId)];
  const key = options?.key ?? (current ? editKey(`track:${trackId}`, current, patch) : undefined);
  return history.edit("트랙 변경", (draft) => {
    const base = baseOf(draft);
    const index = locateTrack(base, trackId);
    if (index < 0) return;
    const before = base.tracks[index] as unknown as Record<string, unknown>;
    const track = draft.tracks[index] as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(patch)) {
      if (before[field] !== value) track[field] = value;
    }
  }, { ...options, key });
}
