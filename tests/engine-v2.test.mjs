import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { produce } from "immer";
import { FakeContext, Source, createManualTimer } from "./helpers/fake-audio.mjs";
import { makeClip, makeDoc, makeMultiDoc } from "./helpers/docs.mjs";

globalThis.window = { AudioContext: FakeContext };
const { AudioEngineV2, RETIRE_MS, scheduleLead, MIN_LEAD_SECONDS, MAX_LEAD_SECONDS } = await import("../src/audio/engine/AudioEngine.ts");
const { BrowserAudioEngine } = await import("../src/audio/audioEngine.ts");

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);
const nearAll = (actual, expected, message = "") => {
  assert.equal(actual?.length, expected.length, `${message} 길이`);
  expected.forEach((value, i) => near(actual[i], value, `${message} [${i}]`));
};

beforeEach(() => {
  Source.starts = [];
});

/** 새 엔진 + 손으로 돌리는 타이머 + 끊기를 모아 두는 retire. 오디오 시계는 0초에서 시작한다. */
async function makeEngine(options = {}) {
  const timer = createManualTimer();
  const retired = [];
  const engine = new AudioEngineV2({ createTimer: () => timer, retire: (action) => retired.push(action), lead: () => 0, ...options });
  const ctx = await engine.ensureContext();
  engine.registerBuffer("asset", ctx.createBuffer(1, 44100 * 10, 44100));
  const rig = { engine, ctx, timer, retired, ended: [] };
  engine.transport.on("ended", () => rig.ended.push(ctx.currentTime));
  /** 오디오 시계를 흘리고 예약기를 한 번 깨운다 */
  rig.advance = (seconds) => { ctx.currentTime += seconds; timer.fire(); };
  return rig;
}

const aliveCount = () => Source.starts.filter((source) => source.stopped === undefined).length;

test("새 엔진은 옛 엔진을 이어받아 마스터·음원 보관 같은 공통 부분을 그대로 쓴다", async () => {
  const { engine } = await makeEngine();
  assert.ok(engine instanceof BrowserAudioEngine);
  assert.ok(engine.getAnalyser());
  assert.equal(RETIRE_MS, 60);
});

test("재생을 시작하면 앞으로 2초 안에 시작하는 클립만 소리를 만든다 (옛 엔진은 전부 한꺼번에 만들었다)", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1, 3, 5, 7]);
  await rig.engine.play(doc, 0);
  assert.equal(Source.starts.length, 2);
  nearAll(Source.starts.map((source) => source.started[0]), [0, 1]);
  assert.equal(rig.engine.isPlaying(), true);
  assert.equal(rig.timer.running, true);

  rig.advance(1.5); // 위치 1.5 → 창 끝 3.5
  assert.equal(Source.starts.length, 3);
  nearAll(Source.starts[2].started, [3, 0, 1]);
  rig.advance(3.2); // 위치 4.7 → 창 끝 6.7
  assert.equal(Source.starts.length, 4);
  rig.advance(0.5); // 위치 5.2 → 창 끝 7.2
  assert.equal(Source.starts.length, 5);
  near(rig.engine.getCurrentPlayhead(), 5.2);
});

test("재생 위치는 오디오 시계를 따라간다", async () => {
  const rig = await makeEngine();
  await rig.engine.play(makeDoc([0]), 2);
  near(rig.engine.getCurrentPlayhead(), 2);
  rig.ctx.currentTime += 1.25;
  near(rig.engine.getCurrentPlayhead(), 3.25);
});

test("이미 진행 중인 클립 한가운데서 시작하면 소스 안의 알맞은 위치에서 시작한다 (옛 엔진과 같은 값)", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([1], { durations: 3 });
  await rig.engine.play(doc, 2);
  assert.equal(Source.starts.length, 1);
  nearAll(Source.starts[0].started, [0, 1, 2]);
});

test("볼륨·이름처럼 소리 경로 값만 바꾸면 새 소리를 만들지 않고, 값은 그 자리에서 고친다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  const graph = rig.engine.trackGraphs.get(doc.tracks[0].id);
  const next = produce(doc, (draft) => { draft.tracks[0].name = "새 이름"; draft.tracks[0].volume = 0.5; });
  rig.engine.sync(next, doc);
  assert.equal(Source.starts.length, 2);
  assert.ok(Source.starts.every((source) => source.stopped === undefined));
  assert.equal(rig.engine.trackGraphs.get(doc.tracks[0].id), graph, "소리 경로는 그대로");
  assert.equal(graph.output.gain.value, 0.5);
  assert.equal(rig.retired.length, 0);
});

