/**
 * 검사기의 낱개 읽기 함수들. 프로젝트(parseProject)와 프리셋(parsePreset)이 같은 함수를 쓴다.
 *
 * 규칙(설계서 §P4-1)
 *  - 없는 값: 기본값이 있으면 조용히 채우고(옛 파일은 이펙트 설정이 통째로 없을 수 있다), 필수인데 없으면 실패한다.
 *  - 자료형이 다른 값(숫자 자리의 글자, 불리언 자리의 null …)과 허용 목록에 없는 글자 값은 실패한다. 아무것도 바꾸지 않는다.
 *  - 숫자가 범위를 벗어났거나 유한한 수가 아니면(NaN·1e308) 가장 가까운 허용값으로 고치고 `Issue`에 남긴다.
 *  - 모르는 키는 읽지 않는다(그래서 결과에 남지 않는다). 주소처럼 보이는 글자는 기본 글자로 바꾸고 `unsafe`로 남긴다.
 */
import { createId } from "../../utils/audioMath";
import type {
  CompressorSettings,
  DelaySettings,
  DelaySyncDivision,
  EffectSlot,
  EffectSlotType,
  EqSettings,
  ReverbMode,
  ReverbSettings,
  Track,
} from "../types";
import {
  DEFAULT_COMPRESSOR_SETTINGS,
  DEFAULT_DELAY_SETTINGS,
  DEFAULT_EFFECT_ORDER,
  DEFAULT_EQ_SETTINGS,
  DEFAULT_REVERB_SETTINGS,
  effectEnabled,
} from "./defaults";
import type { IssueLog } from "./issues";
import {
  COMPRESSOR_RATIO_RANGE,
  COMPRESSOR_THRESHOLD_RANGE,
  COMPRESSOR_TIME_RANGE,
  DELAY_FEEDBACK_RANGE,
  DELAY_HIGH_CUT_RANGE,
  DELAY_TIME_RANGE,
  EQ_GAIN_RANGE,
  FORBIDDEN_IDS,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  REVERB_DECAY_RANGE,
  REVERB_HIGH_PASS_RANGE,
  REVERB_LOW_PASS_RANGE,
  REVERB_PRE_DELAY_RANGE,
  UNIT_RANGE,
  type Range,
} from "./ranges";

export type Obj = Record<string, unknown>;

export const isObject = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);

/** 경로 이름 붙이기: `tracks[0].eq` 꼴 */
export const at = (path: string, key: string | number): string =>
  typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;

/**
 * 주소처럼 보이는 글자: `javascript:`, `vbscript:`, `http(s)://`, `ftp://`, `ws(s)://`, `file://`, `blob:…`, `data:…,…`.
 * "데이터: 드럼"이나 "File: 킥" 같은 평범한 이름은 걸리지 않게 주소 모양까지 확인한다.
 */
const UNSAFE_TEXT = /^[\s\u0000-\u001f]*(?:(?:javascript|vbscript)\s*:|(?:https?|ftp|wss?|file):\/\/|blob:\S|data:[^,\s]*,)/i;
export const isUnsafeText = (text: string): boolean => UNSAFE_TEXT.test(text);

export const isValidId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length < MAX_ID_LENGTH && !FORBIDDEN_IDS.includes(id) && !isUnsafeText(id);

// ───────────────────────── 낱개 읽기 ─────────────────────────

const middleOf = ([min, max]: Range): number => Math.min(max, Math.max(min, 0));

export interface NumberSpec {
  range: Range;
  /** 없을 때·유한하지 않을 때 쓰는 값. 없고 `required`면 없는 값은 실패 */
  def?: number;
  required?: boolean;
  /** 정수만(소수는 반올림해 고친다) */
  integer?: boolean;
}

export function readNumber(log: IssueLog, value: unknown, path: string, spec: NumberSpec): number {
  const [min, max] = spec.range;
  if (value === undefined) {
    if (spec.required || spec.def === undefined) return log.fail(path, "missing");
    return spec.def;
  }
  if (typeof value !== "number") return log.fail(path, "type");
  if (!Number.isFinite(value)) {
    log.fixed(path, "range");
    return spec.def ?? middleOf(spec.range);
  }
  let result = value;
  if (result < min) {
    result = min;
    log.fixed(path, "range");
  } else if (result > max) {
    result = max;
    log.fixed(path, "range");
  }
  if (spec.integer && !Number.isInteger(result)) {
    result = Math.min(max, Math.max(min, Math.round(result)));
    log.fixed(path, "range");
  }
  return result === 0 ? 0 : result; // −0은 0으로
}

/** 없어도 되는 숫자: 없으면 undefined, 있으면 범위를 지킨다 */
export function readOptionalNumber(log: IssueLog, value: unknown, path: string, spec: Omit<NumberSpec, "def" | "required">): number | undefined {
  if (value === undefined) return undefined;
  return readNumber(log, value, path, { ...spec, def: middleOf(spec.range) });
}

