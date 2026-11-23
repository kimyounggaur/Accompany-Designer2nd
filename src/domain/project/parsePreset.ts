/**
 * 이펙트 랙 프리셋 검사기. 프리셋 파일 불러오기와 브라우저 저장소(`localStorage`)의 프리셋 목록 읽기가 같은 함수를 쓴다.
 * (예전에는 `effectChain` 길이만 확인했다. 지금은 프로젝트와 같은 낱개 읽기 규칙으로 모든 설정값의 자료형과 범위를 본다.)
 *
 *  - 이름(글자)과 `effectChain`(슬롯 1개 이상)은 필수. 이펙트 설정(eq·compressor·delay·reverb)이 없으면 기본값(옛 프리셋은 일부가 없다).
 *  - 자료형이 틀린 값은 실패하고, 범위를 벗어난 숫자는 고쳐서 `issues`에 남긴다.
 */
import type { EffectRackPreset } from "../types";
import { runParse, type Parsed } from "./issues";
import { MAX_PRESETS } from "./ranges";
import { isObject, readCompressor, readDelay, readEffectChain, readEq, readOptionalString, readReverb, readText } from "./readers";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const EPOCH = new Date(0).toISOString();

export function parsePreset(raw: unknown): Parsed<EffectRackPreset> {
  return runParse((log) => {
    if (!isObject(raw)) return log.fail("", "type");
    const name = readText(log, raw.name, "name", "프리셋");
    if (name.trim() === "") return log.fail("name", "missing");
    const createdAt = readOptionalString(log, raw.createdAt, "createdAt", (text) => ISO_DATE.test(text) && Number.isFinite(Date.parse(text))) ?? EPOCH;

    if (raw.effectChain === undefined) return log.fail("effectChain", "missing");
    if (!Array.isArray(raw.effectChain)) return log.fail("effectChain", "type");
    if (raw.effectChain.length === 0) return log.fail("effectChain", "missing");

    const eq = readEq(log, raw.eq, "eq");
    const compressor = readCompressor(log, raw.compressor, "compressor");
    const delay = readDelay(log, raw.delay, "delay");
    const reverb = readReverb(log, raw.reverb, "reverb");
    const effectChain = readEffectChain(log, raw.effectChain, "effectChain", { eq, compressor, delay, reverb });
    return { name, createdAt, effectChain, eq, compressor, delay, reverb };
  });
}

/**
 * 저장소에서 읽은 프리셋 목록. 목록이 아니면 빈 목록, 읽을 수 없는 항목은 건너뛴다(앱을 못 쓰게 만들지 않는다).
 * 이름이 같은 프리셋은 앞의 것만, 최대 24개.
 */
export function parsePresetList(raw: unknown): EffectRackPreset[] {
  if (!Array.isArray(raw)) return [];
  const result: EffectRackPreset[] = [];
  const names = new Set<string>();
  for (const item of raw) {
    const parsed = parsePreset(item);
    if (!parsed.ok || names.has(parsed.value.name)) continue;
    names.add(parsed.value.name);
    result.push(parsed.value);
    if (result.length >= MAX_PRESETS) break;
  }
  return result;
}
