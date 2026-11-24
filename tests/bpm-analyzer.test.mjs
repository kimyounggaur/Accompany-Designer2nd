/**
 * BPM 분석기(audio/bpmAnalyzer.ts, 설계서 §P4-4, 보고서 B5): 계산은 Worker가 하고, 화면 스레드는 앞 180초를 작은 덩어리로 잘라 보내기만 한다.
 * Worker는 가짜로 끼운다: 보낸 것·덩어리 수 제한·진행률·그만두기(Worker 끝내기)·실패·Worker가 없을 때의 대신 계산을 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeBpm, BPM_CHUNK_SAMPLES, BpmCancelledError } from "../src/audio/bpmAnalyzer.ts";
import { BPM_ANALYSIS_SECONDS } from "../src/audio/bpmDetector.ts";

/** 가짜 Worker: 받은 것을 기록하고, 덩어리를 받으면 (autoAck일 때) 바로 다 썼다고 알린다. 나머지 답은 시험이 `reply`로 보낸다. */
function fakeWorker({ autoAck = true } = {}) {
  const worker = {
    onmessage: null,
    onerror: null,
    posted: [],
    terminated: 0,
    postMessage(message, transfer) {
      worker.posted.push({ message, transfer });
      if (autoAck && message.type === "chunk") setImmediate(() => worker.onmessage?.({ data: { type: "ack" } }));
    },
    terminate() {
      worker.terminated += 1;
    },
    reply(data) {
      worker.onmessage?.({ data });
    },
    ofType: (type) => worker.posted.filter((entry) => entry.message.type === type).map((entry) => entry.message),
  };
  return worker;
}

/** 샘플마다 다른 값(0, 1, 2, …)이 든 음원: 덩어리로 나눠 보낸 것을 이어 붙여 원본 앞부분과 같은지 볼 수 있다. */
function rampSource(seconds, sampleRate = 8000) {
  const length = Math.floor(seconds * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = i % 1000;
  return { sampleRate, length, getChannelData: () => data };
}

/** 박마다 짧은 1kHz 딸깍 소리가 나는 음원 */
function clickTrack(bpm, seconds = 30, sampleRate = 44100) {
  const length = Math.floor(seconds * sampleRate);
  const data = new Float32Array(length);
  const beat = 60 / bpm;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    data[i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-(t % beat) * 60) * 0.8;
  }
  return { sampleRate, length, getChannelData: () => data };
}

async function waitFor(check, message) {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

const finished = (worker) => () => worker.ofType("finish").length === 1;

test("시작 → 덩어리들 → 끝내기 순서로 보내고, 덩어리는 원본의 복사본을 소유권째 넘긴다", async () => {
  const worker = fakeWorker();
  const original = rampSource(4.5, 1000); // 4,500샘플
  const progress = [];
  const pending = analyzeBpm(original, { createWorker: () => worker, chunkSamples: 1000, onProgress: (value) => progress.push(value) });
  await waitFor(finished(worker), "끝내기 메시지");

  const types = worker.posted.map((entry) => entry.message.type);
  assert.deepEqual(types, ["start", "chunk", "chunk", "chunk", "chunk", "chunk", "finish"]);
  assert.deepEqual(worker.ofType("start"), [{ type: "start", sampleRate: 1000, length: 4500 }]);

  const chunks = worker.ofType("chunk");
  assert.deepEqual(chunks.map((chunk) => chunk.offset), [0, 1000, 2000, 3000, 4000]);
  assert.deepEqual(chunks.map((chunk) => chunk.samples.length), [1000, 1000, 1000, 1000, 500]);
  const joined = new Float32Array(4500);
  for (const chunk of chunks) joined.set(chunk.samples, chunk.offset);
  assert.deepEqual(joined, original.getChannelData(0), "이어 붙이면 원본과 같다");
  for (const entry of worker.posted.filter((item) => item.message.type === "chunk")) {
    assert.deepEqual(entry.transfer, [entry.message.samples.buffer], "복사본의 버퍼를 넘긴다(복사 없이 소유권 이전)");
    assert.notEqual(entry.message.samples.buffer, original.getChannelData(0).buffer, "원본 버퍼가 아니다");
  }

  worker.reply({ type: "progress", value: 0.25 });
  worker.reply({ type: "progress", value: 0.75 });
  worker.reply({ type: "done", bpm: 123.4 });
  assert.equal(await pending, 123.4);
  assert.deepEqual(progress, [0.25, 0.75]);
  assert.equal(worker.terminated, 1, "끝나면 Worker를 끝낸다");
  assert.equal(original.getChannelData(0)[1234], 234, "원본 음원은 그대로다");
});

test("덩어리 하나는 기본 256K 샘플(1 MB)이라 복사가 느린 기기에서도 몇 ms 안에 끝난다", async () => {
  assert.equal(BPM_CHUNK_SAMPLES, 262_144);
  const worker = fakeWorker();
  const pending = analyzeBpm(rampSource(60), { createWorker: () => worker });
  await waitFor(finished(worker), "끝내기 메시지");
  const sizes = worker.ofType("chunk").map((chunk) => chunk.samples.length);
  assert.ok(Math.max(...sizes) <= BPM_CHUNK_SAMPLES);
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), 60 * 8000);
  worker.reply({ type: "done", bpm: 90 });
  await pending;
});

