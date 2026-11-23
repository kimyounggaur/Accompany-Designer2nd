/**
 * 녹음 지연 보정값(ms)을 이 브라우저에 기억한다.
 * 프로젝트 문서에는 넣지 않는다 — 마이크·이어폰 같은 장치에 따라 달라지는 개인 설정이라 파일을 열 때 바뀌면 안 된다.
 */
import { LATENCY_OFFSET_DEFAULT_MS, clampLatencyOffsetMs } from "../domain/recording/latency";

export const LATENCY_OFFSET_STORAGE_KEY = "ad.latencyOffsetMs";

export function readLatencyOffsetMs(): number {
  try {
    const raw = window.localStorage.getItem(LATENCY_OFFSET_STORAGE_KEY);
    if (raw === null) return LATENCY_OFFSET_DEFAULT_MS;
    const value = Number(raw);
    return Number.isFinite(value) ? clampLatencyOffsetMs(value) : LATENCY_OFFSET_DEFAULT_MS;
  } catch {
    return LATENCY_OFFSET_DEFAULT_MS;
  }
}

export function writeLatencyOffsetMs(value: number): void {
  try {
    window.localStorage.setItem(LATENCY_OFFSET_STORAGE_KEY, String(clampLatencyOffsetMs(value)));
  } catch {
    /* 저장하지 못해도 이번 화면에서는 동작한다 */
  }
}
