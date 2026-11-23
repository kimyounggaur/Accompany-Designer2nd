/**
 * 선읽기 리미터의 계산부(순수 함수, 오디오 노드를 모른다). `limiter.worklet.ts`가 감싸서 쓰고, 단위 시험은 이것만 돌린다.
 *
 *  1. 입력을 `lookahead` 샘플(5 ms) 늦춰 내보낸다.
 *  2. 늦추기 전 신호로 샘플마다 필요 이득 need = min(1, 상한 ÷ 두 채널 중 큰 값)을 구한다.
 *     두 채널에 같은 이득을 걸어 소리의 좌우 위치가 그대로 남는다.
 *  3. need의 "최근 5 ms 안의 최소값"을 붙잡고(hold), 5 ms 이동 평균으로 부드럽게 한다(s).
 *     피크가 출력에 닿는 순간에는 이득이 이미 need까지 내려와 있고, 피크가 오기 전 5 ms 동안 미리 천천히 내려온다.
 *  4. 이득이 올라갈 때는 80 ms 시상수 곡선으로 천천히 1로 돌아간다. 내려갈 때는 s를 그대로 따른다.
 *  5. 출력 = 늦춘 입력 × 이득.
 *
 * 상한을 넘지 않는다는 보장: 창 길이를 L = lookahead + 1로 두면, 출력 시점 n에서 이동 평균에 들어가는 L개의 hold 값은
 * 모두 "n − lookahead 시점 샘플의 need"를 창 안에 품고 있다. 그래서 s(n) ≤ need(n − lookahead)이고, 출력 크기는
 * |x(n − lookahead)| × s(n) ≤ 상한이다. 회복 곡선(4)은 이득을 s보다 높이지 않으므로 이 보장을 깨지 않는다.
 */

/** 출력 상한(dBFS). −1 dBFS ≈ 0.891 */
export const LIMITER_CEILING_DB = -1;
export const LIMITER_CEILING = 10 ** (LIMITER_CEILING_DB / 20);
/** 선읽기 길이 = 출력 지연(초) */
export const LIMITER_LOOKAHEAD_SECONDS = 0.005;
/** 이득이 1로 돌아가는 곡선의 시상수(초) */
export const LIMITER_RELEASE_SECONDS = 0.08;

/**
 * 선읽기 길이를 샘플 수로 바꾼다 = 리미터가 소리를 늦추는 샘플 수(44.1 kHz에서 221, 48 kHz에서 240).
 * 내보낼 때 파일 앞에서 이만큼을 잘라 내야 소리가 곡 위치와 어긋나지 않는다.
 */
export function limiterLookaheadFrames(sampleRate: number, lookaheadSeconds: number = LIMITER_LOOKAHEAD_SECONDS): number {
  return Math.max(1, Math.round(lookaheadSeconds * sampleRate));
}

export interface LimiterOptions {
  ceiling?: number;
  lookaheadSeconds?: number;
  releaseSeconds?: number;
}

/** 이동 평균의 합이 부동소수점 오차로 어긋나지 않게 이만큼 처리할 때마다 처음부터 다시 더한다 */
const SUM_REFRESH_SAMPLES = 1 << 16;

export class LookaheadLimiter {
  /** 출력 지연(샘플) */
  readonly lookahead: number;
  readonly ceiling: number;
  readonly channels: number;
  private readonly windowLength: number;
  private readonly delayLines: Float32Array[];
  private delayPosition = 0;
  // 최근 L개 need의 최소값을 O(1)로 구하는 단조 덱(앞이 가장 작은 값)
  private readonly dequeValues: Float64Array;
  private readonly dequeIndexes: Float64Array;
  private dequeHead = 0;
  private dequeSize = 0;
  private processed = 0;
  // hold 값의 L칸 이동 평균
  private readonly average: Float64Array;
  private averagePosition = 0;
  private averageSum: number;
  private sinceRefresh = 0;
  private released = 1;
  private readonly releaseCoefficient: number;
  private minGain = 1;

