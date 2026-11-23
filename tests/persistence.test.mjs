import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, assetKey } from "../src/services/persistence/assetHash.ts";
import {
  MAX_PROJECT_RECORDS,
  buildProjectRecord,
  createChangeWatcher,
  documentChanged,
  formatClock,
  isProjectRecord,
  orphanHashes,
  projectIdsToDelete,
  referencedHashes,
  storageUsageRatio,
} from "../src/services/persistence/projectRecord.ts";
import { AUTOSAVE_DELAY_MS, AutosaveScheduler } from "../src/services/persistence/scheduler.ts";
import { createStorageGuard } from "../src/services/persistence/autosave.ts";
import { useNoticeStore } from "../src/state/noticeStore.ts";

// ───────── 해시 ─────────

test("같은 음원은 같은 해시, 다른 음원은 다른 해시(SHA-256 16진수 64자)", async () => {
  const a = await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]));
  const same = await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]));
  const other = await sha256Hex(new Blob([new Uint8Array([1, 2, 4])]));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, same);
  assert.notEqual(a, other);
  // 알려진 값: SHA-256("abc")
  assert.equal(await sha256Hex(new Blob(["abc"])), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("해시를 계산할 수 없는 환경에서는 음원·프로젝트 id를 쓴 대체 키로 저장한다", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    const key = await assetKey(new Blob([new Uint8Array(5)]), "p1:a1");
    assert.equal(key, "plain:p1:a1:5");
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  }
});

// ───────── 기록 모양 · 정리 규칙 ─────────

const doc = { schemaVersion: 2, id: "p1", name: "곡", bpm: 120, timeSignature: { beats: 4, unit: 4 }, sampleRate: 44100, master: { volumeDb: 0 }, tracks: [], assets: {}, markers: [] };

test("v2 기록만 기록으로 인정하고, 옛 v1 칸이나 깨진 값은 아니다", () => {
  assert.equal(isProjectRecord(buildProjectRecord(doc, { a1: "h1" }, 1000)), true);
  assert.equal(isProjectRecord({ format: "accompany-designer-project", version: 1, project: doc, audio: {} }), false);
  assert.equal(isProjectRecord({ schemaVersion: 2, doc, assetHashes: [], updatedAt: 1 }), false);
  assert.equal(isProjectRecord({ schemaVersion: 2, doc, assetHashes: {}, updatedAt: "어제" }), false);
  assert.equal(isProjectRecord(null), false);
  assert.equal(isProjectRecord([]), false);
});

test("프로젝트 기록은 최근 N개만 남기고, 방금 저장한 것은 항상 남긴다", () => {
  const entries = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `p${n}`, updatedAt: n * 100 }));
  assert.deepEqual(projectIdsToDelete(entries, MAX_PROJECT_RECORDS, "p7").sort(), ["p1", "p2"]);
  // 방금 저장한 기록의 시각이 가장 오래돼 보여도(시계가 되돌려진 경우) 지우지 않는다.
  assert.ok(!projectIdsToDelete(entries, 3, "p1").includes("p1"));
  assert.equal(projectIdsToDelete(entries.slice(0, 3), MAX_PROJECT_RECORDS, "p3").length, 0);
});

test("어느 기록도 쓰지 않는 음원만 지울 대상이 된다", () => {
  const used = referencedHashes([{ assetHashes: { a: "h1", b: "h2" } }, { assetHashes: { c: "h2" } }, { assetHashes: undefined }]);
  assert.deepEqual([...used].sort(), ["h1", "h2"]);
  assert.deepEqual(orphanHashes(["h1", "h2", "h3"], used), ["h3"]);
});

test("저장 공간 사용 비율: 알 수 없으면 undefined", () => {
  assert.equal(storageUsageRatio({ usage: 85, quota: 100 }), 0.85);
  assert.equal(storageUsageRatio({ usage: 5 }), undefined);
  assert.equal(storageUsageRatio({ usage: 5, quota: 0 }), undefined);
  assert.equal(storageUsageRatio(undefined), undefined);
});

test("저장 시각은 24시간제 HH:MM", () => {
  const at = new Date(2026, 10, 23, 2, 5, 30).getTime();
  assert.equal(formatClock(at), "02:05");
});

// ───────── 변경 감시기 ─────────

// 문서 조각(트랙·음원·마커)은 참조로 비교하므로, 바뀌지 않은 상태끼리는 같은 객체를 공유한다.
const shared = { tracks: [], assets: {}, markers: [] };
const slice = (patch = {}) => ({ name: "곡", bpm: 120, ...shared, ...patch });

