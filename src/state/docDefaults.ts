/**
 * 문서의 기본값과 보정 함수.
 * 예전에는 store/useDawStore.ts 안에 있었다. P4-1(문서 형식 v2와 검사기 하나)에서 domain/project/로 합친다.
 */
import type { Clip, EffectSlot, EffectSlotType, ProjectDoc, Track } from "../types";
import { clamp, createId } from "../utils/audioMath";
import { DEFAULT_DELAY_SETTINGS, normalizeDelaySettings } from "../utils/delay";
import { DEFAULT_REVERB_SETTINGS, normalizeReverbSettings } from "../utils/reverb";

type LegacyEqSettings = Partial<Track["eq"]> & {
  lowGain?: number;
  midGain?: number;
};

export const DEFAULT_EFFECT_ORDER: EffectSlotType[] = ["eq", "comp", "delay", "reverb"];

type EffectSettings = Pick<Track, "eq" | "compressor" | "delay" | "reverb">;

function effectEnabled(type: EffectSlotType, settings: EffectSettings) {
  if (type === "eq") return settings.eq.enabled;
  if (type === "comp") return settings.compressor.enabled;
  if (type === "delay") return settings.delay.enabled;
  return settings.reverb.enabled;
}

function createDefaultEffectChain(settings: EffectSettings): EffectSlot[] {
  return DEFAULT_EFFECT_ORDER.map((type) => ({
    id: createId("fx"),
    type,
    enabled: effectEnabled(type, settings),
  }));
}

export function createDefaultTrack(index = 1): Track {
  const eq = {
    enabled: true,
    bassGain: 0,
    middleLowGain: 0,
    middleHighGain: 0,
    highGain: 0,
    presenceGain: 0,
  };
  const compressor = {
    enabled: false,
    threshold: -18,
    ratio: 3,
    attack: 0.012,
    release: 0.2,
  };
  const delay = { ...DEFAULT_DELAY_SETTINGS };
  const reverb = { ...DEFAULT_REVERB_SETTINGS };

  return {
    id: createId("track"),
    name: `트랙 ${index}`,
    volume: 0.86,
    pan: 0,
    muted: false,
    solo: false,
    eq,
    compressor,
    delay,
    reverb,
    effectChain: createDefaultEffectChain({ eq, compressor, delay, reverb }),
    clips: [],
  };
}

/** 빈 프로젝트 문서(트랙 1개) */
export function createEmptyDoc(): ProjectDoc {
  return {
    id: createId("project"),
    name: "새 세션",
    bpm: 120,
    sampleRate: 44100,
    tracks: [createDefaultTrack(1)],
    audioAssets: {},
    timeMarkers: [],
  };
}

function normalizeClip(clip: Clip): Clip {
  return {
    ...clip,
    fadeIn: clamp(clip.fadeIn ?? 0, 0, Math.max(0, clip.duration / 2)),
    fadeOut: clamp(clip.fadeOut ?? 0, 0, Math.max(0, clip.duration / 2)),
    fadeCurve: clip.fadeCurve ?? "equalPower",
  };
}

function normalizeEqSettings(eq: LegacyEqSettings | undefined, fallback: Track["eq"]): Track["eq"] {
  return {
    ...fallback,
    ...eq,
    enabled: eq?.enabled ?? fallback.enabled,
    bassGain: clamp(eq?.bassGain ?? eq?.lowGain ?? fallback.bassGain, -12, 12),
    middleLowGain: clamp(eq?.middleLowGain ?? eq?.midGain ?? fallback.middleLowGain, -12, 12),
    middleHighGain: clamp(eq?.middleHighGain ?? eq?.midGain ?? fallback.middleHighGain, -12, 12),
    highGain: clamp(eq?.highGain ?? fallback.highGain, -12, 12),
    presenceGain: clamp(eq?.presenceGain ?? fallback.presenceGain, -12, 12),
  };
}

function normalizeEffectChain(track: Track, fallback: EffectSlot[]): EffectSlot[] {
  const existingSlots = Array.isArray(track.effectChain) ? track.effectChain : [];
  const settings = { eq: track.eq, compressor: track.compressor, delay: track.delay, reverb: track.reverb };
  const byType = new Map<EffectSlotType, EffectSlot>();

  for (const slot of existingSlots) {
    if (DEFAULT_EFFECT_ORDER.includes(slot.type) && !byType.has(slot.type)) {
      byType.set(slot.type, {
        id: slot.id || createId("fx"),
        type: slot.type,
        enabled: slot.enabled ?? effectEnabled(slot.type, settings),
      });
    }
  }

  const orderedTypes = [
    ...existingSlots
      .map((slot) => slot.type)
      .filter((type): type is EffectSlotType => DEFAULT_EFFECT_ORDER.includes(type)),
    ...DEFAULT_EFFECT_ORDER,
  ];
  const seen = new Set<EffectSlotType>();

  return orderedTypes
    .filter((type) => {
      if (seen.has(type)) return false;
      seen.add(type);
      return true;
    })
    .map((type) => {
      const fallbackSlot = fallback.find((slot) => slot.type === type);
      return byType.get(type) ?? {
        id: fallbackSlot?.id || createId("fx"),
        type,
        enabled: effectEnabled(type, settings),
      };
    });
}

/** 불러온 트랙에 빠진 값을 기본값으로 채우고 범위를 보정한다. */
export function normalizeTrack(track: Track, index: number): Track {
  const fallback = createDefaultTrack(index + 1);
  const eq = normalizeEqSettings(track.eq, fallback.eq);
  const compressor = { ...fallback.compressor, ...track.compressor };
  const delay = normalizeDelaySettings(track.delay);
  const reverb = normalizeReverbSettings(track.reverb);
  const normalizedTrack = { ...fallback, ...track, eq, compressor, delay, reverb };

  return {
    ...normalizedTrack,
    effectChain: normalizeEffectChain(normalizedTrack, fallback.effectChain),
    clips: (track.clips ?? []).map(normalizeClip),
  };
}
