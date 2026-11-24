import { snapDivisionOf } from "../domain/timeline/snap";
import type { PlaylistSnap, TimeSignature } from "../domain/types";

/** "기본(main)"이면 전체 스냅 설정을 따른다. */
export function resolveSnap(snap: PlaylistSnap, globalSnap: Exclude<PlaylistSnap, "main">) {
  return snap === "main" ? globalSnap : snap;
}

/** 4분음표 하나를 몇 칸으로 나눌지(격자 분할 수). 마디 스냅은 박자표에 따라 달라진다(domain/timeline/snap). */
export function getSnapDivision(snap: PlaylistSnap, timeSignature?: TimeSignature) {
  return snapDivisionOf(snap, timeSignature);
}
