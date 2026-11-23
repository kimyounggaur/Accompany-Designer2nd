import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext, createManualTimers } from "./helpers/fake-audio.mjs";

const { createDefaultTrack } = await import("../src/domain/project/defaults.ts");
const { createReverb, IR_DEBOUNCE_MS, IR_CROSSFADE_SECONDS } = await import("../src/audio/effects/Reverb.ts");
const { createImpulseBuffer, impulseKey } = await import("../src/audio/effects/impulse.ts");

/** 잔향 만들기를 세는 리버브: 만들 때마다 설정을 기록한다 */
function makeReverb(changes = {}) {
  const context = new FakeContext();
  const timers = createManualTimers();
  const made = [];
  const settings = { ...createDefaultTrack(1).reverb, enabled: true, ...changes };
  const reverb = createReverb(context, settings, {
    timers,
    makeImpulse: (ctx, wanted) => { made.push(wanted); return createImpulseBuffer(ctx, wanted); },
  });
  return { context, timers, made, settings, reverb };
}

test("처음 만들 때 잔향을 한 번 만든다", () => {
  const { made, context } = makeReverb();
  assert.equal(made.length, 1);
  assert.equal(context.all("convolver").length, 1);
});

test("잔향 길이 노브를 1초 동안 끄는 동안은 잔향을 만들지 않고, 놓은 뒤 150ms에 한 번만 만든다", () => {
  const { reverb, timers, made, settings } = makeReverb();
  assert.equal(IR_DEBOUNCE_MS, 150);
  let decay = settings.decay;
  for (let step = 0; step < 33; step += 1) {
    decay += 0.1;
    reverb.update({ ...settings, decay }, 120, 0);
    timers.advance(30); // 약 1초
  }
  assert.equal(made.length, 1, "끄는 동안에는 새로 만들지 않았다(처음 한 번뿐)");
  timers.advance(100); // 마지막 값을 넣은 뒤 130ms
  assert.equal(made.length, 1, "아직 150ms가 지나지 않았다");
  timers.advance(20);
  assert.equal(made.length, 2, "놓은 뒤 150ms에 한 번");
  assert.equal(made[1].decay, decay, "마지막 값으로 만든다");
  timers.advance(5000);
  assert.equal(made.length, 2, "더 만들지 않는다");
});

test("잔향 모양과 상관없는 노브(섞는 양·프리딜레이·폭 …)는 잔향을 다시 만들지 않는다", () => {
  const { reverb, timers, made, settings } = makeReverb();
  for (let i = 0; i < 20; i += 1) {
    reverb.update({ ...settings, wet: i / 20, dry: 1 - i / 40, preDelayMs: i * 5, width: i / 20, highPassHz: 100 + i * 10 }, 120, 0);
    timers.advance(50);
  }
  timers.advance(1000);
  assert.equal(made.length, 1);
  assert.equal(timers.pending, 0, "기다리는 일도 없다");
});

test("잔향 길이를 바꿨다가 원래 값으로 되돌리면 기다리던 새 잔향은 취소된다", () => {
  const { reverb, timers, made, settings } = makeReverb();
  reverb.update({ ...settings, decay: 4 }, 120, 0);
  assert.equal(timers.pending, 1);
  timers.advance(100);
  reverb.update({ ...settings }, 120, 0);
  assert.equal(timers.pending, 0, "기다림이 취소됐다");
  timers.advance(1000);
  assert.equal(made.length, 1);
});

test("새 잔향으로 바꿀 때 컨볼버 둘을 50ms 동안 교차하고, 옛 컨볼버는 그 뒤에 치운다(이어진 줄까지 끊는다)", () => {
  const { reverb, timers, context, settings } = makeReverb();
  assert.equal(IR_CROSSFADE_SECONDS, 0.05);
  const [oldConvolver] = context.all("convolver");
  const [oldTapGain] = oldConvolver.connections;
  context.currentTime = 2;
  reverb.update({ ...settings, mode: "hall" }, 120, 2);
  timers.advance(IR_DEBOUNCE_MS);

  const convolvers = context.all("convolver");
  assert.equal(convolvers.length, 2, "교차하는 동안 컨볼버가 둘이다");
  const newConvolver = convolvers.find((node) => node !== oldConvolver);
  const [newTapGain] = newConvolver.connections;
  assert.deepEqual(newTapGain.gain.events.at(-1), { type: "target", value: 1, time: 2, constant: 0.01 }, "새 잔향은 0 → 1 (시상수 50ms / 5)");
  assert.deepEqual(oldTapGain.gain.events.at(-1), { type: "target", value: 0, time: 2, constant: 0.01 }, "옛 잔향은 1 → 0");
  assert.equal(newTapGain.gain.assigned[0], 0, "새 잔향은 0에서 시작해 갑자기 들리지 않는다");

  const feeding = (target) => context.all("biquad").some((filter) => filter.connections.includes(target));
  assert.equal(feeding(oldConvolver), true, "교차 중에는 옛 컨볼버에도 소리가 들어간다");
  timers.advance(120);
  assert.equal(feeding(oldConvolver), false, "치운 뒤에는 들어가는 줄도 끊겼다");
  assert.equal(oldConvolver.disconnected, true);
  assert.equal(feeding(newConvolver), true, "새 컨볼버는 계속 쓴다");
});

test("교차 도중 또 바뀌어도 컨볼버는 하나씩 정리된다", () => {
  const { reverb, timers, context, settings } = makeReverb();
  reverb.update({ ...settings, mode: "hall" }, 120, 0);
  timers.advance(150);
  reverb.update({ ...settings, mode: "room" }, 120, 0); // 옛 컨볼버가 아직 남아 있는 중
  timers.advance(150);
  timers.advance(500);
  assert.equal(context.all("convolver").filter((node) => !node.disconnected).length, 1, "마지막에는 컨볼버 하나만 남는다");
});

test("dispose하면 기다리던 일을 모두 취소하고 연결을 끊는다", () => {
  const { reverb, timers, made, context, settings } = makeReverb();
  reverb.update({ ...settings, decay: 5 }, 120, 0);
  assert.equal(timers.pending, 1);
  reverb.dispose();
  assert.equal(timers.pending, 0);
  timers.advance(1000);
  assert.equal(made.length, 1, "치운 뒤에는 잔향을 만들지 않는다");
  assert.equal(reverb.input.disconnected, true);
  assert.equal(context.all("convolver").every((node) => node.disconnected), true);
});

test("교차 중에 dispose해도 옛 컨볼버까지 모두 치운다", () => {
  const { reverb, timers, context, settings } = makeReverb();
  reverb.update({ ...settings, mode: "hall" }, 120, 0);
  timers.advance(150);
  assert.equal(context.all("convolver").length, 2);
  reverb.dispose();
  assert.equal(timers.pending, 0);
  assert.equal(context.all("convolver").every((node) => node.disconnected), true);
});

test("꼬리 길이는 설정에서 계산한다", () => {
  const { reverb, settings } = makeReverb();
  assert.ok(Math.abs(reverb.tailSeconds(settings, 120) - 2.42) < 1e-9);
  assert.equal(impulseKey(settings), "plate:2.4:false:0.15");
});
