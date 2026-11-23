export type EngineChoice = "v1" | "v2";

/** 브라우저 저장소에서 엔진을 고정해 둘 때 쓰는 키: `localStorage["ad.engine"] = "v1"`(옛 엔진으로 고정) */
export const ENGINE_STORAGE_KEY = "ad.engine";

/**
 * 어느 엔진을 쓸지 정한다. 3단계 끝(P3-기본 전환)부터 **기본은 새 엔진(v2)** 이다.
 * 주소의 `?engine=v1`이나 저장소의 `ad.engine=v1`이 있을 때만 옛 엔진으로 돌아간다(문제가 생겼을 때 바로 돌아오는 길).
 * `?engine=…`은 저장소 설정보다 우선하고, 알 수 없는 값은 무시한다.
 * 옛 엔진은 설계 결정 10에 따라 기본 전환 1주 뒤 별도 PR로 지운다. 그때 이 선택 함수도 함께 사라진다.
 */
export function readEngineChoice(
  search: string = typeof location === "undefined" ? "" : location.search,
  stored: string | null = readStored(),
): EngineChoice {
  const fromUrl = new URLSearchParams(search).get("engine");
  if (fromUrl === "v1" || fromUrl === "v2") return fromUrl;
  return stored === "v1" ? "v1" : "v2";
}

function readStored(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(ENGINE_STORAGE_KEY);
  } catch {
    return null; // 저장소를 못 쓰는 환경
  }
}
