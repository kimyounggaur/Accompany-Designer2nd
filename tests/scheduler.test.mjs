import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { produce } from "immer";
import { FakeContext, Source, createManualTimer } from "./helpers/fake-audio.mjs";
import { makeClip, makeDoc, makeMultiDoc } from "./helpers/docs.mjs";

globalThis.window = { AudioContext: FakeContext };
const { ClipVoice, START_FADE, STOP_FADE } = await import("../src/audio/engine/ClipVoice.ts");
const { Scheduler, LOOKAHEAD_SECONDS, TICK_MS } = await import("../src/audio/engine/Scheduler.ts");
const { TransportClock } = await import("../src/audio/engine/Transport.ts");
const { planVoice } = await import("../src/domain/timeline/clipMath.ts");

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);
const nearAll = (actual, expected, message = "") => {
  assert.equal(actual?.length, expected.length, `${message} 길이`);
  expected.forEach((value, i) => near(actual[i], value, `${message} [${i}]`));
};

beforeEach(() => {
  Source.starts = [];
});

/** 노드가 만들어지는 대로 모아 두는 가짜 컨텍스트. voice가 만든 게인은 (포락선, 시작·정지 게인) 순서다. */
function trackedContext() {
  const ctx = new FakeContext();
  ctx.currentTime = 100;
  const out = ctx.createGain();
  const gains = [];
  const original = ctx.createGain.bind(ctx);
  ctx.createGain = () => {
    const node = original();
    gains.push(node);
    return node;
  };
  return { ctx, out, gains };
}

const at = (position) => 100 + position;
const makeBuffer = (ctx, seconds = 10) => ctx.createBuffer(1, 44100 * seconds, 44100);

// ───── ClipVoice ─────

test("ClipVoice: 클립 처음부터 시작하면 소스를 계획대로 예약하고 시작 페이드는 걸지 않는다", () => {
  const { ctx, out, gains } = trackedContext();
  const clip = makeClip("t", "c", 4, { duration: 2 });
  const plan = planVoice(clip, 120, 1, 10, at);
  const voice = new ClipVoice(ctx, clip, makeBuffer(ctx), out, plan);

  assert.equal(Source.starts.length, 1);
  nearAll(Source.starts[0].started, [104, 0, 2], "source.start(when, offset, duration)");
  near(Source.starts[0].playbackRate.value, 1);
  const [envelope, gate] = gains;
  assert.deepEqual(gate.gain.events, [], "클립 처음에서는 시작 게인을 건드리지 않는다");
  assert.deepEqual(gate.gain.assigned, [], "시작 게인의 기본값(1)도 그대로 둔다");
  assert.deepEqual(envelope.gain.assigned, [1], "포락선은 예약의 첫 값(클립 음량 1)을 처음 값으로 먼저 맞춘다");
  assert.ok(envelope.gain.events.some((event) => event.type === "set" && event.value === 1 && event.time === 104), "포락선: 클립 음량이 시작 시각에 걸린다");
  assert.equal(voice.isStopped, false);
  assert.equal(voice.clip, clip);
  assert.equal(voice.plan, plan);
});

test("ClipVoice: 클립 중간에서 시작하면 시작 게인만 0→1로 5ms에 걸쳐 올린다", () => {
  const { ctx, out, gains } = trackedContext();
  const clip = makeClip("t", "c", 4, { duration: 2 });
  const plan = planVoice(clip, 120, 5, 10, at);
  new ClipVoice(ctx, clip, makeBuffer(ctx), out, plan);

  nearAll(Source.starts[0].started, [105, 1, 1], "클립 안 1초 지점부터 1초");
  const [envelope, gate] = gains;
  assert.deepEqual(gate.gain.events, [
    { type: "set", value: 0, time: 105 },
    { type: "ramp", value: 1, time: 105 + START_FADE },
  ]);
  assert.deepEqual(gate.gain.assigned, [0], "처음 값을 0으로 먼저 맞춘다: 기본값 1이 예약 값으로 바뀌기 전의 첫 샘플이 새어 나가면 소리가 한 샘플 튄다");
  near(START_FADE, 0.005);
  assert.ok(!envelope.gain.events.some((event) => event.type === "ramp"), "클립 자체의 포락선에는 시작 페이드를 섞지 않는다");
});

