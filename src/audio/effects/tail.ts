import type { DelaySettings, EffectSlotType, ReverbSettings, Track } from "../../domain/types";
import { getDelayTimeMs, normalizeDelaySettings } from "../../utils/delay";
import { normalizeReverbSettings } from "../../utils/reverb";
import { isEffectActive } from "./chain";

/** 내보내기·곡 끝에서 이펙트 꼬리를 기다리는 최대 길이(초). 피드백이 큰 딜레이가 끝없이 이어지지 않게 한다. */
export const MAX_TAIL_SECONDS = 30;

/** 딜레이: 딜레이 시간 × (반복이 0.001 아래로 줄 때까지의 횟수). 피드백이 0이어도 한 번은 울린다. */
export function delayTailSeconds(delay: DelaySettings | undefined, bpm: number): number {
  if (!delay) return 0;
  const value = normalizeDelaySettings(delay);
  const repeats = value.feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(value.feedback)) : 1;
  return (getDelayTimeMs(value, bpm) / 1000) * repeats;
}

/** 리버브: 프리딜레이 + 잔향 길이 */
export function reverbTailSeconds(reverb: ReverbSettings | undefined): number {
  if (!reverb) return 0;
  const value = normalizeReverbSettings(reverb);
  return value.decay + value.preDelayMs / 1000;
}

/** 이펙트 하나의 꼬리(초). EQ·컴프레서는 입력이 끊기면 바로 조용해진다. */
export function effectTailSeconds(track: Track, type: EffectSlotType, bpm: number): number {
  if (!isEffectActive(track, type)) return 0;
  if (type === "delay") return delayTailSeconds(track.delay, bpm);
  if (type === "reverb") return reverbTailSeconds(track.reverb);
  return 0;
}

/** 트랙의 꼬리: 딜레이 뒤에 리버브가 오면 두 꼬리가 이어지므로 켜진 이펙트의 꼬리를 더한다. 제한 없음. */
export function trackTailSeconds(track: Track, bpm: number): number {
  return (["delay", "reverb"] as const).reduce((sum, type) => sum + effectTailSeconds(track, type, bpm), 0);
}

/** 곡 전체의 꼬리(초): 트랙 꼬리 중 가장 긴 것을 `MAX_TAIL_SECONDS`까지만. */
export function projectTailSeconds(project: { bpm: number; tracks: readonly Track[] }): number {
  const longest = project.tracks.reduce((max, track) => Math.max(max, trackTailSeconds(track, project.bpm)), 0);
  return Math.min(MAX_TAIL_SECONDS, longest);
}
