import { test } from "node:test";
import assert from "node:assert/strict";
import { produce } from "immer";
import { FakeContext, createManualTimers } from "./helpers/fake-audio.mjs";

const { createDefaultTrack } = await import("../src/domain/project/defaults.ts");
const { TrackStrip, CROSSFADE_SECONDS, REORDER_DIP_SECONDS, IDLE_DISCONNECT_MS } = await import("../src/audio/engine/TrackStrip.ts");

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);

/** 켜기 버튼이 하는 일: 이펙트 자신의 켜기와 사슬 슬롯의 켜기를 함께 바꾼다 */
function setEffect(track, type, enabled) {
  const key = { eq: "eq", comp: "compressor", delay: "delay", reverb: "reverb" }[type];
  track[key].enabled = enabled;
  for (const slot of track.effectChain) if (slot.type === type) slot.enabled = enabled;
}
const edit = (track, change) => produce(track, change);

function makeStrip(changes = {}, options = {}) {
  const context = new FakeContext();
  const master = context.createGain();
  const timers = createManualTimers();
  const made = [];
  const track = edit(createDefaultTrack(1), (draft) => { for (const [type, on] of Object.entries(changes)) setEffect(draft, type, on); });
  const strip = new TrackStrip(context, master, track, 120, {
    timers,
    makeImpulse: (ctx, wanted) => { made.push(wanted); return { duration: 1, length: 1, numberOfChannels: 2, sampleRate: ctx.sampleRate }; },
    ...options,
  });
  /**
   * `time`에 값을 맞춘다(실제로는 지금 + 띄움 간격). 오디오 시계 `now`는 따로 주지 않으면 `time`과 같다:
   * 기다리는 시간(교차가 끝나기까지)을 오디오 시계로 계산하므로 두 값이 어긋나면 기다림이 길어진다.
   */
  const update = (next, { solo = false, time = context.currentTime, now = time, bpm = 120 } = {}) => {
    context.currentTime = now;
    strip.update(next, solo, bpm, time);
  };
  return { context, master, timers, made, track, strip, update };
}

/** 칸 하나를 이름으로 찾는다(시험에서만 속을 들여다본다) */
const slotOf = (strip, type) => strip.slots.get(type);
const events = (param, type) => param.events.filter((event) => event.type === type);

/** 입력에서 시작해 이어진 모든 노드 */
function reachable(from) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of node.connections ?? []) stack.push(next);
  }
  return seen;
}

/** 칸을 지나는 순서: 입력에서 첫 연결만 따라가며 칸 입력을 만난 차례 */
function slotWalk(strip) {
  const inputs = new Map([...strip.slots].map(([type, slot]) => [slot.input, type]));
  const outputs = new Map([...strip.slots].map(([type, slot]) => [slot.output, type]));
  const order = [];
  let node = strip.input;
  for (let hops = 0; hops < 60 && node; hops += 1) {
    if (inputs.has(node)) order.push(inputs.get(node));
    if (node === strip.dip) break;
    node = node.connections[0];
    void outputs;
  }
  return order;
}

test("트랙 소리 길: 입력 → 이펙트 칸들 → 순서 게인 → 팬 → 볼륨 → 미터 → 마스터", () => {
  const { strip, master } = makeStrip();
  assert.deepEqual(slotWalk(strip), ["eq", "comp", "delay", "reverb"]);
  const nodes = reachable(strip.input);
  for (const node of [strip.dip, strip.pan, strip.output, strip.analyser, master]) assert.ok(nodes.has(node));
  assert.ok(strip.analyser.connections.includes(master));
  assert.equal(strip.analyser.connections.length, 1);
});

test("꺼진 이펙트는 노드를 만들지 않는다(켜질 때 처음 만든다)", () => {
  const { context, update, track, timers } = makeStrip();
  assert.equal(context.all("compressor").length, 0);
  assert.equal(context.all("delay").length, 0);
  assert.equal(context.all("convolver").length, 0);
  assert.equal(context.all("biquad").length, 5, "EQ는 기본으로 켜져 있다");

  update(edit(track, (draft) => setEffect(draft, "delay", true)));
  assert.equal(context.all("delay").length, 1);
  update(edit(track, (draft) => setEffect(draft, "reverb", true)));
  assert.equal(context.all("convolver").length, 1);
  assert.equal(timers.pending >= 0, true);
});