export function readBool(log: IssueLog, value: unknown, path: string, def?: boolean): boolean {
  if (value === undefined) {
    if (def === undefined) return log.fail(path, "missing");
    return def;
  }
  if (typeof value !== "boolean") return log.fail(path, "type");
  return value;
}

export function readEnum<T extends string>(log: IssueLog, value: unknown, path: string, allowed: readonly T[], def?: T): T {
  if (value === undefined) {
    if (def === undefined) return log.fail(path, "missing");
    return def;
  }
  if (typeof value !== "string") return log.fail(path, "type");
  if (!(allowed as readonly string[]).includes(value)) return log.fail(path, "enum");
  return value as T;
}

/**
 * 글자. 없으면 `fallback`(필수가 아닐 때) 또는 실패. 주소처럼 보이면 `fallback`으로 바꾸고, 200자를 넘으면 자른다.
 * (프로젝트·트랙·클립·음원·마커·프리셋 이름 모두 같은 규칙)
 */
export function readText(log: IssueLog, value: unknown, path: string, fallback: string, required = true): string {
  if (value === undefined) {
    if (required) return log.fail(path, "missing");
    return fallback;
  }
  if (typeof value !== "string") return log.fail(path, "type");
  if (isUnsafeText(value)) {
    log.fixed(path, "unsafe");
    return fallback;
  }
  if (value.length > MAX_NAME_LENGTH) {
    log.fixed(path, "limit");
    return value.slice(0, MAX_NAME_LENGTH);
  }
  return value;
}

export function readId(log: IssueLog, value: unknown, path: string): string {
  if (value === undefined) return log.fail(path, "missing");
  if (typeof value !== "string") return log.fail(path, "type");
  if (!isValidId(value)) return log.fail(path, "unsafe");
  return value;
}

export function readOptionalId(log: IssueLog, value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : readId(log, value, path);
}

/** 읽을 수 없는 선택 항목은 버리고(`undefined`) 고친 것으로 남긴다. 실패하지 않는다. */
export function readOptionalString(log: IssueLog, value: unknown, path: string, accept: (text: string) => boolean): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && accept(value)) return value;
  log.fixed(path, typeof value === "string" && isUnsafeText(value) ? "unsafe" : "type");
  return undefined;
}

// ───────────────────────── 이펙트 설정 ─────────────────────────

/** 이펙트 설정 한 묶음: 없으면 undefined, 객체가 아니면 실패 */
function section(log: IssueLog, raw: unknown, path: string): Obj | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) return log.fail(path, "type");
  return raw;
}

export function readEq(log: IssueLog, raw: unknown, path: string): EqSettings {
  const o = section(log, raw, path);
  const d = DEFAULT_EQ_SETTINGS;
  if (!o) return { ...d };
  const gain = (key: keyof EqSettings, value: unknown): number => readNumber(log, value, at(path, key), { range: EQ_GAIN_RANGE, def: d[key] as number });
  // 아주 옛 파일의 낮은음·중간음 두 칸(lowGain·midGain)은 새 칸으로 옮긴다.
  const legacyLow = readOptionalNumber(log, o.lowGain, at(path, "lowGain"), { range: EQ_GAIN_RANGE });
  const legacyMid = readOptionalNumber(log, o.midGain, at(path, "midGain"), { range: EQ_GAIN_RANGE });
  return {
    enabled: readBool(log, o.enabled, at(path, "enabled"), d.enabled),
    bassGain: gain("bassGain", o.bassGain !== undefined ? o.bassGain : legacyLow),
    middleLowGain: gain("middleLowGain", o.middleLowGain !== undefined ? o.middleLowGain : legacyMid),
    middleHighGain: gain("middleHighGain", o.middleHighGain !== undefined ? o.middleHighGain : legacyMid),
    highGain: gain("highGain", o.highGain),
    presenceGain: gain("presenceGain", o.presenceGain),
  };
}

export function readCompressor(log: IssueLog, raw: unknown, path: string): CompressorSettings {
  const o = section(log, raw, path);
  const d = DEFAULT_COMPRESSOR_SETTINGS;
  if (!o) return { ...d };
  return {
    enabled: readBool(log, o.enabled, at(path, "enabled"), d.enabled),
    threshold: readNumber(log, o.threshold, at(path, "threshold"), { range: COMPRESSOR_THRESHOLD_RANGE, def: d.threshold }),
    ratio: readNumber(log, o.ratio, at(path, "ratio"), { range: COMPRESSOR_RATIO_RANGE, def: d.ratio }),
    attack: readNumber(log, o.attack, at(path, "attack"), { range: COMPRESSOR_TIME_RANGE, def: d.attack }),
    release: readNumber(log, o.release, at(path, "release"), { range: COMPRESSOR_TIME_RANGE, def: d.release }),
  };
}

export const DELAY_SYNC_DIVISIONS: readonly DelaySyncDivision[] = ["1/1", "1/2", "1/4", "1/8", "1/16", "1/8d", "1/8t"];
export const REVERB_MODES: readonly ReverbMode[] = ["plate", "room", "hall"];

