export function estimateBpm(buffer: AudioBuffer) {
  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const analysisSeconds = Math.min(buffer.duration, 180);
  const maxSamples = Math.floor(analysisSeconds * sampleRate);
  const frameSize = 2048;
  const hopSize = 1024;
  const energies: number[] = [];

  for (let position = 0; position + frameSize < maxSamples; position += hopSize) {
    let energy = 0;
    for (let index = 0; index < frameSize; index += 4) {
      const sample = channel[position + index];
      energy += sample * sample;
    }
    energies.push(energy / (frameSize / 4));
  }

  if (energies.length < 32) {
    return undefined;
  }

  const flux: number[] = [];
  for (let index = 1; index < energies.length; index += 1) {
    flux.push(Math.max(0, energies[index] - energies[index - 1]));
  }

  const mean = flux.reduce((sum, value) => sum + value, 0) / flux.length;
  const envelope = flux.map((value) => Math.max(0, value - mean));
  const minBpm = 70;
  const maxBpm = 180;
  const minLag = Math.max(1, Math.round((60 / maxBpm) * (sampleRate / hopSize)));
  const maxLag = Math.round((60 / minBpm) * (sampleRate / hopSize));
  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = 0; index + lag < envelope.length; index += 1) {
      score += envelope[index] * envelope[index + lag];
    }

    const normalizedScore = score / Math.max(1, envelope.length - lag);
    if (normalizedScore > bestScore) {
      bestScore = normalizedScore;
      bestLag = lag;
    }
  }

  if (!bestLag || !Number.isFinite(bestScore) || bestScore <= 0) {
    return undefined;
  }

  return Math.round((60 * sampleRate) / (bestLag * hopSize));
}
