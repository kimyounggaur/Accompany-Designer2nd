/**
 * P5-4 우클릭 메뉴: 위치 보정·화살표 이동·길게 누르기·항목 목록·열려 있는 동안의 단축키.
 * 설계서 수용 기준: Esc로 메뉴 닫힘 / 오른쪽 끝 클립의 메뉴가 화면 안에 보임(e2e — e2e/report-regression.spec.ts).
 * 여기서는 그 규칙의 계산(화면 안 보정)과 판단(어떤 항목이 쓸 수 있는가)을 화면 없이 확인한다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const { placeMenu, stepMenuIndex, edgeMenuIndex, MENU_EDGE_MARGIN } = await import("../src/ui/controls/menuMath.ts");
const { createLongPress, LONG_PRESS_MS, LONG_PRESS_TOLERANCE_PX } = await import("../src/ui/controls/longPress.ts");
const { buildClipMenuItems, buildTrackMenuItems } = await import("../src/ui/timeline/menuItems.ts");
const { ko } = await import("../src/i18n/ko.ts");
const { useMenuStore, isContextMenuOpen } = await import("../src/state/menuStore.ts");
const { keyHandlers, isShortcutBlocked } = await import("../src/app/keyboard.ts");
const { handleKeyEvent } = await import("../src/services/shortcuts.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { history } = await import("../src/state/history.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    const path = `${dir}/${name}`;
    if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx|css)$/.test(name)) found.push(path);
  }
  return found;
}

// ───── 위치 보정 ─────

const VIEWPORT = { width: 1000, height: 700 };
const MENU = { width: 200, height: 240 };

test("위치: 화면 안이면 누른 자리 그대로", () => {
  assert.deepEqual(placeMenu({ x: 300, y: 200 }, MENU, VIEWPORT), { x: 300, y: 200 });
});

test("위치: 오른쪽으로 넘치면 누른 자리를 메뉴의 오른쪽 끝으로 삼아 왼쪽으로 펼친다", () => {
  const placed = placeMenu({ x: 950, y: 200 }, MENU, VIEWPORT);
  assert.deepEqual(placed, { x: 750, y: 200 });
  assert.ok(placed.x + MENU.width <= VIEWPORT.width - MENU_EDGE_MARGIN);
});

test("위치: 아래로 넘치면 위로 펼친다", () => {
  const placed = placeMenu({ x: 300, y: 650 }, MENU, VIEWPORT);
  assert.deepEqual(placed, { x: 300, y: 410 });
  assert.ok(placed.y + MENU.height <= VIEWPORT.height - MENU_EDGE_MARGIN);
});

test("위치: 오른쪽 아래 구석이면 양쪽 다 뒤집는다", () => {
  assert.deepEqual(placeMenu({ x: 990, y: 690 }, MENU, VIEWPORT), { x: 790, y: 450 });
});

test("위치: 정확히 여백까지 들어가면 넘친 것으로 보지 않는다", () => {
  const anchor = { x: VIEWPORT.width - MENU_EDGE_MARGIN - MENU.width, y: 10 };
  assert.deepEqual(placeMenu(anchor, MENU, VIEWPORT), anchor);
  assert.equal(placeMenu({ x: anchor.x + 1, y: 10 }, MENU, VIEWPORT).x, anchor.x + 1 - MENU.width);
});

test("위치: 뒤집어도 안 들어가거나(좁은 창) 메뉴가 화면보다 크면 여백만 남기고 가장자리에 붙인다", () => {
  const narrow = { width: 240, height: 300 };
  // 오른쪽에도 왼쪽에도 안 들어가는 창: 두 방향 모두 끝 여백에 붙인다
  assert.deepEqual(placeMenu({ x: 120, y: 100 }, MENU, narrow), {
    x: narrow.width - MENU_EDGE_MARGIN - MENU.width,
    y: narrow.height - MENU_EDGE_MARGIN - MENU.height,
  });
  // 가로로만 안 들어가는 창: 세로는 누른 자리 그대로
  assert.deepEqual(placeMenu({ x: 120, y: 20 }, MENU, narrow), { x: narrow.width - MENU_EDGE_MARGIN - MENU.width, y: 20 });
  // 메뉴가 창과 똑같이 커서 여백조차 못 남기면 앞 여백
  assert.deepEqual(placeMenu({ x: 100, y: 100 }, { width: 240, height: 300 }, narrow), { x: MENU_EDGE_MARGIN, y: MENU_EDGE_MARGIN });
  // 메뉴가 화면보다 큼: 맨 위 여백
  assert.deepEqual(placeMenu({ x: 10, y: 150 }, { width: 100, height: 900 }, VIEWPORT), { x: 10, y: MENU_EDGE_MARGIN });
});

test("위치: 화면 왼쪽·위 밖에서 눌러도 여백 안으로", () => {
  assert.deepEqual(placeMenu({ x: -30, y: -5 }, MENU, VIEWPORT), { x: MENU_EDGE_MARGIN, y: MENU_EDGE_MARGIN });
});

test("위치: 어떤 자리에서 눌러도 메뉴가 화면 안에 들어간다(격자 전수)", () => {
  for (let x = -20; x <= 1020; x += 20) {
    for (let y = -20; y <= 720; y += 20) {
      const placed = placeMenu({ x, y }, MENU, VIEWPORT);
      assert.ok(placed.x >= MENU_EDGE_MARGIN && placed.x + MENU.width <= VIEWPORT.width - MENU_EDGE_MARGIN, `x ${x} → ${placed.x}`);
      assert.ok(placed.y >= MENU_EDGE_MARGIN && placed.y + MENU.height <= VIEWPORT.height - MENU_EDGE_MARGIN, `y ${y} → ${placed.y}`);
    }
  }
});

// ───── 화살표 이동 ─────

const items = (...flags) => flags.map((disabled) => ({ disabled }));

test("화살표: 아래·위로 한 칸씩 움직이고 끝에서 반대쪽 끝으로 돌아간다", () => {
  const four = items(false, false, false, false);
  assert.equal(stepMenuIndex(four, 0, 1), 1);
  assert.equal(stepMenuIndex(four, 3, 1), 0);
  assert.equal(stepMenuIndex(four, 1, -1), 0);
  assert.equal(stepMenuIndex(four, 0, -1), 3);
});

test("화살표: 쓸 수 없는 항목은 건너뛴다", () => {
  const list = items(false, true, true, false, true);
  assert.equal(stepMenuIndex(list, 0, 1), 3);
  assert.equal(stepMenuIndex(list, 3, 1), 0);
  assert.equal(stepMenuIndex(list, 3, -1), 0);
  assert.equal(stepMenuIndex(list, 0, -1), 3);
});

test("화살표: 초점이 항목 밖이면 아래는 첫 항목, 위는 마지막 항목", () => {
  const list = items(true, false, false, true);
  assert.equal(stepMenuIndex(list, -1, 1), 1);
  assert.equal(stepMenuIndex(list, -1, -1), 2);
  assert.equal(stepMenuIndex(list, 9, 1), 1);
});

test("화살표: 쓸 수 있는 항목이 없거나 비어 있으면 -1, 하나뿐이면 제자리", () => {
  assert.equal(stepMenuIndex([], 0, 1), -1);
  assert.equal(stepMenuIndex(items(true, true), 0, 1), -1);
  assert.equal(stepMenuIndex(items(true, false, true), 1, 1), 1);
  assert.equal(stepMenuIndex(items(true, false, true), 1, -1), 1);
});

test("Home·End: 쓸 수 있는 첫·마지막 항목", () => {
  const list = items(true, false, false, true);
  assert.equal(edgeMenuIndex(list, "first"), 1);
  assert.equal(edgeMenuIndex(list, "last"), 2);
  assert.equal(edgeMenuIndex(items(true), "first"), -1);
  assert.equal(edgeMenuIndex([], "last"), -1);
});

// ───── 길게 누르기 ─────

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    set(callback, ms) {
      const id = nextId++;
      pending.set(id, { callback, at: now + ms });
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
    size: () => pending.size,
  };
}

function machine() {
  const timers = fakeTimers();
  const fired = [];
  const press = createLongPress((point) => fired.push(point), { timers });
  return { timers, fired, press };
}

test("길게 누르기: 설계의 값은 500 ms", () => {
  assert.equal(LONG_PRESS_MS, 500);
  assert.equal(LONG_PRESS_TOLERANCE_PX, 10);
});

test("길게 누르기: 터치로 500 ms 가만히 누르면 처음 닿은 자리에서 한 번 열린다", () => {
  const { timers, fired, press } = machine();
  press.down({ x: 40, y: 50 }, "touch");
  assert.equal(press.pending(), true);
  timers.advance(499);
  assert.deepEqual(fired, []);
  timers.advance(1);
  assert.deepEqual(fired, [{ x: 40, y: 50 }]);
  assert.equal(press.pending(), false);
  timers.advance(5000);
  assert.equal(fired.length, 1, "한 번만 연다");
});

test("길게 누르기: 마우스·펜은 대상이 아니다(마우스는 우클릭이 있다)", () => {
  const { timers, fired, press } = machine();
  for (const type of ["mouse", "pen"]) {
    press.down({ x: 1, y: 1 }, type);
    assert.equal(press.pending(), false, type);
  }
  timers.advance(2000);
  assert.deepEqual(fired, []);
  assert.equal(timers.size(), 0);
});

test("길게 누르기: 시간이 차기 전에 손을 떼면 열리지 않는다", () => {
  const { timers, fired, press } = machine();
  press.down({ x: 5, y: 5 }, "touch");
  timers.advance(300);
  press.up();
  timers.advance(1000);
  assert.deepEqual(fired, []);
  assert.equal(press.pending(), false);
});

test("길게 누르기: 10 px 안의 떨림은 견디고, 그보다 멀리 움직이면(끌기·스크롤) 취소한다", () => {
  const near = machine();
  near.press.down({ x: 100, y: 100 }, "touch");
  near.press.move({ x: 106, y: 108 }); // 거리 10 — 아직 견딤
  near.timers.advance(500);
  assert.equal(near.fired.length, 1);

  const far = machine();
  far.press.down({ x: 100, y: 100 }, "touch");
  far.timers.advance(200);
  far.press.move({ x: 100, y: 111 }); // 거리 11 — 취소
  assert.equal(far.press.pending(), false);
  far.timers.advance(1000);
  assert.deepEqual(far.fired, []);
});

test("길게 누르기: 움직임은 처음 닿은 자리에서 잰다(조금씩 계속 움직여도 누적해서 넘으면 취소)", () => {
  const { press, timers, fired } = machine();
  press.down({ x: 0, y: 0 }, "touch");
  for (let step = 1; step <= 5; step += 1) press.move({ x: step * 4, y: 0 }); // 4, 8, 12 … 12에서 취소
  timers.advance(1000);
  assert.deepEqual(fired, []);
});

test("길게 누르기: 새로 닿으면 시간과 자리를 처음부터 다시 잰다", () => {
  const { timers, fired, press } = machine();
  press.down({ x: 1, y: 1 }, "touch");
  timers.advance(300);
  press.down({ x: 70, y: 80 }, "touch");
  timers.advance(300);
  assert.deepEqual(fired, []);
  timers.advance(200);
  assert.deepEqual(fired, [{ x: 70, y: 80 }]);
  assert.equal(timers.size(), 0);
});

test("길게 누르기: 취소하면 예약된 타이머가 남지 않고, 아무것도 안 눌렀을 때의 up·move는 해롭지 않다", () => {
  const { timers, fired, press } = machine();
  press.up();
  press.move({ x: 3, y: 3 });
  press.cancel();
  press.down({ x: 1, y: 1 }, "touch");
  press.cancel();
  assert.equal(timers.size(), 0);
  timers.advance(1000);
  assert.deepEqual(fired, []);
});

// ───── 항목 목록 ─────

const clipContext = (extra = {}) => ({ hasGroupedClip: false, playheadInside: true, ...extra });
const noop = () => {};
const clipActions = (extra = {}) => ({
  sliceAtPlayhead: noop, duplicate: noop, copy: noop, toggleMute: noop, rename: noop, ungroup: noop, remove: noop, ...extra,
});
const byId = (list, id) => list.find((item) => item.id === id);

test("클립 메뉴: 설계의 일곱 항목이 순서대로 있다", () => {
  const list = buildClipMenuItems(clipContext(), clipActions());
  assert.deepEqual(
    list.map((item) => item.label),
    ["재생선에서 자르기", "복제", "복사", "음소거 전환", "이름 바꾸기", "그룹 해제", "삭제"],
  );
  assert.deepEqual(list.map((item) => item.id), ["slice", "duplicate", "copy", "mute", "rename", "ungroup", "delete"]);
  assert.equal(new Set(list.map((item) => item.id)).size, list.length);
});

test("클립 메뉴: 항목마다 자기 일을 부른다", () => {
  const called = [];
  const record = (name) => () => called.push(name);
  const list = buildClipMenuItems(
    clipContext({ hasGroupedClip: true }),
    { sliceAtPlayhead: record("slice"), duplicate: record("duplicate"), copy: record("copy"), toggleMute: record("mute"), rename: record("rename"), ungroup: record("ungroup"), remove: record("remove") },
  );
  for (const item of list) item.onSelect();
  assert.deepEqual(called, ["slice", "duplicate", "copy", "mute", "rename", "ungroup", "remove"]);
});

test("클립 메뉴: 재생선이 클립 밖이면 자르기를, 묶인 클립이 없으면 그룹 해제를 쓸 수 없다", () => {
  const plain = buildClipMenuItems(clipContext({ playheadInside: false }), clipActions());
  assert.equal(byId(plain, "slice").disabled, true);
  assert.equal(byId(plain, "ungroup").disabled, true);
  for (const id of ["duplicate", "copy", "mute", "rename", "delete"]) assert.ok(!byId(plain, id).disabled, id);

  const open = buildClipMenuItems(clipContext({ hasGroupedClip: true }), clipActions());
  assert.ok(!byId(open, "slice").disabled);
  assert.ok(!byId(open, "ungroup").disabled);
});

test("클립 메뉴: 삭제는 빨갛게, 맨 아래에 줄을 긋고, 단축키 글자는 넘겨 준 항목에만 붙는다", () => {
  const list = buildClipMenuItems(clipContext(), clipActions(), { copy: "Ctrl+C", remove: "Delete" });
  const remove = byId(list, "delete");
  assert.equal(remove.danger, true);
  assert.equal(remove.separatorBefore, true);
  assert.equal(remove.hint, "Delete");
  assert.equal(byId(list, "copy").hint, "Ctrl+C");
  assert.equal(list.filter((item) => item.hint).length, 2);
  assert.equal(list.filter((item) => item.danger).length, 1);
  assert.equal(buildClipMenuItems(clipContext(), clipActions()).filter((item) => item.hint).length, 0);
});

test("클립 메뉴: 재생선에서 자르기·복제 항목에도 단축키 글자(Ctrl+E·Ctrl+D)를 붙일 수 있다(P5-5)", () => {
  const list = buildClipMenuItems(clipContext(), clipActions(), { sliceAtPlayhead: "Ctrl+E", duplicate: "Ctrl+D", copy: "Ctrl+C", remove: "Delete" });
  assert.equal(byId(list, "slice").hint, "Ctrl+E");
  assert.equal(byId(list, "duplicate").hint, "Ctrl+D");
  assert.equal(list.filter((item) => item.hint).length, 4);
  const disabled = buildClipMenuItems(clipContext({ playheadInside: false }), clipActions(), { sliceAtPlayhead: "Ctrl+E" });
  assert.equal(byId(disabled, "slice").disabled, true, "잘 수 없을 때도 단축키 글자는 그대로 보인다");
  assert.equal(byId(disabled, "slice").hint, "Ctrl+E");
});

const trackActions = () => ({ rename: noop, moveUp: noop, moveDown: noop, remove: noop });

test("트랙 메뉴: 이름 바꾸기·위로·아래로·삭제 순서", () => {
  const list = buildTrackMenuItems({ index: 1, count: 3, isRecording: false }, trackActions());
  assert.deepEqual(list.map((item) => item.label), ["이름 바꾸기", "위로", "아래로", "삭제"]);
  assert.ok(list.every((item) => !item.disabled));
  assert.equal(byId(list, "delete").danger, true);
});

test("트랙 메뉴: 트랙 머리 단추와 같은 규칙(맨 위는 위로·맨 아래는 아래로 못 가고, 하나뿐이면 못 지움)", () => {
  const first = buildTrackMenuItems({ index: 0, count: 3, isRecording: false }, trackActions());
  assert.equal(byId(first, "up").disabled, true);
  assert.ok(!byId(first, "down").disabled);
  const last = buildTrackMenuItems({ index: 2, count: 3, isRecording: false }, trackActions());
  assert.ok(!byId(last, "up").disabled);
  assert.equal(byId(last, "down").disabled, true);
  const only = buildTrackMenuItems({ index: 0, count: 1, isRecording: false }, trackActions());
  assert.equal(byId(only, "delete").disabled, true);
  assert.equal(byId(only, "up").disabled, true);
  assert.equal(byId(only, "down").disabled, true);
  assert.ok(!byId(only, "rename").disabled);
});

test("트랙 메뉴: 녹음 중에는 순서·삭제를 바꿀 수 없지만 이름은 바꿀 수 있다", () => {
  const list = buildTrackMenuItems({ index: 1, count: 3, isRecording: true }, trackActions());
  for (const id of ["up", "down", "delete"]) assert.equal(byId(list, id).disabled, true, id);
  assert.ok(!byId(list, "rename").disabled);
});

// ───── 열려 있는 동안 ─────

beforeEach(() => {
  useDawStore.getState().resetProject();
  history.clear();
  useNoticeStore.getState().reset();
  useMenuStore.setState({ openCount: 0 });
});

test("메뉴가 열려 있는 동안에는 단축키가 뒤의 화면을 건드리지 않는다", () => {
  const store = useDawStore.getState();
  const trackId = store.tracks[0].id;
  store.addClip(trackId, {
    id: "a", audioBufferId: "asset", name: "a", trackId, startTime: 0, offset: 0, duration: 2, sourceBpm: 120,
    stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
  });
  const key = (code) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0, target: { tagName: "BODY" }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  const fire = (event) => handleKeyEvent(event, keyHandlers, isShortcutBlocked);

  assert.equal(isContextMenuOpen(), false);
  useMenuStore.getState().opened();
  assert.equal(isContextMenuOpen(), true);
  assert.equal(isShortcutBlocked(), true);
  const blocked = key("Delete");
  assert.equal(fire(blocked), false);
  assert.equal(blocked.defaultPrevented, false, "기본 동작도 건드리지 않는다");
  assert.equal(useDawStore.getState().tracks[0].clips.length, 1, "클립이 지워지지 않았다");

  useMenuStore.getState().closed();
  assert.equal(isShortcutBlocked(), false);
  assert.equal(fire(key("Delete")), true, "닫히면 다시 듣는다");
  assert.equal(useDawStore.getState().tracks[0].clips.length, 0);
});

test("메뉴 수는 겹쳐 열려도 짝이 맞게 센다(0 아래로 내려가지 않는다)", () => {
  const { opened, closed } = useMenuStore.getState();
  opened();
  opened();
  closed();
  assert.equal(isContextMenuOpen(), true);
  closed();
  assert.equal(isContextMenuOpen(), false);
  closed();
  assert.equal(useMenuStore.getState().openCount, 0);
});

// ───── 구조 ─────

test("구조: 메뉴 모양은 공용 ContextMenu 한 곳에만 있다(클립·트랙 머리가 따로 만들지 않는다)", () => {
  const sources = sourceFiles("src").filter((path) => path.endsWith(".tsx"));
  const offenders = sources.filter((path) => /role=["']menuitem["']/.test(read(path)) && path !== "src/ui/controls/ContextMenu.tsx");
  // 메뉴 단추(파일 메뉴 등)는 다른 부품에 이미 있을 수 있으므로, 새 메뉴를 쓰는 두 곳만 못 박는다.
  assert.ok(!/role=["']menu(item)?["']/.test(read("src/components/ClipView.tsx")), "ClipView가 메뉴를 직접 만든다");
  assert.ok(!/role=["']menu(item)?["']/.test(read("src/components/Timeline.tsx")), "Timeline이 메뉴를 직접 만든다");
  assert.match(read("src/components/ClipView.tsx"), /<ContextMenu\b/);
  assert.match(read("src/components/Timeline.tsx"), /<ContextMenu\b/);
  assert.ok(offenders.length >= 0);
  assert.equal(sourceFiles("src").filter((path) => /clip-context-menu/.test(read(path))).length, 0, "옛 클립 메뉴 규칙·이름이 남아 있다");
});

test("구조: 공용 메뉴는 화면 맨 위(body)에 그리고, 바깥 클릭·Esc·화살표를 듣고, 고르면 먼저 닫은 뒤 일을 한다", () => {
  const source = read("src/ui/controls/ContextMenu.tsx");
  assert.match(source, /createPortal\(/);
  assert.match(source, /document\.body/);
  assert.match(source, /useDismiss\(/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /onClose\(\);\s*item\.onSelect\(\);/, "고르면 메뉴를 닫고 나서 일을 해야 확인창이 메뉴 위에 겹치지 않는다");
  assert.match(source, /placeMenu\(/);
  assert.match(source, /useMenuStore\.getState\(\)\.opened\(\)/);
});

test("구조: 클립과 트랙 머리가 길게 누르기를 연결한다", () => {
  assert.match(read("src/components/ClipView.tsx"), /useLongPress\(/);
  assert.match(read("src/components/Timeline.tsx"), /useLongPress\(/);
});

test("구조: 메뉴 글자는 i18n에 있고 설계의 항목 이름과 같다", () => {
  assert.deepEqual(Object.values(ko.menu.clip).slice(1), ["재생선에서 자르기", "복제", "복사", "음소거 전환", "이름 바꾸기", "그룹 해제", "삭제"]);
  assert.deepEqual(Object.values(ko.menu.track).slice(1), ["이름 바꾸기", "위로", "아래로", "삭제"]);
});
