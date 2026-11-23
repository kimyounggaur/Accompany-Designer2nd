import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkRecorder, RECORDER_CHUNK_FRAMES, RECORDER_PEAK_FRAMES } from "../src/audio/worklets/recorderCore.ts";

/** 조각을 모아 두는 녹음기. 작은 조각 크기로 만들면 경계를 손으로 셀 수 있다. */
function make(chunkFrames = 8, peakFrames = 4) {
  const chunks = [];
  const recorder = new ChunkRecorder((chunk) => chunks.push(chunk), chunkFrames, peakFrames);
  return { chunks, recorder };
}

/** 프레임 번호 ÷ 64를 값으로 쓰는 블록(Float32로 정확히 나타낼 수 있어 비교가 쉽다). */
function ramp(startFrame, length) {
  return Float32Array.from({ length }, (_, index) => (startFrame + index) / 64);
}

const values = (samples) => Array.from(samples);

test("기본 조각은 4096 프레임, 파형 칸은 256 프레임이다", () => {
  assert.equal(RECORDER_CHUNK_FRAMES, 4096);
  assert.equal(RECORDER_PEAK_FRAMES, 256);
});

test("128 프레임 블록을 모아 4096 프레임씩 내보내고, 조각마다 파형 최대값 16개가 따라온다", () => {
  const chunks = [];
  const recorder = new ChunkRecorder((chunk) => chunks.push(chunk));
  recorder.arm(0);
  const block = new Float32Array(128).fill(0.5);
  for (let index = 0; index < 64; index += 1) recorder.process([block], index * 128, 128); // 8192 프레임
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.equal(chunk.samples.length, 4096);
    assert.equal(chunk.peaks.length, 16);
    assert.ok(chunk.peaks.every((peak) => peak === 0.5));
  }
  assert.deepEqual(chunks.map((chunk) => chunk.firstFrame), [0, 4096]);
  assert.equal(recorder.framesCaptured, 8192);
  assert.equal(recorder.firstFrame, 0);
});

test("시작 프레임 앞의 소리는 버리고, 시작 프레임의 샘플부터 담는다", () => {
  const { chunks, recorder } = make(8, 4);
  recorder.arm(10);
  // 4프레임 블록: 8..11 블록 안에서 10, 11만 쓴다.
  for (let start = 0; start < 28; start += 4) recorder.process([ramp(start, 4)], start, 4);
  recorder.stop();
  assert.equal(recorder.firstFrame, 10);
  assert.equal(recorder.framesCaptured, 18); // 10..27
  assert.deepEqual(chunks.map((chunk) => chunk.firstFrame), [10, 18, 26]);
  assert.deepEqual(values(chunks[0].samples), [10, 11, 12, 13, 14, 15, 16, 17].map((frame) => frame / 64));
  assert.deepEqual(values(chunks[1].samples), [18, 19, 20, 21, 22, 23, 24, 25].map((frame) => frame / 64));
  assert.deepEqual(values(chunks[2].samples), [26 / 64, 27 / 64], "남은 조각은 stop()이 짧은 채로 내보낸다");
});

test("조각의 파형 최대값은 파형 칸(프레임 수)마다 절댓값의 최대다", () => {
  const { chunks, recorder } = make(8, 4);
  recorder.arm(0);
  recorder.process([Float32Array.from([0.1, -0.7, 0.2, 0.3, 0.9, 0.1, -0.2, 0.05])], 0, 8);
  assert.equal(chunks.length, 1);
  assert.deepEqual(values(chunks[0].peaks), [Math.fround(0.7), Math.fround(0.9)]);
});

test("마지막 조각이 짧으면 파형 칸도 그만큼만 낸다", () => {
  const { chunks, recorder } = make(8, 4);
  recorder.arm(0);
  recorder.process([ramp(0, 5)], 0, 5);
  recorder.stop();
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].samples.length, 5);
  assert.equal(chunks[0].peaks.length, 2); // ceil(5 / 4)
});

test("시작 프레임이 이미 지났으면 다음 블록부터 담고, 실제 첫 프레임을 알려 준다", () => {
  const { chunks, recorder } = make(8, 4);
  recorder.arm(2); // 메시지가 늦게 닿아 첫 블록이 100프레임에서 시작한다
  recorder.process([ramp(100, 4)], 100, 4);
  recorder.stop();
  assert.equal(recorder.firstFrame, 100);
  assert.equal(chunks[0].firstFrame, 100);
  assert.equal(chunks[0].samples.length, 4);
});

