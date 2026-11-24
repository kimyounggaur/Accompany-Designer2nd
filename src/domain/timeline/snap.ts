/**
 * 박자표·마디·스냅 간격 계산(설계서 P5-5). 화면·소리·저장소를 모르는 순수한 계산이다.
 *
 * 템포(BPM)는 박자표와 상관없이 언제나 4분음표 기준이다. 박자표는 "한 마디가 얼마나 긴가"와 "메트로놈이 얼마 간격으로 울리는가"를 정한다.
 *  - 4/4: 4분음표 4개 · 3/4: 3개 · 2/4: 2개 · 6/8: 8분음표 6개 = 4분음표 3개
 * 스냅·눈금자의 "박"은 4분음표 하나로 같다. "마디"만 박자표를 따라 길이가 달라진다.
 */
import { clamp, getBeatSeconds } from "../../utils/audioMath";
import { TIME_SIGNATURE_BEATS_RANGE } from "../project/ranges";
import type { PlaylistSnap, TimeSignature } from "../types";

/** 상단 바에서 고를 수 있는 박자표 */
export const TIME_SIGNATURES: readonly TimeSignature[] = [
  { beats: 2, unit: 4 },
  { beats: 3, unit: 4 },
  { beats: 4, unit: 4 },
  { beats: 6, unit: 8 },
];

const COMMON_TIME: TimeSignature = { beats: 4, unit: 4 };

/** "3/4" 같은 표기 */
export function timeSignatureLabel(signature: TimeSignature): string {
  return `${signature.beats}/${signature.unit}`;
}

export function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.beats === b.beats && a.unit === b.unit;
}

/** 박자표를 문서가 받는 값으로 맞춘다: 윗수는 1~32의 정수, 아랫수는 4 또는 8. 숫자가 아니면 4/4. */
export function normalizeTimeSignature(signature: Partial<TimeSignature> | undefined): TimeSignature {
  const [min, max] = TIME_SIGNATURE_BEATS_RANGE;
  return {
    beats: clamp(Math.round(Number(signature?.beats)) || COMMON_TIME.beats, min, max),
    unit: signature?.unit === 8 ? 8 : 4,
  };
}

/** 표기("6/8")로 고를 수 있는 박자표를 찾는다. 선택지에 없으면 undefined. */
export function findTimeSignature(label: string): TimeSignature | undefined {
  const found = TIME_SIGNATURES.find((signature) => timeSignatureLabel(signature) === label);
  return found ? { ...found } : undefined;
}

/** 한 마디의 길이를 4분음표 개수로 센 값: 4/4 = 4, 3/4 = 3, 2/4 = 2, 6/8 = 3(3/8처럼 소수가 되는 박자표도 있다). */
export function quarterBeatsPerBar(signature: TimeSignature = COMMON_TIME): number {
  return (signature.beats * 4) / signature.unit;
}

/** 한 마디의 길이(초) */
export function barSeconds(bpm: number, signature: TimeSignature = COMMON_TIME): number {
  return getBeatSeconds(bpm) * quarterBeatsPerBar(signature);
}

/** 메트로놈이 한 번 울리는 간격(초): 박자표 아랫수의 음표 하나(4/4는 4분음표, 6/8은 8분음표). */
export function clickSeconds(bpm: number, signature: TimeSignature = COMMON_TIME): number {
  return (getBeatSeconds(bpm) * 4) / signature.unit;
}

/** 한 마디에 메트로놈이 울리는 횟수(박자표 윗수). 첫 번째가 강박이다. */
export function clicksPerBar(signature: TimeSignature = COMMON_TIME): number {
  return signature.beats;
}

/**
 * 스냅 선택지(설계서 P5-6): 화면에 보이는 순서대로 다섯 개. 로컬·글로벌 구분과 "메인"·"라인"은 없다.
 * 마디(박자표를 따름) → 박 → 1/2박 → 1/4박 순으로 촘촘해지고, "없음"은 잡지 않는다. 다섯 개의 간격이 모두 다르다.
 */
export const PLAYLIST_SNAPS: readonly PlaylistSnap[] = ["bar", "beat", "halfBeat", "quarterBeat", "none"];

