/**
 * WAV 파일 머리에서 길이를 읽는다(설계서 §P6-4): 소리를 풀기 전에 풀린 크기를 미리 알려고 한다.
 * 압축 파일(mp3·m4a 등)은 머리만으로 길이를 알 수 없어서 풀고 난 뒤에 확인한다.
 * 머리가 말하는 길이를 그대로 믿는다 — 머리만 큰 길이를 적은 파일도 큰 소리로 본다(파일 크기로 줄여 보지 않는다).
 */
import { decodedBytes } from "./budget";

/** 머리를 읽을 때 앞에서 가져올 바이트 수. fmt·data 조각이 이 안에 있어야 한다(보통 44바이트). */
export const WAV_HEAD_BYTES = 65_536;

export interface WavInfo {
  sampleRate: number;
  channels: number;
  /** 소리의 길이(샘플 수) */
  frames: number;
  /** 소리의 길이(초) */
  seconds: number;
}

/** 샘플 하나의 크기를 `blockAlign`으로 믿을 수 있는 형식: PCM · 실수 · A-law · µ-law · 확장 형식 */
const TRUSTED_FORMATS = new Set([0x0001, 0x0003, 0x0006, 0x0007, 0xfffe]);

const UNKNOWN_SIZE = 0xffffffff;

function tag(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

/**
 * 파일 앞부분(`head`)에서 WAV 정보를 읽는다. WAV가 아니거나, 읽을 수 없는 형식(ADPCM 같은 압축 WAV)이거나,
 * 앞부분 안에서 fmt·data 조각을 찾지 못하면 undefined(풀고 난 뒤에 확인하면 된다).
 * 파일 전체 크기(`fileBytes`)는 머리가 길이를 적지 않은 경우(0 또는 0xFFFFFFFF, 흘려보내며 만든 파일·RF64)에만 쓴다.
 */
export function readWavInfo(head: Uint8Array, fileBytes: number): WavInfo | undefined {
  if (head.length < 12) return undefined;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const magic = tag(view, 0);
  if ((magic !== "RIFF" && magic !== "RF64" && magic !== "BW64") || tag(view, 8) !== "WAVE") return undefined;
  const bigFile = magic !== "RIFF"; // RF64: 조각의 크기가 0xFFFFFFFF이고 진짜 크기는 따로 적힌다

  let format: { tag: number; channels: number; sampleRate: number; blockAlign: number } | undefined;
  let position = 12;
  while (position + 8 <= head.length) {
    const id = tag(view, position);
    const size = view.getUint32(position + 4, true);
    const body = position + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > head.length) return undefined;
      format = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
      };
    } else if (id === "data") {
      if (!format || !TRUSTED_FORMATS.has(format.tag)) return undefined;
      const { channels, sampleRate, blockAlign } = format;
      if (channels < 1 || channels > 64 || sampleRate < 1 || blockAlign < 1) return undefined;
      const sizeUnknown = bigFile || size === 0 || size === UNKNOWN_SIZE;
      const dataBytes = sizeUnknown ? Math.max(0, fileBytes - body) : size;
      const frames = Math.floor(dataBytes / blockAlign);
      return { sampleRate, channels, frames, seconds: frames / sampleRate };
    }
    position = body + size + (size & 1); // 조각은 짝수 바이트로 맞춰 둔다
  }
  return undefined;
}

/**
 * 이 WAV를 풀면 메모리에서 차지할 크기. 소리 장치의 샘플레이트로 맞춰 풀리므로(파일이 22kHz여도 장치가 48kHz면 48kHz로 풀린다)
 * 파일의 샘플레이트가 아니라 `outputRate`로 계산한다.
 */
export function estimateWavDecodedBytes(info: WavInfo, outputRate: number): number {
  return decodedBytes(info.seconds, outputRate, info.channels);
}
