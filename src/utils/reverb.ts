import { DEFAULT_REVERB_SETTINGS } from "../domain/project/defaults";
import type { ReverbMode, ReverbSettings } from "../domain/types";
import { ko } from "../i18n/ko";
import { clamp } from "./audioMath";

const REVERB_MODES: ReverbMode[] = ["plate", "room", "hall"];

export const REVERB_MODE_OPTIONS: Array<{
  value: ReverbMode;
  label: string;
}> = [
  { value: "plate", label: ko.reverb.modes.plate },
  { value: "room", label: ko.reverb.modes.room },
  { value: "hall", label: ko.reverb.modes.hall },
];

export function normalizeReverbSettings(
  reverb?: Partial<ReverbSettings>,
): ReverbSettings {
  const mode = REVERB_MODES.includes(reverb?.mode as ReverbMode)
    ? (reverb?.mode as ReverbMode)
    : DEFAULT_REVERB_SETTINGS.mode;

  return {
    ...DEFAULT_REVERB_SETTINGS,
    ...reverb,
    mode,
    preDelayMs: clamp(
      reverb?.preDelayMs ?? DEFAULT_REVERB_SETTINGS.preDelayMs,
      0,
      250,
    ),
    decay: clamp(reverb?.decay ?? DEFAULT_REVERB_SETTINGS.decay, 0.2, 12),
    drive: clamp(reverb?.drive ?? DEFAULT_REVERB_SETTINGS.drive, 0, 1),
    dry: clamp(reverb?.dry ?? DEFAULT_REVERB_SETTINGS.dry, 0, 1),
    wet: clamp(reverb?.wet ?? DEFAULT_REVERB_SETTINGS.wet, 0, 1),
    width: clamp(reverb?.width ?? DEFAULT_REVERB_SETTINGS.width, 0, 1),
    highPassHz: clamp(
      reverb?.highPassHz ?? DEFAULT_REVERB_SETTINGS.highPassHz,
      20,
      2000,
    ),
    lowPassHz: clamp(
      reverb?.lowPassHz ?? DEFAULT_REVERB_SETTINGS.lowPassHz,
      1000,
      20000,
    ),
    modAmount: clamp(
      reverb?.modAmount ?? DEFAULT_REVERB_SETTINGS.modAmount,
      0,
      1,
    ),
    postEqLowGain: clamp(
      reverb?.postEqLowGain ?? DEFAULT_REVERB_SETTINGS.postEqLowGain,
      -12,
      12,
    ),
    postEqMidGain: clamp(
      reverb?.postEqMidGain ?? DEFAULT_REVERB_SETTINGS.postEqMidGain,
      -12,
      12,
    ),
    postEqHighGain: clamp(
      reverb?.postEqHighGain ?? DEFAULT_REVERB_SETTINGS.postEqHighGain,
      -12,
      12,
    ),
  };
}
