/**
 * 믹스 내보내기에서 마지막으로 고른 샘플레이트·비트 수를 이 브라우저에 기억한다.
 * 프로젝트 문서에는 넣지 않는다 — 내보내는 사람의 취향이라 파일을 열 때 바뀌면 안 된다.
 * 처음(기억이 없을 때)에는 프로젝트의 샘플레이트가 48 kHz면 48 kHz, 아니면 44.1 kHz에 16비트다.
 */
import { defaultSampleRateFor, normalizeExportOptions, type ExportOptions } from "../domain/export/exportOptions";

export const EXPORT_OPTIONS_STORAGE_KEY = "ad.exportOptions";

export function readExportOptions(projectSampleRate?: number): ExportOptions {
  const fallback: ExportOptions = { sampleRate: defaultSampleRateFor(projectSampleRate), bitDepth: 16 };
  try {
    const raw = window.localStorage.getItem(EXPORT_OPTIONS_STORAGE_KEY);
    return raw === null ? fallback : normalizeExportOptions(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function writeExportOptions(options: ExportOptions): void {
  try {
    window.localStorage.setItem(EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify(normalizeExportOptions(options)));
  } catch {
    /* 저장하지 못해도 이번 내보내기에서는 고른 값이 쓰인다 */
  }
}
