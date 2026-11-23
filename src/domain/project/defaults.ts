/**
 * 문서의 기본값: 기본 트랙·기본 이펙트 값·빈 프로젝트.
 * 예전에는 `state/docDefaults.ts`와 `utils/delay.ts`·`utils/reverb.ts`에 나뉘어 있었다. 검사기(parseProject)가 빠진 값을 채울 때 같은 값을 쓴다.
 * React도 Web Audio도 쓰지 않는 순수한 값이다.
 */
import { createId } from "../../utils/audioMath";
import { MASTER_VOLUME_DEFAULT_DB } from "../master/volume";
import type {
  CompressorSettings,
  DelaySettings,
  EffectSlot,
  EffectSlotType,
  EqSettings,
  ProjectDoc,
  ReverbSettings,
  TimeSignature,
  Track,
} from "../types";
import { BPM_DEFAULT, SAMPLE_RATE_DEFAULT } from "./ranges";

export const DEFAULT_EFFECT_ORDER: EffectSlotType[] = ["eq", "comp", "delay", "reverb"];

export const DEFAULT_EQ_SETTINGS: EqSettings = {
  enabled: true,
  bassGain: 0,
  middleLowGain: 0,
  middleHighGain: 0,
  highGain: 0,
  presenceGain: 0,
};

export const DEFAULT_COMPRESSOR_SETTINGS: CompressorSettings = {
  enabled: false,
  threshold: -18,
  ratio: 3,
  attack: 0.012,
  release: 0.2,
};

export const DEFAULT_DELAY_SETTINGS: DelaySettings = {
  enabled: false,
  delayTimeMs: 375,
  feedback: 0.35,
  dry: 1,
  wet: 0.35,
  highCutHz: 8000,
  syncEnabled: false,
  syncDivision: "1/4",
  pingPong: false,
};

export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  enabled: false,
  mode: "plate",
  preDelayMs: 20,
  decay: 2.4,
  drive: 0.15,
  dry: 1,
  wet: 0.28,
  width: 0.8,
  highPassHz: 200,
  lowPassHz: 8000,
  modEnabled: false,
  modAmount: 0.15,
  postEqLowGain: 0,
  postEqMidGain: 0,
  postEqHighGain: 0,
};

export const DEFAULT_TRACK_VOLUME = 0.86;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, unit: 4 };

type EffectSettings = Pick<Track, "eq" | "compressor" | "delay" | "reverb">;

/** 이 종류의 이펙트가 지금 켜져 있는가(설정 쪽 `enabled`) */
export function effectEnabled(type: EffectSlotType, settings: EffectSettings): boolean {
  if (type === "eq") return settings.eq.enabled;
  if (type === "comp") return settings.compressor.enabled;
  if (type === "delay") return settings.delay.enabled;
  return settings.reverb.enabled;
}

/** 기본 순서(EQ → 컴프레서 → 딜레이 → 리버브)의 이펙트 슬롯 */
export function createDefaultEffectChain(settings: EffectSettings): EffectSlot[] {
  return DEFAULT_EFFECT_ORDER.map((type) => ({
    id: createId("fx"),
    type,
    enabled: effectEnabled(type, settings),
  }));
}

export function createDefaultTrack(index = 1): Track {
  const eq = { ...DEFAULT_EQ_SETTINGS };
  const compressor = { ...DEFAULT_COMPRESSOR_SETTINGS };
  const delay = { ...DEFAULT_DELAY_SETTINGS };
  const reverb = { ...DEFAULT_REVERB_SETTINGS };

  return {
    id: createId("track"),
    name: `트랙 ${index}`,
    volume: DEFAULT_TRACK_VOLUME,
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
    schemaVersion: 2,
    id: createId("project"),
    name: "새 세션",
    bpm: BPM_DEFAULT,
    timeSignature: { ...DEFAULT_TIME_SIGNATURE },
    sampleRate: SAMPLE_RATE_DEFAULT,
    master: { volumeDb: MASTER_VOLUME_DEFAULT_DB },
    tracks: [createDefaultTrack(1)],
    assets: {},
    markers: [],
  };
}
