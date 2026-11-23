import type { EffectSlotType, Track } from "../../types";

/** 이펙트 사슬이 비어 있는(옛 프로젝트) 트랙의 기본 순서 */
export const DEFAULT_EFFECT_ORDER: readonly EffectSlotType[] = ["eq", "comp", "delay", "reverb"];

/** 이펙트 자신의 켜기 값. 딜레이·리버브는 옛 프로젝트에서 없을 수 있다. */
function settingsEnabled(track: Pick<Track, "eq" | "compressor" | "delay" | "reverb">, type: EffectSlotType): boolean {
  if (type === "eq") return track.eq.enabled;
  if (type === "comp") return track.compressor.enabled;
  if (type === "delay") return track.delay?.enabled ?? false;
  return track.reverb?.enabled ?? false;
}

/** 트랙의 이펙트 순서: `effectChain`의 종류 순서(같은 종류는 처음 것만), 비어 있으면 기본 순서. */
export function effectOrder(track: Pick<Track, "effectChain">): EffectSlotType[] {
  const chain = track.effectChain?.length ? track.effectChain.map((slot) => slot.type) : DEFAULT_EFFECT_ORDER;
  return [...new Set(chain)];
}

/**
 * 이 이펙트가 지금 소리에 들어가는가: 사슬의 슬롯과 이펙트 자신의 켜기가 둘 다 켜져 있을 때.
 * 사슬이 비어 있으면(옛 프로젝트) 이펙트 자신의 켜기만 본다.
 */
export function isEffectActive(track: Pick<Track, "effectChain" | "eq" | "compressor" | "delay" | "reverb">, type: EffectSlotType): boolean {
  if (!settingsEnabled(track, type)) return false;
  if (!track.effectChain?.length) return true;
  return track.effectChain.some((slot) => slot.type === type && slot.enabled);
}