export function readDelay(log: IssueLog, raw: unknown, path: string): DelaySettings {
  const o = section(log, raw, path);
  const d = DEFAULT_DELAY_SETTINGS;
  if (!o) return { ...d };
  return {
    enabled: readBool(log, o.enabled, at(path, "enabled"), d.enabled),
    delayTimeMs: readNumber(log, o.delayTimeMs, at(path, "delayTimeMs"), { range: DELAY_TIME_RANGE, def: d.delayTimeMs }),
    feedback: readNumber(log, o.feedback, at(path, "feedback"), { range: DELAY_FEEDBACK_RANGE, def: d.feedback }),
    dry: readNumber(log, o.dry, at(path, "dry"), { range: UNIT_RANGE, def: d.dry }),
    wet: readNumber(log, o.wet, at(path, "wet"), { range: UNIT_RANGE, def: d.wet }),
    highCutHz: readNumber(log, o.highCutHz, at(path, "highCutHz"), { range: DELAY_HIGH_CUT_RANGE, def: d.highCutHz }),
    syncEnabled: readBool(log, o.syncEnabled, at(path, "syncEnabled"), d.syncEnabled),
    syncDivision: readEnum(log, o.syncDivision, at(path, "syncDivision"), DELAY_SYNC_DIVISIONS, d.syncDivision),
    pingPong: readBool(log, o.pingPong, at(path, "pingPong"), d.pingPong),
  };
}

export function readReverb(log: IssueLog, raw: unknown, path: string): ReverbSettings {
  const o = section(log, raw, path);
  const d = DEFAULT_REVERB_SETTINGS;
  if (!o) return { ...d };
  const unit = (key: "drive" | "dry" | "wet" | "width" | "modAmount") => readNumber(log, o[key], at(path, key), { range: UNIT_RANGE, def: d[key] });
  const post = (key: "postEqLowGain" | "postEqMidGain" | "postEqHighGain") => readNumber(log, o[key], at(path, key), { range: EQ_GAIN_RANGE, def: d[key] });
  return {
    enabled: readBool(log, o.enabled, at(path, "enabled"), d.enabled),
    mode: readEnum(log, o.mode, at(path, "mode"), REVERB_MODES, d.mode),
    preDelayMs: readNumber(log, o.preDelayMs, at(path, "preDelayMs"), { range: REVERB_PRE_DELAY_RANGE, def: d.preDelayMs }),
    decay: readNumber(log, o.decay, at(path, "decay"), { range: REVERB_DECAY_RANGE, def: d.decay }),
    drive: unit("drive"),
    dry: unit("dry"),
    wet: unit("wet"),
    width: unit("width"),
    highPassHz: readNumber(log, o.highPassHz, at(path, "highPassHz"), { range: REVERB_HIGH_PASS_RANGE, def: d.highPassHz }),
    lowPassHz: readNumber(log, o.lowPassHz, at(path, "lowPassHz"), { range: REVERB_LOW_PASS_RANGE, def: d.lowPassHz }),
    modEnabled: readBool(log, o.modEnabled, at(path, "modEnabled"), d.modEnabled),
    modAmount: unit("modAmount"),
    postEqLowGain: post("postEqLowGain"),
    postEqMidGain: post("postEqMidGain"),
    postEqHighGain: post("postEqHighGain"),
  };
}

const EFFECT_TYPES: readonly EffectSlotType[] = DEFAULT_EFFECT_ORDER;

/**
 * 이펙트 순서. 없으면 기본 순서. 있으면 슬롯마다 id·종류·켜짐을 확인하고, 같은 종류는 처음 것만 남기며,
 * 빠진 종류는 기본 위치(맨 뒤)에 덧붙인다. 슬롯은 항상 네 종류가 한 번씩이다.
 */
export function readEffectChain(
  log: IssueLog,
  raw: unknown,
  path: string,
  settings: Pick<Track, "eq" | "compressor" | "delay" | "reverb">,
): EffectSlot[] {
  const first = new Map<EffectSlotType, EffectSlot>();
  if (raw !== undefined) {
    if (!Array.isArray(raw)) return log.fail(path, "type");
    if (raw.length > 64) return log.fail(path, "limit");
    raw.forEach((item, index) => {
      const slotPath = at(path, index);
      if (!isObject(item)) return log.fail(slotPath, "type");
      const slot: EffectSlot = {
        id: readId(log, item.id, at(slotPath, "id")),
        type: readEnum(log, item.type, at(slotPath, "type"), EFFECT_TYPES),
        enabled: readBool(log, item.enabled, at(slotPath, "enabled")),
      };
      if (!first.has(slot.type)) first.set(slot.type, slot);
    });
  }
  const chain = [...first.values()];
  for (const type of DEFAULT_EFFECT_ORDER) {
    if (!first.has(type)) chain.push({ id: createId("fx"), type, enabled: effectEnabled(type, settings) });
  }
  return chain;
}
