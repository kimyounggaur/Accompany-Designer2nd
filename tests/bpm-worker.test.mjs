/**
 * BPM Worker의 메시지 약속(audio/workers/bpm.worker.ts, 설계서 §P4-4):
 * start → chunk(여러 번, 하나마다 ack) → finish → progress… → done. Worker 전역(self)을 흉내 내어 같은 모듈을 그대로 돌린다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { estimateBpmFromSamples } from "../src/audio/bpmDetector.ts";

const sent = [];
globalThis.self = { postMessage: (message) => sent.push(message), onmessage: null };
await import("../src/audio/workers/bpm.worker.ts");
const send = (data) => globalThis.self.onmessage({ data });
const ofType = (type) => sent.filter((message) => message.type === type);

function clickSamples(bpm, seconds, sampleRate) {
  const data = new Float32Array(Math.floor(seconds * sampleRate));
  const beat = 60 / bpm;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    data[i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-(t % beat) * 60) * 0.8;
  }
  return data;
}

function feed(data, sampleRate, chunk) {
  send({ type: "start", sampleRate, length: data.length });
  for (let offset = 0; offset < data.length; offset += chunk) send({ type: "chunk", offset, samples: data.slice(offset, offset + chunk) });
  send({ type: "finish" });
}

beforeEach(() => {
  sent.length = 0;
});

test("덩어리마다 ack를 보내고, finish에서 진행률을 알리며 계산해 done으로 끝낸다(한 번에 계산한 값과 같다)", () => {
  const data = clickSamples(120, 30, 44100);
  feed(data, 44100, 100_000);
  assert.equal(ofType("ack").length, Math.ceil(data.length / 100_000));
  assert.equal(ofType("error").length, 0);
  const done = ofType("done");
  assert.equal(done.length, 1);
  assert.ok(Math.abs(done[0].bpm - 120) <= 1, `감지값 ${done[0].bpm}`);
  assert.equal(done[0].bpm, estimateBpmFromSamples(data, 44100));
  const progress = ofType("progress").map((message) => message.value);
  assert.ok(progress.length > 3);
  assert.equal(progress[progress.length - 1], 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] > progress[i - 1]);
  assert.equal(sent[sent.length - 1].type, "done", "done이 마지막");
});

test("덩어리를 순서가 바뀌어 받아도 offset 자리에 놓는다", () => {
  const data = clickSamples(100, 30, 44100);
  send({ type: "start", sampleRate: 44100, length: data.length });
  const chunk = 200_000;
  const offsets = [];
  for (let offset = 0; offset < data.length; offset += chunk) offsets.push(offset);
  for (const offset of offsets.reverse()) send({ type: "chunk", offset, samples: data.slice(offset, offset + chunk) });
  send({ type: "finish" });
  assert.equal(ofType("done")[0].bpm, estimateBpmFromSamples(data, 44100));
});

test("무음이면 done의 bpm은 null", () => {
  feed(new Float32Array(44100 * 12), 44100, 262_144);
  assert.equal(ofType("done").length, 1);
  assert.equal(ofType("done")[0].bpm, null);
});

test("start 없이 chunk·finish를 받거나 범위를 벗어난 덩어리를 받으면 error를 보낸다", () => {
  send({ type: "finish" });
  assert.equal(ofType("error").length, 1);
  sent.length = 0;
  send({ type: "start", sampleRate: 44100, length: 100 });
  send({ type: "chunk", offset: 50, samples: new Float32Array(100) });
  assert.equal(ofType("error").length, 1);
  assert.equal(ofType("ack").length, 0);
  sent.length = 0;
  send({ type: "chunk", offset: -1, samples: new Float32Array(10) });
  assert.equal(ofType("error").length, 1);
});
