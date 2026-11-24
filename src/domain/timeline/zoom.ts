/**
 * 타임라인 확대 범위(설계서 §P4-3).
 * 아래쪽 끝은 프로젝트 전체가 화면 폭에 들어가는 배율("전체 보기", Shift+0)이고, 위쪽 끝은 1,000px/초다.
 * 짧은 곡에서는 전체 보기 배율이 기본 배율(96px/초)보다도 커져서 더 줄일 수 없게 되므로, 아래쪽 끝은 지금까지의 1px/초와 전체 보기 배율 중 작은 쪽으로 둔다
 * (곡이 길어 1px/초로도 화면에 다 안 들어올 때만 1px/초 아래로 내려간다).
 */

/** 가장 크게 확대한 배율(px/초). 이때 픽셀 하나는 약 44샘플(44.1kHz)이라 파형은 원본 샘플을 직접 읽는다. */
export const MAX_ZOOM = 1000;
/** 짧은 곡의 아래쪽 끝(옛 값 그대로) */
export const BASE_MIN_ZOOM = 1;
/** 이보다 작게는 줄이지 않는다(24시간 곡도 1,440px에 들어가는 값보다 작다) */
export const ABSOLUTE_MIN_ZOOM = 0.01;
/** 전체 보기가 오른쪽 끝에 남기는 여백(px) */
export const FIT_MARGIN_PX = 24;

/** 프로젝트 전체(`projectSeconds`초)가 `viewportWidth`px 안에 들어가는 배율. 알 수 없으면 undefined. */
export function fitZoom(projectSeconds: number, viewportWidth: number): number | undefined {
  if (!(projectSeconds > 0) || !(viewportWidth > FIT_MARGIN_PX)) return undefined;
  return (viewportWidth - FIT_MARGIN_PX) / projectSeconds;
}

/** 지금 프로젝트에서 줄일 수 있는 가장 작은 배율 */
export function minZoomFor(projectSeconds: number, viewportWidth: number): number {
  const fit = fitZoom(projectSeconds, viewportWidth);
  const min = fit === undefined ? BASE_MIN_ZOOM : Math.min(BASE_MIN_ZOOM, fit);
  return Math.max(ABSOLUTE_MIN_ZOOM, min);
}

/** 배율을 허용 범위로 자른다. 숫자가 아니면 아래쪽 끝. */
export function clampZoom(zoom: number, minZoom: number = BASE_MIN_ZOOM): number {
  if (!Number.isFinite(zoom)) return minZoom;
  return Math.min(MAX_ZOOM, Math.max(minZoom, zoom));
}

/** "전체 보기"의 배율: 프로젝트 전체가 화면 폭에 들어가는 값(범위 안으로 자름). 화면 폭을 모르면 undefined. */
export function zoomToFitValue(projectSeconds: number, viewportWidth: number): number | undefined {
  const fit = fitZoom(projectSeconds, viewportWidth);
  if (fit === undefined) return undefined;
  return clampZoom(fit, minZoomFor(projectSeconds, viewportWidth));
}