test("ClipVoice: 포락선의 처음 값은 예약의 첫 값과 같다 (클립 음량·페이드 인이 있어도 첫 샘플이 새지 않는다)", () => {
  const faded = trackedContext();
  const fadedClip = makeClip("t", "c", 4, { duration: 2, gain: 0.8, fadeIn: 0.5 });
  new ClipVoice(faded.ctx, fadedClip, makeBuffer(faded.ctx), faded.out, planVoice(fadedClip, 120, 1, 10, at));
  assert.deepEqual(faded.gains[0].gain.assigned, [0.0001], "페이드 인 맨 앞은 0에 가까운 값");

  const mid = trackedContext();
  const midClip = makeClip("t", "c", 4, { duration: 2, gain: 0.8, fadeIn: 0.5 });
  new ClipVoice(mid.ctx, midClip, makeBuffer(mid.ctx), mid.out, planVoice(midClip, 120, 5, 10, at));
  assert.deepEqual(mid.gains[0].gain.assigned, [0.8], "페이드 인이 끝난 뒤에서 시작하면 클립 음량");

  const muted = trackedContext();
  const mutedClip = makeClip("t", "c", 4, { duration: 2, gain: 0 });
  new ClipVoice(muted.ctx, mutedClip, makeBuffer(muted.ctx), muted.out, planVoice(mutedClip, 120, 1, 10, at));
  assert.deepEqual(muted.gains[0].gain.assigned, [0]);
});

test("ClipVoice: 템포에 맞춰 늘이는(WARP) 클립은 재생 배율을 소스에 건다", () => {
  const { ctx, out } = trackedContext();
  const clip = makeClip("t", "c", 4, { duration: 2.4, sourceBpm: 100, stretchMode: "resample", offset: 0.5 });
  const plan = planVoice(clip, 120, 4, 10, at);
  new ClipVoice(ctx, clip, makeBuffer(ctx), out, plan);
  near(Source.starts[0].playbackRate.value, 1.2);
  nearAll(Source.starts[0].started, [104, 0.5, 2.4]);
});

test("ClipVoice.stop(): 정지 게인을 지금 값에서 붙잡아 0으로 내리고(약 8ms), 소스는 16ms 뒤 멈춘다", () => {
  const { ctx, out, gains } = trackedContext();
  const clip = makeClip("t", "c", 0, { duration: 2 });
  const voice = new ClipVoice(ctx, clip, makeBuffer(ctx), out, planVoice(clip, 120, 0, 10, at));
  const [, gate] = gains;
  gate.gain.events.length = 0;
  ctx.currentTime = 150;

  voice.stop();
  assert.equal(voice.isStopped, true);
  assert.deepEqual(gate.gain.events, [
    { type: "hold", time: 150 },
    { type: "target", value: 0, time: 150, constant: STOP_FADE / 4 },
  ]);
  assert.equal(Source.starts[0].stopped, true);
  near(Source.starts[0].stopAt, 150 + STOP_FADE * 2);
  near(STOP_FADE, 0.008);
});

test("ClipVoice.stop(at): 정한 시각에 내린다. 여러 번 불러도 한 번만 동작한다", () => {
  const { ctx, out, gains } = trackedContext();
  const clip = makeClip("t", "c", 0, { duration: 2 });
  const voice = new ClipVoice(ctx, clip, makeBuffer(ctx), out, planVoice(clip, 120, 0, 10, at));
  const [, gate] = gains;
  gate.gain.events.length = 0;

  voice.stop(107);
  const eventsAfterFirst = gate.gain.events.length;
  const stopAt = Source.starts[0].stopAt;
  voice.stop(120);
  voice.stop();
  assert.equal(gate.gain.events.length, eventsAfterFirst, "두 번째부터는 아무것도 더하지 않는다");
  assert.equal(Source.starts[0].stopAt, stopAt);
  assert.equal(gate.gain.events[0].time, 107);
});