test("10분 곡도 앞 180초만 보낸다(복사는 곡 길이와 무관하게 180초분)", async () => {
  const worker = fakeWorker();
  const pending = analyzeBpm(rampSource(600), { createWorker: () => worker });
  await waitFor(finished(worker), "끝내기 메시지");
  assert.equal(worker.ofType("start")[0].length, BPM_ANALYSIS_SECONDS * 8000);
  const total = worker.ofType("chunk").reduce((sum, chunk) => sum + chunk.samples.length, 0);
  assert.equal(total, BPM_ANALYSIS_SECONDS * 8000);
  worker.reply({ type: "done", bpm: 90 });
  await pending;
});

test("Worker가 다 쓰지 않은 덩어리는 3개(maxInFlight)를 넘게 보내지 않고, 다 썼다고 알리면 이어서 보낸다", async () => {
  const worker = fakeWorker({ autoAck: false });
  const pending = analyzeBpm(rampSource(10, 1000), { createWorker: () => worker, chunkSamples: 1000 });
  await waitFor(() => worker.ofType("chunk").length === 3, "덩어리 3개");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(worker.ofType("chunk").length, 3, "답이 없으면 더 쌓아 두지 않는다");

  worker.reply({ type: "ack" });
  await waitFor(() => worker.ofType("chunk").length === 4, "덩어리 4개");
  worker.reply({ type: "ack" });
  worker.reply({ type: "ack" });
  await waitFor(() => worker.ofType("chunk").length === 6, "덩어리 6개");
  for (let i = 0; i < 20; i++) worker.reply({ type: "ack" });
  await waitFor(finished(worker), "끝내기 메시지");
  assert.equal(worker.ofType("chunk").length, 10);
  worker.reply({ type: "done", bpm: 100 });
  await pending;
});

test("Worker가 박자를 못 찾으면 undefined", async () => {
  const worker = fakeWorker();
  const pending = analyzeBpm(rampSource(2), { createWorker: () => worker });
  await waitFor(finished(worker), "끝내기 메시지");
  worker.reply({ type: "done", bpm: null });
  assert.equal(await pending, undefined);
});

