import type { DelaySettings, DelaySyncDivision } from "../types";
import { clamp } from "./audioMath";

export const DELAY_SYNC_OPTIONS: Array<{
  value: DelaySyncDivision;
  label: string;
}> = [
  { value: "1/1", label: "1/1" },
  { value: "1/2", label: "1/2" },
  { value: "1/4", label: "1/4" },
  { value: "1/8", label: "1/8" },
  { value: "1/16", label: "1/16" },
  { value: "1/8d", label: "Dotted 1/8" },
  { value: "1/8t", label: "Triplet 1/8" },
];

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

const SYNC_BEAT_MULTIPLIERS: Record<DelaySyncDivision, number> = {
  "1/1": 4,
  "1/2": 2,
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/8d": 0.75,
  "1/8t": 1 / 3,
};

export function normalizeDelaySettings(
  delay?: Partial<DelaySettings>,
): DelaySettings {
  return {
    ...DEFAULT_DELAY_SETTINGS,
    ...delay,
    delayTimeMs: clamp(delay?.delayTimeMs ?? DEFAULT_DELAY_SETTINGS.delayTimeMs, 1, 2000),
    feedback: clamp(delay?.feedback ?? DEFAULT_DELAY_SETTINGS.feedback, 0, 0.95),
    dry: clamp(delay?.dry ?? DEFAULT_DELAY_SETTINGS.dry, 0, 1),
    wet: clamp(delay?.wet ?? DEFAULT_DELAY_SETTINGS.wet, 0, 1),
    highCutHz: clamp(delay?.highCutHz ?? DEFAULT_DELAY_SETTINGS.highCutHz, 1000, 20000),
  };
}

export function getDelayTimeMs(delay: DelaySettings, bpm: number) {
  if (!delay.syncEnabled) {
    return clamp(delay.delayTimeMs, 1, 2000);
  }

  const beatMs = 60000 / clamp(bpm || 120, 20, 300);
  const multiplier = SYNC_BEAT_MULTIPLIERS[delay.syncDivision] ?? 1;
  return clamp(beatMs * multiplier, 1, 2000);
}