test("ClipVoice.stop(): cancelAndHoldAtTime이 없는 브라우저에서는 cancelScheduledValues로 대신한다", () => {
  const { ctx, out, gains } = trackedContext();
  const clip = makeClip("t", "c", 0, { duration: 2 });
  const voice = new ClipVoice(ctx, clip, makeBuffer(ctx), out, planVoice(clip, 120, 0, 10, at));
  const [, gate] = gains;
  gate.gain.events.length = 0;
  gate.gain.cancelAndHoldAtTime = undefined;

  voice.stop(130);
  assert.deepEqual(gate.gain.events.map((event) => event.type), ["cancel", "target"]);
});

test("ClipVoice.stop(): 소스가 이미 끝나서 stop()이 던져도 밖으로 새지 않는다", () => {
  const { ctx, out } = trackedContext();
  const clip = makeClip("t", "c", 0, { duration: 2 });
  const voice = new ClipVoice(ctx, clip, makeBuffer(ctx), out, planVoice(clip, 120, 0, 10, at));
  Source.starts[0].stop = () => { throw new Error("InvalidStateError"); };
  assert.doesNotThrow(() => voice.stop());
  assert.equal(voice.isStopped, true);
});

test("ClipVoice: 소리가 끝나면 노드를 모두 끊고 끝났음을 알린다", () => {
  const { ctx, out, gains } = trackedContext();
  const clip = makeClip("t", "c", 0, { duration: 2 });
  const ended = [];
  const voice = new ClipVoice(ctx, clip, makeBuffer(ctx), out, planVoice(clip, 120, 0, 10, at), (v) => ended.push(v));
  const [envelope, gate] = gains;
  Source.starts[0].finish();
  assert.deepEqual(ended, [voice]);
  assert.equal(Source.starts[0].disconnected, true);
  assert.equal(envelope.disconnected, true);
  assert.equal(gate.disconnected, true);
});

// ───── Scheduler ─────

/** 가짜 컨텍스트 + 재생 시계 + 손으로 돌리는 타이머 + 예약기 */
function makeRig(doc, { endAt = 100 } = {}) {
  const ctx = new FakeContext();
  ctx.currentTime = 100;
  const rig = { ctx, doc, endAt, leadSeconds: 0, hold: false, timer: createManualTimer(), out: ctx.createGain(), buffers: new Map([["asset", makeBuffer(ctx)]]), ended: 0 };
  rig.outputOf = () => rig.out;
  rig.transport = new TransportClock({
    now: () => ctx.currentTime,
    lead: () => rig.leadSeconds,
    outputLatency: () => 0,
    ensureRunning: async () => {},
    end: () => rig.endAt,
    holdOpen: () => rig.hold,
  });
  rig.transport.on("ended", () => { rig.ended++; });
  rig.scheduler = new Scheduler({
    transport: rig.transport,
    context: () => ctx,
    doc: () => rig.doc,
    buffer: (assetId) => rig.buffers.get(assetId),
    output: (trackId) => rig.outputOf(trackId),
    createTimer: () => rig.timer,
  });
  rig.transport.connect(rig.scheduler);
  /** 오디오 시계를 `seconds`만큼 흘리고 예약기를 한 번 깨운다 */
  rig.advance = (seconds) => { ctx.currentTime += seconds; rig.timer.fire(); };
  return rig;
}

const startedWhens = () => Source.starts.map((source) => source.started[0]);

