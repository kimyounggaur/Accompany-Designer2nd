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

/** 시험용 리미터: 진짜 워크렛 대신 게인 노드 하나(워크렛은 Node에서 올릴 수 없다). 동작량은 `report(db)`로 알린다. */
function fakeLimiter(ctx) {
  const node = ctx.createGain();
  let listener;
  return {
    input: node, output: node, node, latencySeconds: 0.005,
    onReduction: (next) => { listener = next; },
    dispose: () => node.disconnect(),
    report: (db) => listener?.(db),
  };
}

/** 새 엔진 + 손으로 돌리는 타이머 + 끊기를 모아 두는 retire. 오디오 시계는 0초에서 시작한다. */
async function makeEngine(options = {}) {
  const timer = createManualTimer();
  const retired = [];
  let limiter;
  const engine = new AudioEngineV2({
    createTimer: () => timer,
    retire: (action) => retired.push(action),
    lead: () => 0,
    createLimiter: async (context) => (limiter = fakeLimiter(context)),
    ...options,
  });
  const ctx = await engine.ensureContext();
  engine.registerBuffer("asset", ctx.createBuffer(1, 44100 * 10, 44100));
  const rig = { engine, ctx, timer, retired, ended: [], limiter };
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
  const strip = rig.engine.strips.get(doc.tracks[0].id);
  const next = produce(doc, (draft) => { draft.tracks[0].name = "새 이름"; draft.tracks[0].volume = 0.5; });
  rig.engine.sync(next, doc);
  assert.equal(Source.starts.length, 2);
  assert.ok(Source.starts.every((source) => source.stopped === undefined));
  assert.equal(rig.engine.strips.get(doc.tracks[0].id), strip, "소리 경로는 그대로");
  assert.equal(strip.output.gain.value, 0.5);
  assert.equal(rig.retired.length, 0);
});