  constructor(sampleRate: number, channels = 2, options: LimiterOptions = {}) {
    this.channels = channels;
    this.ceiling = options.ceiling ?? LIMITER_CEILING;
    this.lookahead = limiterLookaheadFrames(sampleRate, options.lookaheadSeconds);
    this.windowLength = this.lookahead + 1;
    this.delayLines = Array.from({ length: channels }, () => new Float32Array(this.lookahead));
    this.dequeValues = new Float64Array(this.windowLength + 1);
    this.dequeIndexes = new Float64Array(this.windowLength + 1);
    this.average = new Float64Array(this.windowLength).fill(1);
    this.averageSum = this.windowLength;
    const release = options.releaseSeconds ?? LIMITER_RELEASE_SECONDS;
    this.releaseCoefficient = 1 - Math.exp(-1 / (Math.max(1e-4, release) * sampleRate));
  }

  /**
   * 입력 블록(채널별 배열)을 처리해 출력 블록을 채운다. 입력 채널이 모자라면 모자란 채널은 무음으로 본다.
   * 입력이 없어도(연결이 끊겨도) 호출하면 지연 버퍼에 남은 소리가 계속 나간다.
   */
  process(input: ArrayLike<Float32Array>, output: ArrayLike<Float32Array>): void {
    const frames = output.length ? output[0].length : input.length ? input[0].length : 0;
    const { channels, lookahead, windowLength, ceiling } = this;
    const capacity = this.windowLength + 1;
    for (let n = 0; n < frames; n += 1) {
      let peak = 0;
      for (let ch = 0; ch < channels; ch += 1) {
        const x = ch < input.length ? input[ch][n] : 0;
        const magnitude = x < 0 ? -x : x;
        if (magnitude > peak) peak = magnitude;
      }
      const need = peak > ceiling ? ceiling / peak : 1;

      // 최근 L개 need의 최소값(hold)
      let back = (this.dequeHead + this.dequeSize - 1) % capacity;
      while (this.dequeSize > 0 && this.dequeValues[back] >= need) {
        this.dequeSize -= 1;
        back = (back - 1 + capacity) % capacity;
      }
      const tail = (this.dequeHead + this.dequeSize) % capacity;
      this.dequeValues[tail] = need;
      this.dequeIndexes[tail] = this.processed;
      this.dequeSize += 1;
      while (this.dequeIndexes[this.dequeHead] <= this.processed - windowLength) {
        this.dequeHead = (this.dequeHead + 1) % capacity;
        this.dequeSize -= 1;
      }
      const held = this.dequeValues[this.dequeHead];
      this.processed += 1;

      // hold 값의 이동 평균
      this.averageSum += held - this.average[this.averagePosition];
      this.average[this.averagePosition] = held;
      this.averagePosition = (this.averagePosition + 1) % windowLength;
      if (++this.sinceRefresh >= SUM_REFRESH_SAMPLES) {
        this.sinceRefresh = 0;
        let sum = 0;
        for (let i = 0; i < windowLength; i += 1) sum += this.average[i];
        this.averageSum = sum;
      }
      const smoothed = this.averageSum / windowLength;

      // 내려갈 때는 곧바로, 올라갈 때는 천천히
      if (smoothed < this.released) this.released = smoothed;
      else this.released += (smoothed - this.released) * this.releaseCoefficient;
      const gain = this.released;
      if (gain < this.minGain) this.minGain = gain;

      // 늦춘 입력 × 이득
      const position = this.delayPosition;
      for (let ch = 0; ch < channels; ch += 1) {
        const line = this.delayLines[ch];
        const delayed = line[position];
        line[position] = ch < input.length ? input[ch][n] : 0;
        if (ch < output.length) output[ch][n] = delayed * gain;
      }
      this.delayPosition = position + 1 === lookahead ? 0 : position + 1;
    }
  }

  /** 마지막으로 부른 뒤 가장 낮았던 이득(선형, 1 이하)을 돌려주고 다시 1부터 센다. */
  takeMinGain(): number {
    const value = this.minGain;
    this.minGain = this.released;
    return value;
  }

  /** 지금 걸려 있는 이득(선형) */
  get gain(): number {
    return this.released;
  }
}

/** 선형 이득 → dB (0 이하로 읽는다) */
export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -120;
}
