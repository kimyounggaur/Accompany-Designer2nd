/**
 * 파형 자료 갖추기(app/peaks.ts, 설계서 §P4-3): 캐시 → 계산 → 보관 순서와, 소리가 바뀌었거나 그만둘 때 결과를 버리는 규칙.
 * 소리 엔진·저장소·계산기는 모두 가짜로 끼운다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = { AudioContext: class {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };

const { cancelAllPeaks, ensurePeaks, ensurePeaksForAssets, peaksMatch } = await import("../src/app/peaks.ts");
const { clearPeaks, getPeakSet, setPeakSet } = await import("../src/services/peaksCache.ts");
const { createPeakSet } = await import("../src/domain/waveform/peakLevels.ts");
const { PeaksCancelledError } = await import("../src/audio/peaksAnalyzer.ts");

function bufferOf(frames = 3000, sampleRate = 44100) {
  const data = new Float32Array(frames).fill(0.5);
  return { sampleRate, length: frames, numberOfChannels: 1, getChannelData: () => data };
}

/** 가짜 부품: 부른 기록을 남기고, 계산·읽기·쓰기를 시험이 조절한다. */
function fakes({ buffers = {}, cached = {}, analyzeImpl, loadImpl, saveImpl } = {}) {
  const log = { analyzed: [], loaded: [], saved: [], signals: [] };
  const deps = {
    getBuffer: (id) => buffers[id],
    load: async (hash) => {
      log.loaded.push(hash);
      if (loadImpl) return loadImpl(hash);
      return cached[hash];
    },
    save: async (hash, set) => {
      log.saved.push([hash, set]);
      if (saveImpl) return saveImpl(hash, set);
    },
    analyze: async (source, signal) => {
      log.analyzed.push(source);
      log.signals.push(signal);
      if (analyzeImpl) return analyzeImpl(source, signal);
      return createPeakSet(source);
    },
  };
  return { deps, log, buffers };
}

beforeEach(() => {
  cancelAllPeaks();
  clearPeaks();
});

test("소리가 있으면 계산해서 보관소에 채우고, 해시가 있으면 저장소 캐시에도 둔다", async () => {
  const buffer = bufferOf();
  const { deps, log } = fakes({ buffers: { a1: buffer } });
  await ensurePeaks({ id: "a1", hash: "h1" }, deps);
  const set = getPeakSet("a1");
  assert.ok(set);
  assert.equal(set.frames, 3000);
  assert.equal(log.analyzed.length, 1);
  assert.deepEqual(log.loaded, ["h1"], "계산하기 전에 캐시를 본다");
  assert.equal(log.saved.length, 1);
  assert.equal(log.saved[0][0], "h1");
  assert.equal(log.saved[0][1], set);
});

test("저장소 캐시에 맞는 것이 있으면 계산하지 않고 그것을 쓴다(다시 쓰지도 않는다)", async () => {
  const buffer = bufferOf();
  const cachedSet = createPeakSet(buffer);
  const { deps, log } = fakes({ buffers: { a1: buffer }, cached: { h1: cachedSet } });
  await ensurePeaks({ id: "a1", hash: "h1" }, deps);
  assert.equal(getPeakSet("a1"), cachedSet);
  assert.equal(log.analyzed.length, 0);
  assert.equal(log.saved.length, 0);
});

test("캐시의 파형이 이 소리와 안 맞으면(샘플레이트·길이가 다르면) 다시 계산해 덮어쓴다", async () => {
  const buffer = bufferOf(3000, 44100);
  const stale = createPeakSet(bufferOf(3000, 48000));
  const { deps, log } = fakes({ buffers: { a1: buffer }, cached: { h1: stale } });
  await ensurePeaks({ id: "a1", hash: "h1" }, deps);
  assert.notEqual(getPeakSet("a1"), stale);
  assert.equal(getPeakSet("a1").sampleRate, 44100);
  assert.equal(log.analyzed.length, 1);
  assert.equal(log.saved.length, 1);
  assert.equal(peaksMatch(stale, buffer), false);
});

test("해시가 없으면 캐시를 보지도 쓰지도 않고 계산만 한다", async () => {
  const { deps, log } = fakes({ buffers: { a1: bufferOf() } });
  await ensurePeaks({ id: "a1" }, deps);
  assert.ok(getPeakSet("a1"));
  assert.deepEqual(log.loaded, []);
  assert.deepEqual(log.saved, []);
});

test("소리가 아직 없는 음원(빠진 음원)은 아무것도 하지 않는다", async () => {
  const { deps, log } = fakes({ buffers: {} });
  await ensurePeaks({ id: "a1", hash: "h1" }, deps);
  assert.equal(getPeakSet("a1"), undefined);
  assert.deepEqual(log.loaded, []);
  assert.equal(log.analyzed.length, 0);
});

test("이미 맞는 파형이 있으면 다시 하지 않는다", async () => {
  const buffer = bufferOf();
  const existing = createPeakSet(buffer);
  setPeakSet("a1", existing);
  const { deps, log } = fakes({ buffers: { a1: buffer } });
  await ensurePeaks({ id: "a1", hash: "h1" }, deps);
  assert.equal(getPeakSet("a1"), existing);
  assert.deepEqual(log.loaded, []);
  assert.equal(log.analyzed.length, 0);
});

