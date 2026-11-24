/**
 * 파형 한 칸(화면 픽셀 하나)마다 그릴 최소·최대값을 정한다(설계서 §P4-3 "그리기").
 *
 * 픽셀 하나가 차지하는 샘플 수(`샘플레이트 ÷ 배율 × 재생 배율`)를 구해, 그보다 작거나 같은 가장 큰 단계를 고른다.
 * 픽셀당 256샘플보다 더 확대하면(최대 배율 1,000px/초에서 약 44샘플) 원본 샘플을 직접 읽는다 — 보이는 칸만이라 수천 샘플이다.
 * 순수 계산이라 화면(캔버스) 없이 시험한다.
 */
import { PEAK_BUCKET_SIZES, PEAK_INT_RANGE, type PeakSet, type PeakSource } from "./peakLevels";

export interface ColumnRange {
  /** 음원 안에서 클립이 보여 주는 첫 지점(초) — 클립의 `offset` */
  readonly offset: number;
  /** 음원 안에서 클립이 보여 주는 길이(초) — 클립의 `duration`(재생 배율을 곱하기 전, 원본 시간) */
  readonly duration: number;
  /** 클립이 화면에서 차지하는 전체 너비(px) */
  readonly widthPx: number;
  /** 그릴 첫 칸(클립 왼쪽 끝에서 px) */
  readonly fromPx: number;
  /** 그릴 칸 수(칸 하나 = 1px) */
  readonly count: number;
}

export interface PeakColumns {
  /** 칸마다 가장 작은 값(−1~0쪽). 음원의 가장 큰 소리가 1이다. */
  readonly min: Float32Array;
  /** 칸마다 가장 큰 값 */
  readonly max: Float32Array;
}

/** 칸 하나가 차지하는 원본 샘플 수 */
export function samplesPerPixel(set: Pick<PeakSet, "sampleRate">, duration: number, widthPx: number): number {
  return (Math.max(0, duration) / Math.max(1, widthPx)) * set.sampleRate;
}

/** 칸 하나의 샘플 수보다 작거나 같은 가장 큰 단계의 번호. 가장 촘촘한 단계보다도 작으면 0. */
export function pickLevelIndex(perPixel: number): number {
  let index = 0;
  for (let i = 1; i < PEAK_BUCKET_SIZES.length; i += 1) {
    if (PEAK_BUCKET_SIZES[i] <= perPixel) index = i;
  }
  return index;
}

/** 단계를 쓰지 않고 원본 샘플을 직접 읽어야 하는가(픽셀당 256샘플보다 더 확대) */
export function needsRawSamples(perPixel: number): boolean {
  return perPixel < PEAK_BUCKET_SIZES[0];
}

export function waveformColumns(set: PeakSet, range: ColumnRange, raw?: PeakSource): PeakColumns {
  const count = Math.max(0, Math.floor(range.count));
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  if (count === 0 || set.frames <= 0) return { min, max };

  const rate = set.sampleRate;
  const secondsPerPixel = Math.max(0, range.duration) / Math.max(1, range.widthPx);
  const perPixel = secondsPerPixel * rate;
  const level = set.levels[pickLevelIndex(perPixel)];
  const size = level.samplesPerBucket;
  const lastBucket = level.min.length - 1;
  // 클립이 보여 주는 샘플 구간. 이 밖의 소리는 이 클립의 파형에 섞이면 안 된다(자른 조각의 높이: 보고서 B1).
  const clipFrom = Math.max(0, range.offset * rate);
  const clipTo = Math.min(set.frames, (range.offset + range.duration) * rate);
  const exact = raw !== undefined && raw.length > 0 ? raw : undefined;
  const channels = exact ? Array.from({ length: exact.numberOfChannels }, (_, channel) => exact.getChannelData(channel)) : [];
  const rawScale = 1 / set.peak;

  /** 원본 샘플 [a, b)에서 이 칸의 최소·최대를 읽는다. 읽은 것이 없으면 false. */
  const readRaw = (x: number, a: number, b: number): boolean => {
    if (!exact) return false;
    const first = Math.max(0, Math.floor(a));
    const limit = Math.min(set.frames, exact.length, Math.max(first + 1, Math.ceil(b)));
    let lo = Infinity;
    let hi = -Infinity;
    for (const data of channels) {
      for (let i = first; i < limit; i += 1) {
        const value = data[i];
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    if (lo === Infinity) return false;
    min[x] = Math.max(-1, lo * rawScale);
    max[x] = Math.min(1, hi * rawScale);
    return true;
  };

  const useRaw = exact !== undefined && needsRawSamples(perPixel);
  for (let x = 0; x < count; x += 1) {
    const from = (range.offset + (range.fromPx + x) * secondsPerPixel) * rate;
    const to = from + perPixel;
    if (to <= clipFrom || from >= clipTo) continue; // 클립 밖(음원 밖에 걸친 자리 포함)

    if (useRaw) {
      readRaw(x, from, to);
      continue;
    }

    const first = Math.max(0, Math.min(lastBucket, Math.floor(from / size)));
    const last = Math.max(first, Math.min(lastBucket, Math.ceil(to / size) - 1));
    // 클립 가장자리 칸: 묶음이 클립 밖의 소리까지 담고 있으면 그 칸만 원본 샘플로 정확히 읽는다(칸은 많아야 둘이다).
    if (exact && (first * size < clipFrom - 1e-6 || (last + 1) * size > clipTo + 1e-6)) {
      if (readRaw(x, Math.max(from, clipFrom), Math.min(to, clipTo))) continue;
    }
    let lo = level.min[first];
    let hi = level.max[first];
    for (let i = first + 1; i <= last; i += 1) {
      if (level.min[i] < lo) lo = level.min[i];
      if (level.max[i] > hi) hi = level.max[i];
    }
    min[x] = lo / PEAK_INT_RANGE;
    max[x] = hi / PEAK_INT_RANGE;
  }
  return { min, max };
}
