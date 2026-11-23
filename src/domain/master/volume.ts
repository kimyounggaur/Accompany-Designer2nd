/**
 * 마스터 볼륨(dB)에 관한 순수 계산. 문서(state)와 소리 경로(audio)가 같은 범위·같은 변환을 쓰도록
 * 한곳에 둔다. 브라우저·오디오 API를 쓰지 않는다.
 */

/** 마스터 볼륨의 범위(dB). 문서의 `master.volumeDb`도 이 안에 들어온다. */
export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 6;
export const MASTER_VOLUME_DEFAULT_DB = 0;
/** 화면 슬라이더의 한 칸(dB) */
export const MASTER_VOLUME_STEP_DB = 0.5;

/** 범위 안으로 맞춘다. 숫자가 아니면 기본값(0 dB) */
export function clampMasterVolumeDb(db: number): number {
  if (!Number.isFinite(db)) return MASTER_VOLUME_DEFAULT_DB;
  return Math.min(MASTER_VOLUME_MAX_DB, Math.max(MASTER_VOLUME_MIN_DB, db));
}

/** 문서에 넣을 값: 범위 안으로 맞추고 소수 첫째 자리까지만 남긴다(−0은 0으로) */
export function normalizeMasterVolumeDb(db: number): number {
  const rounded = Math.round(clampMasterVolumeDb(db) * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** dB → 선형 이득 */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
