import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PEAKS_PER_DISPLAY_BAR,
  RECORDING_TICK_MS,
  UI_UPDATE_MIN_INTERVAL_MS,
} from "../src/audio/recording/RecordingController.ts";
import { SAMPLE_RATE, createHarness, deferred, flush } from "./helpers/recording-harness.mjs";

const near = (actual, expected, message = "", tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} 기대 ${expected}, 실제 ${actual}`);

// ───────── 정상 흐름 ─────────

test("4박 카운트인 → 녹음 → 정지: 단계가 차례로 바뀌고, 반주와 녹음은 같은 시각에 시작한다", async () => {
  const h = createHarness({ now: 1, bpm: 120, playhead: 3, settings: { countInBeats: 4 } });
  assert.equal(h.controller.phase, "idle");
  await h.controller.start();

  // 준비 → 카운트인. 반주·녹음 시작은 t0(1.1초) + 4박(2초) = 3.1초.
  assert.equal(h.controller.phase, "counting-in");
  assert.deepEqual(h.statuses(), ["preparing", "counting-in"]);
  assert.equal(h.calls.play.length, 1);
  assert.equal(h.calls.play[0].from, 3, "편집 커서에서 재생한다");
  near(h.calls.play[0].atContextTime, 3.1, "반주 시작 시각");
  assert.equal(h.recorder.beganAt, Math.round(3.1 * SAMPLE_RATE), "녹음기는 같은 시각의 프레임부터 담는다");
  assert.equal(h.recorder.beganAt, Math.round(h.calls.play[0].atContextTime * SAMPLE_RATE), "반주와 녹음 시작이 1프레임 이내로 같다");
  assert.equal(h.clicks.length, 4);
  assert.deepEqual(h.clicks.map((entry) => entry.click.strong), [true, false, false, false]);
  assert.equal(h.timer.interval, RECORDING_TICK_MS);
  assert.equal(h.log.chooseCalls, 0, "트랙은 녹음이 시작될 때 고른다");
  assert.deepEqual(h.log.playing, [], "화면의 재생 표시는 카운트인이 끝난 뒤에 켠다");

  // 카운트인 표시: 4, 3, 2, 1
  for (const time of [1.2, 1.7, 2.2, 2.7]) h.tickAt(time);
  assert.deepEqual(h.log.events.filter((event) => event.type === "countIn").map((event) => event.remaining), [4, 3, 2, 1]);
  assert.equal(h.controller.phase, "counting-in");

  // 카운트인이 끝나면 녹음 단계. 같은 시각에 틱이 또 와도 한 번만 들어간다.
  h.tickAt(3.2);
  h.timer.fire();
  assert.equal(h.controller.phase, "recording");
  assert.equal(h.log.chooseCalls, 1);
  assert.deepEqual(h.log.playing, [true]);
  assert.deepEqual(h.log.events.at(-1), { type: "started", fileName: "녹음 001.wav" });
  const entered = h.log.updates.findLast((patch) => patch.status === "recording");
  assert.equal(entered.trackId, "track-1");
  near(entered.startedAtProjectTime, 3, "잠정 시작 위치는 반주가 시작한 자리");

  // 첫 조각이 오면 첫 샘플의 시각으로 시작 위치를 바로잡는다(128 프레임 늦게 시작한 경우).
  h.recorder.emit(4096, { firstFrame: h.recorder.beganAt + 128 });
  const corrected = h.log.updates.findLast((patch) => "startedAtProjectTime" in patch && patch.status === undefined);
  near(corrected.startedAtProjectTime, 3 + 128 / SAMPLE_RATE, "첫 샘플의 자리");
  h.recorder.emit(4096);

  // 정지
  h.context.currentTime = 4.1;
  await h.controller.stop();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.statuses().slice(-1), ["stopping"]);
  assert.equal(h.calls.stop, 1, "정지하면 재생도 멈춘다");
  assert.deepEqual(h.log.playing, [true, false]);
  near(h.log.playheads.at(-1), 4, "멈춘 그 자리에 재생 위치를 둔다");
  assert.equal(h.recorder.finishCalls, 1);
  assert.deepEqual(h.eventTypes().slice(-2), ["saving", "saved"]);
  assert.equal(h.log.commits.length, 1);
  const commit = h.log.commits[0];
  assert.equal(commit.trackId, "track-1");
  assert.equal(commit.asset.id, "asset-1");
  assert.equal(commit.clipId, "clip-1");
  assert.equal(commit.bpm, 120);
  assert.equal(commit.trim, 0);
  near(commit.startTime, 3 + 128 / SAMPLE_RATE, "클립 시작 위치");
  assert.deepEqual(h.log.remembered.map((entry) => entry.assetId), ["asset-1"]);
  assert.equal(h.log.resets, 1);
  assert.equal(h.timer.disposed, true);
});

test("이미 재생 중이면 카운트인 없이 지금 흐르는 곡에 맞춰 바로 녹음하고, 재생을 다시 시작하지 않는다", async () => {
  const h = createHarness({ now: 2, alreadyPlaying: true, playingFrom: 5, settings: { countInBeats: 4 } });
  await h.controller.start();
  assert.equal(h.controller.phase, "recording");
  assert.equal(h.calls.play.length, 0, "재생을 다시 시작하지 않는다");
  assert.equal(h.clicks.length, 0, "카운트인 클릭이 없다");
  assert.equal(h.recorder.beganAt, Math.round(2.1 * SAMPLE_RATE), "지금 + 0.1초부터 담는다");
  assert.equal(h.log.chooseCalls, 1);
  assert.deepEqual(h.log.playing, [], "재생 표시는 이미 켜져 있으니 건드리지 않는다");
  const entered = h.log.updates.findLast((patch) => patch.status === "recording");
  near(entered.startedAtProjectTime, 5.1, "곡 시계가 가리키는 자리");

  h.recorder.emit(4096);
  h.context.currentTime = 2.5;
  await h.controller.stop();
  assert.equal(h.calls.stop, 1, "녹음을 끝내면 재생도 멈춘다");
  assert.deepEqual(h.log.playing, [false]);
  assert.equal(h.log.commits.length, 1);
  near(h.log.commits[0].startTime, 5.1);
});

test("카운트인 0박이면 t0(지금 + 0.1초)에 반주와 녹음을 함께 시작하고 바로 녹음 단계다", async () => {
  const h = createHarness({ now: 1, playhead: 2, settings: { countInBeats: 0 } });
  await h.controller.start();
  assert.equal(h.controller.phase, "recording");
  assert.equal(h.clicks.length, 0);
  near(h.calls.play[0].atContextTime, 1.1);
  assert.equal(h.recorder.beganAt, Math.round(1.1 * SAMPLE_RATE));
  assert.deepEqual(h.log.playing, [true]);
  assert.deepEqual(h.statuses(), ["preparing", "recording"]);
});

test("녹음 버튼(toggle): 쉬면 시작하고, 진행 중이면 멈춘다", async () => {
  const h = createHarness({ settings: { countInBeats: 0 } });
  await h.controller.toggle();
  assert.equal(h.controller.phase, "recording");
  h.recorder.emit(4096);
  await h.controller.toggle();
  assert.equal(h.controller.phase, "idle");
  assert.equal(h.log.commits.length, 1);
});

test("녹음 중에 start()를 또 불러도 무시한다", async () => {
  const h = createHarness({ settings: { countInBeats: 0 } });
  await Promise.all([h.controller.start(), h.controller.start()]);
  assert.equal(h.recorders.length, 1);
  await h.controller.start();
  assert.equal(h.recorders.length, 1);
  assert.equal(h.log.chooseCalls, 1);
});

// ───────── 시작 실패·취소 ─────────

test("마이크 허락이 거부되면 준비 단계에서 쉬는 상태로 돌아가고, 시작 오류를 알리며, 아무것도 재생하지 않는다", async () => {
  const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  const h = createHarness({ openError: denied });
  await h.controller.start();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.statuses(), ["preparing"]);
  assert.deepEqual(h.log.failures, [{ error: denied, stage: "start" }]);
  assert.equal(h.calls.play.length, 0);
  assert.equal(h.log.chooseCalls, 0);
  assert.ok(h.recorder.cancelCalls >= 1, "열다 만 녹음기는 닫는다");
  assert.equal(h.log.resets, 1);
  assert.deepEqual(h.log.events, []);

  // 허락한 뒤에는 다시 시도할 수 있다.
  h.config.openError = undefined;
  await h.controller.start();
  assert.equal(h.controller.phase, "recording");
  assert.equal(h.recorders.length, 2);
});

test("오디오 컨텍스트를 만들지 못해도 같은 방식으로 돌아간다", async () => {
  const error = new Error("no audio");
  const h = createHarness({ ensureError: error });
  await h.controller.start();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.log.failures, [{ error, stage: "start" }]);
  assert.equal(h.recorders.length, 0);
});

test("반주를 시작하지 못하면 마이크를 닫고, 켜 둔 재생을 멈추고, 재생 위치를 되돌린다", async () => {
  const error = new Error("play failed");
  const h = createHarness({ playError: error, playhead: 2.5, settings: { countInBeats: 2 } });
  await h.controller.start();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.log.failures, [{ error, stage: "start" }]);
  assert.ok(h.recorder.cancelCalls >= 1);
  assert.equal(h.calls.stop, 1);
  assert.deepEqual(h.log.playing, [false]);
  assert.deepEqual(h.log.playheads, [2.5]);
  assert.deepEqual(h.clicks.map((entry) => entry.cancelled), [true, true], "예약한 클릭도 거둔다");
});

test("준비 중에 정지(녹음 버튼 다시 누름)하면 조용히 취소하고, 늦게 열린 마이크는 닫는다", async () => {
  const gate = deferred();
  const h = createHarness({ openGate: gate.promise });
  const starting = h.controller.start();
  await flush();
  assert.equal(h.controller.phase, "preparing");
  await h.controller.stop();
  assert.equal(h.controller.phase, "idle");
  gate.resolve();
  await starting;
  assert.equal(h.controller.phase, "idle");
  assert.equal(h.calls.play.length, 0, "취소했으니 재생하지 않는다");
  assert.deepEqual(h.log.events, [], "준비 중 취소는 안내하지 않는다");
  assert.ok(h.recorder.cancelCalls >= 1);
  assert.equal(h.log.failures.length, 0);
});

test("오디오 컨텍스트를 기다리는 중에 취소하면 녹음기를 만들지 않는다", async () => {
  const gate = deferred();
  const h = createHarness({ ensureGate: gate.promise });
  const starting = h.controller.start();
  await flush();
  h.controller.cancel({ silent: true });
  gate.resolve();
  await starting;
  assert.equal(h.recorders.length, 0);
  assert.equal(h.controller.phase, "idle");
});

test("카운트인 중에 정지하면 울리지 않은 클릭을 거두고, 재생을 멈추고, 재생 위치를 되돌리고, 취소를 알린다", async () => {
  const h = createHarness({ now: 1, playhead: 3, settings: { countInBeats: 4 } });
  await h.controller.start();
  h.tickAt(1.2); // 첫 클릭(1.1초)은 이미 울렸다
  await h.controller.stop();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.clicks.map((entry) => entry.cancelled), [false, true, true, true]);
  assert.equal(h.calls.stop, 1);
  assert.deepEqual(h.log.playing, [false]);
  assert.deepEqual(h.log.playheads, [3]);
  assert.deepEqual(h.log.events.at(-1), { type: "countInCancelled" });
  assert.ok(h.recorder.cancelCalls >= 1);
  assert.equal(h.log.chooseCalls, 0, "트랙은 아직 고르지 않았으니 거둘 것도 없다");
  assert.deepEqual(h.log.discarded, []);
  assert.equal(h.log.commits.length, 0);
  assert.equal(h.timer.disposed, true);
  assert.equal(h.log.resets, 1);
});

test("카운트인 중에 녹음 버튼을 다시 눌러도 같다(toggle)", async () => {
  const h = createHarness({ settings: { countInBeats: 2 } });
  await h.controller.toggle();
  assert.equal(h.controller.phase, "counting-in");
  await h.controller.toggle();
  assert.equal(h.controller.phase, "idle");
  assert.equal(h.log.events.at(-1).type, "countInCancelled");
});

// ───────── 녹음 중 취소·마무리 ─────────

test("녹음 중에 취소(프로젝트 교체·화면 닫기)하면 저장하지 않고, 이 녹음이 만든 빈 트랙을 거둔다", async () => {
  const h = createHarness({ chosen: { trackId: "new-track", created: true }, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.recorder.emit(4096);
  h.controller.cancel({ silent: true });
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.log.discarded, ["new-track"]);
  assert.equal(h.log.commits.length, 0);
  assert.equal(h.calls.stop, 1);
  assert.deepEqual(h.log.playing, [true, false]);
  assert.ok(!h.eventTypes().includes("saved"));
  assert.ok(!h.eventTypes().includes("countInCancelled"), "녹음 중 취소는 카운트인 취소 안내를 내지 않는다");
});

test("고른 트랙이 이미 있던 트랙이면 취소해도 거두지 않는다", async () => {
  const h = createHarness({ chosen: { trackId: "mine", created: false }, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.controller.cancel();
  assert.deepEqual(h.log.discarded, []);
});

test("녹음된 소리가 없으면 클립을 만들지 않고 안내하며, 만든 빈 트랙을 거둔다", async () => {
  const h = createHarness({ chosen: { trackId: "new-track", created: true }, settings: { countInBeats: 0 } });
  await h.controller.start();
  await h.controller.stop(); // 조각이 하나도 오지 않았다
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.eventTypes().slice(-2), ["saving", "empty"]);
  assert.equal(h.calls.decode.length, 0);
  assert.equal(h.log.commits.length, 0);
  assert.deepEqual(h.log.discarded, ["new-track"]);
  assert.deepEqual(h.log.failures, []);
});

test("저장하다 실패하면 저장 오류를 알리고, 만든 빈 트랙을 거두고, 쉬는 상태로 돌아간다", async () => {
  const error = new Error("decode failed");
  const h = createHarness({ decodeError: error, chosen: { trackId: "new-track", created: true }, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.recorder.emit(4096);
  await h.controller.stop();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.log.failures, [{ error, stage: "save" }]);
  assert.deepEqual(h.log.discarded, ["new-track"]);
  assert.equal(h.log.commits.length, 0);
  assert.ok(!h.eventTypes().includes("saved"));
  assert.equal(h.log.resets, 1);
});

test("녹음기가 마무리하다 실패해도(finish 오류) 같은 방식으로 돌아간다", async () => {
  const error = new Error("finish failed");
  const h = createHarness({ finishError: error, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.recorder.emit(4096);
  await h.controller.stop();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.log.failures, [{ error, stage: "save" }]);
  assert.ok(h.recorder.cancelCalls >= 1, "마이크는 닫는다");
});

test("마무리하는 동안 취소하면 문서에 넣지 않고, 마무리 중에 정지를 또 눌러도 한 번만 마무리한다", async () => {
  const gate = deferred();
  const h = createHarness({ finishGate: gate.promise, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.recorder.emit(4096);
  const stopping = h.controller.stop();
  await flush();
  assert.equal(h.controller.phase, "stopping");
  await h.controller.stop(); // 아무 일도 하지 않는다
  assert.equal(h.recorder.finishCalls, 1);
  h.controller.dispose(); // 프로젝트를 열었다
  assert.equal(h.controller.phase, "idle");
  gate.resolve();
  await stopping;
  assert.equal(h.log.commits.length, 0, "취소한 녹음은 새 문서에 들어가지 않는다");
  assert.ok(!h.eventTypes().includes("saved"));
});

test("디코드하는 동안 취소해도 문서에 넣지 않는다", async () => {
  const gate = deferred();
  const h = createHarness({ decodeGate: gate.promise, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.recorder.emit(4096);
  const stopping = h.controller.stop();
  await flush();
  h.controller.cancel({ silent: true });
  gate.resolve();
  await stopping;
  assert.equal(h.log.commits.length, 0);
  assert.deepEqual(h.log.remembered, []);
});

test("취소하고 다시 시작해도 옛 녹음의 조각은 새 녹음에 섞이지 않는다", async () => {
  const h = createHarness({ settings: { countInBeats: 0 } });
  await h.controller.start();
  const stale = h.recorder.onChunk;
  h.controller.cancel({ silent: true });
  assert.equal(h.recorder.onChunk, undefined, "취소하면 조각을 받지 않는다");
  await h.controller.start();
  const before = h.log.updates.length;
  stale({ samples: new Float32Array(4096), peaks: new Float32Array(16).fill(0.9), firstFrame: 0 });
  assert.equal(h.log.updates.length, before, "옛 조각은 무시한다");
  h.recorder.emit(4096);
  await h.controller.stop();
  assert.equal(h.log.commits.length, 1);
});

test("쉬는 중에 cancel()·dispose()를 불러도 아무 일도 없다", () => {
  const h = createHarness();
  h.controller.cancel();
  h.controller.dispose();
  assert.equal(h.controller.phase, "idle");
  assert.deepEqual(h.log.events, []);
  assert.equal(h.log.resets, 0);
});

// ───────── 지연 보정 ─────────

test("클립 시작 위치 = 첫 샘플 위치 − (출력 + 기본 + 입력 지연 + 사용자 보정)", async () => {
  const h = createHarness({
    now: 1,
    playhead: 2,
    outputLatency: 0.02,
    baseLatency: 0.01,
    inputLatency: 0.005,
    settings: { countInBeats: 0, latencyOffsetMs: 10 },
  });
  await h.controller.start();
  h.recorder.emit(4096); // 첫 프레임 = 녹음 시작 프레임(곡의 2초)
  await h.controller.stop();
  near(h.log.commits[0].startTime, 2 - 0.045, "지연 45 ms를 앞당긴다");
  assert.equal(h.log.commits[0].trim, 0);
});

test("사용자 보정 +100 ms는 같은 조건에서 클립을 0.1초 더 앞으로 당긴다", async () => {
  const startOf = async (latencyOffsetMs) => {
    const h = createHarness({ playhead: 2, outputLatency: 0.03, settings: { countInBeats: 0, latencyOffsetMs } });
    await h.controller.start();
    h.recorder.emit(4096);
    await h.controller.stop();
    return h.log.commits[0].startTime;
  };
  const base = await startOf(0);
  const shifted = await startOf(100);
  const delayed = await startOf(-50);
  near(base - shifted, 0.1, "+100 ms");
  near(delayed - base, 0.05, "−50 ms");
});

test("곡의 시작보다 앞으로 밀리면 0초에 놓고 그만큼 앞을 잘라 내며, 자르는 양은 녹음 길이를 넘지 않는다", async () => {
  const h = createHarness({ playhead: 0, outputLatency: 0.05, assetDuration: 0.03, settings: { countInBeats: 0 } });
  await h.controller.start();
  h.recorder.emit(4096);
  await h.controller.stop();
  const commit = h.log.commits[0];
  assert.equal(commit.startTime, 0);
  near(commit.trim, 0.02, "녹음 길이 0.03초 − 0.01초", 1e-9);

  const longer = createHarness({ playhead: 0, outputLatency: 0.05, assetDuration: 5, settings: { countInBeats: 0 } });
  await longer.controller.start();
  longer.recorder.emit(4096);
  await longer.controller.stop();
  near(longer.log.commits[0].trim, 0.05, "잘라 낼 만큼 자른다", 1e-9);
});

// ───────── 화면 갱신 ─────────

test("화면 갱신(경과 시간·임시 파형)은 50 ms 이상 간격으로 초당 20회를 넘지 않는다", async () => {
  const h = createHarness({ settings: { countInBeats: 0 } });
  assert.equal(UI_UPDATE_MIN_INTERVAL_MS, 50);
  await h.controller.start();
  const before = h.log.updates.length;
  for (let index = 0; index < 100; index += 1) {
    h.setNowMs(index * 10); // 조각이 10 ms마다 온다(실제보다 훨씬 빠른 극단)
    h.recorder.emit(4096);
  }
  const refreshes = h.log.updates.slice(before).filter((patch) => "elapsed" in patch);
  assert.ok(refreshes.length >= 19 && refreshes.length <= 21, `1초 동안 ${refreshes.length}회`);
});

test("임시 파형은 조각의 최대값 4개를 한 칸으로 묶어 쌓는다", async () => {
  const h = createHarness({ settings: { countInBeats: 0 } });
  assert.equal(PEAKS_PER_DISPLAY_BAR, 4);
  await h.controller.start();
  const peaks = [0.1, 0.9, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0, 0, 0, 0, 0.05, 0.02, 0.01, 0.03];
  h.recorder.emit(4096, { peaks });
  const update = h.log.updates.findLast((patch) => "waveformPeaks" in patch && patch.waveformPeaks.length > 0);
  assert.deepEqual(update.waveformPeaks, [0.9, 0.7, 0, 0.05].map(Math.fround));

  // 100개(약 8.5초)가 쌓여도 칸 수는 조각당 4칸이다.
  for (let index = 1; index < 100; index += 1) {
    h.setNowMs(index * 100);
    h.recorder.emit(4096);
  }
  const last = h.log.updates.findLast((patch) => "waveformPeaks" in patch);
  assert.equal(last.waveformPeaks.length, 400);
});

test("경과 시간은 담은 프레임 수 ÷ 샘플레이트다", async () => {
  const h = createHarness({ settings: { countInBeats: 0 } });
  await h.controller.start();
  for (let index = 0; index < 12; index += 1) {
    h.setNowMs(index * 100);
    h.recorder.emit(4000); // 모두 48000 프레임 = 1초
  }
  const last = h.log.updates.findLast((patch) => "elapsed" in patch);
  near(last.elapsed, 48000 / SAMPLE_RATE, "1초", 1e-9);
});

// ───────── 메트로놈 ─────────

test("메트로놈을 켜면 녹음이 시작하는 자리에서 강박으로 시작해 박마다 울리고, 정지하면 남은 클릭을 거둔다", async () => {
  const h = createHarness({ now: 1, bpm: 120, settings: { countInBeats: 2, metronomeEnabled: true } });
  await h.controller.start();
  assert.equal(h.clicks.length, 2, "카운트인 클릭 2개만 먼저 예약한다");
  // 카운트인 클릭은 1.1, 1.6초. 녹음은 2.1초에 시작한다.
  h.run(1.025, 4.0);
  const metronome = h.clicks.slice(2).map((entry) => entry.click);
  // 4.0초까지 돌렸으니 소리 나기 0.15초 안쪽에 든 박 4(4.1초)까지 예약돼 있다.
  assert.deepEqual(metronome.map((click) => click.beat), [0, 1, 2, 3, 4]);
  assert.deepEqual(metronome.map((click) => click.strong), [true, false, false, false, true], "박 0이 강박");
  near(metronome[0].time, 2.1, "첫 박은 녹음이 시작하는 시각", 1e-9);
  near(metronome[1].time, 2.6, "다음 박은 한 박 뒤", 1e-9);
  assert.equal(h.controller.phase, "recording");

  const scheduledBeforeStop = h.clicks.length;
  const upcoming = h.clicks.filter((entry) => entry.click.time > 4.0);
  assert.ok(upcoming.length >= 1, "다음 박이 이미 예약돼 있다");
  h.recorder.emit(4096);
  h.context.currentTime = 4.0;
  await h.controller.stop();
  assert.ok(upcoming.every((entry) => entry.cancelled), "정지하면 울리지 않은 박은 거둔다");
  h.run(4.025, 5);
  assert.equal(h.clicks.length, scheduledBeforeStop, "정지한 뒤에는 새 박을 예약하지 않는다");
});

test("메트로놈을 끄면 카운트인 클릭만 있다", async () => {
  const h = createHarness({ now: 1, settings: { countInBeats: 2, metronomeEnabled: false } });
  await h.controller.start();
  h.run(1.025, 4);
  assert.equal(h.clicks.length, 2);
});