test("같은 문서를 다시 sync해도 아무 일도 하지 않는다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  const graph = rig.engine.trackGraphs.get(doc.tracks[0].id);
  const eventsBefore = graph.output.gain.events.length;
  rig.engine.sync(doc, doc);
  assert.equal(graph.output.gain.events.length, eventsBefore);
  assert.equal(Source.starts.length, 2);
});

test("클립 하나를 옮기면 그 클립의 소리만 바뀐다. 10번 옮겨도 다른 클립은 한 번도 끊기지 않는다", async () => {
  const rig = await makeEngine();
  let current = makeDoc([0, 1]);
  await rig.engine.play(current, 0);
  const untouched = Source.starts[0];
  for (let i = 0; i < 10; i += 1) {
    const next = produce(current, (draft) => { draft.tracks[0].clips[1].startTime = i % 2 === 0 ? 1.2 : 1; });
    rig.engine.sync(next, current);
    current = next;
  }
  assert.equal(Source.starts.length, 12, "처음 2개 + 옮길 때마다 1개");
  assert.equal(untouched.stopped, undefined, "안 옮긴 클립은 그대로 재생");
  assert.equal(Source.starts.filter((source) => source.stopped === true).length, 10);
  assert.equal(aliveCount(), 2);
  assert.equal(rig.engine.scheduler.voiceCount(), 2);
  near(Source.starts.at(-1).started[0], 1, "마지막 이동은 1초로 되돌린 것");
});

test("재생 중에 클립을 새로 놓으면 창 안이면 바로, 먼 클립은 위치가 가까워질 때 소리가 만들어진다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0]);
  await rig.engine.play(doc, 0);
  const trackId = doc.tracks[0].id;
  const next = produce(doc, (draft) => {
    draft.tracks[0].clips.push(makeClip(trackId, "near", 1.5), makeClip(trackId, "far", 20));
  });
  rig.engine.sync(next, doc);
  assert.equal(Source.starts.length, 2, "1.5초 클립만 바로");
  rig.advance(19); // 위치 19 → 창 끝 21
  assert.equal(Source.starts.length, 3);
  nearAll(Source.starts[2].started, [20, 0, 1]);
});

test("재생 중 play()는 시크로 동작한다: 이전 소리는 모두 내려가고 새 위치에서 이어지며, 재생 상태 알림은 없다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1, 3, 5, 7]);
  await rig.engine.play(doc, 0);
  const states = [];
  rig.engine.transport.on("state", () => states.push(rig.engine.transport.state));
  await rig.engine.play(doc, 5);
  assert.deepEqual(states, []);
  assert.equal(rig.engine.isPlaying(), true);
  near(rig.engine.getCurrentPlayhead(), 5);
  assert.equal(Source.starts.length, 3);
  assert.ok(Source.starts.slice(0, 2).every((source) => source.stopped === true));
  nearAll(Source.starts[2].started, [0.01, 0, 1], "5초 클립은 지금보다 10ms 뒤에 처음부터");
  assert.equal(aliveCount(), 1);
});

test("engine.seek(): 재생 중이면 같은 방식으로 옮기고, 멈춘 중이면 위치만 바꾼다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1, 5]);
  rig.engine.seek(4);
  near(rig.engine.getCurrentPlayhead(), 4);
  assert.equal(Source.starts.length, 0);

  await rig.engine.play(doc, 4);
  assert.equal(Source.starts.length, 1, "5초 클립");
  rig.engine.seek(0.5);
  assert.equal(Source.starts[0].stopped, true);
  assert.equal(Source.starts.length, 3, "0.5초 위치의 첫 클립(중간) + 1초 클립");
  nearAll(Source.starts[1].started, [0.01, 0.5, 0.5]);
});

