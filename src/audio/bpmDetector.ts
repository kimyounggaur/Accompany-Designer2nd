/** Estimate tempo from the transient envelope without changing playback settings. */
export function estimateBpm(buffer: AudioBuffer): number | undefined {
  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const frameSize = 1024;
  const hopSize = 512;
  const maxSamples = Math.min(channel.length, Math.floor(180 * sampleRate));
  const energies: number[] = [];
  for (let position = 0; position + frameSize <= maxSamples; position += hopSize) {
    let energy = 0;
    for (let index = 0; index < frameSize; index += 4) {
      const sample = channel[position + index];
      energy += sample * sample;
    }
    energies.push(Math.sqrt(energy / (frameSize / 4)));
  }
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
  return Math.round(60 * framesPerSecond / (bestLag + correction));
}
