export function encodeWav(
  chunks: Float32Array[],
  sampleRate: number,
  channels = 1,
) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + sampleCount * bytesPerSample);
  const view = new DataView(buffer);
  let offset = 0;

  writeString(view, offset, "RIFF");
  offset += 4;
  view.setUint32(offset, 36 + sampleCount * bytesPerSample, true);
  offset += 4;
  writeString(view, offset, "WAVE");
  offset += 4;
  writeString(view, offset, "fmt ");
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString(view, offset, "data");
  offset += 4;
  view.setUint32(offset, sampleCount * bytesPerSample, true);
  offset += 4;

  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/** WAV 머리말 크기(바이트) */
export const WAV_HEADER_BYTES = 44;

/** 16비트 또는 24비트 PCM WAV 파일의 크기(바이트) */
export function wavByteLength(frames: number, bitDepth: 16 | 24, channels = 2): number {
  return WAV_HEADER_BYTES + frames * channels * (bitDepth / 8);
}

/** 부동소수점 샘플(−1~1)을 정수로: 범위 밖은 ±1로 자르고, 가까운 정수로 반올림한다. 숫자가 아닌 값은 0. */
function quantize(sample: number, negativeScale: number, positiveScale: number): number {
  const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
  const scaled = Math.round(clamped < 0 ? clamped * negativeScale : clamped * positiveScale);
  return scaled === scaled ? scaled : 0;
}

/**
 * 채널별 샘플(−1~1)을 16비트 또는 24비트 PCM WAV로 만든다(믹스 내보내기, P3-6). 화면 스레드를 막지 않게 Worker에서 부른다.
 * 디더링은 하지 않는다: 같은 입력이면 늘 같은 바이트가 나와야 파일 해시로 같은 소리인지 비교할 수 있다.
 * 채널 길이가 다르면 가장 짧은 쪽에 맞춘다.
 */
export function encodePcmWav(channels: readonly Float32Array[], sampleRate: number, bitDepth: 16 | 24): ArrayBuffer {
  const channelCount = channels.length;
  const frames = channelCount ? Math.min(...channels.map((channel) => channel.length)) : 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frames * blockAlign;
  if (WAV_HEADER_BYTES - 8 + dataBytes > 0xffffffff) throw new RangeError("WAV 파일이 4 GB를 넘습니다.");
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  if (bitDepth === 16) {
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        view.setInt16(offset, quantize(channels[channel][frame], 0x8000, 0x7fff), true);
        offset += 2;
      }
    }
  } else {
    const bytes = new Uint8Array(buffer);
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const value = quantize(channels[channel][frame], 0x800000, 0x7fffff);
        bytes[offset] = value & 0xff;
        bytes[offset + 1] = (value >> 8) & 0xff;
        bytes[offset + 2] = (value >> 16) & 0xff;
        offset += 3;
      }
    }
  }
  return buffer;
}
