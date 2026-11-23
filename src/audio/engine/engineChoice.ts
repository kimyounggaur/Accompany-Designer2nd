export type EngineChoice = "v1" | "v2";

/** 브라우저 저장소에서 엔진을 고정해 둘 때 쓰는 키: `localStorage["ad.engine"] = "v2"` */
export const ENGINE_STORAGE_KEY = "ad.engine";

/**
 * 어느 엔진을 쓸지 정한다. 3단계 동안 새 엔진은 주소에 `?engine=v2`가 있거나 저장소에 `ad.engine=v2`가 있을 때만 켜진다.
 * `?engine=v1`은 저장소 설정보다 우선한다(문제가 생겼을 때 바로 옛 엔진으로 돌아오는 길).
 */
export function readEngineChoice(
  search: string = typeof location === "undefined" ? "" : location.search,
  stored: string | null = readStored(),
): EngineChoice {
  const fromUrl = new URLSearchParams(search).get("engine");
  if (fromUrl === "v1" || fromUrl === "v2") return fromUrl;
  return stored === "v2" ? "v2" : "v1";
}

function readStored(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(ENGINE_STORAGE_KEY);
  } catch {
    return null; // 저장소를 못 쓰는 환경
  }
}
