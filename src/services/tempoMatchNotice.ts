/**
 * "템포 맞춤을 처음 켤 때 한 번만" 보이는 안내를 이 브라우저에서 이미 보았는지 기억한다(설계서 §P4-4, 보고서 B4).
 * 프로젝트 문서에는 넣지 않는다 — 파일을 열 때마다 되살아나면 안 되는 개인 화면 설정이다.
 * 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 "보지 않았다"로 돌려주므로, 그 경우에는 새로 열 때마다 한 번씩 보인다.
 */
export const TEMPO_MATCH_NOTICE_STORAGE_KEY = "ad.tempoMatchPitchNoticeSeen";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function hasSeenTempoMatchNotice(storage: ReadableStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(TEMPO_MATCH_NOTICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTempoMatchNoticeSeen(storage: WritableStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(TEMPO_MATCH_NOTICE_STORAGE_KEY, "1");
  } catch {
    /* 저장하지 못해도 이번 화면에서는 동작한다 */
  }
}
