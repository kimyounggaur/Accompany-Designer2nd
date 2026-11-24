import { audioEngine } from "../audio/currentEngine";
import { analyzePeaks, PeaksCancelledError } from "../audio/peaksAnalyzer";
import type { AssetMeta } from "../domain/types";
import type { PeakSet, PeakSource } from "../domain/waveform/peakLevels";
import { getPeakSet, setPeakSet } from "../services/peaksCache";
import { loadPeakSet, savePeakSet } from "../services/persistence/peaksStore";

/**
 * 음원마다 다단계 파형 자료를 갖춰 놓는다(설계서 §P4-3).
 *
 *   1. 보관소에 이미 있고 소리와 맞으면 끝.
 *   2. 음원 해시가 있으면 저장소 캐시(IndexedDB `peaks`)를 본다 — 맞으면 보관소에 채우고 끝(같은 파일은 다시 계산하지 않는다).
 *   3. 없으면 Worker로 계산해 보관소에 채우고, 해시가 있으면 저장소 캐시에도 둔다.
 *
 * 계산하는 동안 파형이 비어 보이다가 끝나면 저절로 그려진다. 실패해도 소리·편집에는 영향이 없다.
 * 소리가 바뀌었거나(프로젝트를 열어 소리 엔진이 비워진 경우 포함) 그만두라는 신호가 오면 결과를 버린다.
 */

/** 끼워 넣는 부품(시험에서는 가짜로 바꾼다) */
export interface PeaksDeps {
  /** 음원 id의 소리 데이터. 아직 없으면(빠진 음원·푸는 중) undefined */
  getBuffer: (assetId: string) => PeakSource | undefined;
  load: (hash: string) => Promise<PeakSet | undefined>;
  save: (hash: string, set: PeakSet) => Promise<void>;
  analyze: (source: PeakSource, signal: AbortSignal) => Promise<PeakSet>;
}

const defaultDeps: PeaksDeps = {
  getBuffer: (assetId) => audioEngine.getBuffer(assetId),
  load: loadPeakSet,
  save: savePeakSet,
  analyze: (source, signal) => analyzePeaks(source, { signal }),
};

interface Running {
  buffer: PeakSource;
  controller: AbortController;
  promise: Promise<void>;
}

/** 지금 만드는 중인 음원(음원 id → 작업). 같은 소리로 두 번 계산하지 않는다. */
const running = new Map<string, Running>();

/** 파형 자료가 이 소리의 것인가(샘플레이트와 길이가 같다). 같은 파일도 푸는 길(재생 장치·오프라인)에 따라 샘플레이트가 달라질 수 있다. */
export function peaksMatch(set: Pick<PeakSet, "sampleRate" | "frames">, buffer: Pick<PeakSource, "sampleRate" | "length">): boolean {
  return set.sampleRate === buffer.sampleRate && set.frames === buffer.length;
}

async function build(asset: Pick<AssetMeta, "id" | "hash">, buffer: PeakSource, controller: AbortController, deps: PeaksDeps): Promise<void> {
  const stillCurrent = () => !controller.signal.aborted && deps.getBuffer(asset.id) === buffer;
  try {
    let set: PeakSet | undefined;
    if (asset.hash) {
      const cached = await deps.load(asset.hash).catch(() => undefined);
      if (cached && peaksMatch(cached, buffer)) set = cached;
      if (!stillCurrent()) return;
    }
    const fromCache = set !== undefined;
    if (!set) {
      set = await deps.analyze(buffer, controller.signal);
      if (!stillCurrent()) return;
    }
    setPeakSet(asset.id, set);
    if (!fromCache && asset.hash) await deps.save(asset.hash, set).catch(() => undefined); // 캐시를 못 써도 파형은 이미 보인다
  } catch (error) {
    if (error instanceof PeaksCancelledError) return;
    console.warn("파형을 만들지 못했습니다.", error);
  }
}

/** 음원 하나의 파형 자료를 갖춘다. 소리가 없으면(빠진 음원) 아무것도 하지 않는다. */
export function ensurePeaks(asset: Pick<AssetMeta, "id" | "hash">, deps: PeaksDeps = defaultDeps): Promise<void> {
  const buffer = deps.getBuffer(asset.id);
  if (!buffer) return Promise.resolve();
  const current = getPeakSet(asset.id);
  if (current && peaksMatch(current, buffer)) return Promise.resolve();
  const same = running.get(asset.id);
  if (same && same.buffer === buffer) return same.promise;
  same?.controller.abort(); // 소리가 바뀌었다: 옛 소리의 계산은 그만둔다

  const controller = new AbortController();
  const entry: Running = {
    buffer,
    controller,
    promise: build(asset, buffer, controller, deps).finally(() => {
      if (running.get(asset.id) === entry) running.delete(asset.id);
    }),
  };
  running.set(asset.id, entry);
  return entry.promise;
}

/** 여러 음원의 파형 자료를 차례로 갖춘다(Worker와 복사해 둔 덩어리가 한꺼번에 불어나지 않게 하나씩). */
export async function ensurePeaksForAssets(assets: Iterable<Pick<AssetMeta, "id" | "hash">>, deps: PeaksDeps = defaultDeps): Promise<void> {
  for (const asset of assets) await ensurePeaks(asset, deps);
}

/** 만드는 중인 계산을 모두 그만둔다(프로젝트를 통째로 바꿀 때) */
export function cancelAllPeaks(): void {
  for (const entry of running.values()) entry.controller.abort();
  running.clear();
}
