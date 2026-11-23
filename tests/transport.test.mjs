import { test } from "node:test";
import assert from "node:assert/strict";
import { TransportClock, SEEK_GAP_SECONDS } from "../src/audio/engine/Transport.ts";
import { readEngineChoice, ENGINE_STORAGE_KEY } from "../src/audio/engine/engineChoice.ts";

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);

/** 오디오 시계·곡 끝·녹음 여부를 손으로 돌리는 가짜 바깥 환경 */
function makeEnv(overrides = {}) {
  const env = {
    time: 100, latency: 0.02, leadSeconds: 0, endAt: 10, hold: false, ensureCalls: 0,
    now: () => env.time,
    lead: () => env.leadSeconds,
    outputLatency: () => env.latency,
    ensureRunning: async () => { env.ensureCalls++; },
    end: () => env.endAt,
    holdOpen: () => env.hold,
    ...overrides,
  };
  return env;
}

/** 시계가 소리 쪽에 시킨 일을 순서대로 적는 가짜 소리 쪽 */
function makeSink() {
  const sink = { log: [], silence() { sink.log.push("silence"); }, reschedule() { sink.log.push("reschedule"); } };
  return sink;
}

function makeClock(envOverrides) {
  const env = makeEnv(envOverrides);
  const sink = makeSink();
  const clock = new TransportClock(env);
  clock.connect(sink);
  const events = [];
  clock.on("state", () => events.push(["state", clock.state]));
  clock.on("ended", () => events.push(["ended", clock.state]));
  return { env, sink, clock, events };
}

test("처음 상태: 멈춤, 위치 0", () => {
  const { clock } = makeClock();
  assert.equal(clock.state, "stopped");
  assert.equal(clock.position(), 0);
  assert.equal(clock.visualPosition(), 0);
});

test("play(): 오디오 시계를 켠 뒤 재생 상태가 되고, 소리 쪽에 한 번 예약을 시킨다", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play();
  assert.equal(env.ensureCalls, 1);
  assert.equal(clock.state, "playing");
  assert.deepEqual(events, [["state", "playing"]]);
  assert.deepEqual(sink.log, ["reschedule"]);
  env.time += 1.5;
  near(clock.position(), 1.5);
});

test("play(): 오디오 시계를 켜는 동안에는 아직 재생 상태가 아니다", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { clock, sink } = makeClock({ ensureRunning: () => gate });
  const started = clock.play(2);
  assert.equal(clock.state, "stopped");
  assert.deepEqual(sink.log, []);
  release();
  await started;
  assert.equal(clock.state, "playing");
  near(clock.position(), 2);
});

test("play(from): 그 위치에서 시작하고, 위치 ↔ 오디오 시각 변환은 서로 거꾸로다", async () => {
  const { env, clock } = makeClock();
  await clock.play(3);
  near(clock.position(), 3);
  near(clock.contextTimeAt(3), 100);
  near(clock.contextTimeAt(5), 102);
  near(clock.positionAt(102), 5);
  for (const position of [0, 0.37, 3, 7.25]) near(clock.positionAt(clock.contextTimeAt(position)), position);
  env.time += 2;
  near(clock.position(), 5);
});

test("play(): 이미 재생 중이고 위치를 주지 않으면 아무 일도 하지 않는다", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play(1);
  env.time += 1;
  sink.log.length = 0;
  events.length = 0;
  await clock.play();
  assert.deepEqual(sink.log, []);
  assert.deepEqual(events, []);
  near(clock.position(), 2);
});

test("pause(): 위치를 붙잡고 소리를 내린다. 시간이 지나도 위치는 그대로, 다시 play()하면 거기서 이어 간다", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play(1);
  env.time += 1.5;
  sink.log.length = 0;
  events.length = 0;
  clock.pause();
  assert.equal(clock.state, "paused");
  assert.deepEqual(sink.log, ["silence"]);
  assert.deepEqual(events, [["state", "paused"]]);
  near(clock.position(), 2.5);
  env.time += 30;
  near(clock.position(), 2.5);
  near(clock.visualPosition(), 2.5);

  sink.log.length = 0;
  await clock.play();
  assert.equal(clock.state, "playing");
  near(clock.position(), 2.5);
  assert.deepEqual(sink.log, ["reschedule"]);
  near(clock.contextTimeAt(2.5), env.time);
  env.time += 0.5;
  near(clock.position(), 3);
});

