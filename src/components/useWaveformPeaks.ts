import { useCallback, useSyncExternalStore } from "react";
import { getPeaks, subscribePeaks } from "../services/peaksCache";

/** 음원의 파형 점. 아직 없으면(음원이 비어 있거나 푸는 중) undefined이고, 채워지면 다시 그려진다. */
export function useWaveformPeaks(assetId: string | undefined): number[] | undefined {
  const getSnapshot = useCallback(() => (assetId ? getPeaks(assetId) : undefined), [assetId]);
  return useSyncExternalStore(subscribePeaks, getSnapshot);
}