test("처음부터 켜진 이펙트는 교차 없이 바로 효과 길을 탄다(원음 0, 효과 1)", () => {
  const { strip } = makeStrip({ delay: true });
  const slot = slotOf(strip, "delay");
  assert.equal(slot.dry.gain.value, 0);
  assert.equal(slot.path.wet.gain.value, 1);
  assert.equal(slot.dry.gain.events.length, 0, "예약 없이 값만 넣었다");
  assert.ok(slot.input.connections.includes(slot.path.effect.input));
  const eq = slotOf(strip, "eq");
  assert.equal(eq.dry.gain.value, 0, "EQ도 켜져 있으니 같다");
  const comp = slotOf(strip, "comp");
  assert.equal(comp.path, undefined, "꺼진 칸에는 효과 길이 없다");
  assert.equal(comp.dry.gain.assigned.length, 0, "꺼진 칸의 원음은 그대로 흐른다(실제 게인 기본값 1)");
});

test("이펙트를 켜면 10ms 안에 원음 1→0, 효과 0→1로 교차한다(연결 → 교차 순서)", () => {
  const { strip, update, track } = makeStrip();
  update(edit(track, (draft) => setEffect(draft, "delay", true)), { time: 3.02, now: 3 });
  const slot = slotOf(strip, "delay");
  assert.equal(CROSSFADE_SECONDS, 0.01);
  assert.ok(slot.input.connections.includes(slot.path.effect.input), "먼저 연결한다");
  assert.equal(slot.path.wet.gain.assigned.at(-1), 0, "효과 길은 0으로 시작");
  // 목표값 방식: 시작점이 필요 없어서 앞의 예약이 어떤 상태든 이어진다(시상수 = 10ms / 5)
  assert.deepEqual(slot.dry.gain.events, [{ type: "target", value: 0, time: 3.02, constant: 0.002 }]);
  assert.deepEqual(slot.path.wet.gain.events, [{ type: "target", value: 1, time: 3.02, constant: 0.002 }]);
});

test("이펙트를 끄면 반대로 교차하고, 입력 연결은 1초 뒤에 끊는다", () => {
  const { strip, update, track, timers } = makeStrip({ delay: true });
  const slot = slotOf(strip, "delay");
  const effectInput = slot.path.effect.input;
  update(edit(track, (draft) => setEffect(draft, "delay", false)), { time: 5 });
  assert.deepEqual(slot.dry.gain.events, [{ type: "target", value: 1, time: 5, constant: 0.002 }]);
  assert.deepEqual(slot.path.wet.gain.events, [{ type: "target", value: 0, time: 5, constant: 0.002 }]);
  assert.ok(slot.input.connections.includes(effectInput), "꼬리가 울리도록 아직 이어 둔다");

  assert.equal(IDLE_DISCONNECT_MS, 1000);
  timers.advance(999);
  assert.ok(slot.input.connections.includes(effectInput));
  timers.advance(1);
  assert.equal(slot.input.connections.includes(effectInput), false, "1초 뒤 입력만 끊는다");
  assert.ok(slot.path, "이펙트 자체는 남아 다시 켤 때 쓴다");
});

test("끈 뒤 1초 안에 다시 켜면 연결은 끊기지 않고 곧바로 교차한다", () => {
  const { strip, update, track, timers } = makeStrip({ delay: true });
  const slot = slotOf(strip, "delay");
  const effectInput = slot.path.effect.input;
  const off = edit(track, (draft) => setEffect(draft, "delay", false));
  update(off, { time: 1 });
  timers.advance(500);
  update(edit(off, (draft) => setEffect(draft, "delay", true)), { time: 1.5 });
  timers.advance(5000);
  assert.ok(slot.input.connections.includes(effectInput), "끊기 예약이 취소됐다");
  assert.equal(slot.path.wet.gain.events.at(-1).value, 1);
});

test("입력이 끊긴 뒤 다시 켜면 이펙트를 새로 만들지 않고 다시 연결한 다음 교차한다", () => {
  const { strip, update, track, timers, context } = makeStrip({ delay: true });
  const slot = slotOf(strip, "delay");
  const path = slot.path;
  const delayNodes = context.all("delay").length;
  const off = edit(track, (draft) => setEffect(draft, "delay", false));
  update(off, { time: 1 });
  timers.advance(1500);
  assert.equal(slot.input.connections.includes(path.effect.input), false);

  update(edit(off, (draft) => setEffect(draft, "delay", true)), { time: 4 });
  assert.equal(slot.path, path, "같은 이펙트");
  assert.equal(context.all("delay").length, delayNodes, "노드를 새로 만들지 않았다");
  assert.ok(slot.input.connections.includes(path.effect.input), "연결부터");
  assert.deepEqual(slot.path.wet.gain.events.at(-1), { type: "target", value: 1, time: 4, constant: 0.002 });
});

