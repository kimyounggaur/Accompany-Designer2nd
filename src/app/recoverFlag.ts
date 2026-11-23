/**
 * 오류 안내 화면의 [저장된 작업 없이 시작]이 켜는 표시.
 * 저장된 프로젝트 때문에 화면이 계속 깨질 때를 위한 탈출구로, 다음 시작 한 번만 복구를 건너뛴다.
 * 저장된 기록은 지우지 않는다(최근 프로젝트 5개 안에 남는다).
 */
const KEY = "ad.skipRecoverOnce";

export function markSkipRecoverOnce(storage: Pick<Storage, "setItem"> | undefined = safeSessionStorage()): void {
  try {
    storage?.setItem(KEY, "1");
  } catch {
    /* 저장소를 못 쓰는 환경이면 건너뛰기를 포기한다 */
  }
}

/** 표시가 있으면 지우고 true를 돌려준다(한 번만 건너뛴다). */
export function consumeSkipRecover(storage: Pick<Storage, "getItem" | "removeItem"> | undefined = safeSessionStorage()): boolean {
  try {
    if (!storage || storage.getItem(KEY) !== "1") return false;
    storage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
