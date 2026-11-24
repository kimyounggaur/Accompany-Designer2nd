/**
 * 타임라인 확대 범위·전체 보기·눈금 솎기(설계서 §P4-3).
 * 순수 계산(domain/timeline/zoom·ruler)과, 그 계산을 쓰는 화면 저장소(setZoom·zoomToFit)를 확인한다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  ABSOLUTE_MIN_ZOOM,
  BASE_MIN_ZOOM,
  FIT_MARGIN_PX,
  MAX_ZOOM,
  clampZoom,
  fitZoom,
  minZoomFor,
  zoomToFitValue,
} from "../src/domain/timeline/zoom.ts";
import {
  INITIAL_RULER_WINDOW,
  MIN_LABEL_SPACING_PX,
  MIN_TICK_SPACING_PX,
  gridTileWidth,
  nextRulerWindow,
  planRulerTicks,
} from "../src/domain/timeline/ruler.ts";
import { makeDoc } from "./helpers/docs.mjs";

const storage = new Map();
globalThis.window = {
  AudioContext: class {},
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
  },
};

const { useDawStore } = await import("../src/store/useDawStore.ts");
const { createEmptyDoc } = await import("../src/domain/project/defaults.ts");

// ───────── 확대 범위 ─────────

test("전체 보기 배율: 화면 폭에서 오른쪽 여백을 뺀 폭에 프로젝트 전체가 들어간다", () => {
  assert.equal(fitZoom(60, 1224), (1224 - FIT_MARGIN_PX) / 60);
  assert.equal(fitZoom(0, 1224), undefined, "길이를 모르면 없다");
  assert.equal(fitZoom(60, 0), undefined, "화면 폭을 모르면 없다");
  assert.equal(fitZoom(60, FIT_MARGIN_PX), undefined, "여백보다 좁으면 없다");
});

test("아래쪽 끝: 짧은 곡은 옛 값(1px/초) 그대로, 한 시간 곡처럼 1px/초로도 안 들어오는 곡만 전체 보기 배율까지 내려간다", () => {
  assert.equal(minZoomFor(12, 1224), BASE_MIN_ZOOM, "12초 곡");
  assert.equal(minZoomFor(240, 1224), BASE_MIN_ZOOM, "4분 곡(전체 보기는 5px/초)");
  const hour = minZoomFor(3600, 1224);
  assert.ok(hour < BASE_MIN_ZOOM);
  assert.equal(hour, (1224 - FIT_MARGIN_PX) / 3600);
  assert.equal(minZoomFor(3600, 0), BASE_MIN_ZOOM, "화면 폭을 모르면 옛 값");
  assert.equal(minZoomFor(3600 * 24 * 30, 1224), ABSOLUTE_MIN_ZOOM, "아무리 길어도 이보다 작게는 내려가지 않는다");
});

test("범위 자르기: 위쪽 끝은 1,000px/초, 숫자가 아니면 아래쪽 끝", () => {
  assert.equal(MAX_ZOOM, 1000);
  assert.equal(clampZoom(5000), 1000);
  assert.equal(clampZoom(0.2), BASE_MIN_ZOOM);
  assert.equal(clampZoom(0.2, 0.1), 0.2);
  assert.equal(clampZoom(Number.NaN, 0.5), 0.5);
  assert.equal(clampZoom(96), 96);
});

test("전체 보기의 값: 프로젝트 전체가 화면 폭에 들어오는 배율(범위 안으로 자른다)", () => {
  assert.equal(zoomToFitValue(3600, 1224), (1224 - FIT_MARGIN_PX) / 3600);
  assert.equal(zoomToFitValue(12, 1224), (1224 - FIT_MARGIN_PX) / 12);
  assert.equal(zoomToFitValue(12, 0), undefined);
  assert.equal(zoomToFitValue(0.001, 100000), MAX_ZOOM, "너무 짧으면 위쪽 끝에서 멈춘다");
});

// ───────── 화면 저장소 ─────────

beforeEach(() => {
  useDawStore.getState().importProject(createEmptyDoc());
  useDawStore.setState({ zoomPxPerSecond: 96, timelineViewportWidth: 0 });
});

test("setZoom: 위쪽 끝은 1,000px/초(예전 320에서 늘었다), 화면 폭을 모르면 아래쪽 끝은 1px/초", () => {
  const state = () => useDawStore.getState();
  state().setZoom(5000);
  assert.equal(state().zoomPxPerSecond, 1000);
  state().setZoom(0.001);
  assert.equal(state().zoomPxPerSecond, 1);
  state().setZoom(640);
  assert.equal(state().zoomPxPerSecond, 640);
});

test("setZoom: 긴 곡에서는 전체 보기 배율까지 줄일 수 있다", () => {
  const state = () => useDawStore.getState();
  state().setTimelineViewportWidth(1224);
  state().importProject(makeDoc([0], { durations: 3600 }));
  const fit = (1224 - FIT_MARGIN_PX) / (3600 + 8 * 0.5); // 프로젝트 길이 = 마지막 클립 끝 + 8박
  state().setZoom(0.001);
  assert.ok(state().zoomPxPerSecond < 1, `1px/초 아래로 내려간다: ${state().zoomPxPerSecond}`);
  assert.ok(Math.abs(state().zoomPxPerSecond - fit) < 1e-9, `${state().zoomPxPerSecond} vs ${fit}`);
});

test("zoomToFit: 화면 폭을 알면 프로젝트 전체가 들어오는 배율로 바꾸고, 모르면 실패하며 그대로 둔다", () => {
  const state = () => useDawStore.getState();
  assert.equal(state().zoomToFit().ok, false);
  assert.equal(state().zoomPxPerSecond, 96);
  state().setTimelineViewportWidth(1224);
  assert.equal(state().zoomToFit().ok, true);
  assert.equal(state().zoomPxPerSecond, (1224 - FIT_MARGIN_PX) / 8, "빈 프로젝트는 8초");
});

test("setTimelineViewportWidth: 올바른 폭만 받고, 같은 폭이면 상태를 바꾸지 않는다", () => {
  const state = () => useDawStore.getState();
  state().setTimelineViewportWidth(1224.4);
  assert.equal(state().timelineViewportWidth, 1224);
  let calls = 0;
  const off = useDawStore.subscribe(() => { calls += 1; });
  state().setTimelineViewportWidth(1224);
  off();
  assert.equal(calls, 0);
  state().setTimelineViewportWidth(Number.NaN);
  assert.equal(state().timelineViewportWidth, 0);
  state().setTimelineViewportWidth(-5);
  assert.equal(state().timelineViewportWidth, 0);
});

// ───────── 눈금자 ─────────

test("보통 배율에서는 지금과 똑같이 박마다 눈금을 두고 마디(4박)마다 번호를 붙인다", () => {
  const plan = planRulerTicks(0.5, 96, 12);
  assert.equal(plan.tickEvery, 1);
  assert.equal(plan.labelEvery, 4);
  assert.equal(plan.ticks.length, Math.ceil(12 / 0.5) + 1);
  assert.deepEqual(plan.ticks.slice(0, 6).map((tick) => tick.label), ["1", "", "", "", "2", ""]);
  assert.deepEqual(plan.ticks.slice(0, 3).map((tick) => tick.left), [0, 48, 96]);
});

test("곡이 길어 한 박이 좁아지면 눈금을 2의 거듭제곱 박 간격으로 솎는다: 눈금 사이 6px 이상, 번호 사이 32px 이상", () => {
  for (const [seconds, zoom] of [[3600, 0.39], [3600, 5], [600, 2.3], [7200, 0.2], [240, 5.6]]) {
    const plan = planRulerTicks(0.5, zoom, seconds);
    const beatWidth = 0.5 * zoom;
    assert.ok(plan.tickEvery * beatWidth >= MIN_TICK_SPACING_PX - 1e-9, `${seconds}초 ${zoom}px/초: 눈금 간격 ${plan.tickEvery * beatWidth}px`);
    assert.ok(plan.labelEvery * beatWidth >= MIN_LABEL_SPACING_PX - 1e-9, `${seconds}초 ${zoom}px/초: 번호 간격 ${plan.labelEvery * beatWidth}px`);
    assert.equal(plan.labelEvery % plan.tickEvery, 0, "번호는 눈금 위에 놓인다");
    assert.equal(plan.labelEvery % 4, 0, "번호는 마디 단위");
    assert.ok(plan.ticks.length <= Math.ceil((seconds * zoom) / MIN_TICK_SPACING_PX) + 2, `눈금 수 ${plan.ticks.length}는 폭에 비례해 늘지 않는다`);
    for (const tick of plan.ticks) {
      assert.equal(tick.label === "", tick.beat % plan.labelEvery !== 0);
      if (tick.label) assert.equal(tick.label, String(tick.beat / 4 + 1));
    }
  }
  assert.ok(planRulerTicks(0.5, 0.39, 3600).ticks.length < 400, "1시간 곡 전체 보기의 눈금");
});

test("눈금 계획: 길이나 폭이 올바르지 않으면 눈금이 없다", () => {
  assert.deepEqual(planRulerTicks(0.5, 0, 12).ticks, []);
  assert.deepEqual(planRulerTicks(0, 96, 12).ticks, []);
  assert.deepEqual(planRulerTicks(0.5, 96, 0).ticks, []);
});

test("눈금 범위: 범위 안의 눈금만 만들고, 위치와 번호는 범위 없이 만든 것과 똑같다", () => {
  for (const [seconds, zoom] of [[3600, 96], [3600, 5], [600, 2.3], [240, 96], [12, 1]]) {
    const full = planRulerTicks(0.5, zoom, seconds);
    for (const range of [{ fromPx: 0, toPx: 1500 }, { fromPx: 4321, toPx: 6200 }, { fromPx: 1e6, toPx: 1.002e6 }]) {
      const part = planRulerTicks(0.5, zoom, seconds, range);
      const expected = full.ticks.filter((tick) => tick.left >= range.fromPx && tick.left <= range.toPx);
      assert.deepEqual(part.ticks, expected, `${seconds}초 ${zoom}px/초 ${range.fromPx}~${range.toPx}px`);
      assert.equal(part.tickEvery, full.tickEvery);
      assert.equal(part.labelEvery, full.labelEvery);
    }
  }
});

test("눈금 범위: 한 시간 곡을 96px/초로 봐도 DOM에 두는 눈금은 화면 근처 몇십 개뿐이다(전체 7,201개)", () => {
  assert.equal(planRulerTicks(0.5, 96, 3600).ticks.length, 7201);
  const viewport = 874;
  const range = nextRulerWindow(INITIAL_RULER_WINDOW, 100000, viewport);
  const part = planRulerTicks(0.5, 96, 3600, range);
  assert.ok(part.ticks.length > 0 && part.ticks.length <= 100, `눈금 ${part.ticks.length}개`);
  // 보이는 곳(100000 ~ 100874px)은 모두 덮는다.
  assert.ok(part.ticks[0].left <= 100000 && part.ticks[part.ticks.length - 1].left >= 100000 + viewport - 48);
});

test("눈금 범위 갱신: 보이는 곳이 여유 안에 있으면 같은 객체를 돌려주고, 가장자리에 다가가면 새로 잡는다", () => {
  const first = nextRulerWindow(INITIAL_RULER_WINDOW, 0, 874);
  assert.equal(first, INITIAL_RULER_WINDOW, "처음 화면은 처음 범위로 충분하다");
  assert.equal(nextRulerWindow(INITIAL_RULER_WINDOW, 500, 874), INITIAL_RULER_WINDOW);

  const far = nextRulerWindow(INITIAL_RULER_WINDOW, 10000, 874);
  assert.notEqual(far, INITIAL_RULER_WINDOW);
  assert.ok(far.fromPx < 10000 && far.toPx > 10874, "보이는 곳 양옆에 여유를 둔다");
  assert.equal(far.fromPx, 10000 - 874);
  assert.equal(far.toPx, 10874 + 874);
  // 조금 스크롤해서는 다시 잡지 않는다(스크롤마다 다시 그리지 않는다).
  assert.equal(nextRulerWindow(far, 10100, 874), far);
  assert.equal(nextRulerWindow(far, 9900, 874), far);
  // 여유의 절반을 넘으면 다시 잡는다.
  const right = nextRulerWindow(far, 10000 + 500, 874);
  assert.notEqual(right, far);
  assert.ok(right.toPx > far.toPx);
  const left = nextRulerWindow(far, 10000 - 500, 874);
  assert.notEqual(left, far);
  assert.ok(left.fromPx < far.fromPx);
  // 왼쪽 끝으로 돌아오면 0에서 시작한다.
  const home = nextRulerWindow(far, 0, 874);
  assert.equal(home.fromPx, 0);
  // 좁은 화면에서도 여유는 적어도 600px
  const narrow = nextRulerWindow(INITIAL_RULER_WINDOW, 5000, 300);
  assert.equal(narrow.fromPx, 4400);
  assert.equal(narrow.toPx, 5900);
  // 화면 폭이 0(아직 모름)이어도 범위가 깨지지 않는다.
  const zero = nextRulerWindow(INITIAL_RULER_WINDOW, 0, 0);
  assert.ok(zero.fromPx >= 0 && zero.toPx >= zero.fromPx);
});

test("격자 배경 한 칸: 6px보다 좁으면 같은 간격을 두 배씩 넓혀 그린다(보통 배율에서는 그대로)", () => {
  assert.equal(gridTileWidth(24), 24);
  assert.equal(gridTileWidth(6), 6);
  assert.equal(gridTileWidth(0.2), 0.2 * 32);
  assert.ok(gridTileWidth(0.05) >= MIN_TICK_SPACING_PX);
  assert.equal(gridTileWidth(0), 0);
});