test("여러 채널은 평균 내어 모노로 합친다", () => {
  const { chunks, recorder } = make(4, 4);
  recorder.arm(0);
  recorder.process([Float32Array.from([1, 0.5, 0, -1]), Float32Array.from([0, 0.5, 1, -1])], 0, 4);
  assert.deepEqual(values(chunks[0].samples), [0.5, 0.5, 0.5, -1]);
});

test("채널이 하나뿐이면 값을 그대로 담는다(나누지 않는다)", () => {
  const { chunks, recorder } = make(4, 4);
  recorder.arm(0);
  recorder.process([Float32Array.from([0.25, -0.5, 0.75, 1])], 0, 4);
  assert.deepEqual(values(chunks[0].samples), [0.25, -0.5, 0.75, 1]);
});

test("입력이 끊겨 채널이 없는 블록은 0으로 채워 샘플 수가 오디오 시계와 어긋나지 않게 한다", () => {
  const { chunks, recorder } = make(8, 4);
  recorder.arm(0);
  recorder.process([ramp(0, 4)], 0, 4);
  recorder.process([], 4, 4); // 마이크가 끊긴 블록
  recorder.process([ramp(8, 4)], 8, 4);
  recorder.stop();
  assert.equal(recorder.framesCaptured, 12);
  assert.deepEqual(values(chunks[0].samples), [0, 1, 2, 3, 0, 0, 0, 0].map((frame) => frame / 64));
  assert.deepEqual(values(chunks[1].samples), [8, 9, 10, 11].map((frame) => frame / 64));
});

test("arm()은 한 번만 먹는다: 이미 담는 중이면 시작 프레임을 바꾸지 않는다", () => {
  const { recorder } = make();
  recorder.arm(5);
  recorder.arm(500);
  recorder.process([ramp(0, 8)], 0, 8);
  assert.equal(recorder.firstFrame, 5);
  assert.equal(recorder.isArmed, true);
});

test("arm() 전의 블록과 stop() 뒤의 블록은 담지 않는다", () => {
  const { chunks, recorder } = make(4, 4);
  recorder.process([ramp(0, 4)], 0, 4); // arm 전
  assert.equal(recorder.framesCaptured, 0);
  recorder.arm(0);
  recorder.process([ramp(4, 4)], 4, 4);
  recorder.stop();
  recorder.process([ramp(8, 4)], 8, 4); // stop 뒤
  assert.equal(chunks.length, 1);
  assert.equal(recorder.framesCaptured, 4);
  assert.equal(recorder.isArmed, false);
});

test("담은 것이 없으면 stop()이 아무것도 내보내지 않고 firstFrame은 -1이다", () => {
  const { chunks, recorder } = make();
  recorder.arm(1000);
  recorder.process([ramp(0, 8)], 0, 8); // 시작 프레임 전
  recorder.stop();
  assert.equal(chunks.length, 0);
  assert.equal(recorder.firstFrame, -1);
  assert.equal(recorder.framesCaptured, 0);
});

test("10초(48 kHz)를 128 프레임 블록으로 받아도 한 프레임도 잃지 않고 조각이 끊김 없이 이어진다", () => {
  const sampleRate = 48000;
  const total = sampleRate * 10;
  const start = 48000 * 3 + 37; // 블록 경계에 맞지 않는 시작
  const chunks = [];
  const recorder = new ChunkRecorder((chunk) => chunks.push(chunk));
  recorder.arm(start);
  const block = new Float32Array(128).fill(0.25);
  for (let frame = 0; frame < start + total; frame += 128) recorder.process([block], frame, 128);
  recorder.stop();
  const captured = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0);
  assert.ok(captured >= total && captured < total + 128, `담은 프레임 ${captured}`);
  assert.equal(recorder.framesCaptured, captured);
  let expected = start;
  for (const chunk of chunks) {
    assert.equal(chunk.firstFrame, expected, "조각의 첫 프레임은 앞 조각이 끝난 바로 다음");
    expected += chunk.samples.length;
  }
  assert.equal(recorder.firstFrame, start);
  assert.ok(chunks.slice(0, -1).every((chunk) => chunk.samples.length === 4096));
});