test("Scheduler: 앞으로 2초 안에 시작하는 클립만 예약한다 (start < 위치 + 2초)", async () => {
  assert.equal(LOOKAHEAD_SECONDS, 2);
  assert.equal(TICK_MS, 25);
  const rig = makeRig(makeDoc([0, 1, 1.9, 2, 5]));
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 3, "0·1·1.9초 클립만");
  assert.equal(rig.scheduler.voiceCount(), 3);
  nearAll(startedWhens(), [100, 101, 101.9]);
});

test("Scheduler: 틱마다 새로 창에 들어온 클립만 더하고, 이미 예약한 클립은 다시 만들지 않는다", async () => {
  const rig = makeRig(makeDoc([0, 1, 1.9, 2, 5]));
  await rig.transport.play(0);
  rig.advance(0.5); // 위치 0.5 → 창 끝 2.5
  assert.equal(Source.starts.length, 4);
  nearAll(Source.starts[3].started, [102, 0, 1], "2초 클립은 그 시각에 처음부터");
  rig.advance(0); // 같은 시각에 또 깨워도
  assert.equal(Source.starts.length, 4);
  rig.advance(2.6); // 위치 3.1 → 창 끝 5.1
  assert.equal(Source.starts.length, 5);
  nearAll(Source.starts[4].started, [105, 0, 1]);
});

test("Scheduler: 이미 지나간 클립은 다시 만들지 않는다(재생 위치가 클립 끝을 넘음)", async () => {
  const rig = makeRig(makeDoc([0, 1]));
  await rig.transport.play(3);
  assert.equal(Source.starts.length, 0);
  assert.equal(rig.scheduler.voiceCount(), 0);
});

test("Scheduler: 시계가 재생 중일 때만 타이머가 돌고, 시작·정지를 따라간다", async () => {
  const rig = makeRig(makeDoc([0]));
  assert.equal(rig.timer.running, false);
  await rig.transport.play(0);
  assert.equal(rig.timer.running, true);
  assert.equal(rig.timer.interval, TICK_MS);
  rig.transport.pause();
  assert.equal(rig.timer.running, false);
  await rig.transport.play();
  assert.equal(rig.timer.running, true);
  assert.equal(rig.timer.starts, 2);
  rig.transport.stop();
  assert.equal(rig.timer.running, false);
  rig.scheduler.dispose();
  assert.equal(rig.timer.disposed, true);
});

test("Scheduler: 재생 중이 아닐 때 깨우면 아무것도 만들지 않는다", () => {
  const rig = makeRig(makeDoc([0, 1]));
  rig.scheduler.tick();
  assert.equal(Source.starts.length, 0);
});

test("Scheduler: 일시정지하면 모든 소리가 내려간다(8ms 페이드 아웃)", async () => {
  const rig = makeRig(makeDoc([0, 1]));
  await rig.transport.play(0);
  rig.advance(0.3);
  rig.transport.pause();
  assert.equal(rig.scheduler.voiceCount(), 0);
  assert.deepEqual(Source.starts.map((source) => source.stopped), [true, true]);
  near(Source.starts[0].stopAt, 100.3 + STOP_FADE * 2);
});

test("Scheduler: 재생 중 시크는 모든 소리를 내리고, 10ms 뒤 새 위치에서 창 안의 클립을 다시 예약한다", async () => {
  const rig = makeRig(makeDoc([0, 1, 5, 20]));
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 2);
  rig.transport.seek(4.5);
  assert.deepEqual(Source.starts.slice(0, 2).map((source) => source.stopped), [true, true], "이전 소리는 모두 내려간다");
  assert.equal(Source.starts.length, 3, "새 창(4.5~6.5)에는 5초 클립 하나");
  nearAll(Source.starts[2].started, [100 + 0.01 + 0.5, 0, 1], "시작 시각 = 지금 + 10ms + 0.5초");
  assert.equal(rig.scheduler.voiceCount(), 1);
});

test("Scheduler: 클립 한가운데로 시크하면 그 위치부터 짧은 페이드 인으로 시작한다", async () => {
  const rig = makeRig(makeDoc([0], { durations: 4 }));
  await rig.transport.play(0);
  rig.transport.seek(2.5);
  assert.equal(Source.starts.length, 2);
  nearAll(Source.starts[1].started, [100.01, 2.5, 1.5], "클립 안 2.5초 지점부터 남은 1.5초");
});