test("그만두기: 덩어리를 보내는 중에 signal을 끊으면 Worker를 끝내고 BpmCancelledError로 거절하며, 더 보내지 않는다", async () => {
  const worker = fakeWorker({ autoAck: false });
  const controller = new AbortController();
  const progress = [];
  const pending = analyzeBpm(rampSource(10, 1000), { createWorker: () => worker, chunkSamples: 1000, signal: controller.signal, onProgress: (value) => progress.push(value) });
  await waitFor(() => worker.ofType("chunk").length === 3, "덩어리 3개");
  controller.abort();
  await assert.rejects(pending, BpmCancelledError);
  assert.equal(worker.terminated, 1);

  worker.onmessage?.({ data: { type: "ack" } });
  worker.onmessage?.({ data: { type: "progress", value: 0.9 } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(worker.ofType("chunk").length, 3, "그만둔 뒤에는 덩어리를 더 보내지 않는다");
  assert.equal(worker.ofType("finish").length, 0);
  assert.deepEqual(progress, []);
});

test("그만두기: 계산하는 중(끝내기를 보낸 뒤)에 끊어도 거절하고 Worker를 끝낸다. 그 뒤 도착한 답은 무시한다", async () => {
  const worker = fakeWorker();
  const controller = new AbortController();
  const progress = [];
  const pending = analyzeBpm(rampSource(2), { createWorker: () => worker, signal: controller.signal, onProgress: (value) => progress.push(value) });
  await waitFor(finished(worker), "끝내기 메시지");
  worker.reply({ type: "progress", value: 0.4 });
  controller.abort();
  await assert.rejects(pending, BpmCancelledError);
  assert.equal(worker.terminated, 1);
  worker.onmessage?.({ data: { type: "progress", value: 0.9 } });
  worker.onmessage?.({ data: { type: "done", bpm: 120 } });
  assert.deepEqual(progress, [0.4], "그만둔 뒤의 진행률은 전달하지 않는다");
});

test("시작하기 전에 이미 끊긴 signal이면 Worker를 만들지 않고 거절한다", async () => {
  const controller = new AbortController();
  controller.abort();
  let created = 0;
  await assert.rejects(
    analyzeBpm(rampSource(2), { createWorker: () => { created += 1; return fakeWorker(); }, signal: controller.signal }),
    BpmCancelledError,
  );
  assert.equal(created, 0);
});

test("Worker가 오류를 알리면 그 이유로 거절하고 Worker를 끝낸다", async () => {
  const worker = fakeWorker();
  const pending = analyzeBpm(rampSource(2), { createWorker: () => worker });
  await waitFor(finished(worker), "끝내기 메시지");
  worker.reply({ type: "error", message: "분석 오류" });
  await assert.rejects(pending, /분석 오류/);
  assert.equal(worker.terminated, 1);
});

test("Worker 자체가 실패(onerror)해도 거절하고 Worker를 끝낸다", async () => {
  const worker = fakeWorker({ autoAck: false });
  const pending = analyzeBpm(rampSource(2), { createWorker: () => worker });
  await waitFor(() => worker.ofType("chunk").length === 1, "덩어리");
  worker.onerror?.({ message: "스크립트를 불러오지 못했습니다" });
  await assert.rejects(pending, /스크립트를 불러오지 못했습니다/);
  assert.equal(worker.terminated, 1);
});

test("길이가 0인 음원은 Worker 없이 undefined", async () => {
  let created = 0;
  const empty = { sampleRate: 44100, length: 0, getChannelData: () => new Float32Array(0) };
  assert.equal(await analyzeBpm(empty, { createWorker: () => { created += 1; return fakeWorker(); } }), undefined);
  assert.equal(created, 0);
});

test("Worker를 만들 수 없으면 화면 스레드에서 계산한다: 결과가 같고 진행률이 0~1로 오르다 1로 끝난다", async () => {
  const progress = [];
  const detected = await analyzeBpm(clickTrack(120), { createWorker: () => undefined, onProgress: (value) => progress.push(value) });
  assert.ok(detected !== undefined && Math.abs(detected - 120) <= 1, `감지값 ${detected}`);
  assert.ok(progress.length > 3, "진행률을 여러 번 알린다");
  assert.equal(progress[progress.length - 1], 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] > progress[i - 1], "같은 퍼센트는 다시 알리지 않고 거꾸로 가지 않는다");
  assert.ok(progress.every((value) => value >= 0 && value <= 1));
});

test("Worker가 없을 때도 시작 전에 끊으면 계산하지 않고 거절한다", async () => {
  const controller = new AbortController();
  const pending = analyzeBpm(clickTrack(120), { createWorker: () => undefined, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, BpmCancelledError);
});
