/**
 * 박자(BPM) 추정. 소리의 세기가 갑자기 커지는 곳(타격)의 간격을 자기상관으로 찾는다.
 * 계산은 `estimateBpmFromSamples` 하나이고, 화면에서는 Worker가 이것을 부른다(audio/bpmAnalyzer.ts, P4-4).
 */

/** 분석하는 앞부분의 길이(초). 이보다 긴 곡은 앞부분만 본다. */
export const BPM_ANALYSIS_SECONDS = 180;

/** 분석에 쓰는 샘플 수(채널 하나) */
export function bpmAnalysisLength(length: number, sampleRate: number): number {
  return Math.min(length, Math.floor(BPM_ANALYSIS_SECONDS * sampleRate));
}

/** AudioBuffer가 이 모양이다(시험에서는 흉내 낸 것을 넘긴다) */
export interface BpmSource {
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** 진행률(0~1)을 알린다. 같은 퍼센트는 한 번만 부른다. */
function progressReporter(onProgress: ((fraction: number) => void) | undefined): (fraction: number) => void {
  if (!onProgress) return () => undefined;
  let last = -1;
  return (fraction) => {
    const percent = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
    if (percent === last) return;
    last = percent;
    onProgress(percent / 100);
  };
}

/** Estimate tempo from the transient envelope without changing playback settings. */
export function estimateBpm(buffer: BpmSource): number | undefined {
  return estimateBpmFromSamples(buffer.getChannelData(0), buffer.sampleRate);
}

/**
 * 첫 채널의 샘플로 박자를 추정한다. 앞 180초까지만 본다.
 * `onProgress`: 세기 곡선을 만드는 데 절반, 간격(박자) 후보를 비교하는 데 절반으로 보고 진행률을 알린다(Worker에서 화면으로).
 */
export function estimateBpmFromSamples(
  channel: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): number | undefined {
  const report = progressReporter(onProgress);
  const frameSize = 1024;
  const hopSize = 512;
  const maxSamples = bpmAnalysisLength(channel.length, sampleRate);
  const energies: number[] = [];
  for (let position = 0; position + frameSize <= maxSamples; position += hopSize) {
    let energy = 0;
    for (let index = 0; index < frameSize; index += 4) {
      const sample = channel[position + index];
      energy += sample * sample;
    }
    energies.push(Math.sqrt(energy / (frameSize / 4)));
    if (energies.length % 512 === 0) report((position / maxSamples) * 0.5);
  }
  report(0.5);
  if (energies.length < 100) return undefined;
  const flux = energies.map((value, index) => index ? Math.max(0, value - energies[index - 1]) : 0);
  const mean = flux.reduce((sum, value) => sum + value, 0) / flux.length;
  const envelope = flux.map((value) => Math.max(0, value - mean * 0.5));
  if (envelope.reduce((sum, value) => sum + value * value, 0) < 1e-10) return undefined;
  const framesPerSecond = sampleRate / hopSize;
  const minLag = Math.floor(60 * framesPerSecond / 200);
  const maxLag = Math.ceil(60 * framesPerSecond / 45);
  if (envelope.length < maxLag * 2) return undefined;
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    report(0.5 + ((lag - minLag + 1) / (maxLag - minLag + 3)) * 0.5);
    let product = 0, energyA = 0, energyB = 0;
    for (let index = lag; index < envelope.length; index++) {
      const a = envelope[index], b = envelope[index - lag];
      product += a * b; energyA += a * a; energyB += b * b;
    }
    const bpm = 60 * framesPerSecond / lag;
    // Gentle preference for conventional tempi resolves otherwise identical octave candidates.
    const preference = Math.exp(-0.08 * Math.abs(Math.log2(bpm / 120)));
    scores[lag] = product / Math.sqrt(energyA * energyB || 1) * preference;
  }
  let bestLag = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) if (scores[lag] > scores[bestLag]) bestLag = lag;
  if (scores[bestLag] < 0.08) return undefined;
  // A longer lag can win when transients fall between frames. Compare plausible
  // faster octave/triple candidates and favor their fundamental when supported.
  const initialLag = bestLag;
  const initialScore = scores[initialLag];
  let fasterScore = 0;
  for (const divisor of [2, 3, 4]) {
    const target = initialLag / divisor;
    if (target < minLag) continue;
    const low = Math.max(minLag, Math.floor(target) - 1);
    const high = Math.min(maxLag, Math.ceil(target) + 1);
    for (let lag = low; lag <= high; lag++) {
      if (scores[lag] >= initialScore * 0.58 && scores[lag] > fasterScore) {
        fasterScore = scores[lag]; bestLag = lag;
      }
    }
  }
  // Sub-frame peak interpolation avoids the quantized results of integer lag alone.
  const left = scores[bestLag - 1], center = scores[bestLag], right = scores[bestLag + 1];
  const denominator = left - 2 * center + right;
  const correction = denominator ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) : 0;
  report(1);
  return Math.round(60 * framesPerSecond / (bestLag + correction));
}
