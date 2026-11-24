/**
 * 파형 보관소(음원 id → 다단계 파형 자료). 문서에는 파형이 없으므로(문서 형식 v2) 화면은 여기서 읽는다.
 * 자료를 만드는 일(저장소 캐시를 먼저 보고, 없으면 Worker로 계산)은 `app/peaks.ts`가 하고, 끝나면 여기에 채운다.
 * 새 프로젝트를 열면 비운다. 저장소(IndexedDB) 쪽 캐시는 `persistence/peaksStore.ts`.
 */
import type { PeakSet } from "../domain/waveform/peakLevels";

const sets = new Map<string, PeakSet>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function setPeakSet(assetId: string, set: PeakSet): void {
  sets.set(assetId, set);
  emit();
}

export function getPeakSet(assetId: string): PeakSet | undefined {
  return sets.get(assetId);
}

/** 한 음원의 파형을 버린다(음원이 문서에서 사라졌거나 소리가 바뀌었을 때) */
export function removePeakSet(assetId: string): void {
  if (sets.delete(assetId)) emit();
}

/** 모두 비운다(프로젝트를 통째로 바꿀 때) */
export function clearPeaks(): void {
  if (!sets.size) return;
  sets.clear();
  emit();
}

/** 보관소가 바뀔 때마다 부른다. 해제 함수를 돌려준다(React의 useSyncExternalStore용). */
export function subscribePeaks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
