/**
 * 도구 동작 표(P4-6, 보고서 B9, 결정 4): 도구마다 빈 곳·클립·다듬기 손잡이를 누를 때 하는 일.
 * 표는 옛 코드(`Timeline.beginLanePointer`, `ClipView.handleClipPointerDown`·`beginTrim`)의 동작을 그대로 옮긴 것이라
 * 아래 '옛 판정'은 그 if 순서를 한 줄씩 옮겨 적은 것이고, 표가 모든 도구·수정 키에서 이와 같은 답을 내는지 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  TOOL_BEHAVIOR,
  PLAYLIST_TOOLS,
  EMPTY_AREA_ACTIONS,
  CLIP_ACTIONS,
  TRIM_HANDLE_ACTIONS,
  toolBehavior,
  emptyAreaActionFor,
  clipActionFor,
  trimHandleActionFor,
  runEmptyAreaAction,
  runClipAction,
} = await import("../src/domain/timeline/toolBehavior.ts");

const TOOLS = ["move", "draw", "paint", "delete", "mute", "slip", "slice", "select", "zoom", "play-selected"];
const MODIFIERS = [false, true];

// ───────── 옛 판정(if 순서 그대로) ─────────

/** 옛 Timeline.beginLanePointer: 그리기·페인트(복사본 놓기) → (선택 도구 또는 Shift·Ctrl) 상자 선택 → 확대 → 나머지는 선택 해제 + 재생 위치 이동 */
function oldEmptyArea(tool, withModifier) {
  if (tool === "draw") return "stamp-and-move";
  if (tool === "paint") return "stamp-along";
  if (tool === "select" || withModifier) return "box-select";
  if (tool === "zoom") return "zoom-box";
  return "seek";
}

/** 옛 ClipView.handleClipPointerDown: 삭제 → 음소거 → 자르기 → 선택 재생 → (선택 도구 또는 Shift·Ctrl) 선택 → 나머지는 끌기 시작(슬립만 슬립) */
function oldClip(tool, withModifier) {
  if (tool === "delete") return "delete";
  if (tool === "mute") return "toggle-mute";
  if (tool === "slice") return "slice";
  if (tool === "play-selected") return "select-and-play";
  if (tool === "select" || withModifier) return "select";
  return tool === "slip" ? "select-and-slip" : "select-and-move";
}

/** 옛 ClipView.beginTrim: 이 네 도구는 손잡이를 클립처럼 처리하고, 나머지는 다듬기 */
function oldTrimHandle(tool) {
  return ["delete", "mute", "slice", "play-selected"].includes(tool) ? "same-as-clip" : "trim";
}

// ───────── 표의 모양 ─────────

test("표에는 도구 10개가 모두 있고, 줄마다 다섯 칸이 채워져 있다", () => {
  assert.deepEqual([...PLAYLIST_TOOLS].sort(), [...TOOLS].sort());
  for (const tool of TOOLS) {
    assert.deepEqual(Object.keys(TOOL_BEHAVIOR[tool]).sort(), ["clip", "clipWithModifier", "emptyArea", "emptyAreaWithModifier", "trimHandle"], tool);
  }
});

test("모든 칸의 할 일은 알려진 할 일이고, 표에서 한 번도 안 쓰이는 할 일은 없다", () => {
  const usedEmpty = new Set();
  const usedClip = new Set();
  const usedTrim = new Set();
  for (const tool of TOOLS) {
    const row = TOOL_BEHAVIOR[tool];
    for (const action of [row.emptyArea, row.emptyAreaWithModifier]) {
      assert.ok(EMPTY_AREA_ACTIONS.includes(action), `${tool}: 빈 곳 ${action}`);
      usedEmpty.add(action);
    }
    for (const action of [row.clip, row.clipWithModifier]) {
      assert.ok(CLIP_ACTIONS.includes(action), `${tool}: 클립 ${action}`);
      usedClip.add(action);
    }
    assert.ok(TRIM_HANDLE_ACTIONS.includes(row.trimHandle), `${tool}: 손잡이 ${row.trimHandle}`);
    usedTrim.add(row.trimHandle);
  }
  assert.deepEqual([...usedEmpty].sort(), [...EMPTY_AREA_ACTIONS].sort());
  assert.deepEqual([...usedClip].sort(), [...CLIP_ACTIONS].sort());
  assert.deepEqual([...usedTrim].sort(), [...TRIM_HANDLE_ACTIONS].sort());
});

// ───────── 지금 동작 그대로 ─────────

test("빈 곳: 모든 도구·수정 키에서 옛 판정과 같다", () => {
  for (const tool of TOOLS) {
    for (const withModifier of MODIFIERS) {
      assert.equal(emptyAreaActionFor(tool, withModifier), oldEmptyArea(tool, withModifier), `${tool} 수정 키 ${withModifier}`);
    }
  }
});

test("클립: 모든 도구·수정 키에서 옛 판정과 같다", () => {
  for (const tool of TOOLS) {
    for (const withModifier of MODIFIERS) {
      assert.equal(clipActionFor(tool, withModifier), oldClip(tool, withModifier), `${tool} 수정 키 ${withModifier}`);
    }
  }
});

test("다듬기 손잡이: 모든 도구에서 옛 판정과 같다", () => {
  for (const tool of TOOLS) assert.equal(trimHandleActionFor(tool), oldTrimHandle(tool), tool);
});

