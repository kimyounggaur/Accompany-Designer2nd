/**
 * 파형 점 보관소(음원 id → 0~1 값 목록). 문서에는 파형이 없으므로(문서 형식 v2) 화면은 여기서 읽는다.
 * 음원을 풀 때(올리기·녹음·프로젝트 열기·자동 저장 복구)마다 채우고, 새 프로젝트를 열면 비운다.
 * 지금은 메모리에만 둔다. 4단계 P4-3에서 다단계 파형과 저장소(IndexedDB `peaks`) 캐시로 바뀐다.
 */
const peaks = new Map<string, number[]>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function setPeaks(assetId: string, values: number[]): void {
  peaks.set(assetId, values);
  emit();
}

export function getPeaks(assetId: string): number[] | undefined {
  return peaks.get(assetId);
}

/** 모두 비운다(프로젝트를 통째로 바꿀 때) */
export function clearPeaks(): void {
  if (!peaks.size) return;
  peaks.clear();
  emit();
}

/** 보관소가 바뀔 때마다 부른다. 해제 함수를 돌려준다(React의 useSyncExternalStore용). */
export function subscribePeaks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