test("Scheduler: 곡 끝에 닿으면 모든 소리를 내리고 멈추며 타이머도 멈춘다", async () => {
  const rig = makeRig(makeDoc([0, 1]), { endAt: 3 });
  await rig.transport.play(0);
  rig.advance(2.9);
  assert.equal(rig.ended, 0);
  rig.advance(0.2);
  assert.equal(rig.ended, 1);
  assert.equal(rig.transport.state, "stopped");
  assert.equal(rig.timer.running, false);
  assert.equal(rig.scheduler.voiceCount(), 0);
  rig.advance(1);
  assert.equal(rig.ended, 1, "한 번만 알린다");
});

test("Scheduler: 클립 하나가 바뀌면 그 클립의 소리만 바꾼다", async () => {
  const base = makeDoc([0, 1]);
  const rig = makeRig(base);
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 2);
  const [first, second] = Source.starts;

  rig.doc = produce(base, (draft) => { draft.tracks[0].clips[1].startTime = 1.2; });
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();

  assert.equal(first.stopped, undefined, "안 바뀐 클립은 그대로 재생");
  assert.equal(second.stopped, true, "바뀐 클립의 옛 소리는 내려간다");
  assert.equal(Source.starts.length, 3);
  nearAll(Source.starts[2].started, [101.2, 0, 1]);
  assert.equal(rig.scheduler.voiceCount(), 2);
});

test("Scheduler: 소리와 상관없는 값(이름)만 바뀐 클립은 건드리지 않는다", async () => {
  const base = makeDoc([0, 1]);
  const rig = makeRig(base);
  await rig.transport.play(0);
  rig.doc = produce(base, (draft) => { draft.tracks[0].clips[0].name = "다른 이름"; });
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();
  assert.equal(Source.starts.length, 2);
  assert.ok(Source.starts.every((source) => source.stopped === undefined));
});

test("Scheduler: 클립을 음소거하면 그 소리만 내리고 다시 만들지 않는다. 풀면 지금 위치에서 이어 만든다", async () => {
  const base = makeDoc([0], { durations: 4 });
  const rig = makeRig(base);
  await rig.transport.play(0);
  rig.advance(0.3);
  const muted = produce(base, (draft) => { draft.tracks[0].clips[0].muted = true; });
  rig.doc = muted;
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();
  assert.equal(Source.starts[0].stopped, true);
  assert.equal(Source.starts.length, 1);
  assert.equal(rig.scheduler.voiceCount(), 0);

  rig.advance(0.2);
  rig.doc = produce(muted, (draft) => { draft.tracks[0].clips[0].muted = false; });
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();
  assert.equal(Source.starts.length, 2);
  nearAll(Source.starts[1].started, [100.5, 0.5, 3.5], "풀린 지점(0.5초)부터");
});

test("Scheduler: 지워진 클립의 소리는 내려가고, 나머지는 그대로다", async () => {
  const base = makeDoc([0, 1]);
  const rig = makeRig(base);
  await rig.transport.play(0);
  rig.doc = produce(base, (draft) => { draft.tracks[0].clips.splice(1, 1); });
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();
  assert.equal(Source.starts[0].stopped, undefined);
  assert.equal(Source.starts[1].stopped, true);
  assert.equal(Source.starts.length, 2);
  assert.equal(rig.scheduler.voiceCount(), 1);
});