test("stop()은 일시정지다: 위치를 붙잡고, 소리를 내리고, 타이머를 멈추고, 소리 경로를 끊도록 맡긴다. 다시 play()하면 이어서 간다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  rig.advance(0.8);
  const graph = rig.engine.trackGraphs.get(doc.tracks[0].id);

  rig.engine.stop();
  assert.equal(rig.engine.isPlaying(), false);
  assert.equal(rig.engine.transport.state, "paused");
  near(rig.engine.getCurrentPlayhead(), 0.8);
  assert.ok(Source.starts.every((source) => source.stopped === true));
  assert.equal(rig.timer.running, false);
  assert.equal(rig.engine.trackGraphs.size, 0);
  assert.equal(rig.retired.length, 1, "소리 경로 끊기는 60ms 뒤로 미뤄 둔다");
  assert.deepEqual(graph.output.gain.events.at(-1), { type: "target", value: 0, time: 0.8, constant: 0.004 }, "끊기 전에 트랙 출력을 0으로 내린다");
  assert.equal(graph.input.disconnected, undefined, "아직 끊지 않았다");

  rig.ctx.currentTime += 5;
  near(rig.engine.getCurrentPlayhead(), 0.8, "멈춘 동안 위치는 그대로");
  rig.retired.forEach((run) => run());
  assert.equal(graph.input.disconnected, true);

  await rig.engine.play(doc, rig.engine.getCurrentPlayhead());
  assert.equal(rig.engine.isPlaying(), true);
  assert.equal(rig.engine.trackGraphs.size, 1);
  near(rig.engine.getCurrentPlayhead(), 0.8);
  assert.equal(Source.starts.length, 4);
  nearAll(Source.starts[2].started, [5.8, 0.8, 0.2], "이어 재생: 첫 클립의 남은 부분");
  nearAll(Source.starts[3].started, [6, 0, 1]);
});

test("소리 경로 끊기는 기본값으로 60ms 뒤에 일어난다", async () => {
  const engine = new AudioEngineV2({ createTimer: () => createManualTimer() });
  const ctx = await engine.ensureContext();
  engine.registerBuffer("asset", ctx.createBuffer(1, 44100, 44100));
  const doc = makeDoc([0]);
  await engine.play(doc, 0);
  const graph = engine.trackGraphs.get(doc.tracks[0].id);
  engine.stop();
  assert.equal(graph.input.disconnected, undefined);
  await new Promise((resolve) => setTimeout(resolve, RETIRE_MS + 40));
  assert.equal(graph.input.disconnected, true);
});

test("멈춘 상태에서 pause()·stop()을 불러도 아무 일도 없다", async () => {
  const rig = await makeEngine();
  assert.doesNotThrow(() => { rig.engine.stop(); rig.engine.pause(); });
  assert.equal(rig.engine.isPlaying(), false);
  assert.equal(rig.engine.transport.state, "stopped");
});

test("곡 끝: 한 번만 'ended'가 나고 위치는 끝에 놓이며, 다시 재생하면 0부터다 (C4)", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1]); // 마지막 클립 끝 2초 + 4박(2초) 여유 → 곡 끝은 8초(최소 길이)
  await rig.engine.play(doc, 0);
  rig.advance(7.9);
  assert.equal(rig.ended.length, 0);
  rig.advance(0.2);
  assert.equal(rig.ended.length, 1);
  assert.equal(rig.engine.isPlaying(), false);
  near(rig.engine.getCurrentPlayhead(), 8);
  assert.equal(rig.timer.running, false);
  assert.ok(Source.starts.every((source) => source.stopped === true));
  rig.advance(1);
  assert.equal(rig.ended.length, 1);

  await rig.engine.play(doc, rig.engine.getCurrentPlayhead());
  assert.equal(rig.engine.isPlaying(), true);
  near(rig.engine.getCurrentPlayhead(), 0, "끝에서 다시 재생하면 처음부터");
  assert.equal(Source.starts.length, 4);
});

test("녹음 중(holdOpen)에는 곡 끝에 닿아도 멈추지 않는다", async () => {
  const rig = await makeEngine();
  let recording = true;
  rig.engine.setHoldOpen(() => recording);
  await rig.engine.play(makeDoc([0]), 0);
  rig.advance(9);
  assert.equal(rig.engine.isPlaying(), true);
  assert.equal(rig.ended.length, 0);
  recording = false;
  rig.advance(0.1);
  assert.equal(rig.engine.isPlaying(), false);
  assert.equal(rig.ended.length, 1);
});

