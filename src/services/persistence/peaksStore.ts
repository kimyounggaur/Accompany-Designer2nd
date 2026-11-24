/**
 * 파형 자료의 저장소 캐시(IndexedDB `peaks`, 설계서 §P4-3).
 *
 * 음원 데이터의 해시(SHA-256)마다 네 단계를 따로 담는다: 키 `${해시}:${단계 번호}`, 값은 한 단계의 `PeakRecord`.
 * 같은 파일이면 어느 프로젝트에서 열어도 파형을 다시 계산하지 않는다. 파형은 소리에서 언제든 다시 만들 수 있으므로
 * 읽을 수 없거나(모양이 다르거나 하나라도 빠졌거나) 소리와 맞지 않으면 없는 것으로 치고 다시 계산한다.
 * 쓰기·읽기 실패는 앱 동작에 영향이 없다(부르는 쪽이 삼킨다).
 */
import { PEAK_BUCKET_SIZES, PEAK_RECORD_VERSION, type PeakLevel, type PeakSet } from "../../domain/waveform/peakLevels";
import { STORE, requestToPromise, transactionDone, withDb } from "./db";

/** 저장소에 담기는 한 단계 */
export interface PeakRecord {
  version: typeof PEAK_RECORD_VERSION;
  sampleRate: number;
  frames: number;
  peak: number;
  samplesPerBucket: number;
  min: Int8Array;
  max: Int8Array;
}

export function peakKey(hash: string, levelIndex: number): string {
  return `${hash}:${levelIndex}`;
}

/** 키가 가리키는 음원 해시(마지막 `:` 앞) */
export function hashOfPeakKey(key: string): string {
  const cut = key.lastIndexOf(":");
  return cut < 0 ? key : key.slice(0, cut);
}

/** 어느 프로젝트도 쓰지 않는 음원의 파형 키(지워도 되는 것) */
export function orphanPeakKeys(storedKeys: ReadonlyArray<IDBValidKey>, usedHashes: ReadonlySet<string>): string[] {
  return storedKeys.filter((key): key is string => typeof key === "string" && !usedHashes.has(hashOfPeakKey(key)));
}

/** 파형 자료 → 단계별 기록(네 개) */
export function toPeakRecords(set: PeakSet): PeakRecord[] {
  return set.levels.map((level) => ({
    version: PEAK_RECORD_VERSION,
    sampleRate: set.sampleRate,
    frames: set.frames,
    peak: set.peak,
    samplesPerBucket: level.samplesPerBucket,
    min: level.min,
    max: level.max,
  }));
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 단계별 기록(번호 순서) → 파형 자료. 네 단계가 모두 있고 서로 맞을 때만 돌려준다(하나라도 어긋나면 undefined: 다시 계산한다).
 * 값의 범위·길이까지 확인한다 — 저장소 기록은 다른 버전의 앱이나 다른 탭이 쓴 것일 수 있다.
 */
export function peakSetFromRecords(records: ReadonlyArray<unknown>): PeakSet | undefined {
  if (records.length !== PEAK_BUCKET_SIZES.length) return undefined;
  let sampleRate = 0;
  let frames = -1;
  let peak = 0;
  const levels: PeakLevel[] = [];
  for (let index = 0; index < PEAK_BUCKET_SIZES.length; index += 1) {
    const record = records[index];
    if (typeof record !== "object" || record === null) return undefined;
    const item = record as Partial<PeakRecord>;
    if (item.version !== PEAK_RECORD_VERSION) return undefined;
    if (!isPositiveFinite(item.sampleRate) || !isPositiveFinite(item.peak)) return undefined;
    if (typeof item.frames !== "number" || !Number.isInteger(item.frames) || item.frames <= 0) return undefined;
    if (item.samplesPerBucket !== PEAK_BUCKET_SIZES[index]) return undefined;
    if (!(item.min instanceof Int8Array) || !(item.max instanceof Int8Array)) return undefined;
    const expected = Math.ceil(item.frames / item.samplesPerBucket);
    if (item.min.length !== expected || item.max.length !== expected) return undefined;
    if (index === 0) {
      sampleRate = item.sampleRate;
      frames = item.frames;
      peak = item.peak;
    } else if (item.sampleRate !== sampleRate || item.frames !== frames || item.peak !== peak) {
      return undefined; // 다른 때 쓴 단계가 섞였다
    }
    levels.push({ samplesPerBucket: item.samplesPerBucket, min: item.min, max: item.max });
  }
  return { sampleRate, frames, peak, levels };
}

/** 저장소에서 음원 해시의 파형 자료를 읽는다. 없거나 쓸 수 없으면 undefined. */
export async function loadPeakSet(hash: string): Promise<PeakSet | undefined> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE.peaks, "readonly");
    const store = tx.objectStore(STORE.peaks);
    const records = await Promise.all(PEAK_BUCKET_SIZES.map((_, index) => requestToPromise<unknown>(store.get(peakKey(hash, index)))));
    return peakSetFromRecords(records);
  });
}

/** 파형 자료를 한 번의 트랜잭션으로 쓴다(네 단계가 함께 들어가거나 함께 빠진다). */
export async function savePeakSet(hash: string, set: PeakSet): Promise<void> {
  const records = toPeakRecords(set);
  await withDb(async (db) => {
    const tx = db.transaction(STORE.peaks, "readwrite");
    const done = transactionDone(tx);
    done.catch(() => undefined);
    const store = tx.objectStore(STORE.peaks);
    records.forEach((record, index) => store.put(record, peakKey(hash, index)));
    await done;
  });
}