test("Scheduler: 클립이 다른 트랙으로 옮겨지면 옛 소리를 내리고 새 트랙 경로로 다시 만든다", async () => {
  const base = makeMultiDoc([[0], []]);
  const rig = makeRig(base);
  const outputs = new Map(base.tracks.map((track) => [track.id, rig.ctx.createGain()]));
  rig.outputOf = (trackId) => outputs.get(trackId);
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 1);

  rig.doc = produce(base, (draft) => {
    const [clip] = draft.tracks[0].clips.splice(0, 1);
    clip.trackId = draft.tracks[1].id;
    draft.tracks[1].clips.push(clip);
  });
  rig.scheduler.reconcile(new Set(base.tracks.map((track) => track.id)), false);
  rig.scheduler.tick();
  assert.equal(Source.starts[0].stopped, true);
  assert.equal(Source.starts.length, 2);
});

test("Scheduler: 템포가 바뀌면 템포에 맞춰 늘이는(WARP) 클립의 소리만 바꾼다", async () => {
  const base = makeDoc([0, 1], { durations: [1, 2.4] });
  base.tracks[0].clips[1] = { ...base.tracks[0].clips[1], sourceBpm: 100, stretchMode: "resample" };
  const rig = makeRig(base);
  await rig.transport.play(0);
  const [plain, warped] = Source.starts;
  near(warped.playbackRate.value, 1.2);

  rig.doc = { ...base, bpm: 140 };
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), true);
  rig.scheduler.tick();
  assert.equal(plain.stopped, undefined, "WARP가 아닌 클립은 템포가 바뀌어도 그대로");
  assert.equal(warped.stopped, true);
  assert.equal(Source.starts.length, 3);
  near(Source.starts[2].playbackRate.value, 1.4);
});

test("Scheduler: releaseTrack은 그 트랙의 소리만 내린다", async () => {
  const base = makeMultiDoc([[0], [0.5]]);
  const rig = makeRig(base);
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 2);
  rig.scheduler.releaseTrack(base.tracks[0].id);
  assert.equal(Source.starts[0].stopped, true);
  assert.equal(Source.starts[1].stopped, undefined);
  assert.equal(rig.scheduler.voiceCount(), 1);
});

test("Scheduler: 음원이 없거나 트랙 경로가 없는 클립은 건너뛰고, 녹음 중·음소거 클립은 만들지 않는다", async () => {
  const base = makeDoc([0, 0.2, 0.4, 0.6]);
  base.tracks[0].clips[1] = { ...base.tracks[0].clips[1], audioBufferId: "없는 음원" };
  base.tracks[0].clips[2] = { ...base.tracks[0].clips[2], isRecording: true };
  base.tracks[0].clips[3] = { ...base.tracks[0].clips[3], muted: true };
  const rig = makeRig(base);
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 1, "정상 클립 하나만");

  const noOutput = makeRig(base);
  noOutput.outputOf = () => undefined;
  Source.starts = [];
  await noOutput.transport.play(0);
  assert.equal(Source.starts.length, 0);
});

test("Scheduler: 클립이 끝까지 재생되어 소스가 끝나면 목록에서 빠지고, 다시 만들지 않는다", async () => {
  const rig = makeRig(makeDoc([0, 1]));
  await rig.transport.play(0);
  rig.advance(1.5);
  assert.equal(rig.scheduler.voiceCount(), 2);
  Source.starts[0].finish();
  assert.equal(rig.scheduler.voiceCount(), 1);
  rig.advance(0.1);
  assert.equal(Source.starts.length, 2, "끝난 클립을 다시 만들지 않는다");
});

test("Scheduler: 바꿔치기 전 소리가 뒤늦게 끝나도 새 소리를 목록에서 지우지 않는다", async () => {
  const base = makeDoc([0, 1]);
  const rig = makeRig(base);
  await rig.transport.play(0);
  const oldSecond = Source.starts[1];
  rig.doc = produce(base, (draft) => { draft.tracks[0].clips[1].startTime = 1.4; });
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();
  assert.equal(rig.scheduler.voiceCount(), 2);
  oldSecond.finish(); // 내려가던 옛 소리가 뒤늦게 끝났다
  assert.equal(rig.scheduler.voiceCount(), 2);
});

