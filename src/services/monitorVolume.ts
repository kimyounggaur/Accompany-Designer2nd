/**
 * 모니터 볼륨(메트로놈 클릭과 입력 모니터의 크기, 0~1)을 이 브라우저에 기억한다.
 * 프로젝트 문서에는 넣지 않는다 — 스피커·헤드폰 환경에 따라 달라지는 개인 설정이라 파일을 열 때 바뀌면 안 된다.
 */
import { clampMonitorVolume, MONITOR_VOLUME_DEFAULT } from "../audio/engine/MonitorBus";

export const MONITOR_VOLUME_STORAGE_KEY = "ad.monitorVolume";

export function readMonitorVolume(): number {
  try {
    const raw = window.localStorage.getItem(MONITOR_VOLUME_STORAGE_KEY);
    if (raw === null) return MONITOR_VOLUME_DEFAULT;
    const value = Number(raw);
    return Number.isFinite(value) ? clampMonitorVolume(value) : MONITOR_VOLUME_DEFAULT;
  } catch {
    return MONITOR_VOLUME_DEFAULT;
  }
}

export function writeMonitorVolume(volume: number): void {
  try {
    window.localStorage.setItem(MONITOR_VOLUME_STORAGE_KEY, String(clampMonitorVolume(volume)));
  } catch {
    /* 저장하지 못해도 이번 화면에서는 동작한다 */
  }
}
