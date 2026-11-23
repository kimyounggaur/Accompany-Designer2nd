/**
 * 파형 점(음원의 크기를 1,800칸으로 줄인 0~1 값). 문서에는 담지 않고 음원을 풀 때마다 만든다.
 * 4단계 P4-3에서 다단계 파형(Worker + 저장소 캐시)으로 바뀐다.
 */
export interface PeakSource {
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export function createWaveformPeaks(buffer: PeakSource, targetPeaks = 1800): number[] {
  const peaks: number[] = [];
  const channelCount = buffer.numberOfChannels;
  const samplesPerPeak = Math.max(1, Math.floor(buffer.length / targetPeaks));
  const peakCount = Math.ceil(buffer.length / samplesPerPeak);
  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const start = peakIndex * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, buffer.length);
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      for (const channel of channels) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex]));
      }
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / maxPeak);
}
