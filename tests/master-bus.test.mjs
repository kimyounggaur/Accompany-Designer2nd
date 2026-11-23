import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";

const {
  MasterBus, createMasterBus, createFallbackLimiter, dbToGain, clampMasterVolumeDb,
  MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB, MASTER_VOLUME_DEFAULT_DB,
} = await import("../src/audio/engine/MasterBus.ts");
const { MonitorBus, clampMonitorVolume, MONITOR_VOLUME_DEFAULT } = await import("../src/audio/engine/MonitorBus.ts");

const near = (actual, expected, tolerance = 1e-9, message = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} ≠ ${expected}`);

/** 시험용 리미터: 진짜 워크렛 대신 게인 노드 하나. 동작량은 `report(db)`로 알린다. */
function fakeLimiter(context, { latencySeconds = 0.005 } = {}) {
  const node = context.createGain();
  let listener;
  return {
    input: node, output: node, latencySeconds, node,
    onReduction: (next) => { listener = next; },
    dispose: () => node.disconnect(),
    report: (db) => listener?.(db),
  };
}

async function makeBus(options = {}) {
  const context = new FakeContext();
  const limiter = fakeLimiter(context);
  let now = 1000;
  const bus = await createMasterBus(context, { createLimiter: async () => limiter, now: () => now, ...options });
  return { context, limiter, bus, advance: (ms) => { now += ms; } };
}

test("볼륨 범위는 −60 ~ +6 dB, 기본은 0 dB", () => {
  assert.equal(MASTER_VOLUME_MIN_DB, -60);
  assert.equal(MASTER_VOLUME_MAX_DB, 6);
  assert.equal(MASTER_VOLUME_DEFAULT_DB, 0);
  assert.equal(clampMasterVolumeDb(-100), -60);
  assert.equal(clampMasterVolumeDb(20), 6);
  assert.equal(clampMasterVolumeDb(-3.5), -3.5);
  assert.equal(clampMasterVolumeDb(Number.NaN), 0);
  near(dbToGain(0), 1);
  near(dbToGain(-6), 0.501187, 1e-5);
  near(dbToGain(6), 1.995262, 1e-5);
  near(dbToGain(-60), 0.001);
});

test("마스터 길: 볼륨 게인 → 리미터 → 분석기 → 스피커 (그 밖의 연결은 없다)", async () => {
  const { context, limiter, bus } = await makeBus();
  assert.ok(bus instanceof MasterBus);
  assert.deepEqual(bus.input.connections, [limiter.input]);
  assert.deepEqual(limiter.output.connections, [bus.analyser]);
  assert.deepEqual(bus.analyser.connections, [context.destination]);
  assert.equal(bus.input.kind, "gain");
  assert.equal(bus.analyser.fftSize, 2048);
  assert.equal(bus.usesFallback, false);
  assert.equal(bus.latencySeconds, 0.005, "리미터 지연 5 ms를 알려 준다");
});

test("스피커가 아닌 곳에도 이을 수 있다(내보내기에서 쓰는 모양)", async () => {
  const context = new FakeContext();
  const sink = context.createGain();
  const { bus } = await makeBus({ destination: sink });
  assert.ok(bus);
  const own = await createMasterBus(context, { createLimiter: async () => fakeLimiter(context), destination: sink });
  assert.deepEqual(own.analyser.connections, [sink]);
});

test("처음 볼륨: 기본 0 dB = 이득 1, 값을 주면 그 값(범위 밖은 범위 안으로)", async () => {
  near((await makeBus()).bus.input.gain.value, 1);
  near((await makeBus({ volumeDb: -6 })).bus.input.gain.value, dbToGain(-6));
  near((await makeBus({ volumeDb: -90 })).bus.input.gain.value, dbToGain(-60));
  near((await makeBus({ volumeDb: 12 })).bus.input.gain.value, dbToGain(6));
});

test("볼륨을 바꾸면 그 시각부터 10 ms 시상수로 부드럽게 간다(한 번에 값을 넣지 않는다)", async () => {
  const { bus } = await makeBus();
  bus.setVolumeDb(-12, 3.5);
  const [event] = bus.input.gain.events;
  assert.equal(event.type, "target");
  assert.equal(event.time, 3.5);
  assert.equal(event.constant, 0.01);
  near(event.value, dbToGain(-12));
  bus.setVolumeDb(40, 4);
  near(bus.input.gain.events.at(-1).value, dbToGain(6), 1e-12, "범위 밖은 +6 dB로");
  bus.setVolumeDb(-200, 5);
  near(bus.input.gain.events.at(-1).value, dbToGain(-60), 1e-12, "범위 밖은 −60 dB로");
});

test("리미터 동작량: 알려 온 값(0 이하)을 돌려주고, 한동안 소식이 없으면 0이다", async () => {
  const { limiter, bus, advance } = await makeBus();
  assert.equal(bus.reductionDb(), 0, "아직 알려 온 적 없음");
  limiter.report(-4.2);
  assert.equal(bus.reductionDb(), -4.2);
  advance(100);
  assert.equal(bus.reductionDb(), -4.2, "100 ms 안에는 그대로");
  limiter.report(-1.5);
  advance(200);
  assert.equal(bus.reductionDb(), -1.5);
  advance(100);
  assert.equal(bus.reductionDb(), 0, "250 ms 넘게 소식이 없으면 0");
  limiter.report(3);
  assert.equal(bus.reductionDb(), 0, "이득을 올리는 일은 없으므로 양수는 0으로");
});

test("워크렛 리미터를 못 올리면 옛 방식(압축기 + 상한)으로 대신한다", async () => {
  const context = new FakeContext();
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  let bus;
  try {
    bus = await createMasterBus(context, { createLimiter: async () => { throw new Error("audioWorklet 없음"); } });
  } finally {
    console.warn = original;
  }
  assert.equal(bus.usesFallback, true);
  assert.equal(bus.latencySeconds, 0);
  assert.equal(warnings.length, 1, "경고를 한 번 남긴다");
  const [compressor] = context.all("compressor");
  assert.equal(compressor.threshold.value, -1);
  assert.equal(compressor.ratio.value, 20);
  const [ceiling] = context.all("waveshaper");
  assert.ok(ceiling.curve instanceof Float32Array);
  assert.ok(Math.abs(Math.max(...ceiling.curve) - 0.98) < 1e-6);
  assert.deepEqual(bus.input.connections, [compressor], "볼륨 → 압축기");
  assert.deepEqual(compressor.connections, [ceiling]);
  assert.deepEqual(ceiling.connections, [bus.analyser]);
  assert.equal(bus.reductionDb(), 0, "동작량은 알 수 없어 0");
});

test("대신하는 리미터도 같은 모양이다: 입력 노드와 출력 노드, 지연 0", () => {
  const context = new FakeContext();
  const handle = createFallbackLimiter(context);
  assert.equal(handle.latencySeconds, 0);
  assert.notEqual(handle.input, handle.output);
  handle.onReduction(() => {});
  handle.dispose();
  assert.equal(handle.input.disconnected, true);
});

test("dispose는 리미터와 모든 연결을 끊는다", async () => {
  const { limiter, bus } = await makeBus();
  bus.dispose();
  assert.equal(limiter.node.disconnected, true);
  assert.equal(bus.input.disconnected, true);
  assert.equal(bus.analyser.disconnected, true);
});

test("모니터 길: 볼륨 게인 하나가 스피커로만 이어지고, 마스터 길과는 이어지지 않는다", async () => {
  const { context, bus } = await makeBus();
  const monitor = new MonitorBus(context);
  assert.deepEqual(monitor.input.connections, [context.destination]);
  near(monitor.input.gain.value, MONITOR_VOLUME_DEFAULT);
  // 마스터 길에서 도달하는 노드 중에 모니터 입력이 없다
  const seen = new Set();
  const stack = [bus.input];
  while (stack.length) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of node.connections ?? []) stack.push(next);
  }
  assert.equal(seen.has(monitor.input), false, "마스터 → 모니터 길은 없다");
  assert.equal(seen.has(context.destination), true);
});

test("모니터 볼륨: 0~1 범위 안에서 부드럽게 바뀐다", () => {
  const context = new FakeContext();
  const monitor = new MonitorBus(context, 0.5);
  near(monitor.input.gain.value, 0.5);
  monitor.setVolume(0.2, 2);
  assert.deepEqual(monitor.input.gain.events.at(-1), { type: "target", value: 0.2, time: 2, constant: 0.01 });
  monitor.setVolume(4, 3);
  assert.equal(monitor.input.gain.events.at(-1).value, 1);
  monitor.setVolume(-1, 4);
  assert.equal(monitor.input.gain.events.at(-1).value, 0);
  assert.equal(clampMonitorVolume(Number.NaN), MONITOR_VOLUME_DEFAULT);
  monitor.dispose();
  assert.equal(monitor.input.disconnected, true);
});
