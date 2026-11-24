import test from "node:test";
import assert from "node:assert/strict";
import { PeakBuilder, createPeakSet } from "../src/domain/waveform/peakLevels.ts";
import { PeaksCancelledError, analyzePeaks } from "../src/audio/peaksAnalyzer.ts";

const source = (channels, sampleRate = 44100) => ({
  sampleRate,
  length: channels[0].length,
  numberOfChannels: channels.length,
  getChannelData: (channel) => channels[channel],
});
function noise(length, seed = 1) {
  const data = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = (state / 0xffffffff) * 2 - 1;
  }
  return data;
}
const sameSet = (a, b) => {
  assert.equal(a.peak, b.peak);
  assert.equal(a.frames, b.frames);
  assert.equal(a.sampleRate, b.sampleRate);
  a.levels.forEach((level, index) => {
    assert.deepEqual([...level.min], [...b.levels[index].min], `단계 ${index} 최소`);
    assert.deepEqual([...level.max], [...b.levels[index].max], `단계 ${index} 최대`);
  });
};

/** Worker와 같은 약속을 지키는 가짜: 메시지는 다음 턴에 처리한다(진짜 Worker처럼 비동기) */
function fakeWorker({ failOn } = {}) {
  const worker = {
    onmessage: null,
    onerror: null,
    terminated: false,
    inFlight: 0,
    maxInFlight: 0,
    chunks: 0,
    builder: undefined,
    postMessage(message) {
      if (message.type === "chunk") {
        worker.chunks += 1;
        worker.inFlight += 1;
        worker.maxInFlight = Math.max(worker.maxInFlight, worker.inFlight);
      }
      setImmediate(() => {
        if (worker.terminated) return;
        if (message.type === "start") worker.builder = new PeakBuilder(message.sampleRate, message.frames);
        else if (message.type === "chunk") {
          if (failOn === worker.chunks) return worker.onmessage?.({ data: { type: "error", message: "계산 실패" } });
          worker.builder.addChunk(message.samples, message.offset);
          worker.inFlight -= 1;
          worker.onmessage?.({ data: { type: "ack" } });
        } else if (message.type === "finish") worker.onmessage?.({ data: { type: "done", set: worker.builder.finish() } });
      });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

test("Worker로 덩어리를 나눠 보내 계산한 결과가 한 번에 계산한 것과 같다(채널 둘, 덩어리 경계가 256의 배수가 아님)", async () => {
  const channels = [noise(30_000, 1), noise(30_000, 2)];
  const worker = fakeWorker();
  const set = await analyzePeaks(source(channels), { createWorker: () => worker, chunkFrames: 1000 });
  sameSet(set, createPeakSet(source(channels)));
  assert.equal(worker.chunks, 60, "채널당 30덩어리");
  assert.equal(worker.terminated, true, "끝나면 Worker를 내린다");
});

test("Worker가 아직 다 쓰지 않은 덩어리는 정한 수를 넘게 쌓지 않는다", async () => {
  const worker = fakeWorker();
  await analyzePeaks(source([noise(40_000)]), { createWorker: () => worker, chunkFrames: 500, maxInFlight: 2 });
  assert.ok(worker.maxInFlight <= 2, `쌓인 덩어리 최대 ${worker.maxInFlight}`);
  assert.ok(worker.chunks === 80);
});

test("중간에 그만두면 PeaksCancelledError로 거절하고 Worker를 내린다", async () => {
  const controller = new AbortController();
  const worker = fakeWorker();
  const pending = analyzePeaks(source([noise(200_000)]), { createWorker: () => worker, chunkFrames: 100, signal: controller.signal });
  setTimeout(() => controller.abort(), 2);
  await assert.rejects(pending, PeaksCancelledError);
  assert.equal(worker.terminated, true);
  await assert.rejects(analyzePeaks(source([noise(10)]), { signal: controller.signal }), PeaksCancelledError, "시작 전에 이미 그만둔 경우");
});

test("Worker가 실패를 알리면 그 이유로 거절하고 Worker를 내린다", async () => {
  const worker = fakeWorker({ failOn: 3 });
  await assert.rejects(analyzePeaks(source([noise(10_000)]), { createWorker: () => worker, chunkFrames: 1000 }), /계산 실패/);
  assert.equal(worker.terminated, true);
});

test("Worker를 만들 수 없으면 화면 스레드에서 조각으로 나눠 계산하고, 조각 사이에 다른 일이 끼어들 수 있다", async () => {
  const channels = [noise(700_000, 5)];
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 0);
  const set = await analyzePeaks(source(channels), { createWorker: () => undefined });
  clearInterval(timer);
  sameSet(set, createPeakSet(source(channels)));
  assert.ok(ticks >= 2, `계산하는 동안 끼어든 일 ${ticks}번`);
});

test("비어 있는 소리는 파형을 만들지 않는다", async () => {
  await assert.rejects(analyzePeaks(source([new Float32Array(0)])), /비어 있는/);
});
