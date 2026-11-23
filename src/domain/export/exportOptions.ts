/**
 * 믹스 WAV 내보내기 옵션(설계 P3-6): 샘플레이트 44.1/48 kHz, 비트 수 16/24.
 * 화면 없이 시험할 수 있는 순수 값과 함수만 둔다. 기기에 기억하는 일은 services/exportSettings.ts가 한다.
 */

export const EXPORT_SAMPLE_RATES = [44100, 48000] as const;
export const EXPORT_BIT_DEPTHS = [16, 24] as const;

export type ExportSampleRate = (typeof EXPORT_SAMPLE_RATES)[number];
export type ExportBitDepth = (typeof EXPORT_BIT_DEPTHS)[number];

export interface ExportOptions {
  sampleRate: ExportSampleRate;
  bitDepth: ExportBitDepth;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { sampleRate: 44100, bitDepth: 16 };

/** 이보다 긴 곡은 내보내지 않는다(초). 한 시간짜리 스테레오 float 결과가 이미 1 GB를 넘는다. */
export const MAX_EXPORT_SECONDS = 3600;

/** 처음 보여 줄 샘플레이트: 프로젝트가 48 kHz면 48 kHz, 그 밖에는 44.1 kHz */
export function defaultSampleRateFor(projectSampleRate: number | undefined): ExportSampleRate {
  return projectSampleRate === 48000 ? 48000 : 44100;
}

/** 저장해 둔 값이나 화면에서 온 값을 허용된 옵션으로 맞춘다. 알 수 없는 값은 `fallback`의 값을 쓴다. */
export function normalizeExportOptions(raw: unknown, fallback: ExportOptions = DEFAULT_EXPORT_OPTIONS): ExportOptions {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sampleRate = EXPORT_SAMPLE_RATES.find((rate) => rate === source.sampleRate) ?? fallback.sampleRate;
  const bitDepth = EXPORT_BIT_DEPTHS.find((bits) => bits === source.bitDepth) ?? fallback.bitDepth;
  return { sampleRate, bitDepth };
}