test("pause(): 재생 중이 아니면 아무 일도 하지 않는다", () => {
  const { sink, clock, events } = makeClock();
  clock.pause();
  assert.equal(clock.state, "stopped");
  assert.deepEqual(sink.log, []);
  assert.deepEqual(events, []);
});

test("stop(): 재생 중이면 소리를 내리고 처음으로. 이미 멈춰 있으면 알림도 없다", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play(4);
  env.time += 1;
  sink.log.length = 0;
  events.length = 0;
  clock.stop();
  assert.equal(clock.state, "stopped");
  assert.equal(clock.position(), 0);
  assert.deepEqual(sink.log, ["silence"]);
  assert.deepEqual(events, [["state", "stopped"]]);

  sink.log.length = 0;
  events.length = 0;
  clock.stop();
  assert.deepEqual(sink.log, []);
  assert.deepEqual(events, []);

  await clock.play();
  near(clock.position(), 0, "stop 뒤 재생은 처음부터");
});

test("일시정지 중 stop(): 소리는 이미 내려갔으므로 다시 내리지 않고 위치만 0으로", async () => {
  const { sink, clock } = makeClock();
  await clock.play(2);
  clock.pause();
  sink.log.length = 0;
  clock.stop();
  assert.equal(clock.state, "stopped");
  assert.equal(clock.position(), 0);
  assert.deepEqual(sink.log, []);
});

test("C4: 곡 끝에 놓인 채 play()하면 0부터 시작한다", async () => {
  const { clock } = makeClock();
  clock.seek(10); // 멈춘 채 끝으로
  assert.equal(clock.position(), 10);
  await clock.play();
  near(clock.position(), 0, "끝에서는 처음부터");

  clock.stop();
  await clock.play(12); // 끝 너머를 직접 줘도
  near(clock.position(), 0);

  clock.stop();
  await clock.play(9.99);
  near(clock.position(), 9.99, "끝 직전은 그 자리에서");
});

test("play(): 음수·NaN 위치는 0으로 본다", async () => {
  const { clock } = makeClock();
  await clock.play(-3);
  near(clock.position(), 0);
  clock.stop();
  await clock.play(Number.NaN);
  near(clock.position(), 0);
});

test("멈춘·일시정지 중 seek(): 소리 쪽을 건드리지 않고 위치만 옮긴다", async () => {
  const { sink, clock, events } = makeClock();
  clock.seek(4);
  assert.equal(clock.position(), 4);
  assert.equal(clock.state, "stopped");
  clock.seek(-2);
  assert.equal(clock.position(), 0);
  assert.deepEqual(sink.log, []);
  assert.deepEqual(events, []);

  await clock.play(1);
  clock.pause();
  sink.log.length = 0;
  clock.seek(6);
  assert.equal(clock.state, "paused");
  assert.equal(clock.position(), 6);
  assert.deepEqual(sink.log, []);
  await clock.play();
  near(clock.position(), 6, "이어 재생은 옮긴 위치에서");
});

test("재생 중 seek(): 먼저 소리를 내리고, 10ms 뒤 새 위치에서 다시 예약한다", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play(1);
  env.time += 2;
  sink.log.length = 0;
  events.length = 0;
  clock.seek(5);
  assert.deepEqual(sink.log, ["silence", "reschedule"], "내리기 → 다시 예약 순서");
  assert.deepEqual(events, [], "재생 상태는 그대로이므로 상태 알림이 없다");
  assert.equal(clock.state, "playing");
  near(SEEK_GAP_SECONDS, 0.01);
  near(clock.contextTimeAt(5), env.time + SEEK_GAP_SECONDS, "새 위치의 시작은 10ms 뒤");
  near(clock.position(), 5, "옮긴 직후에는 위치가 새 자리에서 움직이지 않는다");
  env.time += SEEK_GAP_SECONDS;
  near(clock.position(), 5);
  env.time += 0.5;
  near(clock.position(), 5.5);
});