test("기본 도구(이동): 빈 곳을 누르면 재생 위치 이동, 수정 키를 더하면 상자 선택, 클립은 선택하고 끌면 옮김(B9)", () => {
  assert.deepEqual(TOOL_BEHAVIOR.move, {
    emptyArea: "seek",
    emptyAreaWithModifier: "box-select",
    clip: "select-and-move",
    clipWithModifier: "select",
    trimHandle: "trim",
  });
});

test("설계서 표의 칸: 그리기·페인트는 빈 곳에 복사본을 놓고, 선택 도구는 상자 선택, 확대는 범위 확대, 슬립은 내용 밀기", () => {
  assert.equal(emptyAreaActionFor("draw", false), "stamp-and-move");
  assert.equal(emptyAreaActionFor("paint", false), "stamp-along");
  assert.equal(emptyAreaActionFor("select", false), "box-select");
  assert.equal(emptyAreaActionFor("zoom", false), "zoom-box");
  assert.equal(clipActionFor("slip", false), "select-and-slip");
  assert.equal(clipActionFor("delete", false), "delete");
  assert.equal(clipActionFor("mute", false), "toggle-mute");
  assert.equal(clipActionFor("slice", false), "slice");
  assert.equal(clipActionFor("select", false), "select");
  assert.equal(clipActionFor("play-selected", false), "select-and-play");
});

test("표에 없는 도구 이름이 들어와도 멈추지 않고 기본 도구(이동)처럼 다룬다", () => {
  assert.equal(toolBehavior("없는-도구"), TOOL_BEHAVIOR.move);
  assert.equal(emptyAreaActionFor("없는-도구", false), "seek");
  assert.equal(clipActionFor("없는-도구", false), "select-and-move");
  assert.equal(trimHandleActionFor("없는-도구"), "trim");
});

// ───────── 모든 칸이 처리기에 연결돼 있다 ─────────

/** 할 일 이름마다 처리기 하나씩 만들어, 불린 순서를 기록한다 */
function spyHandlers(names, calls) {
  return Object.fromEntries(names.map((name) => [name, () => calls.push(name)]));
}

test("빈 곳: 모든 도구·수정 키에서 표가 가리킨 처리기 하나만 불린다", () => {
  for (const tool of TOOLS) {
    for (const withModifier of MODIFIERS) {
      const calls = [];
      const ran = runEmptyAreaAction(tool, withModifier, spyHandlers(EMPTY_AREA_ACTIONS, calls));
      const expected = withModifier ? TOOL_BEHAVIOR[tool].emptyAreaWithModifier : TOOL_BEHAVIOR[tool].emptyArea;
      assert.deepEqual(calls, [expected], `${tool} 수정 키 ${withModifier}`);
      assert.equal(ran, expected);
    }
  }
});

test("클립: 모든 도구·수정 키에서 표가 가리킨 처리기 하나만 불린다", () => {
  for (const tool of TOOLS) {
    for (const withModifier of MODIFIERS) {
      const calls = [];
      const ran = runClipAction(tool, withModifier, spyHandlers(CLIP_ACTIONS, calls));
      const expected = withModifier ? TOOL_BEHAVIOR[tool].clipWithModifier : TOOL_BEHAVIOR[tool].clip;
      assert.deepEqual(calls, [expected], `${tool} 수정 키 ${withModifier}`);
      assert.equal(ran, expected);
    }
  }
});

test("처리기가 빠진 할 일을 표가 가리키면 조용히 넘어가지 않고 실패한다", () => {
  assert.throws(() => runClipAction("delete", false, { ...spyHandlers(CLIP_ACTIONS, []), delete: undefined }), TypeError);
  assert.throws(() => runEmptyAreaAction("zoom", false, { ...spyHandlers(EMPTY_AREA_ACTIONS, []), "zoom-box": undefined }), TypeError);
});

// ───────── 화면 쪽이 표를 쓴다 ─────────

/** 소스에서 `function <name>(`으로 시작하는 함수의 본문(여는 중괄호부터 짝이 맞는 닫는 중괄호까지)을 잘라 온다 */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}을(를) 찾지 못함`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  assert.fail(`${name}의 끝을 찾지 못함`);
}

const timelineSource = readFileSync(new URL("../src/components/Timeline.tsx", import.meta.url), "utf8");
const clipViewSource = readFileSync(new URL("../src/components/ClipView.tsx", import.meta.url), "utf8");
const TOOL_COMPARISON = /playlistTool\s*(===|!==|\?)|\[[^\]]*\]\.includes\(\s*playlistTool/;

test("Timeline의 빈 곳 누르기는 도구를 직접 가리지 않고 표를 거친다", () => {
  const body = functionBody(timelineSource, "beginLanePointer");
  assert.match(body, /runEmptyAreaAction\(/);
  assert.doesNotMatch(body, TOOL_COMPARISON);
});

test("ClipView의 클립·손잡이 누르기는 도구를 직접 가리지 않고 표를 거친다", () => {
  const clipBody = functionBody(clipViewSource, "handleClipPointerDown");
  assert.match(clipBody, /runClipAction\(/);
  assert.doesNotMatch(clipBody, TOOL_COMPARISON);
  const trimBody = functionBody(clipViewSource, "beginTrim");
  assert.match(trimBody, /trimHandleActionFor\(/);
  assert.doesNotMatch(trimBody, TOOL_COMPARISON);
});