test("같은 문서를 다시 sync해도 아무 일도 하지 않는다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  const strip = rig.engine.strips.get(doc.tracks[0].id);
  const eventsBefore = strip.output.gain.events.length;
  rig.engine.sync(doc, doc);
  assert.equal(strip.output.gain.events.length, eventsBefore);
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
  const strip = rig.engine.strips.get(doc.tracks[0].id);

  rig.engine.stop();
  assert.equal(rig.engine.isPlaying(), false);
  assert.equal(rig.engine.transport.state, "paused");
  near(rig.engine.getCurrentPlayhead(), 0.8);
  assert.ok(Source.starts.every((source) => source.stopped === true));
  assert.equal(rig.timer.running, false);
  assert.equal(rig.engine.strips.size, 0);
  assert.equal(rig.retired.length, 1, "소리 경로 끊기는 60ms 뒤로 미뤄 둔다");
  assert.deepEqual(strip.output.gain.events.at(-1), { type: "target", value: 0, time: 0.8, constant: 0.004 }, "끊기 전에 트랙 출력을 0으로 내린다");
  assert.equal(strip.input.disconnected, undefined, "아직 끊지 않았다");

  rig.ctx.currentTime += 5;
  near(rig.engine.getCurrentPlayhead(), 0.8, "멈춘 동안 위치는 그대로");
  rig.retired.forEach((run) => run());
  assert.equal(strip.input.disconnected, true);

  await rig.engine.play(doc, rig.engine.getCurrentPlayhead());
  assert.equal(rig.engine.isPlaying(), true);
  assert.equal(rig.engine.strips.size, 1);
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
  const strip = engine.strips.get(doc.tracks[0].id);
  engine.stop();
  assert.equal(strip.input.disconnected, undefined);
  await new Promise((resolve) => setTimeout(resolve, RETIRE_MS + 40));
  assert.equal(strip.input.disconnected, true);
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

/** 이펙트 켜기 버튼이 하는 일: 이펙트 자신의 켜기와 사슬 슬롯의 켜기를 함께 바꾼다 */
function withEffect(doc, type, enabled, change = () => {}) {
  return produce(doc, (draft) => {
    const track = draft.tracks[0];
    track[{ eq: "eq", comp: "compressor", delay: "delay", reverb: "reverb" }[type]].enabled = enabled;
    for (const slot of track.effectChain) if (slot.type === type) slot.enabled = enabled;
    change(track);
  });
}

test("재생 중 딜레이·리버브를 5번씩 켜고 꺼도 소리 소스는 시작도 정지도 하지 않고, 스트립도 그대로다 (S4)", async () => {
  const rig = await makeEngine();
  let current = makeDoc([0, 1]);
  await rig.engine.play(current, 0);
  const strip = rig.engine.strips.get(current.tracks[0].id);
  const sources = Source.starts.length;
  assert.equal(sources, 2);

  let nodesAfterFirstRound = 0;
  for (let round = 0; round < 5; round += 1) {
    for (const enabled of [true, false]) {
      for (const type of ["delay", "reverb"]) {
        const next = withEffect(current, type, enabled);
        rig.engine.sync(next, current);
        current = next;
        rig.advance(0.05);
      }
    }
    if (round === 0) nodesAfterFirstRound = rig.ctx.nodes.length;
  }
  assert.equal(Source.starts.length, sources, "소스 시작 횟수 증가 0");
  assert.ok(Source.starts.every((source) => source.stopped === undefined), "멈춘 소스도 0");
  assert.equal(rig.engine.strips.get(current.tracks[0].id), strip, "같은 스트립");
  assert.equal(rig.retired.length, 0, "끊은 소리 경로도 0");
  assert.equal(rig.ctx.nodes.length, nodesAfterFirstRound, "처음 켠 뒤로는 노드를 새로 만들지 않는다(딜레이·리버브 모두 한 번만 만든다)");
  assert.equal(rig.ctx.all("convolver").length, 1, "리버브의 잔향 컨볼버는 하나");
});

test("컴프레서 압축량: 엔진이 트랙의 지금 압축량(dB)을 돌려주고, 컴프레서가 꺼져 있거나 트랙이 없으면 0이다", async () => {
  const rig = await makeEngine();
  const base = makeDoc([0, 1]);
  const id = base.tracks[0].id;
  assert.equal(rig.engine.getCompressorReduction(id), 0, "재생 전에는 소리 경로가 없다");
  await rig.engine.play(base, 0);
  assert.equal(rig.engine.getCompressorReduction(id), 0, "컴프레서가 꺼져 있다");

  const masterCompressors = rig.ctx.all("compressor").length; // 마스터 리미터도 브라우저 압축기를 쓴다
  const on = withEffect(base, "comp", true);
  rig.engine.sync(on, base);
  rig.advance(0.05);
  const compressor = rig.ctx.all("compressor")[masterCompressors];
  assert.ok(compressor, "트랙의 컴프레서가 새로 만들어졌다");
  compressor.reduction = -9;
  assert.equal(rig.engine.getCompressorReduction(id), -9);
  assert.equal(rig.engine.getCompressorReduction("없는-트랙"), 0);
});

test("값을 맞추는 시각은 지금이 아니라 안전한 시각(지금 + lead)이다: 볼륨과 이펙트 교차 모두", async () => {
  const rig = await makeEngine({ lead: () => 0.03 });
  const base = makeDoc([0], { durations: 6 });
  await rig.engine.play(base, 0);
  rig.advance(1);
  const strip = rig.engine.strips.get(base.tracks[0].id);
  const louder = produce(base, (draft) => { draft.tracks[0].volume = 0.3; });
  rig.engine.sync(louder, base);
  assert.deepEqual(strip.output.gain.events.at(-1), { type: "target", value: 0.3, time: 1.03, constant: 0.01 });

  rig.engine.sync(withEffect(louder, "delay", true), louder);
  const slot = strip.slots.get("delay");
  assert.deepEqual(slot.dry.gain.events, [{ type: "target", value: 0, time: 1.03, constant: 0.002 }], "교차도 안전한 시각에서 시작한다");
});

test("곡 끝에 이펙트 꼬리를 더한다: 딜레이가 길게 울리는 곡은 꼬리가 다 울린 뒤에 멈춘다", async () => {
  const rig = await makeEngine();
  const base = makeDoc([0]); // 마지막 클립 끝 1초 → 곡 길이는 8초(최소)
  const doc = withEffect(base, "delay", true, (track) => { track.delay.delayTimeMs = 1000; track.delay.feedback = 0.5; });
  near(rig.engine.getPlaybackEnd(base), 8, "이펙트가 없으면 곡 길이 그대로");
  near(rig.engine.getPlaybackEnd(doc), 11, "마지막 클립 끝 1초 + 딜레이 꼬리 10초");
  near(new BrowserAudioEngine().getPlaybackEnd(doc), 8, "옛 엔진은 곡 길이에서 멈춘다(바뀌지 않음)");

  await rig.engine.play(doc, 0);
  rig.advance(8.5);
  assert.equal(rig.engine.isPlaying(), true, "곡 길이를 지나도 꼬리가 남았다");
  rig.advance(2.4);
  assert.equal(rig.engine.isPlaying(), true);
  assert.equal(rig.ended.length, 0);
  rig.advance(0.2);
  assert.equal(rig.ended.length, 1);
  assert.equal(rig.engine.isPlaying(), false);
  near(rig.engine.getCurrentPlayhead(), 11);
});

test("꼬리가 아무리 길어도 곡 끝은 마지막 클립 끝 + 30초까지다", async () => {
  const rig = await makeEngine();
  const doc = withEffect(makeDoc([0]), "delay", true, (track) => { track.delay.delayTimeMs = 2000; track.delay.feedback = 0.95; });
  near(rig.engine.getPlaybackEnd(doc), 31);
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
  assert.ok(rig.engine.strips.has(keep));
  assert.equal(rig.engine.strips.has(removed), false);
  assert.equal(rig.engine.trackAnalysers.has(removed), false);
  assert.equal(rig.retired.length, 1);
});

test("이펙트(EQ) 켜기·끄기는 소리 경로도 소리 소스도 건드리지 않는다: 같은 스트립, 소스 시작·정지 0, 끊기 0", async () => {
  const rig = await makeEngine();
  const doc = makeMultiDoc([[0, 1], [0.5]]);
  await rig.engine.play(doc, 0);
  assert.equal(Source.starts.length, 3);
  const [first, second] = doc.tracks.map((track) => track.id);
  const strip = rig.engine.strips.get(first);
  const other = rig.engine.strips.get(second);

  const off = produce(doc, (draft) => { draft.tracks[0].eq.enabled = false; });
  rig.engine.sync(off, doc);
  const on = produce(off, (draft) => { draft.tracks[0].eq.enabled = true; });
  rig.engine.sync(on, off);
  assert.equal(rig.engine.strips.get(first), strip, "같은 스트립");
  assert.equal(rig.engine.strips.get(second), other, "다른 트랙도 그대로");
  assert.equal(rig.retired.length, 0, "끊을 것이 없다");
  assert.equal(Source.starts.length, 3, "소스를 새로 시작하지 않는다");
  assert.ok(Source.starts.every((source) => source.stopped === undefined), "멈춘 소스도 없다");
});

test("재생 전에 들어온 sync는 문서만 기억하고 소리 경로·소스는 만들지 않는다", async () => {
  const rig = await makeEngine();
  rig.engine.sync(makeDoc([0, 1]));
  assert.equal(rig.engine.strips.size, 0);
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

// ───────────────────────── P3-4 마스터 길 ─────────────────────────

const withMaster = (doc, volumeDb) => produce(doc, (draft) => { draft.master = { volumeDb }; });

test("마스터 길: 트랙이 모이는 마스터 볼륨 → 리미터 → 마스터 미터(분석기) → 스피커", async () => {
  const rig = await makeEngine();
  const { engine, ctx, limiter } = rig;
  assert.equal(engine.master.kind, "gain");
  assert.deepEqual(engine.master.connections, [limiter.input]);
  assert.deepEqual(limiter.output.connections, [engine.getMasterAnalyser()]);
  assert.deepEqual(engine.getMasterAnalyser().connections, [ctx.destination]);
  assert.equal(ctx.all("compressor").length, 0, "옛 압축기는 없다");
  assert.equal(ctx.all("waveshaper").length, 0, "0.98 상한도 없다");
  near(engine.master.gain.value, 1, "마스터 볼륨 0 dB = 이득 1(옛 0.92가 아니다)");
});

test("트랙은 마스터 볼륨 게인으로 이어진다", async () => {
  const rig = await makeEngine();
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  const strip = rig.engine.strips.get(doc.tracks[0].id);
  assert.ok(strip.analyser.connections.includes(rig.engine.master));
});

test("재생을 시작하기 전에 정한 마스터 볼륨은 곧바로 적용된다(시작할 때 볼륨이 흔들리지 않는다)", async () => {
  const rig = await makeEngine();
  await rig.engine.play(withMaster(makeDoc([0, 1]), -6), 0);
  const gain = rig.engine.master.gain;
  near(gain.value, 10 ** (-6 / 20), "−6 dB");
  assert.equal(gain.events.filter((event) => event.type === "target").length, 0, "부드럽게 가는 예약 없이 값이 들어갔다");
});

test("문서에 master가 없으면(옛 프로젝트) 0 dB다", async () => {
  const rig = await makeEngine();
  await rig.engine.play(makeDoc([0, 1]), 0);
  near(rig.engine.master.gain.value, 1);
});

test("재생 중에 마스터 볼륨을 바꾸면 안전한 시각부터 10 ms 시상수로 부드럽게 가고, 소리 소스는 건드리지 않는다", async () => {
  const rig = await makeEngine({ lead: () => 0.03 });
  const base = makeDoc([0, 1]);
  await rig.engine.play(base, 0);
  const sources = Source.starts.length;
  rig.advance(1);
  const next = withMaster(base, -12);
  rig.engine.sync(next, base);
  const events = rig.engine.master.gain.events.filter((event) => event.type === "target");
  assert.equal(events.length, 1);
  near(events[0].time, 1.03, "지금(1) + lead(0.03)");
  assert.equal(events[0].constant, 0.01);
  near(events[0].value, 10 ** (-12 / 20));
  assert.equal(Source.starts.length, sources, "소스 시작 +0");
  assert.equal(rig.retired.length, 0);
});

test("마스터 값이 그대로면(다른 편집) 마스터 볼륨에는 아무것도 쓰지 않는다", async () => {
  const rig = await makeEngine();
  const base = withMaster(makeDoc([0, 1]), -3);
  await rig.engine.play(base, 0);
  const gain = rig.engine.master.gain;
  const before = gain.events.length + gain.assigned.length;
  const next = produce(base, (draft) => { draft.tracks[0].volume = 0.4; });
  assert.equal(next.master, base.master, "immer가 master 참조를 그대로 둔다");
  rig.engine.sync(next, base);
  assert.equal(gain.events.length + gain.assigned.length, before);
});

test("마스터 볼륨은 범위(−60 ~ +6 dB) 안으로 맞춘다", async () => {
  const rig = await makeEngine();
  const base = makeDoc([0, 1]);
  await rig.engine.play(withMaster(base, 40), 0);
  near(rig.engine.master.gain.value, 10 ** (6 / 20), "+6 dB까지");
  const low = withMaster(base, -300);
  rig.engine.sync(low, base);
  near(rig.engine.master.gain.events.at(-1).value, 10 ** (-60 / 20), "−60 dB까지");
});

test("정지한 사이 바꾼 마스터 볼륨은 다음 재생을 시작할 때 곧바로 적용된다", async () => {
  const rig = await makeEngine();
  const base = makeDoc([0, 1]);
  await rig.engine.play(base, 0);
  rig.engine.stop();
  const quiet = withMaster(base, -20);
  rig.engine.sync(quiet, base); // 정지 중: 문서만 기억한다
  near(rig.engine.master.gain.value, 1, "아직 그대로");
  await rig.engine.play(quiet, 0);
  near(rig.engine.master.gain.value, 10 ** (-20 / 20));
});

test("리미터 동작량은 MasterBus가 알려 온 값이다", async () => {
  const rig = await makeEngine();
  assert.equal(rig.engine.getLimiterReduction(), 0);
  rig.limiter.report(-5.5);
  assert.equal(rig.engine.getLimiterReduction(), -5.5);
});

test("리미터 지연 5 ms는 재생 시계의 출력 지연에 더해진다(화면 위치가 들리는 소리와 맞는다)", async () => {
  const rig = await makeEngine();
  assert.equal(rig.engine.getMasterLatency(), 0.005);
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  rig.ctx.baseLatency = 0.01;
  rig.advance(2);
  near(rig.engine.transport.position() - rig.engine.transport.visualPosition(), 0.015, "baseLatency 0.01 + 리미터 0.005");
  rig.ctx.outputLatency = 0.03;
  near(rig.engine.transport.position() - rig.engine.transport.visualPosition(), 0.035, "outputLatency 0.03 + 리미터 0.005");
});

test("워크렛 리미터를 올리지 못해도 소리는 난다(옛 압축기로 대신하고 지연은 0)", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  let rig;
  try {
    rig = await makeEngine({ createLimiter: async () => { throw new Error("audioWorklet 없음"); } });
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.equal(rig.ctx.all("compressor").length, 1);
  assert.equal(rig.engine.getMasterLatency(), 0);
  const doc = makeDoc([0, 1]);
  await rig.engine.play(doc, 0);
  assert.equal(aliveCount(), 2, "그래도 재생된다");
});

test("모니터 길: 메트로놈·입력 모니터를 이을 곳은 스피커로만 이어지고 마스터와는 따로다", async () => {
  const rig = await makeEngine();
  const input = rig.engine.getMonitorInput();
  assert.ok(input);
  assert.deepEqual(input.connections, [rig.ctx.destination]);
  near(input.gain.value, 0.85);
  assert.notEqual(input, rig.engine.master);
  assert.equal(rig.engine.master.connections.includes(input), false);
});

test("모니터 볼륨은 소리 엔진이 켜지기 전에 정해도 기억했다가 쓴다", async () => {
  const engine = new AudioEngineV2({ createTimer: () => createManualTimer(), createLimiter: async (context) => fakeLimiter(context) });
  engine.setMonitorVolume(0.3);
  assert.equal(engine.getMonitorVolume(), 0.3);
  assert.equal(engine.getMonitorInput(), undefined, "아직 소리 엔진이 없다");
  await engine.ensureContext();
  near(engine.getMonitorInput().gain.value, 0.3);
  engine.setMonitorVolume(0.6);
  assert.equal(engine.getMonitorInput().gain.events.at(-1).value, 0.6);
  engine.setMonitorVolume(9);
  assert.equal(engine.getMonitorVolume(), 1);
});

test("옛 엔진은 마스터 길이 그대로다(0.92 → 압축기 → 상한): 마스터 볼륨은 0.92에 곱한다", async () => {
  const legacy = new BrowserAudioEngine();
  const ctx = await legacy.ensureContext();
  assert.equal(ctx.all("compressor").length, 1);
  assert.equal(ctx.all("waveshaper").length, 1);
  near(legacy.master.gain.value, 0.92);
  assert.equal(legacy.getLimiterReduction(), 0);
  assert.equal(legacy.getMasterLatency(), 0);
  legacy.registerBuffer("asset", ctx.createBuffer(1, 44100 * 10, 44100));
  await legacy.play(withMaster(makeDoc([0, 1]), -6), 0);
  near(legacy.master.gain.value, 0.92 * 10 ** (-6 / 20));
  legacy.stop();
});