test("lead: 재생 시작도, 재생 중 이동도 오디오 시각 + lead부터 걸린다 (그동안 위치는 시작 위치에 머문다)", async () => {
  const { env, clock } = makeClock({ leadSeconds: 0.03 });
  await clock.play(2);
  near(clock.contextTimeAt(2), env.time + 0.03, "시작은 지금 + 30ms");
  near(clock.position(), 2);
  env.time += 0.02;
  near(clock.position(), 2, "아직 시작 전");
  env.time += 0.04;
  near(clock.position(), 2.03);

  clock.seek(7);
  near(clock.contextTimeAt(7), env.time + 0.03 + SEEK_GAP_SECONDS, "이동 뒤 시작은 지금 + lead + 10ms");
  near(clock.position(), 7);
});

test("lead: 시각을 직접 정해 준 재생(카운트인)은 lead를 더하지 않는다", async () => {
  const { env, clock } = makeClock({ leadSeconds: 0.03 });
  await clock.play(0, { atContextTime: env.time + 0.5 });
  near(clock.contextTimeAt(0), env.time + 0.5);
});

test("safeTime()·schedulePosition(): 안전한 시각, 그 시각에 시계가 가 있을 위치(시작 위치보다 앞서지 않는다)", async () => {
  const { env, clock } = makeClock({ leadSeconds: 0.03 });
  near(clock.safeTime(), env.time + 0.03);
  near(clock.schedulePosition(), 0, "멈춘 동안은 멈춘 위치");
  await clock.play(1);
  near(clock.schedulePosition(), 1, "시작 전에는 시작 위치");
  env.time += 1;
  near(clock.position(), 1 + (1 - 0.03));
  near(clock.schedulePosition(), 1 + 1, "지금의 위치보다 lead만큼 앞선 위치");
  clock.pause();
  near(clock.schedulePosition(), clock.position(), "일시정지 중에는 붙잡은 위치");
});

test("재생 중 play(from)는 seek와 같다(상태 알림 없이 옮긴다)", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play(0);
  env.time += 1;
  sink.log.length = 0;
  events.length = 0;
  await clock.play(7);
  assert.deepEqual(sink.log, ["silence", "reschedule"]);
  assert.deepEqual(events, []);
  near(clock.position(), 7);
  // 끝 너머로 옮기면 0부터(C4)
  sink.log.length = 0;
  await clock.play(50);
  near(clock.position(), 0);
  assert.deepEqual(sink.log, ["silence", "reschedule"]);
});

test("재생 중 seek()를 10번 연달아 해도 매번 내리고 한 번 예약한다", async () => {
  const { env, sink, clock } = makeClock();
  await clock.play(0);
  sink.log.length = 0;
  for (let i = 1; i <= 10; i += 1) {
    env.time += 0.05;
    clock.seek(i * 0.5);
  }
  assert.equal(sink.log.filter((entry) => entry === "silence").length, 10);
  assert.equal(sink.log.filter((entry) => entry === "reschedule").length, 10);
  assert.deepEqual(sink.log.slice(0, 4), ["silence", "reschedule", "silence", "reschedule"]);
  near(clock.position(), 5);
});

test("visualPosition(): 출력 지연만큼 뒤에 있고, 시작 위치보다 앞서 가지 않는다", async () => {
  const { env, clock } = makeClock({ latency: 0.05 });
  await clock.play(2);
  env.time += 0.01;
  near(clock.position(), 2.01);
  near(clock.visualPosition(), 2, "시작 직후에는 시작 위치에 머문다");
  env.time += 1;
  near(clock.visualPosition(), 2.96);
  clock.pause();
  near(clock.visualPosition(), clock.position(), "멈추면 지연이 없다");
});

test("곡 끝: 한 번만 멈추고 'ended'를 한 번만 알린다. 위치는 끝에 둔다", async () => {
  const { env, sink, clock, events } = makeClock();
  await clock.play(8);
  env.time += 1.5;
  near(clock.position(), 9.5);
  assert.equal(clock.checkEnd(), false, "아직 끝이 아니다");
  env.time += 0.5;
  events.length = 0;
  sink.log.length = 0;
  assert.equal(clock.checkEnd(), true);
  assert.equal(clock.state, "stopped");
  assert.deepEqual(events, [["state", "stopped"], ["ended", "stopped"]], "상태 알림 → 끝 알림 순서");
  assert.deepEqual(sink.log, ["silence"]);
  assert.equal(clock.position(), 10);
  assert.equal(clock.checkEnd(), false, "이미 멈췄으니 다시 알리지 않는다");
  assert.equal(events.length, 2);
  await clock.play();
  near(clock.position(), 0, "끝에서 다시 재생하면 처음부터");
});

