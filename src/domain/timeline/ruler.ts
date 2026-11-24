/**
 * 눈금자 표시 계획. 곡이 길어 한 박이 1px보다 좁아지는 확대 배율(전체 보기)에서도 눈금 칸 수가 폭에 비례해 늘지 않게 솎는다.
 * 보통 배율(한 박이 6px 이상)에서는 박(4분음표)마다 눈금을 두고 마디마다 번호를 붙인다.
 * 한 마디의 박 수는 박자표가 정한다(4/4 = 4, 3/4 = 3, 2/4 = 2, 6/8 = 3 — `quarterBeatsPerBar`). 정하지 않으면 4박이다.
 */

/** 눈금 사이의 가장 좁은 간격(px) */
export const MIN_TICK_SPACING_PX = 6;
/** 마디 번호 사이의 가장 좁은 간격(px) */
export const MIN_LABEL_SPACING_PX = 32;

export interface RulerTick {
  /** 박 번호(0부터) */
  readonly beat: number;
  /** 눈금자 왼쪽 끝에서 px */
  readonly left: number;
  /** 마디 번호(없으면 빈 문자열) */
  readonly label: string;
}

/** 두 수가 정수배 관계인가(소수 계산의 어긋남을 흡수) */
function isMultipleOf(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9 * Math.max(1, Math.abs(ratio));
}

function ceilPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export interface RulerPlan {
  readonly ticks: readonly RulerTick[];
  /** 눈금 사이의 박 수 */
  readonly tickEvery: number;
  /** 번호 사이의 박 수(한 마디 박 수의 배수) */
  readonly labelEvery: number;
}

/** 눈금을 실제로 그려 둘 가로 범위(눈금자 왼쪽 끝에서 px). 한 시간 곡처럼 긴 눈금자에서 화면 근처 눈금만 DOM에 둔다. */
export interface RulerWindow {
  readonly fromPx: number;
  readonly toPx: number;
}

/**
 * 눈금 계획. `range`를 주면 그 범위 안의 눈금만 만든다(눈금 위치와 번호는 범위 없이 만든 것과 똑같다).
 * 범위가 없으면 눈금자 전체. `beatsPerBar`는 한 마디의 박(4분음표) 수다(기본 4, 박자표에 따라 2·3·4, 3/8처럼 소수도 가능).
 */
export function planRulerTicks(
  beatSeconds: number,
  zoomPxPerSecond: number,
  visibleSeconds: number,
  range?: RulerWindow,
  beatsPerBar = 4,
): RulerPlan {
  const bar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  const beatWidth = beatSeconds * zoomPxPerSecond;
  if (!(beatWidth > 0) || !(visibleSeconds > 0)) return { ticks: [], tickEvery: 1, labelEvery: bar };
  const tickEvery = ceilPowerOfTwo(MIN_TICK_SPACING_PX / beatWidth);
  // 번호는 마디 단위로 솎는다: 마디 수가 1·2·4·8…이 되게, 번호 사이가 32px 이상이 되게.
  const labelEvery = bar * ceilPowerOfTwo(MIN_LABEL_SPACING_PX / (bar * beatWidth));
  const totalBeats = Math.ceil(visibleSeconds / beatSeconds);
  const first = range ? Math.max(0, Math.ceil(range.fromPx / beatWidth / tickEvery) * tickEvery) : 0;
  const last = range ? Math.min(totalBeats, Math.floor(range.toPx / beatWidth)) : totalBeats;
  const ticks: RulerTick[] = [];
  for (let beat = first; beat <= last; beat += tickEvery) {
    ticks.push({ beat, left: beat * beatWidth, label: isMultipleOf(beat, labelEvery) ? String(Math.round(beat / bar) + 1) : "" });
  }
  if (!Number.isInteger(bar)) {
    // 마디 시작이 박 위에 놓이지 않는 박자표(3/8·7/8 …): 눈금 칸에 걸리지 않는 번호 눈금은 따로 더한다.
    const from = range ? Math.max(0, range.fromPx / beatWidth) : 0;
    for (let n = Math.ceil(from / labelEvery - 1e-9); n * labelEvery <= last + 1e-9; n += 1) {
      const beat = n * labelEvery;
      if (Number.isInteger(beat) && beat >= first && isMultipleOf(beat, tickEvery)) continue; // 위에서 이미 만들었다
      ticks.push({ beat, left: beat * beatWidth, label: String(Math.round(beat / bar) + 1) });
    }
    ticks.sort((a, b) => a.beat - b.beat);
  }
  return { ticks, tickEvery, labelEvery };
}

/** 눈금을 그려 둘 범위가 처음 정해지기 전에 쓰는 범위(px) */
export const INITIAL_RULER_WINDOW: RulerWindow = { fromPx: 0, toPx: 3000 };

/**
 * 스크롤·폭이 바뀌었을 때 눈금 범위를 정한다. 보이는 곳 양옆에 화면 폭만큼(적어도 600px) 여유를 두고,
 * 보이는 곳이 여유의 절반 안으로 들어올 때까지는 범위를 그대로 둔다(스크롤할 때마다 다시 그리지 않는다).
 */
export function nextRulerWindow(current: RulerWindow, scrollLeft: number, viewportWidth: number): RulerWindow {
  const from = Math.max(0, scrollLeft);
  const to = from + Math.max(0, viewportWidth);
  const margin = Math.max(viewportWidth, 600);
  // 왼쪽 끝(0)에 이미 닿아 있으면 왼쪽은 더 늘릴 필요가 없다.
  const leftOk = current.fromPx === 0 || from - margin / 2 >= current.fromPx;
  const rightOk = to + margin / 2 <= current.toPx;
  if (leftOk && rightOk) return current;
  return { fromPx: Math.max(0, from - margin), toPx: to + margin };
}

/** 격자 배경 한 칸의 너비(px). 칸이 너무 좁으면 같은 간격을 2배씩 넓혀 그린다(선은 박 위치에 그대로 놓인다). */
export function gridTileWidth(subdivisionWidth: number): number {
  if (!(subdivisionWidth > 0)) return subdivisionWidth;
  let width = subdivisionWidth;
  while (width < MIN_TICK_SPACING_PX) width *= 2;
  return width;
}