test("같은 음원을 동시에 두 번 부르면 계산은 한 번만 한다", async () => {
  const { deps, log } = fakes({ buffers: { a1: bufferOf() } });
  await Promise.all([ensurePeaks({ id: "a1", hash: "h1" }, deps), ensurePeaks({ id: "a1", hash: "h1" }, deps)]);
  assert.equal(log.analyzed.length, 1);
  assert.ok(getPeakSet("a1"));
});

test("계산하는 사이 소리가 바뀌면(프로젝트를 열어 비워졌거나 다른 소리로 바뀌면) 결과를 버린다", async () => {
  const buffer = bufferOf();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { deps, buffers } = fakes({ buffers: { a1: buffer }, analyzeImpl: async (source) => { await gate; return createPeakSet(source); } });
  const running = ensurePeaks({ id: "a1" }, deps);
  delete buffers.a1; // 소리 엔진이 비워졌다
  release();
  await running;
  assert.equal(getPeakSet("a1"), undefined);

  // 다른 소리가 올라왔어도 마찬가지
  const first = bufferOf(3000);
  const second = bufferOf(5000);
  const more = fakes({ buffers: { a2: first }, analyzeImpl: async (source) => { await gate; return createPeakSet(source); } });
  const again = ensurePeaks({ id: "a2" }, more.deps);
  more.buffers.a2 = second;
  await again;
  assert.equal(getPeakSet("a2"), undefined, "옛 소리의 계산 결과는 쓰지 않는다");
  await ensurePeaks({ id: "a2" }, more.deps);
  assert.equal(getPeakSet("a2").frames, 5000, "새 소리는 새로 계산한다");
});

test("cancelAllPeaks: 그만두라는 신호가 가고, 끝난 결과는 버려진다", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { deps, log } = fakes({ buffers: { a1: bufferOf() }, analyzeImpl: async (source) => { await gate; return createPeakSet(source); } });
  const running = ensurePeaks({ id: "a1" }, deps);
  await new Promise((resolve) => setImmediate(resolve));
  cancelAllPeaks();
  assert.equal(log.signals[0].aborted, true);
  release();
  await running;
  assert.equal(getPeakSet("a1"), undefined);
});

test("계산이 그만둠으로 끝나면 조용히 넘어가고, 다른 이유로 실패해도 던지지 않는다(파형만 비어 있다)", async () => {
  const cancelled = fakes({ buffers: { a1: bufferOf() }, analyzeImpl: async () => { throw new PeaksCancelledError(); } });
  await ensurePeaks({ id: "a1" }, cancelled.deps);
  assert.equal(getPeakSet("a1"), undefined);

  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    const broken = fakes({ buffers: { a2: bufferOf() }, analyzeImpl: async () => { throw new Error("worker 실패"); } });
    await ensurePeaks({ id: "a2" }, broken.deps);
    assert.equal(getPeakSet("a2"), undefined);
    assert.equal(warned.length, 1);
    // 실패한 작업은 남지 않으므로 다시 부르면 다시 해 본다
    const retry = fakes({ buffers: { a2: bufferOf() } });
    await ensurePeaks({ id: "a2" }, retry.deps);
    assert.ok(getPeakSet("a2"));
  } finally {
    console.warn = warn;
  }
});

test("캐시를 읽지 못하거나 쓰지 못해도 파형은 보인다", async () => {
  const unreadable = fakes({ buffers: { a1: bufferOf() }, loadImpl: () => { throw new Error("저장소를 열 수 없습니다"); } });
  await ensurePeaks({ id: "a1", hash: "h1" }, unreadable.deps);
  assert.ok(getPeakSet("a1"), "읽기에 실패하면 계산으로 넘어간다");
  assert.equal(unreadable.log.analyzed.length, 1);

  const unwritable = fakes({ buffers: { a2: bufferOf() }, saveImpl: () => { throw new Error("저장 공간 부족"); } });
  await ensurePeaks({ id: "a2", hash: "h2" }, unwritable.deps);
  assert.ok(getPeakSet("a2"), "쓰기에 실패해도 보관소에는 채워진다");
});

test("ensurePeaksForAssets: 여러 음원을 차례로 갖춘다(동시에 계산하지 않는다)", async () => {
  let active = 0;
  let maxActive = 0;
  const order = [];
  const { deps } = fakes({
    buffers: { a1: bufferOf(1000), a2: bufferOf(2000), a3: bufferOf(3000) },
    analyzeImpl: async (source) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(source.length);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return createPeakSet(source);
    },
  });
  await ensurePeaksForAssets([{ id: "a1" }, { id: "a2" }, { id: "a3" }], deps);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, [1000, 2000, 3000]);
  assert.deepEqual([getPeakSet("a1").frames, getPeakSet("a2").frames, getPeakSet("a3").frames], [1000, 2000, 3000]);
});