test("곡 끝: 녹음 중(holdOpen)이면 멈추지 않고 계속 간다", async () => {
  const { env, clock, events } = makeClock();
  await clock.play(9);
  env.hold = true;
  env.time += 5;
  events.length = 0;
  assert.equal(clock.checkEnd(), false);
  assert.equal(clock.state, "playing");
  near(clock.position(), 14);
  assert.deepEqual(events, []);
  env.hold = false;
  assert.equal(clock.checkEnd(), true);
  assert.deepEqual(events.map(([name]) => name), ["state", "ended"]);
});

test("재생 중이 아니면 checkEnd()는 아무것도 하지 않는다", () => {
  const { env, clock, events } = makeClock();
  env.time += 100;
  assert.equal(clock.checkEnd(), false);
  assert.deepEqual(events, []);
});

test("play(from, { atContextTime }): 그 오디오 시각에 정확히 시작한다(카운트인용)", async () => {
  const { env, clock } = makeClock();
  await clock.play(0, { atContextTime: 105 });
  near(clock.contextTimeAt(0), 105);
  near(clock.positionAt(105), 0);
  near(clock.position(), 0, "시작 시각 전에는 위치가 앞서지 않는다");
  env.time = 103;
  near(clock.position(), 0);
  env.time = 106;
  near(clock.position(), 1);
});

test("on(): 되돌려 준 함수를 부르면 그 리스너만 빠진다", async () => {
  const { clock } = makeClock();
  const seen = [];
  const offA = clock.on("state", () => seen.push("a"));
  clock.on("state", () => seen.push("b"));
  await clock.play();
  assert.deepEqual(seen, ["a", "b"]);
  offA();
  clock.pause();
  assert.deepEqual(seen, ["a", "b", "b"]);
});

test("리스너가 알림 도중 자신을 빼도 다른 리스너는 모두 불린다", async () => {
  const { clock } = makeClock();
  const seen = [];
  const off = clock.on("state", () => { seen.push("first"); off(); });
  clock.on("state", () => seen.push("second"));
  await clock.play();
  assert.deepEqual(seen, ["first", "second"]);
});

test("소리 쪽을 연결하지 않아도 시계는 혼자 동작한다", async () => {
  const clock = new TransportClock(makeEnv());
  await clock.play(1);
  clock.seek(2);
  clock.pause();
  clock.stop();
  assert.equal(clock.state, "stopped");
});

// ───── 엔진 고르기 ─────

test("readEngineChoice: 기본은 새 엔진, 주소·저장소로 옛 엔진을 고른다", () => {
  assert.equal(readEngineChoice("", null), "v2");
  assert.equal(readEngineChoice("?engine=v1", null), "v1");
  assert.equal(readEngineChoice("?x=1&engine=v1", null), "v1");
  assert.equal(readEngineChoice("?engine=v2", null), "v2");
  assert.equal(readEngineChoice("", "v1"), "v1");
  assert.equal(readEngineChoice("", "v2"), "v2");
  assert.equal(readEngineChoice("", "아무거나"), "v2");
});

test("readEngineChoice: 주소의 ?engine=…은 저장소 설정보다 우선하고, 알 수 없는 값은 무시한다", () => {
  assert.equal(readEngineChoice("?engine=v1", "v2"), "v1");
  assert.equal(readEngineChoice("?engine=v2", "v1"), "v2");
  assert.equal(readEngineChoice("?engine=v3", "v1"), "v1", "알 수 없는 값은 무시하고 저장소를 본다");
  assert.equal(readEngineChoice("?engine=v3", null), "v2");
  assert.equal(ENGINE_STORAGE_KEY, "ad.engine");
});

test("readEngineChoice: 인자를 생략해도(브라우저가 아닌 환경) 새 엔진", () => {
  assert.equal(readEngineChoice(), "v2");
});
