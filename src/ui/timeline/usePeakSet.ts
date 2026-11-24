import { useCallback, useSyncExternalStore } from "react";
import type { PeakSet } from "../../domain/waveform/peakLevels";
import { getPeakSet, subscribePeaks } from "../../services/peaksCache";

/** 음원의 다단계 파형 자료. 아직 없으면(음원이 비어 있거나 계산 중) undefined이고, 채워지면 다시 그려진다. */
export function usePeakSet(assetId: string | undefined): PeakSet | undefined {
  const getSnapshot = useCallback(() => (assetId ? getPeakSet(assetId) : undefined), [assetId]);
  return useSyncExternalStore(subscribePeaks, getSnapshot);
}