test("템포가 바뀌면 템포에 맞춰 늘이는(WARP) 클립의 소리만 바뀐다", async () => {
  const rig = await makeEngine();
  const base = makeDoc([0, 1], { durations: [1, 2.4] });
  base.tracks[0].clips[1] = { ...base.tracks[0].clips[1], sourceBpm: 100, stretchMode: "resample" };
  await rig.engine.play(base, 0);
  const next = produce(base, (draft) => { draft.bpm = 140; });
  rig.engine.sync(next, base);
  assert.equal(Source.starts[0].stopped, undefined, "일반 클립은 그대로");
  assert.equal(Source.starts[1].stopped, true);
  assert.equal(Source.starts.length, 3);
  near(Source.starts[2].playbackRate.value, 1.4);
  assert.equal(rig.retired.length, 0, "템포만 바뀌면 소리 경로는 새로 만들지 않는다");
});

test("트랙을 지우면 그 트랙의 소리와 경로만 사라진다", async () => {
  const rig = await makeEngine();
  const doc = makeMultiDoc([[0], [0.5]]);
  await rig.engine.play(doc, 0);
  const [keep, removed] = doc.tracks.map((track) => track.id);
  assert.equal(Source.starts.length, 2);
  const next = produce(doc, (draft) => { draft.tracks.splice(1, 1); });
  rig.engine.sync(next, doc);
  assert.equal(Source.starts[0].stopped, undefined);
  assert.equal(Source.starts[1].stopped, true);
  assert.ok(rig.engine.trackGraphs.has(keep));
  assert.equal(rig.engine.trackGraphs.has(removed), false);
  assert.equal(rig.engine.trackAnalysers.has(removed), false);
  assert.equal(rig.retired.length, 1);
});

test("이펙트 연결 모양(EQ 켜기·끄기)이 바뀌면 그 트랙만 새 소리 경로로 옮기고, 옛 경로는 나중에 끊는다", async () => {
  const rig = await makeEngine();
  const doc = makeMultiDoc([[0, 1], [0.5]]);
  await rig.engine.play(doc, 0);
  assert.equal(Source.starts.length, 3);
  const [first, second] = doc.tracks.map((track) => track.id);
  const oldGraph = rig.engine.trackGraphs.get(first);
  const otherGraph = rig.engine.trackGraphs.get(second);

  const next = produce(doc, (draft) => { draft.tracks[0].eq.enabled = false; });
  rig.engine.sync(next, doc);
  assert.notEqual(rig.engine.trackGraphs.get(first), oldGraph);
  assert.equal(rig.engine.trackGraphs.get(second), otherGraph, "다른 트랙은 그대로");
  assert.equal(rig.retired.length, 1);
  assert.equal(Source.starts.length, 5, "바뀐 트랙의 클립 2개만 새 경로로 다시 만든다");
  assert.deepEqual(Source.starts.map((source) => source.stopped), [true, true, undefined, undefined, undefined]);
});

test("재생 전에 들어온 sync는 문서만 기억하고 소리 경로·소스는 만들지 않는다", async () => {
  const rig = await makeEngine();
  rig.engine.sync(makeDoc([0, 1]));
  assert.equal(rig.engine.trackGraphs.size, 0);
  assert.equal(Source.starts.length, 0);
  assert.equal(rig.timer.running, false);
});

test("재생을 시작하는 중에 들어온 문서가 있으면, 그 문서로 소리를 만든다", async () => {
  const rig = await makeEngine();
  const docA = makeDoc([0, 1]);
  const docB = produce(docA, (draft) => { draft.tracks[0].clips[0].startTime = 0.5; });
  const starting = rig.engine.play(docA, 0);
  rig.engine.sync(docB, docA); // play()를 부른 직후, 시작하기 전에 문서가 바뀌었다
  await starting;
  assert.equal(Source.starts.length, 2);
  assert.ok(Source.starts.every((source) => source.stopped === undefined), "잘못 만든 소리를 지우고 다시 만들 필요가 없다");
  nearAll(Source.starts.map((source) => source.started[0]), [0.5, 1]);
});

