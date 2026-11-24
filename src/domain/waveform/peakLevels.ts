/**
 * 다단계 파형 자료(설계서 §P4-3).
 * 음원 샘플을 256 / 1,024 / 4,096 / 16,384개씩 묶어, 묶음마다 최소·최대값을 −127~127 정수로 둔다.
 * 4분 곡이면 네 단계를 합쳐 약 110 KB다(채널은 하나로 합쳐 가장 크게 벌어진 값만 남긴다).
 *
 * 값의 크기는 음원에서 가장 큰 소리(`peak`)를 127로 맞춘다: 조용한 녹음도 눈에 보이고, 한 음원을 자른 클립끼리는 높이를 비교할 수 있다
 * (자른 조각의 파형이 조각마다 다시 커지지 않는다: 보고서 B1).
 *
 * 화면·Worker·시험이 같은 코드를 쓰도록 DOM이나 Web Audio를 쓰지 않는 순수 계산이다.
 */

/** 단계별 한 묶음의 샘플 수. 앞이 가장 촘촘하다. */
export const PEAK_BUCKET_SIZES = [256, 1024, 4096, 16384] as const;
/** 정수로 둔 값의 한쪽 끝(−127~127). 128은 쓰지 않아 +/− 대칭이다. */
export const PEAK_INT_RANGE = 127;
/** 저장소(IndexedDB) 기록의 모양 버전. 모양을 바꾸면 올려서 옛 기록을 못 쓰게 한다. */
export const PEAK_RECORD_VERSION = 1;

export interface PeakLevel {
  /** 묶음 하나의 샘플 수(채널당) */
  readonly samplesPerBucket: number;
  /** 묶음마다 가장 작은 값(−127~0쪽), `peak`를 127로 맞춘 정수 */
  readonly min: Int8Array;
  /** 묶음마다 가장 큰 값 */
  readonly max: Int8Array;
}

export interface PeakSet {
  /** 음원의 샘플레이트(Hz) */
  readonly sampleRate: number;
  /** 음원의 샘플 수(채널당) */
  readonly frames: number;
  /** 음원에서 가장 큰 소리의 크기(0~). 정수 127이 이 크기다. 완전 무음이면 1. */
  readonly peak: number;
  /** `PEAK_BUCKET_SIZES` 순서의 단계들(항상 4개) */
  readonly levels: readonly PeakLevel[];
}

/** 파형을 읽을 수 있는 소리 데이터(AudioBuffer가 이 모양이다) */
export interface PeakSource {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** 단계 하나를 만들 때 쓰는 값들을 정수 칸으로 옮긴다(가까운 정수로 반올림). */
function quantize(value: number, scale: number): number {
  const q = Math.round(value * scale);
  return q > PEAK_INT_RANGE ? PEAK_INT_RANGE : q < -PEAK_INT_RANGE ? -PEAK_INT_RANGE : q;
}

/** 앞 단계 묶음 4개를 한 묶음으로 합친다(최소는 최소끼리, 최대는 최대끼리: 값이 정확히 이어진다). */
function coarser(level: PeakLevel, samplesPerBucket: number): PeakLevel {
  const ratio = samplesPerBucket / level.samplesPerBucket;
  const count = Math.ceil(level.min.length / ratio);
  const min = new Int8Array(count);
  const max = new Int8Array(count);
  for (let i = 0; i < count; i += 1) {
    const from = i * ratio;
    const to = Math.min(level.min.length, from + ratio);
    let lo = level.min[from];
    let hi = level.max[from];
    for (let j = from + 1; j < to; j += 1) {
      if (level.min[j] < lo) lo = level.min[j];
      if (level.max[j] > hi) hi = level.max[j];
    }
    min[i] = lo;
    max[i] = hi;
  }
  return { samplesPerBucket, min, max };
}

/**
 * 샘플을 덩어리로 받아 가며 다단계 파형을 만든다. 덩어리는 어느 채널·어느 순서로 와도 되고(채널은 겹쳐 합친다),
 * 덩어리의 시작이 256의 배수일 필요도 없다. 긴 음원을 Worker로 조금씩 나눠 보낼 수 있게 한 모양이다.
 */
export class PeakBuilder {
  readonly sampleRate: number;
  readonly frames: number;
  private readonly lo: Float32Array;
  private readonly hi: Float32Array;

  constructor(sampleRate: number, frames: number) {
    this.sampleRate = sampleRate;
    this.frames = frames;
    const buckets = Math.ceil(frames / PEAK_BUCKET_SIZES[0]);
    this.lo = new Float32Array(buckets).fill(Infinity);
    this.hi = new Float32Array(buckets).fill(-Infinity);
  }

  /** `samples[0]`이 음원의 `offset`번째 샘플인 덩어리를 더한다. 음원 길이를 넘는 부분은 버린다. */
  addChunk(samples: Float32Array, offset: number): void {
    const first = PEAK_BUCKET_SIZES[0];
    const end = Math.min(offset + samples.length, this.frames);
    let position = Math.max(0, offset);
    while (position < end) {
      const bucket = Math.floor(position / first);
      const bucketEnd = Math.min((bucket + 1) * first, end);
      let lo = this.lo[bucket];
      let hi = this.hi[bucket];
      for (let i = position - offset, stop = bucketEnd - offset; i < stop; i += 1) {
        const value = samples[i];
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
      this.lo[bucket] = lo;
      this.hi[bucket] = hi;
      position = bucketEnd;
    }
  }

  /** 지금까지 받은 것으로 파형 자료를 만든다(받지 못한 구간은 0으로 둔다). */
  finish(): PeakSet {
    let peak = 0;
    for (let i = 0; i < this.lo.length; i += 1) {
      const lo = this.lo[i];
      const hi = this.hi[i];
      if (Number.isFinite(lo) && -lo > peak) peak = -lo; // 무한대는 크기로 치지 않는다(깨진 디코드 결과)
      if (Number.isFinite(hi) && hi > peak) peak = hi;
    }
    const scale = peak > 0 ? PEAK_INT_RANGE / peak : 0;
    const min = new Int8Array(this.lo.length);
    const max = new Int8Array(this.lo.length);
    for (let i = 0; i < this.lo.length; i += 1) {
      min[i] = this.lo[i] === Infinity ? 0 : quantize(this.lo[i], scale);
      max[i] = this.hi[i] === -Infinity ? 0 : quantize(this.hi[i], scale);
    }
    const levels: PeakLevel[] = [{ samplesPerBucket: PEAK_BUCKET_SIZES[0], min, max }];
    for (const size of PEAK_BUCKET_SIZES.slice(1)) levels.push(coarser(levels[levels.length - 1], size));
    return { sampleRate: this.sampleRate, frames: this.frames, peak: peak > 0 ? peak : 1, levels };
  }
}

/** 소리 데이터 전체를 한 번에 파형 자료로 만든다(시험·Worker를 쓸 수 없을 때). 긴 음원은 Worker 쪽(`audio/peaksAnalyzer`)을 쓴다. */
export function createPeakSet(source: PeakSource): PeakSet {
  const builder = new PeakBuilder(source.sampleRate, source.length);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) builder.addChunk(source.getChannelData(channel), 0);
  return builder.finish();
}

/** 단계 안의 값 하나를 −1~1(음원의 가장 큰 소리가 1)로 바꾼다. */
export function peakToUnit(value: number): number {
  return value / PEAK_INT_RANGE;
}

/** 파형 자료가 차지하는 바이트 수(어림) */
export function peakSetBytes(set: PeakSet): number {
  return set.levels.reduce((sum, level) => sum + level.min.byteLength + level.max.byteLength, 0);
}