test("문서가 바뀌었을 때만 변경으로 본다(재생 위치 같은 화면 상태는 아니다)", () => {
  const base = slice();
  assert.equal(documentChanged({ ...base, playhead: 3 }, base), false);
  assert.equal(documentChanged(slice({ bpm: 90 }), base), true);
  assert.equal(documentChanged(slice({ tracks: [] }), base), true); // 새 배열 = 새 문서
  assert.equal(documentChanged({ ...base }, base), false);
});

test("녹음·카운트인 중에는 예약하지 않고, 끝나면 문서가 바뀐 경우에만 한 번 예약한다", () => {
  let calls = 0;
  let busy = false;
  const watch = createChangeWatcher(() => (calls += 1), () => busy);
  const idle = slice();
  watch(slice({ bpm: 100 }), idle); // 평소 변경
  assert.equal(calls, 1);

  busy = true; // 녹음 시작(문서는 그대로)
  watch(idle, idle);
  watch(slice({ assets: {} }), idle); // 녹음 중 문서 변경(새 assets 객체)
  assert.equal(calls, 1);
  busy = false; // 녹음 끝
  watch.idle();
  assert.equal(calls, 2);
  watch.idle(); // 한 번만
  assert.equal(calls, 2);

  // 카운트인만 하고 취소했다면(문서 그대로) 저장하지 않는다.
  busy = true;
  watch(slice(), slice());
  busy = false;
  watch.idle();
  assert.equal(calls, 2);

  // 녹음이 끝난 뒤 첫 변경이 오면 그 변경이 예약되고, 이어서 idle()이 와도 두 번 예약하지 않는다.
  busy = true;
  watch(slice({ tracks: [] }), idle);
  busy = false;
  watch(slice({ tracks: [], bpm: 99 }), slice({ tracks: [] }));
  assert.equal(calls, 3);
  watch.idle();
  assert.equal(calls, 3);
});

// ───────── 저장 예약기 ─────────