test("딜레이를 열 번 켜고 꺼도 이펙트는 한 번만 만들어진다", () => {
  const { update, track, context, timers } = makeStrip();
  let current = track;
  for (let i = 0; i < 10; i += 1) {
    current = edit(current, (draft) => setEffect(draft, "delay", i % 2 === 0));
    update(current, { time: i * 0.1 });
    timers.advance(100);
  }
  assert.equal(context.all("delay").length, 1);
});

test("핑퐁처럼 연결 모양이 달라지는 값은 새 효과 길을 만들어 교차하고, 옛 길은 나중에 치운다", () => {
  const { strip, update, track, timers, context } = makeStrip({ delay: true });
  const slot = slotOf(strip, "delay");
  const before = slot.path;
  assert.equal(context.all("delay").length, 1);

  update(edit(track, (draft) => { setEffect(draft, "delay", true); draft.delay.pingPong = true; }), { time: 2 });
  assert.notEqual(slot.path, before, "효과 길을 바꿨다");
  assert.equal(context.all("delay").length, 3, "핑퐁은 딜레이 둘");
  assert.deepEqual(before.wet.gain.events.at(-1), { type: "target", value: 0, time: 2, constant: 0.002 });
  assert.deepEqual(slot.path.wet.gain.events.at(-1), { type: "target", value: 1, time: 2, constant: 0.002 });
  assert.ok(slot.input.connections.includes(before.effect.input), "교차하는 동안은 옛 길도 이어 둔다");
  assert.equal(before.effect.input.disconnected, undefined);

  timers.advance(120);
  assert.equal(slot.input.connections.includes(before.effect.input), false, "옛 길을 치웠다");
  assert.equal(before.effect.input.disconnected, true);
  assert.ok(slot.input.connections.includes(slot.path.effect.input));
});

test("이펙트 값(피드백 같은 것)만 바뀌면 효과 길은 그대로이고 값만 고친다", () => {
  const { strip, update, track, context } = makeStrip({ delay: true });
  const slot = slotOf(strip, "delay");
  const before = slot.path;
  const nodes = context.nodes.length;
  update(edit(track, (draft) => { setEffect(draft, "delay", true); draft.delay.feedback = 0.6; }), { time: 1 });
  assert.equal(slot.path, before);
  assert.equal(context.nodes.length, nodes, "노드가 늘지 않았다");
  const feedback = context.all("gain").find((node) => node.gain.events.some((event) => event.type === "target" && event.value === 0.6));
  assert.ok(feedback, "피드백 값이 고쳐졌다");
});

test("순서를 바꾸면 10ms 안에 순서 게인을 0으로 내리고, 거의 0이 된 뒤에 연결을 바꾸고, 다시 올린다", () => {
  const { strip, update, track, timers, context } = makeStrip({ delay: true, reverb: true });
  const nodes = context.nodes.length;
  const reversed = edit(track, (draft) => { draft.effectChain.reverse(); });
  update(reversed, { time: 1 });
  assert.equal(REORDER_DIP_SECONDS, 0.01);
  assert.deepEqual(strip.dip.gain.events, [{ type: "target", value: 0, time: 1, constant: 0.002 }], "시작점이 필요 없는 목표값 방식");
  assert.deepEqual(slotWalk(strip), ["eq", "comp", "delay", "reverb"], "아직 옛 순서로 이어져 있다");

  context.currentTime = 1.014;
  timers.advance(14);
  assert.deepEqual(slotWalk(strip), ["eq", "comp", "delay", "reverb"], "충분히 내려가기 전에는 연결을 바꾸지 않는다");
  context.currentTime = 1.015;
  timers.advance(1);
  assert.deepEqual(slotWalk(strip), ["reverb", "delay", "comp", "eq"], "내려간 뒤 새 순서로 이었다");
  const up = strip.dip.gain.events.at(-1);
  assert.deepEqual([up.type, up.value, up.constant], ["target", 1, 0.002]);
  near(up.time, 1.02, "5ms 쉬고 다시 올린다");
  assert.equal(context.nodes.length, nodes, "이펙트는 새로 만들지 않는다");
  const nodesReached = reachable(strip.input);
  assert.ok(nodesReached.has(strip.output) && nodesReached.has(strip.analyser));
});

