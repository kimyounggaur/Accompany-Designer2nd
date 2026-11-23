import type { ReverbMode, ReverbSettings } from "../../types";

/** 같은 씨앗이면 늘 같은 수열을 내는 난수 생성기(0 이상 1 미만). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 문자열 → 32비트 정수(FNV-1a). 잔향 설정을 씨앗으로 바꾸는 데 쓴다. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type ImpulseSettings = Pick<ReverbSettings, "mode" | "decay" | "modEnabled" | "modAmount">;

/** 잔향의 모양을 정하는 값들. 이 값이 같으면 잔향도 같다(다른 노브는 잔향을 다시 만들지 않는다). */
export function impulseKey(settings: ImpulseSettings): string {
  return `${settings.mode}:${settings.decay}:${settings.modEnabled}:${settings.modAmount}`;
}

function decayCurve(mode: ReverbMode): number {
  if (mode === "room") return 1.35;
  if (mode === "hall") return 1.1;
  return 2.2;
}

function modeColor(mode: ReverbMode): number {
  if (mode === "room") return 0.74;
  if (mode === "hall") return 0.56;
  return 0.68;
}

/**
 * 잔향(임펄스 응답) 두 채널의 값. 씨앗은 `impulseKey`의 해시라서, 같은 설정이면 재생에서도 내보내기에서도 같은 잔향이 나온다.
 * 오디오 컨텍스트 없이 계산하므로 단위 시험에서 값을 직접 비교할 수 있다.
 */
export function createImpulseChannels(settings: ImpulseSettings, sampleRate: number): [Float32Array, Float32Array] {
  const length = Math.max(1, Math.floor(sampleRate * settings.decay));
  const random = mulberry32(hashString(impulseKey(settings)));
  const curve = decayCurve(settings.mode);
  const color = modeColor(settings.mode);
  const modDepth = settings.modEnabled ? settings.modAmount * 0.28 : 0;
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];

  for (let channel = 0; channel < 2; channel += 1) {
    const data = channels[channel];
    const phase = channel === 0 ? 0 : Math.PI * 0.43;
    let last = 0;
    for (let sample = 0; sample < length; sample += 1) {
      const progress = sample / length;
      const envelope = Math.pow(1 - progress, curve);
      const noise = random() * 2 - 1;
      const filtered = noise * color + last * (1 - color);
      const modulation = 1 + Math.sin(progress * Math.PI * 18 + phase) * modDepth;
      last = filtered;
      data[sample] = filtered * envelope * modulation * 0.72;
    }
  }
  return channels;
}

/** `createImpulseChannels`의 값을 오디오 버퍼에 담는다. */
export function createImpulseBuffer(context: BaseAudioContext, settings: ImpulseSettings): AudioBuffer {
  const [left, right] = createImpulseChannels(settings, context.sampleRate);
  const buffer = context.createBuffer(2, left.length, context.sampleRate);
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  return buffer;
}
