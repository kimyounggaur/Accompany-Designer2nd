/**
 * 녹음 지연 보정(B7). 녹음된 소리가 곡의 어느 자리에 놓여야 하는지를 계산한다. 순수 함수라 가짜 시계로 시험한다.
 *
 * 연주자는 스피커에서 나온 반주를 들으며 연주한다. 그 소리가 귀에 닿기까지 시간이 걸리고(출력 지연),
 * 마이크로 들어온 소리가 컴퓨터에 닿기까지도 시간이 걸린다(입력 지연). 그래서 녹음기가 받은 첫 샘플의 시각에
 * 곡 시계가 가리키던 자리보다, 연주는 지연만큼 이른 자리에 해당한다:
 *
 *   시작 위치 = positionAt(첫 샘플의 오디오 시각)
 *             − (출력 지연 + 기본 지연 + 입력 지연 + 사용자 보정값)
 *
 *   출력 지연     = AudioContext.outputLatency (지원하지 않으면 0) + 마스터 길이 소리를 늦추는 시간(리미터 5 ms)
 *   기본 지연     = AudioContext.baseLatency
 *   입력 지연     = 마이크 트랙 설정의 latency (없으면 0)
 *   사용자 보정값 = 녹음 설정의 "지연 보정(ms)" (기본 0, −200 ~ +200). 양수면 클립이 앞으로 당겨진다.
 *
 * 블루투스 이어폰처럼 지연이 크면 자동값만으로는 모자라서 사용자 보정값을 둔다.
 */
export const LATENCY_OFFSET_MIN_MS = -200;
export const LATENCY_OFFSET_MAX_MS = 200;
export const LATENCY_OFFSET_DEFAULT_MS = 0;

export interface LatencyInputs {
  /** 스피커까지의 지연(초) */
  outputLatency?: number;
  /** 오디오 컨텍스트의 기본 지연(초) */
  baseLatency?: number;
  /** 마이크 입력 지연(초) */
  inputLatency?: number;
  /** 사용자 보정값(ms) */
  userOffsetMs?: number;
}

/** 지연 보정값(ms)을 정수로 맞추고 범위(−200 ~ +200) 안으로 넣는다. 숫자가 아니면 0. */
export function clampLatencyOffsetMs(value: number): number {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return LATENCY_OFFSET_DEFAULT_MS;
  return Math.min(LATENCY_OFFSET_MAX_MS, Math.max(LATENCY_OFFSET_MIN_MS, rounded)) || 0;
}

/** 브라우저가 알려 주는 지연은 0 이상의 유한한 수만 믿는다. */
function seconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 위 식에서 괄호 안의 합(초). 사용자 보정값은 음수일 수 있다(클립을 뒤로 미룬다). */
export function totalLatencySeconds(inputs: LatencyInputs): number {
  const user = clampLatencyOffsetMs(inputs.userOffsetMs ?? 0) / 1000;
  return seconds(inputs.outputLatency) + seconds(inputs.baseLatency) + seconds(inputs.inputLatency) + user;
}

export interface RecordingPlacement {
  /** 클립이 타임라인에서 시작하는 위치(초, 0 이상) */
  startTime: number;
  /** 곡의 시작(0초)보다 앞으로 밀려난 만큼을 녹음 앞쪽에서 잘라 낸 길이(초). 클립의 `offset`으로 쓴다. */
  trim: number;
}

/**
 * 녹음 클립이 놓일 자리.
 * @param positionAtFirstSample 녹음기가 받은 첫 샘플의 오디오 시각에 곡 시계가 가리키던 위치(초)
 */
export function placeRecording(positionAtFirstSample: number, inputs: LatencyInputs): RecordingPlacement {
  const raw = (Number.isFinite(positionAtFirstSample) ? positionAtFirstSample : 0) - totalLatencySeconds(inputs);
  // 0초보다 앞으로 가야 하면 그만큼은 녹음의 앞쪽을 잘라 0초에 맞춘다(클립은 음수 위치를 갖지 못한다).
  return raw >= 0 ? { startTime: raw, trim: 0 } : { startTime: 0, trim: -raw };
}
