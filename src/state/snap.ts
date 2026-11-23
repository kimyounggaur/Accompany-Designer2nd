import type { PlaylistSnap } from "../types";

/** "기본(main)"이면 전체 스냅 설정을 따른다. */
export function resolveSnap(snap: PlaylistSnap, globalSnap: Exclude<PlaylistSnap, "main">) {
  return snap === "main" ? globalSnap : snap;
}

/** 1박을 몇 칸으로 나눌지(격자 분할 수) */
export function getSnapDivision(snap: PlaylistSnap) {
  if (snap === "beat") {
    return 1;
  }

  if (snap === "quarterBeat") {
    return 4;
  }

  return 2;
}