test("Scheduler: 클립이 아주 많아도 창 안에 들어온 새 클립만 예약한다 (5000개)", async () => {
  const starts = Array.from({ length: 5000 }, (_, i) => i * 0.5);
  const rig = makeRig(makeDoc(starts), { endAt: 10000 });
  await rig.transport.play(0);
  assert.equal(Source.starts.length, 4, "처음 2초 안: 시작 시각 0, 0.5, 1, 1.5");
  rig.advance(10);
  // 위치 10초 → 창 끝 12초. 이미 끝난 클립(시작 ≤ 9초)은 만들지 않고, 9.5~11.5초 클립 5개만 더한다.
  assert.equal(Source.starts.length, 9);
  assert.equal(rig.scheduler.voiceCount(), 9);
});

// ───── 안전한 시각(lead): 새 소리·내리기는 "지금"이 아니라 조금 뒤에 건다 ─────

test("Scheduler: lead가 있으면 처음 재생도 그만큼 뒤에서 시작하고, 위치는 그동안 시작 위치에 머문다", async () => {
  const rig = makeRig(makeDoc([0, 1]));
  rig.leadSeconds = 0.03;
  await rig.transport.play(0);
  nearAll(Source.starts[0].started, [100.03, 0, 1], "첫 클립은 지금 + 30ms에 시작");
  near(rig.transport.position(), 0, "아직 시작 전이라 위치가 0에 머문다");
  rig.advance(0.01);
  near(rig.transport.position(), 0);
  rig.advance(0.04);
  near(rig.transport.position(), 0.02);
});

test("Scheduler: lead가 있으면 시크 뒤 새 소리는 지금 + lead + 10ms에, 옛 소리는 지금 + lead부터 내려간다", async () => {
  const rig = makeRig(makeDoc([0, 5], { durations: 3 }));
  rig.leadSeconds = 0.03;
  await rig.transport.play(0);
  rig.advance(0.5);
  const [old] = Source.starts;
  rig.transport.seek(5.5);
  near(old.stopAt, 100.5 + 0.03 + STOP_FADE * 2, "옛 소리는 안전한 시각(지금 + 30ms)부터 내려간다");
  assert.equal(Source.starts.length, 2);
  nearAll(Source.starts[1].started, [100.5 + 0.03 + 0.01, 0.5, 2.5], "새 소리: 시작 시각은 안전한 시각 + 10ms, 그 지점의 위치부터");
});

test("Scheduler: lead가 있으면 일시정지는 안전한 시각부터 내린다", async () => {
  const rig = makeRig(makeDoc([0]));
  rig.leadSeconds = 0.03;
  await rig.transport.play(0);
  rig.advance(0.3);
  const [source] = Source.starts;
  rig.transport.pause();
  near(source.stopAt, 100.3 + 0.03 + STOP_FADE * 2);
});

test("Scheduler: 재생 중 클립을 바꾸면 새 소리는 안전한 시각의 위치에서 이어 시작하고, 옛 소리는 그 시각부터 내려간다", async () => {
  const base = makeDoc([0], { durations: 6 });
  const rig = makeRig(base);
  rig.leadSeconds = 0.03;
  await rig.transport.play(0); // 시작 시각 100.03
  rig.advance(1); // 오디오 시각 101 → 안전한 시각(101.03)에서의 위치는 1.0초
  const [old] = Source.starts;
  rig.doc = produce(base, (draft) => { draft.tracks[0].clips[0].startTime = 0.5; });
  rig.scheduler.reconcile(new Set([base.tracks[0].id]), false);
  rig.scheduler.tick();

  near(old.stopAt, 101.03 + STOP_FADE * 2, "옛 소리는 안전한 시각부터 내려간다");
  assert.equal(Source.starts.length, 2);
  near(Source.starts[1].started[0], 101.03, "새 소리는 안전한 시각에 시작");
  near(Source.starts[1].started[1], 0.5, "그 시각의 위치(1.0초)는 옮긴 클립(0.5초)의 안쪽 0.5초");
});
