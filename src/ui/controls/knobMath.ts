/**
 * 노브의 값 계산. 화면·스토어를 모르는 순수한 함수들이다.
 * 끌기·키보드·더블클릭이 모두 여기서 값을 얻으므로, 모양이 다른 노브도 같은 약속으로 움직인다(설계서 §P5-0).
 *
 * - 위로 180px 끌면 전체 범위를 지난다. Shift를 누르면 1/10(미세 조정).
 * - 키보드 ←↓ 한 칸 내림, →↑ 한 칸 올림, PageUp·PageDown 10칸, Home·End 최소·최대. 한 칸은 `step`, 없으면 범위의 1/100.
 * - `curve: "log"`는 위치와 값이 로그 관계다(주파수 노브). 값은 0보다 커야 하고, 아니면 직선으로 다룬다.
 * - 값은 `step`의 배수로 맞춘다. 배수는 0을 기준으로 센다(최솟값 기준이 아님): 0.001 ~ 1 범위에서 0.01 간격이면 0.001, 0.01, 0.02, …
 */

export type KnobCurve = "linear" | "log";

/** 위로 이만큼(px) 끌면 전체 범위를 지난다 */
export const KNOB_DRAG_PX = 180;
/** Shift를 누른 채 끌 때의 배율(미세 조정) */
export const KNOB_FINE_FACTOR = 0.1;
/** PageUp·PageDown이 한 번에 가는 칸 수 */
export const KNOB_PAGE_STEPS = 10;
/** 한 칸을 정하지 않았을 때 범위를 나누는 개수 */
export const KNOB_DEFAULT_STEPS = 100;

/** 이 노브의 위치가 로그 눈금인가. 최솟값이 0 이하이면 로그를 쓸 수 없어 직선으로 본다. */
function isLog(min: number, max: number, curve: KnobCurve | undefined): boolean {
  return curve === "log" && min > 0 && max > min;
}

export function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 값 → 위치(0~1). 범위 밖의 값은 끝으로 본다. */
export function toNormalized(value: number, min: number, max: number, curve?: KnobCurve): number {
  if (!(max > min)) return 0;
  const clamped = clampValue(value, min, max);
  if (isLog(min, max, curve)) return Math.log(clamped / min) / Math.log(max / min);
  return (clamped - min) / (max - min);
}

/** 위치(0~1) → 값. 범위 밖의 위치는 끝으로 본다. */
export function fromNormalized(norm: number, min: number, max: number, curve?: KnobCurve): number {
  if (!(max > min)) return min;
  const n = Math.min(1, Math.max(0, Number.isFinite(norm) ? norm : 0));
  if (isLog(min, max, curve)) return min * Math.pow(max / min, n);
  return min + n * (max - min);
}

/** 소수 자리 수(0.5 → 1, 0.01 → 2, 100 → 0). 지수 표기(1e-7)도 읽는다. */
export function decimalPlaces(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Number(exponent[1]) + (text.split("e")[0].split(".")[1]?.length ?? 0);
  return text.split(".")[1]?.length ?? 0;
}

/** 부동소수 찌꺼기(0.30000000000000004)를 걷어 낸다 */
export function roundTo(value: number, places: number): number {
  return Number(value.toFixed(Math.min(12, Math.max(0, places))));
}

/** 값을 `step`의 배수로 맞추고 범위 안에 둔다. `step`이 없으면 범위만 맞춘다. */
export function snapToStep(value: number, step: number | undefined, min: number, max: number): number {
  const clamped = clampValue(value, min, max);
  if (step === undefined || !(step > 0)) return clamped;
  const snapped = roundTo(Math.round(clamped / step) * step, decimalPlaces(step));
  return clampValue(snapped, min, max);
}

export interface KnobRange {
  min: number;
  max: number;
  step?: number;
  curve?: KnobCurve;
}

/**
 * 끌어서 얻는 값. `startNorm`은 누른 순간의 위치, `deltaPx`는 위로 움직인 거리(아래로면 음수).
 * 누른 순간에서 계산하므로 끄는 동안 반올림 오차가 쌓이지 않는다.
 */
export function dragValue(args: KnobRange & { startNorm: number; deltaPx: number; fine?: boolean }): number {
  const factor = args.fine ? KNOB_FINE_FACTOR : 1;
  const norm = args.startNorm + (args.deltaPx / KNOB_DRAG_PX) * factor;
  return snapToStep(fromNormalized(norm, args.min, args.max, args.curve), args.step, args.min, args.max);
}

/** 키보드 한 번에 얻는 값. 노브가 쓰지 않는 키면 undefined. */
export function keyboardValue(args: KnobRange & { key: string; value: number }): number | undefined {
  const { key, value, min, max, step, curve } = args;
  if (key === "Home") return min;
  if (key === "End") return max;

  let direction: 1 | -1;
  let steps = 1;
  if (key === "ArrowUp" || key === "ArrowRight") direction = 1;
  else if (key === "ArrowDown" || key === "ArrowLeft") direction = -1;
  else if (key === "PageUp") { direction = 1; steps = KNOB_PAGE_STEPS; }
  else if (key === "PageDown") { direction = -1; steps = KNOB_PAGE_STEPS; }
  else return undefined;

  const linearStep = step !== undefined && step > 0 ? step : (max - min) / KNOB_DEFAULT_STEPS;
  const linear = snapToStep(value + direction * linearStep * steps, step, min, max);
  if (!isLog(min, max, curve)) return linear;

  // 로그 눈금은 위치를 1/100씩 옮긴다. 값이 성긴 격자(낮은 주파수의 10Hz 간격 등)에 걸려 안 움직이면 한 칸 옮긴다.
  const moved = snapToStep(
    fromNormalized(toNormalized(value, min, max, curve) + (direction * steps) / KNOB_DEFAULT_STEPS, min, max, curve),
    step, min, max,
  );
  return moved === clampValue(value, min, max) ? linear : moved;
}
