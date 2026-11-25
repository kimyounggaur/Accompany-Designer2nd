/**
 * 올린 소리가 쓰는 메모리의 계산과 기준(설계서 §P6-4, 보고서 D7). 순수한 계산만 한다(브라우저·소리 엔진을 모른다).
 *
 * 소리를 풀면 샘플 하나가 4바이트(32비트 실수)로 메모리에 올라간다. 그래서 풀린 크기는 파일 크기가 아니라 길이로 정해진다:
 *   풀린 크기 = 길이(초) × 샘플레이트 × 채널 수 × 4바이트   (4분 스테레오 44.1kHz = 84,672,000바이트, 약 85MB)
 * MB는 1,000,000바이트, GB는 1,000,000,000바이트(설계서의 "약 85MB"와 같은 셈).
 */

export const MB = 1_000_000;
export const GB = 1_000 * MB;

/** 풀린 샘플 하나의 크기(바이트) */
export const BYTES_PER_SAMPLE = 4;

/** 이 기준을 넘으면 어떻게 하는지(바이트). 모든 값은 "넘으면"이다(같은 값은 통과). */
export interface MemoryLimits {
  /** 올린 소리 전체가 이만큼을 넘으면 "느려질 수 있습니다"라고 묻는다 */
  notice: number;
  /** 올린 소리 전체가 이만큼을 넘으면 올리지 못하게 한다 */
  reject: number;
  /** 파일 하나가 이만큼을 넘으면 풀기 전에 묻는다(파일 크기 기준) */
  fileAsk: number;
}

/** 데스크톱: 600MB 넘으면 안내, 1.2GB 넘으면 거부. 파일 하나 300MB 넘으면 풀기 전에 묻기 */
export const DESKTOP_LIMITS: Readonly<MemoryLimits> = Object.freeze({ notice: 600 * MB, reject: 1200 * MB, fileAsk: 300 * MB });

/** 휴대폰(메모리 4GB 이하로 알려졌거나 화면 폭이 768px 미만): 200MB 넘으면 안내, 400MB 넘으면 거부 */
export const PHONE_LIMITS: Readonly<MemoryLimits> = Object.freeze({ notice: 200 * MB, reject: 400 * MB, fileAsk: 300 * MB });

/** 소리를 풀면 메모리에서 차지하는 크기(바이트). 길이·샘플레이트·채널이 올바르지 않으면 0 */
export function decodedBytes(seconds: number, sampleRate: number, channels: number): number {
  if (!(seconds > 0) || !(sampleRate > 0) || !(channels > 0)) return 0;
  return Math.round(seconds * sampleRate) * channels * BYTES_PER_SAMPLE;
}

/** 기기를 보고 알아낸 값 */
export interface DeviceHint {
  /** `navigator.deviceMemory`(GB, 크롬 계열만 알려 준다. 모르면 없음) */
  deviceMemory?: number;
  /** 화면(창) 폭(px) */
  width: number;
}

/** 휴대폰급 기준을 쓸 기기인가: 알려진 메모리가 4GB 이하이거나 화면 폭이 768px 미만 */
export function isPhoneClass(hint: DeviceHint): boolean {
  const lowMemory = typeof hint.deviceMemory === "number" && hint.deviceMemory <= 4;
  return lowMemory || hint.width < 768;
}

export function limitsFor(hint: DeviceHint): Readonly<MemoryLimits> {
  return isPhoneClass(hint) ? PHONE_LIMITS : DESKTOP_LIMITS;
}

export type MemoryLevel = "ok" | "notice" | "reject";

/** 올린 소리 전체(이 파일까지 더한 값)가 기준의 어디에 있는가 */
export function judgeTotal(totalBytes: number, limits: Readonly<MemoryLimits>): MemoryLevel {
  if (totalBytes > limits.reject) return "reject";
  if (totalBytes > limits.notice) return "notice";
  return "ok";
}

/** 화면에 보일 크기: 1GB 미만은 "85MB", 그 이상은 "1.2GB" */
export function formatMemory(bytes: number): string {
  const megabytes = Math.round(bytes / MB);
  if (megabytes < 1000) return `${megabytes}MB`;
  return `${(bytes / GB).toFixed(1).replace(/\.0$/, "")}GB`;
}