function makeScheduler(overrides = {}) {
  let clock = 1_000_000;
  const timers = new Map();
  let nextTimer = 1;
  const log = { saves: 0, statuses: [], errors: [] };
  const state = { fail: undefined, paused: false, release: undefined };
  const scheduler = new AutosaveScheduler({
    save: () => {
      log.saves += 1;
      if (state.release) return new Promise((resolve) => (state.release = resolve));
      return state.fail ? Promise.reject(state.fail) : Promise.resolve();
    },
    setTimer: (callback, ms) => {
      const id = nextTimer++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    now: () => clock,
    onStatus: (status) => log.statuses.push(status),
    onError: (error) => log.errors.push(error),
    isPaused: () => state.paused,
    ...overrides,
  });
  const fire = () => {
    const [id, timer] = [...timers.entries()][0];
    timers.delete(id);
    timer.callback();
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { scheduler, timers, log, state, fire, settle, tick: (ms) => (clock += ms) };
}

test("복구가 끝나기 전에는 변경이 있어도 저장하지 않는다", () => {
  const t = makeScheduler();
  t.scheduler.changed();
  assert.equal(t.timers.size, 0);
  assert.equal(t.scheduler.hasUnsaved(), false);
  t.scheduler.markReady();
  t.scheduler.changed();
  assert.equal(t.timers.size, 1);
  assert.equal(t.scheduler.hasUnsaved(), true);
});

test("계속 바뀌면 시간을 다시 재고, 1.2초 조용하면 한 번만 저장한다", async () => {
  const t = makeScheduler();
  t.scheduler.markReady();
  t.scheduler.changed();
  t.scheduler.changed();
  t.scheduler.changed();
  assert.equal(t.timers.size, 1);
  assert.equal([...t.timers.values()][0].ms, AUTOSAVE_DELAY_MS);
  assert.equal(AUTOSAVE_DELAY_MS, 1200);
  t.fire();
  await t.settle();
  assert.equal(t.log.saves, 1);
  assert.deepEqual(t.log.statuses.map((s) => s.state), ["saving", "saved"]);
  assert.equal(t.log.statuses[1].savedAt, 1_000_000);
  assert.equal(t.scheduler.hasUnsaved(), false);
});

test("flush는 기다리는 저장을 지금 시작하고, 기다리는 게 없으면 아무것도 하지 않는다", async () => {
  const t = makeScheduler();
  t.scheduler.markReady();
  await t.scheduler.flush();
  assert.equal(t.log.saves, 0);
  t.scheduler.changed();
  await t.scheduler.flush();
  assert.equal(t.log.saves, 1);
  assert.equal(t.timers.size, 0);
  assert.equal(t.scheduler.hasUnsaved(), false);
});

test("저장이 실패하면 '실패' 상태와 오류가 전달되고, 저장 안 된 변경으로 남는다", async () => {
  const t = makeScheduler();
  const quota = Object.assign(new Error("꽉 참"), { name: "QuotaExceededError" });
  t.state.fail = quota;
  t.scheduler.markReady();
  t.scheduler.changed();
  await t.scheduler.flush();
  assert.deepEqual(t.log.statuses.map((s) => s.state), ["saving", "failed"]);
  assert.deepEqual(t.log.errors, [quota]);
  assert.equal(t.scheduler.hasUnsaved(), true); // 창을 닫을 때 경고해야 한다

  // 공간을 확보한 뒤의 다음 변경은 다시 저장된다.
  t.state.fail = undefined;
  t.scheduler.changed();
  await t.scheduler.flush();
  assert.equal(t.log.statuses.at(-1).state, "saved");
  assert.equal(t.scheduler.hasUnsaved(), false);
});

test("저장하는 동안 또 바뀌면 저장 안 된 변경이 남고, 저장은 겹치지 않고 차례로 한다", async () => {
  const t = makeScheduler();
  t.scheduler.markReady();
  t.state.release = () => {};
  t.scheduler.changed();
  const first = t.scheduler.flush();
  await t.settle();
  assert.equal(t.log.saves, 1);
  t.scheduler.changed(); // 저장 중에 다시 변경
  t.state.release(); // 첫 저장 끝
  await first;
  assert.equal(t.scheduler.hasUnsaved(), true);
  t.state.release = undefined;
  await t.scheduler.flush();
  assert.equal(t.log.saves, 2);
  assert.equal(t.scheduler.hasUnsaved(), false);
});

test("녹음 중에는 저장하지 않는다. 녹음이 끝나 다시 예약되면 그때 저장한다", async () => {
  const t = makeScheduler();
  t.scheduler.markReady();
  t.scheduler.changed();
  t.state.paused = true;
  t.fire(); // 기다리던 시간이 지났지만 녹음 중
  await t.settle();
  assert.equal(t.log.saves, 0);
  assert.equal(t.scheduler.hasUnsaved(), true);

  t.scheduler.changed();
  await t.scheduler.flush(); // 탭을 숨겨도 녹음 중이면 저장하지 않는다
  assert.equal(t.log.saves, 0);

  t.state.paused = false;
  t.scheduler.changed();
  await t.scheduler.flush();
  assert.equal(t.log.saves, 1);
});

test("dispose 뒤에는 예약도 상태 갱신도 하지 않는다", async () => {
  const t = makeScheduler();
  t.scheduler.markReady();
  t.scheduler.changed();
  t.scheduler.dispose();
  assert.equal(t.timers.size, 0);
  t.scheduler.changed();
  assert.equal(t.timers.size, 0);
});

// ───────── 저장 공간 점검 ─────────

beforeEach(() => useNoticeStore.getState().reset());

test("음원을 처음 저장한 뒤에만, 한 번만 보존을 요청한다", async () => {
  let persistCalls = 0;
  const check = createStorageGuard({ persist: async () => { persistCalls += 1; return true; }, estimate: async () => ({ usage: 1, quota: 100 }) });
  await check(false);
  assert.equal(persistCalls, 0);
  await check(true);
  await check(true);
  assert.equal(persistCalls, 1);
});

test("저장 공간을 80% 넘게 쓰면 세션당 한 번만 경고한다", async () => {
  const check = createStorageGuard({ persist: async () => true, estimate: async () => ({ usage: 85, quota: 100 }) });
  await check(false);
  await check(false);
  const warnings = useNoticeStore.getState().notices.filter((n) => n.level === "warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /85%/);
});

test("80% 미만이거나 사용량을 알 수 없으면 경고하지 않고, 요청이 실패해도 멈추지 않는다", async () => {
  const quiet = createStorageGuard({ persist: async () => true, estimate: async () => ({ usage: 79, quota: 100 }) });
  await quiet(true);
  const broken = createStorageGuard({ persist: async () => { throw new Error("거절"); }, estimate: async () => { throw new Error("지원 안 함"); } });
  await broken(true);
  const none = createStorageGuard(undefined);
  await none(true);
  assert.equal(useNoticeStore.getState().notices.length, 0);
});
