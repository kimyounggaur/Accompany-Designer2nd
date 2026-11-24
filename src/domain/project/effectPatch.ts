/**
 * 이펙트 설정 한 칸(이퀄라이저·컴프레서·딜레이·리버브)을 고치는 변경을 만든다.
 * 켜고 끄는 값(`enabled`)이 들어 있으면 이펙트 사슬(`effectChain`)의 같은 종류 슬롯도 함께 바꿔, 두 곳이 어긋나지 않게 한다.
 * 예전에는 Inspector 안에 네 벌로 복사되어 있었다. React도 스토어도 쓰지 않는 순수한 함수다.
 */
import type { EffectSlotType, Track } from "../types";

export type EffectSettingsKey = "eq" | "compressor" | "delay" | "reverb";

/** 설정 이름 → 이펙트 사슬 슬롯 종류(컴프레서만 이름이 다르다) */
const SLOT_TYPE: Readonly<Record<EffectSettingsKey, EffectSlotType>> = {
  eq: "eq",
  compressor: "comp",
  delay: "delay",
  reverb: "reverb",
};

/** `updateTrack`에 넘기는 트랙 변경(클립은 건드리지 않는다) */
export type TrackPatch = Partial<Omit<Track, "clips">>;

export function effectPatch<K extends EffectSettingsKey>(track: Track, key: K, patch: Partial<Track[K]>): TrackPatch {
  const settings = { ...track[key], ...patch };
  const enabled = (patch as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") return { [key]: settings };

  const type = SLOT_TYPE[key];
  return {
    [key]: settings,
    effectChain: track.effectChain.map((slot) => (slot.type === type ? { ...slot, enabled } : slot)),
  };
}