test("순서를 연달아 바꾸면 마지막 순서만 쓰고 연결은 한 번만 바꾼다", () => {
  const { strip, update, track, timers } = makeStrip();
  const second = edit(track, (draft) => { draft.effectChain.reverse(); });
  const third = edit(track, (draft) => { draft.effectChain = [draft.effectChain[2], draft.effectChain[0], draft.effectChain[1], draft.effectChain[3]]; });
  update(second, { time: 1 });
  timers.advance(5);
  update(third, { time: 1.005 });
  assert.equal(timers.pending, 1, "연결을 바꾸는 일은 하나뿐");
  timers.advance(100);
  assert.deepEqual(slotWalk(strip), ["delay", "eq", "comp", "reverb"]);
  assert.equal(strip.dip.gain.events.filter((event) => event.value === 1).length, 1, "다시 올리는 것도 한 번");
});

test("순서가 그대로이면 아무것도 하지 않는다", () => {
  const { strip, update, track, timers } = makeStrip();
  const dipEvents = strip.dip.gain.events.length;
  update(edit(track, (draft) => { draft.volume = 0.5; }), { time: 1 });
  assert.equal(strip.dip.gain.events.length, dipEvents);
  assert.equal(timers.pending, 0);
});

test("볼륨·팬·음소거·솔로는 트랙 출력에 10ms 시상수로 부드럽게 반영된다", () => {
  const { strip, update, track } = makeStrip();
  update(edit(track, (draft) => { draft.volume = 0.5; draft.pan = -0.4; }), { time: 2 });
  assert.deepEqual(strip.output.gain.events.at(-1), { type: "target", value: 0.5, time: 2, constant: 0.01 });
  assert.deepEqual(strip.pan.pan.events.at(-1), { type: "target", value: -0.4, time: 2, constant: 0.01 });

  update(edit(track, (draft) => { draft.muted = true; }), { time: 3 });
  assert.equal(strip.output.gain.events.at(-1).value, 0, "음소거");
  update(track, { time: 4, solo: true });
  assert.equal(strip.output.gain.events.at(-1).value, 0, "다른 트랙이 솔로면 이 트랙은 조용하다");
  update(edit(track, (draft) => { draft.solo = true; }), { time: 5, solo: true });
  assert.equal(strip.output.gain.events.at(-1).value, 0.86, "이 트랙이 솔로면 들린다");
});

test("다른 트랙이 솔로인 상태로 새 트랙을 만들면 처음부터 조용하다", () => {
  const { strip } = makeStrip({}, { solo: true });
  assert.equal(strip.output.gain.value, 0);
  const normal = makeStrip();
  assert.equal(normal.strip.output.gain.value, 0.86);
});

test("멈출 때 트랙 소리를 4ms 시상수로 0으로 내린다", () => {
  const { strip } = makeStrip();
  strip.fadeOut(2);
  assert.deepEqual(strip.output.gain.events.slice(-2), [{ type: "cancel", time: 2 }, { type: "target", value: 0, time: 2, constant: 0.004 }]);
});

test("dispose하면 모든 연결을 끊고 기다리던 일을 취소한다(끈 뒤 연결 끊기·순서 바꾸기·리버브 잔향)", () => {
  const { strip, update, track, timers, context } = makeStrip({ delay: true, reverb: true });
  const off = edit(track, (draft) => { setEffect(draft, "delay", false); draft.effectChain.reverse(); draft.reverb.decay = 6; });
  update(off, { time: 1 });
  assert.ok(timers.pending >= 2, "연결 끊기와 순서 바꾸기와 잔향이 기다리는 중");
  strip.dispose();
  assert.equal(timers.pending, 0);
  timers.advance(5000);
  assert.equal(strip.input.disconnected, true);
  assert.equal(strip.analyser.disconnected, true);
  assert.ok(context.nodes.filter((node) => node.kind === "convolver").every((node) => node.disconnected));
});

test("컴프레서 압축량: 켜진 컴프레서의 지금 압축량(dB)을 읽고, 꺼져 있으면 0이다", () => {
  const { context, strip, track, update } = makeStrip();
  assert.equal(strip.compressorReduction(), 0, "꺼져 있으면 노드도 없다");

  update(edit(track, (draft) => setEffect(draft, "comp", true)));
  const [compressor] = context.all("compressor");
  compressor.reduction = -7.5; // 브라우저 압축기가 지금 걸고 있는 양
  assert.equal(strip.compressorReduction(), -7.5);
  compressor.reduction = -12;
  assert.equal(strip.compressorReduction(), -12, "읽을 때마다 새로 읽는다");

  update(edit(track, (draft) => setEffect(draft, "comp", false)));
  assert.equal(strip.compressorReduction(), 0, "끄면 효과 길이 닫혀 0이다(노드는 남아 있어도)");
});

test("컴프레서가 아닌 이펙트는 압축량이 없어 0으로 읽힌다", () => {
  const { strip } = makeStrip({ delay: true, reverb: true });
  assert.equal(strip.compressorReduction(), 0);
});