test("오디오 시계를 켜는 사이(await)에 들어온 문서도 놓치지 않는다", async () => {
  const rig = await makeEngine();
  const docA = makeDoc([0, 1]);
  const docB = produce(docA, (draft) => { draft.tracks[0].clips[0].startTime = 0.5; });
  const original = rig.engine.ensureContext.bind(rig.engine);
  let release;
  let calls = 0;
  rig.engine.ensureContext = async () => {
    calls += 1;
    if (calls === 2) await new Promise((resolve) => { release = resolve; }); // 시계 쪽의 ensureRunning에서 멈춰 세운다
    return original();
  };
  const starting = rig.engine.play(docA, 0);
  while (!release) await Promise.resolve();
  assert.equal(rig.engine.isPlaying(), false);
  rig.engine.sync(docB, docA);
  release();
  await starting;
  assert.equal(rig.engine.isPlaying(), true);
  assert.equal(Source.starts.length, 3, "A로 만든 첫 클립은 B로 바뀌며 한 번 교체된다");
  assert.equal(Source.starts[0].stopped, true);
  nearAll(Source.starts[2].started, [0.5, 0, 1]);
  assert.equal(aliveCount(), 2);
});

test("녹음 중 클립(isRecording)과 음소거 클립은 소리를 만들지 않는다", async () => {
  const rig = await makeEngine();
  const base = makeDoc([0, 0.2, 0.4]);
  base.tracks[0].clips[1] = { ...base.tracks[0].clips[1], isRecording: true };
  base.tracks[0].clips[2] = { ...base.tracks[0].clips[2], muted: true };
  await rig.engine.play(base, 0);
  assert.equal(Source.starts.length, 1);
});

test("dispose(): 멈추고 타이머를 정리한다", async () => {
  const rig = await makeEngine();
  await rig.engine.play(makeDoc([0, 1]), 0);
  rig.engine.dispose();
  assert.equal(rig.engine.transport.state, "stopped");
  assert.equal(rig.timer.disposed, true);
  assert.ok(Source.starts.every((source) => source.stopped === true));
});

test("scheduleLead: 오디오 하드웨어 버퍼(baseLatency)의 두 배 + 10ms를 20~60ms 범위 안으로", () => {
  near(MIN_LEAD_SECONDS, 0.02);
  near(MAX_LEAD_SECONDS, 0.06);
  near(scheduleLead(undefined), 0.02, "알 수 없으면 최소값");
  near(scheduleLead(0), 0.02);
  near(scheduleLead(0.004), 0.02, "작은 값은 최소값으로 올린다");
  near(scheduleLead(0.01), 0.03);
  near(scheduleLead(0.02), 0.05);
  near(scheduleLead(0.1), 0.06, "큰 값은 최대값으로 자른다");
});

test("기본 lead는 컨텍스트의 baseLatency에서 계산한다", async () => {
  const engine = new AudioEngineV2({ createTimer: () => createManualTimer() });
  const ctx = await engine.ensureContext();
  ctx.baseLatency = 0.01;
  ctx.currentTime = 5;
  near(engine.transport.safeTime(), 5.03);
  ctx.baseLatency = undefined;
  near(engine.transport.safeTime(), 5.02);
});

test("lead를 두고 재생 중 클립 하나를 옮기면: 새 소리는 안전한 시각에서 이어 시작, 옛 소리는 그 시각부터 내려가고, 다른 클립은 그대로", async () => {
  const rig = await makeEngine({ lead: () => 0.03 });
  const base = makeDoc([0, 4], { durations: 6 });
  await rig.engine.play(base, 0); // 첫 클립은 0.03에 시작
  rig.advance(1); // 오디오 시각 1 → 안전한 시각 1.03의 위치 = 1.0
  const [moved] = Source.starts;
  assert.equal(Source.starts.length, 1, "4초 클립은 아직 창 밖");
  rig.engine.sync(produce(base, (draft) => { draft.tracks[0].clips[0].startTime = 0.5; }));
  assert.equal(moved.stopAt !== undefined, true);
  near(moved.stopAt, 1.03 + 0.016, "옛 소리는 안전한 시각 + 16ms에 끝난다");
  assert.equal(Source.starts.length, 2);
  near(Source.starts[1].started[0], 1.03);
  near(Source.starts[1].started[1], 0.5);
});