/** 처음 스냅이자 상단 바 스냅 단추를 켤 때의 값: 1/2박. 옛 "라인"과 같은 간격이라 쓰던 사람이 느끼는 변화가 없다. */
export const DEFAULT_SNAP: PlaylistSnap = "halfBeat";

/**
 * 스냅 값 → 격자 분할 수(4분음표 하나를 몇 칸으로 나눌지). 한 칸의 길이는 `박 길이 ÷ 분할 수`다.
 * 마디는 한 칸이 한 마디라서 1보다 작다(4/4는 1/4, 3/4와 6/8은 1/3, 2/4는 1/2).
 */
export function snapDivisionOf(snap: PlaylistSnap, signature: TimeSignature = COMMON_TIME): number {
  switch (snap) {
    case "bar":
      return 1 / quarterBeatsPerBar(signature);
    case "beat":
      return 1;
    case "quarterBeat":
      return 4;
    case "halfBeat":
    case "none":
      return 2; // 없음은 스냅을 쓰지 않지만 눈금 격자는 반 박 간격으로 그린다
  }
}

/** 스냅 선택이 화면에 주는 설정: 잡을지(`enabled`)와 격자 분할 수(`division`). 스토어·눈금자·끌어다 놓기가 이 값 하나를 따른다. */
export function snapSettings(
  snap: PlaylistSnap,
  signature: TimeSignature = COMMON_TIME,
): { enabled: boolean; division: number } {
  return { enabled: snap !== "none", division: snapDivisionOf(snap, signature) };
}

// ───────── 녹음 카운트인 ─────────

/** 카운트인으로 울릴 수 있는 클릭 수의 위쪽 끝(메트로놈 계획의 한도와 같다) */
export const COUNT_IN_CLICKS_MAX = 16;

/** 카운트인 선택지 하나: 클릭 수(`value`)와, 사람이 읽는 방식(없음 · n박 · n마디) */
export interface CountInOption {
  value: number;
  unit: "none" | "beat" | "bar";
  /** `unit`이 박이면 박 수, 마디면 마디 수 */
  count: number;
}

/**
 * 박자표에 맞는 카운트인 선택지(클릭 수 오름차순): 없음 · 1박 · 2박 · 1마디 · 2마디.
 * 마디는 박자표의 윗수만큼 울린다(3/4의 1마디는 3번, 6/8은 8분음표 6번). 클릭 수가 같아지는 선택지는 "마디"로 부른다(2/4의 2박 = 1마디).
 * 한도(`COUNT_IN_CLICKS_MAX`)를 넘는 선택지는 뺀다.
 */
export function countInOptions(signature: TimeSignature = COMMON_TIME): CountInOption[] {
  const bar = normalizeTimeSignature(signature).beats;
  const byValue = new Map<number, CountInOption>();
  const add = (option: CountInOption) => {
    if (option.value > COUNT_IN_CLICKS_MAX) return;
    const existing = byValue.get(option.value);
    if (!existing || (existing.unit === "beat" && option.unit === "bar")) byValue.set(option.value, option);
  };
  add({ value: 0, unit: "none", count: 0 });
  add({ value: 1, unit: "beat", count: 1 });
  add({ value: 2, unit: "beat", count: 2 });
  add({ value: bar, unit: "bar", count: 1 });
  add({ value: bar * 2, unit: "bar", count: 2 });
  return [...byValue.values()].sort((a, b) => a.value - b.value);
}

/**
 * 저장해 둔 카운트인 클릭 수를 이 박자표에서 쓸 수 있는 값으로 고른다. 선택지에 있으면 그대로, 없으면 가장 가까운 선택지(같은 거리면 긴 쪽).
 * 4/4에서 "1마디"(4)를 골라 둔 채 3/4로 바꾸면 3, 6/8로 바꾸면 6이 된다. 저장한 값은 건드리지 않으므로 4/4로 돌아오면 다시 4다.
 */
export function effectiveCountIn(count: number, signature: TimeSignature = COMMON_TIME): number {
  const values = countInOptions(signature).map((option) => option.value);
  const wanted = Math.max(0, Math.round(Number(count) || 0));
  if (values.includes(wanted)) return wanted;
  return values.reduce((best, value) => {
    const distance = Math.abs(value - wanted);
    const bestDistance = Math.abs(best - wanted);
    return distance < bestDistance || (distance === bestDistance && value > best) ? value : best;
  }, values[0]);
}
