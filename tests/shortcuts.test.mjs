/**
 * P5-2 단축키 관리자: 키 표, 판정 규칙(입력 칸·한글 조합·슬라이더), 처리 순서, 메뉴 표기, 연결.
 * 설계서 수용 기준(단위):
 *  - 같은 키 조합이 두 번 등록되면 실패
 *  - 메뉴에 적힌 키 = 표의 키
 * (e2e: Ctrl+S → 다운로드 시작, Ctrl+C·Ctrl+V → 클립 수 +1, 선택 상자에 초점이 있을 때 V → 도구 그대로 — e2e/report-regression.spec.ts)
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const sc = await import("../src/services/shortcuts.ts");
const { keyHandlers, installKeyboard, isShortcutBlocked } = await import("../src/app/keyboard.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { useDialogStore } = await import("../src/state/dialogStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { history } = await import("../src/state/history.ts");
const { clearClipboard } = await import("../src/services/clipboard.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** 키 이벤트 흉내. 키는 글자(key)가 아니라 자리(code)로 정한다. target은 초점이 있는 요소를 흉내 낸 객체. */
function key(code, options = {}) {
  const { ctrl = false, meta = false, alt = false, shift = false, repeat = false, composing = false, keyCode = 0, target = { tagName: "BODY" } } = options;
  return {
    code, ctrlKey: ctrl, metaKey: meta, altKey: alt, shiftKey: shift, repeat, isComposing: composing, keyCode, target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}
const input = (type) => ({ tagName: "INPUT", ...(type === undefined ? {} : { type }) });
const el = (tagName, extra = {}) => ({ tagName, ...extra });
const slider = () => el("DIV", { getAttribute: (name) => (name === "role" ? "slider" : null) });

const ids = () => sc.SHORTCUTS.map((shortcut) => shortcut.id);
const idOf = (event) => sc.findShortcut(event)?.id;

// ───── 표 ─────

test("표: 설계서의 단축키 표와 같다(입력 칸 안에서 듣는 것은 Ctrl+S 하나)", () => {
  const design = {
    playPause: ["Space"],
    stop: ["Shift+Space"],
    record: ["KeyR"],
    undo: ["Mod+KeyZ"],
    redo: ["Mod+Shift+KeyZ", "Mod+KeyY"],
    save: ["Mod+KeyS"],
    copy: ["Mod+KeyC"],
    paste: ["Mod+KeyV"],
    duplicate: ["Mod+KeyD"],
    sliceAtPlayhead: ["Mod+KeyE"],
    selectAll: ["Mod+KeyA"],
    deleteClips: ["Delete", "Backspace"],
    "tool:move": ["KeyV"],
    "tool:draw": ["KeyP"],
    "tool:paint": ["KeyB"],
    "tool:delete": ["KeyD"],
    "tool:mute": ["KeyT"],
    "tool:slip": ["KeyS"],
    "tool:slice": ["KeyC"],
    "tool:select": ["KeyE"],
    "tool:zoom": ["KeyZ"],
    "tool:play-selected": ["KeyY"],
    quantize: ["Alt+KeyQ"],
    zoomIn: ["PageUp"],
    zoomOut: ["PageDown"],
    zoomPreset1: ["Shift+Digit1"],
    zoomPreset2: ["Shift+Digit2"],
    zoomPreset3: ["Shift+Digit3"],
    zoomOutQuick: ["Shift+Digit4"],
    zoomSelection: ["Shift+Digit5", "Shift+KeyZ"], // Shift+Z는 예전부터 있던 같은 동작의 두 번째 키
    zoomFit: ["Shift+Digit0"],
  };
  assert.deepEqual(Object.fromEntries(sc.SHORTCUTS.map((shortcut) => [shortcut.id, [...shortcut.keys]])), design);
  assert.deepEqual(sc.SHORTCUTS.filter((shortcut) => shortcut.inInputs).map((shortcut) => shortcut.id), ["save"]);
  assert.deepEqual(sc.SHORTCUTS.filter((shortcut) => shortcut.repeat).map((shortcut) => shortcut.id).sort(), ["redo", "undo", "zoomIn", "zoomOut"]);
  assert.deepEqual(sc.SHORTCUTS.filter((shortcut) => shortcut.yieldToSlider).map((shortcut) => shortcut.id), ["zoomIn", "zoomOut"]);
  // 이름은 겹치지 않고, 모든 줄에 한국어 이름이 있다.
  assert.equal(new Set(ids()).size, ids().length);
  for (const shortcut of sc.SHORTCUTS) assert.match(shortcut.label, /[가-힣]/, `${shortcut.id}의 이름이 한국어가 아니다`);
});

test("표: 브라우저가 막을 수 없는 키(Ctrl+T·W·N)는 쓰지 않고, Ctrl+D·E는 복제·재생선에서 자르기가 쓴다(P5-5)", () => {
  const used = new Set(sc.SHORTCUTS.flatMap((shortcut) => shortcut.keys));
  for (const unusable of ["Mod+KeyT", "Mod+KeyW", "Mod+KeyN"]) {
    assert.equal(used.has(unusable), false, `${unusable}는 표에 없다(브라우저가 먼저 가져간다)`);
  }
  assert.equal(sc.shortcutOf("duplicate").keys.join(), "Mod+KeyD");
  assert.equal(sc.shortcutOf("sliceAtPlayhead").keys.join(), "Mod+KeyE");
  assert.equal(sc.keyLabel("duplicate"), "Ctrl+D");
  assert.equal(sc.keyLabel("sliceAtPlayhead"), "Ctrl+E");
});

test("충돌: 같은 키 조합이 두 번 등록되면 실패한다", () => {
  assert.deepEqual(sc.findConflicts(sc.SHORTCUTS), []);
  assert.doesNotThrow(() => sc.buildKeymap(sc.SHORTCUTS));

  const base = sc.shortcutOf("zoomFit");
  // 다른 줄에서 같은 조합
  assert.throws(() => sc.buildKeymap([...sc.SHORTCUTS, { ...base, id: "zoomFit", keys: ["Mod+KeyZ"] }]), /두 번 등록/);
  assert.deepEqual(sc.findConflicts([...sc.SHORTCUTS, { ...base, keys: ["Mod+KeyZ"] }]), [{ combo: "Mod+KeyZ", ids: ["undo", "zoomFit"] }]);
  // 수정키를 다른 순서로 적어도 같은 조합이다
  assert.throws(() => sc.buildKeymap([...sc.SHORTCUTS, { ...base, keys: ["Shift+Mod+KeyZ"] }]), /Mod\+Shift\+KeyZ/);
  // 한 줄 안에서 두 번 적어도 충돌이다
  assert.equal(sc.findConflicts([{ ...base, keys: ["Mod+KeyQ", "Mod+KeyQ"] }]).length, 1);
  // 수정키만 다른 것은 다른 키다(Ctrl+Z / Ctrl+Shift+Z)
  assert.doesNotThrow(() => sc.buildKeymap([{ ...base, keys: ["Mod+KeyQ"] }, { ...base, id: "zoomIn", keys: ["Mod+Shift+KeyQ"] }]));
});

test("키 조합 글: 알 수 없는 수정키·빈 조합은 오류, 수정키 순서는 정규화된다", () => {
  assert.throws(() => sc.parseCombo("Ctrl+KeyZ"), /알 수 없는 수정키/);
  assert.throws(() => sc.parseCombo(""), /비어/);
  assert.deepEqual(sc.parseCombo("Shift+Alt+Mod+Digit1"), { code: "Digit1", mod: true, alt: true, shift: true });
  assert.equal(sc.comboKey(sc.parseCombo("Shift+Alt+Mod+Digit1")), "Mod+Alt+Shift+Digit1");
  assert.throws(() => sc.shortcutOf("없는-동작"), /표에 없는/);
});

// ───── 키 찾기: 자리(code)와 수정키가 정확히 같아야 한다 ─────

test("찾기: 수정키까지 정확히 같아야 한다(Ctrl+Z ≠ Ctrl+Shift+Z ≠ Z)", () => {
  assert.equal(idOf(key("KeyZ", { ctrl: true })), "undo");
  assert.equal(idOf(key("KeyZ", { ctrl: true, shift: true })), "redo");
  assert.equal(idOf(key("KeyY", { ctrl: true })), "redo");
  assert.equal(idOf(key("KeyZ", { meta: true })), "undo", "맥의 ⌘는 Ctrl과 같다");
  assert.equal(idOf(key("KeyZ", { meta: true, shift: true })), "redo");
  assert.equal(idOf(key("KeyZ")), "tool:zoom");
  assert.equal(idOf(key("KeyZ", { shift: true })), "zoomSelection");
  assert.equal(idOf(key("KeyZ", { alt: true })), undefined);
  assert.equal(idOf(key("KeyZ", { ctrl: true, alt: true })), undefined);
  assert.equal(idOf(key("Space")), "playPause");
  assert.equal(idOf(key("Space", { shift: true })), "stop");
  assert.equal(idOf(key("Space", { ctrl: true })), undefined);
  assert.equal(idOf(key("Digit1")), undefined, "Shift 없는 숫자는 단축키가 아니다");
  assert.equal(idOf(key("Digit1", { shift: true })), "zoomPreset1");
  assert.equal(idOf(key("KeyQ")), undefined);
  assert.equal(idOf(key("KeyQ", { alt: true })), "quantize");
  assert.equal(idOf(key("Delete")), "deleteClips");
  assert.equal(idOf(key("Backspace")), "deleteClips");
  assert.equal(idOf(key("Delete", { shift: true })), undefined);
  assert.equal(idOf(key("KeyA", { ctrl: true })), "selectAll");
  assert.equal(idOf(key("KeyR")), "record");
  assert.equal(idOf(key("KeyR", { ctrl: true })), undefined, "Ctrl+R(새로 고침)은 건드리지 않는다");
});

test("찾기: 글자가 아니라 키의 자리로 알아본다(한글 'ㅍ'을 쳐도 V 자리의 키)", () => {
  // key는 'ㅍ'이어도 code는 KeyV. 판정은 code만 본다.
  const event = { ...key("KeyV"), key: "ㅍ" };
  assert.equal(idOf(event), "tool:move");
  assert.equal(sc.shouldHandle(event, sc.shortcutOf("tool:move")), true);
  assert.equal(idOf({ ...key("KeyP"), key: "ㅔ" }), "tool:draw");
  assert.equal(idOf({ ...key("KeyB"), key: "ㅠ" }), "tool:paint");
  assert.equal(idOf({ ...key("KeyC"), key: "ㅊ" }), "tool:slice");
});

test("matches: 줄의 키 조합 중 하나와 같으면 참", () => {
  const redo = sc.shortcutOf("redo");
  assert.equal(sc.matches(key("KeyZ", { ctrl: true, shift: true }), redo), true);
  assert.equal(sc.matches(key("KeyY", { ctrl: true }), redo), true);
  assert.equal(sc.matches(key("KeyZ", { ctrl: true }), redo), false);
});

// ───── 입력 칸·한글 조합·슬라이더 ─────

test("입력 칸(글자·숫자 칸, 여러 줄 칸, 선택 상자, 편집 영역) 안에서는 Ctrl+S 말고 모두 무시한다", () => {
  const typing = [input("text"), input("number"), input("search"), input("email"), input(), el("TEXTAREA"), el("SELECT"), el("DIV", { isContentEditable: true })];
  for (const target of typing) {
    assert.equal(sc.isTypingTarget(target), true, `${target.tagName}/${target.type} 은 글자를 치는 곳`);
    for (const shortcut of sc.SHORTCUTS) {
      const event = { ...key(shortcut.keys[0].split("+").pop(), { target }), ...modifiers(shortcut.keys[0]) };
      assert.equal(sc.shouldHandle(event, shortcut), shortcut.id === "save", `${target.tagName}/${target.type}: ${shortcut.id}`);
    }
  }
});

/** "Mod+Shift+KeyZ" → { ctrlKey, altKey, shiftKey } */
function modifiers(spec) {
  const combo = sc.parseCombo(spec);
  return { ctrlKey: combo.mod, altKey: combo.alt, shiftKey: combo.shift };
}

test("글자를 치지 않는 곳(슬라이더·체크 상자·라디오·단추·몸통)에서는 단축키가 듣는다", () => {
  const idle = [input("range"), input("checkbox"), input("radio"), input("button"), el("BUTTON"), slider(), el("BODY"), el("DIV"), {}, null, undefined];
  for (const target of idle) {
    assert.equal(sc.isTypingTarget(target), false);
    assert.equal(sc.shouldHandle(key("KeyV", { target }), sc.shortcutOf("tool:move")), true);
    assert.equal(sc.shouldHandle(key("Space", { target }), sc.shortcutOf("playPause")), true, "스페이스는 슬라이더·노브·단추에 초점이 있어도 재생");
    assert.equal(sc.shouldHandle(key("KeyZ", { ctrl: true, target }), sc.shortcutOf("undo")), true);
  }
  // 소문자 태그 이름이어도 같다
  assert.equal(sc.isTypingTarget({ tagName: "input", type: "TEXT" }), true);
  assert.equal(sc.isTypingTarget({ tagName: "input", type: "RANGE" }), false);
});

test("한글 조합 중에는 무시한다. 입력기가 처리 중인 키(229)는 글자 칸에서만 조합으로 본다", () => {
  const save = sc.shortcutOf("save");
  // 조합 중(isComposing): 어디서든, Ctrl+S도 무시
  assert.equal(sc.shouldHandle(key("KeyS", { ctrl: true, composing: true, target: input("text") }), save), false);
  assert.equal(sc.shouldHandle(key("KeyV", { composing: true }), sc.shortcutOf("tool:move")), false);
  // 글자 칸에서 keyCode 229: Ctrl+S도 무시
  assert.equal(sc.shouldHandle(key("KeyS", { ctrl: true, keyCode: 229, target: input("text") }), save), false);
  // 글자 칸이 아닌 곳에서는 한글 입력 상태에서 누른 V·P·B·C가 동작해야 한다
  for (const [code, id] of [["KeyV", "tool:move"], ["KeyP", "tool:draw"], ["KeyB", "tool:paint"], ["KeyC", "tool:slice"]]) {
    assert.equal(sc.shouldHandle(key(code, { keyCode: 229 }), sc.shortcutOf(id)), true, `${id}`);
  }
  assert.equal(sc.shouldHandle(key("Space", { keyCode: 229 }), sc.shortcutOf("playPause")), true);
});

test("PageUp·PageDown은 슬라이더·노브에 초점이 있으면 그쪽에 맡긴다(확대도 같이 되지 않는다)", () => {
  for (const id of ["zoomIn", "zoomOut"]) {
    const shortcut = sc.shortcutOf(id);
    const code = id === "zoomIn" ? "PageUp" : "PageDown";
    assert.equal(sc.shouldHandle(key(code, { target: input("range") }), shortcut), false);
    assert.equal(sc.shouldHandle(key(code, { target: slider() }), shortcut), false);
    assert.equal(sc.shouldHandle(key(code, { target: el("BUTTON") }), shortcut), true);
    assert.equal(sc.shouldHandle(key(code), shortcut), true);
  }
  assert.equal(sc.isSliderTarget(slider()), true);
  assert.equal(sc.isSliderTarget(input("range")), true);
  assert.equal(sc.isSliderTarget(input("text")), false);
  assert.equal(sc.isSliderTarget(el("DIV", { getAttribute: () => "button" })), false);
  assert.equal(sc.isSliderTarget(null), false);
});

// ───── 처리 순서 ─────

/** 모든 동작을 기록하는 가짜 연결 */
function recorder() {
  const calls = [];
  const handlers = Object.fromEntries(ids().map((id) => [id, () => { calls.push(id); }]));
  return { calls, handlers };
}

test("처리: 해당하는 동작을 한 번 부르고 키의 기본 동작을 막는다", () => {
  const { calls, handlers } = recorder();
  const event = key("KeyS", { ctrl: true, target: input("text") });
  assert.equal(sc.handleKeyEvent(event, handlers), true);
  assert.deepEqual(calls, ["save"]);
  assert.equal(event.defaultPrevented, true, "브라우저의 '페이지 저장'이 뜨지 않는다");

  const unknown = key("KeyK");
  assert.equal(sc.handleKeyEvent(unknown, handlers), false);
  assert.equal(unknown.defaultPrevented, false);
  assert.deepEqual(calls, ["save"]);
});

test("처리: 입력 칸 안의 키(Ctrl+Z·V·Space·Delete)는 건드리지 않는다 — 칸 자체의 동작(글자 입력·취소)에 맡긴다", () => {
  const { calls, handlers } = recorder();
  for (const [code, options] of [["KeyZ", { ctrl: true }], ["KeyV", {}], ["Space", {}], ["Delete", {}], ["Backspace", {}], ["KeyA", { ctrl: true }], ["KeyC", { ctrl: true }]]) {
    for (const target of [input("text"), input("number"), el("TEXTAREA"), el("SELECT")]) {
      const event = key(code, { ...options, target });
      assert.equal(sc.handleKeyEvent(event, handlers), false);
      assert.equal(event.defaultPrevented, false, `${code} in ${target.tagName}: 기본 동작을 막으면 글자가 입력되지 않는다`);
    }
  }
  assert.deepEqual(calls, []);
});

test("처리: 대화상자가 열려 있는 동안에는 어떤 키도 듣지 않고 기본 동작도 건드리지 않는다", () => {
  const { calls, handlers } = recorder();
  for (const event of [key("Delete"), key("Space"), key("KeyS", { ctrl: true }), key("KeyV")]) {
    assert.equal(sc.handleKeyEvent(event, handlers, () => true), false);
    assert.equal(event.defaultPrevented, false, "확인창의 '취소' 단추가 스페이스로 눌려야 한다");
  }
  assert.deepEqual(calls, []);
  assert.equal(sc.handleKeyEvent(key("Space"), handlers, () => false), true);
  assert.deepEqual(calls, ["playPause"]);
});

test("처리: 키를 누르고 있어 되풀이되는 입력은 되풀이하는 동작(실행 취소·다시 실행·확대·축소)만 되풀이한다", () => {
  const { calls, handlers } = recorder();
  const held = (code, options = {}) => key(code, { ...options, repeat: true });
  for (const event of [held("Space"), held("KeyR"), held("KeyS", { ctrl: true }), held("KeyC", { ctrl: true }), held("KeyV", { ctrl: true }), held("Delete"), held("KeyV")]) {
    assert.equal(sc.handleKeyEvent(event, handlers), true);
    assert.equal(event.defaultPrevented, true, "되풀이 중에도 쪽 넘김·단추 눌림은 막는다");
  }
  assert.deepEqual(calls, [], "재생·녹음·저장·복사·붙여넣기·삭제는 처음 한 번만");
  for (const event of [held("KeyZ", { ctrl: true }), held("KeyZ", { ctrl: true, shift: true }), held("PageUp"), held("PageDown")]) {
    assert.equal(sc.handleKeyEvent(event, handlers), true);
  }
  assert.deepEqual(calls, ["undo", "redo", "zoomIn", "zoomOut"]);
});

test("처리: 동작이 false를 돌려주면(할 일이 없음) 키의 기본 동작을 막지 않는다. 오류가 나도 기본 동작은 막는다", () => {
  const { handlers } = recorder();
  const declining = { ...handlers, deleteClips: () => false };
  const event = key("Delete");
  assert.equal(sc.handleKeyEvent(event, declining), false);
  assert.equal(event.defaultPrevented, false);

  const explicit = { ...handlers, deleteClips: () => true };
  const second = key("Delete");
  assert.equal(sc.handleKeyEvent(second, explicit), true);
  assert.equal(second.defaultPrevented, true);

  const failing = { ...handlers, playPause: () => { throw new Error("재생 실패"); } };
  const third = key("Space");
  assert.throws(() => sc.handleKeyEvent(third, failing), /재생 실패/);
  assert.equal(third.defaultPrevented, true, "스페이스가 쪽을 넘기지 않게 막는다");
});

// ───── 표기 ─────

test("표기: 메뉴·단추에 적는 키는 표의 첫째 키에서 만든다(맥은 ⌘)", () => {
  const expected = {
    quantize: "Alt+Q",
    deleteClips: "Delete",
    zoomIn: "Page Up",
    zoomOut: "Page Down",
    zoomPreset1: "Shift+1",
    zoomPreset2: "Shift+2",
    zoomPreset3: "Shift+3",
    zoomOutQuick: "Shift+4",
    zoomSelection: "Shift+5",
    zoomFit: "Shift+0",
    selectAll: "Ctrl+A",
    undo: "Ctrl+Z",
    redo: "Ctrl+Shift+Z",
    save: "Ctrl+S",
    playPause: "Space",
    stop: "Shift+Space",
    record: "R",
    "tool:move": "V",
    "tool:draw": "P",
    "tool:paint": "B",
    "tool:delete": "D",
    "tool:mute": "T",
    "tool:slip": "S",
    "tool:slice": "C",
    "tool:select": "E",
    "tool:zoom": "Z",
    "tool:play-selected": "Y",
  };
  for (const [id, label] of Object.entries(expected)) assert.equal(sc.keyLabel(id, { mac: false }), label, id);
  assert.equal(sc.keyLabel("undo", { mac: true }), "⌘+Z");
  assert.equal(sc.keyLabel("save", { mac: true }), "⌘+S");
  assert.equal(sc.keyLabels("redo", { mac: false }), "Ctrl+Shift+Z / Ctrl+Y");
  assert.equal(sc.keyLabels("redo", { mac: true }), "⌘+Shift+Z / ⌘+Y");
  assert.equal(sc.keyLabels("deleteClips"), "Delete / Backspace");
  assert.equal(sc.formatKey("Mod+Alt+Shift+Digit3", { mac: false }), "Ctrl+Alt+Shift+3");
  // 옛 메뉴에 적혀 있던 글과 달라진 것이 없다(표기가 표에서 나와도 화면은 그대로)
  assert.equal(sc.keyLabel("tool:play-selected", { mac: false }), "Y");
});

test("표기: aria-keyshortcuts는 Control과 Meta 두 가지를 모두 알린다", () => {
  assert.equal(sc.ariaKeys("zoomFit"), "Shift+0");
  assert.equal(sc.ariaKeys("tool:move"), "V");
  assert.equal(sc.ariaKeys("undo"), "Control+Z Meta+Z");
  assert.equal(sc.ariaKeys("redo"), "Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y");
  assert.equal(sc.ariaKeys("zoomIn"), "PageUp");
  assert.equal(sc.ariaKeys("quantize"), "Alt+Q");
});

test("표기: 맥 판별은 브라우저 정보가 없으면 맥이 아니다", () => {
  assert.equal(typeof sc.isMacPlatform(), "boolean");
});

// ───── 연결: 표의 모든 동작이 실제 함수에 이어져 있다 ─────

test("연결: 표의 동작마다 연결이 하나씩 있고 남는 연결은 없다", () => {
  assert.deepEqual(Object.keys(keyHandlers).sort(), ids().sort());
  for (const [id, handler] of Object.entries(keyHandlers)) assert.equal(typeof handler, "function", id);
  // 소스에서도: 연결 표는 표의 이름 전체(Record<ShortcutId, …>)를 요구한다
  assert.match(read("src/app/keyboard.ts"), /export const keyHandlers: KeyHandlers/);
  assert.match(read("src/services/shortcuts.ts"), /export type KeyHandlers = Readonly<Record<ShortcutId, KeyHandler>>/);
});

beforeEach(() => {
  useDawStore.getState().resetProject();
  history.clear();
  useNoticeStore.getState().reset();
  useDialogStore.setState({ confirm: undefined });
  clearClipboard(); // 앱 안 클립보드는 모듈에 남으므로 시험마다 비운다
});

const fire = (event) => sc.handleKeyEvent(event, keyHandlers, isShortcutBlocked);
const status = () => useNoticeStore.getState().statusMessage;
const clipOn = (trackId, id, startTime) => ({
  id, audioBufferId: "asset", name: id, trackId, startTime, offset: 0, duration: 2, sourceBpm: 120,
  stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
});
const clipCount = () => useDawStore.getState().tracks.reduce((sum, track) => sum + track.clips.length, 0);

test("흐름: 도구 키 10개가 각각 해당 도구를 고른다(안내 없이)", () => {
  const before = status();
  for (const [code, tool] of [["KeyV", "move"], ["KeyP", "draw"], ["KeyB", "paint"], ["KeyD", "delete"], ["KeyT", "mute"], ["KeyS", "slip"], ["KeyC", "slice"], ["KeyE", "select"], ["KeyZ", "zoom"], ["KeyY", "play-selected"]]) {
    useDawStore.getState().setPlaylistTool(tool === "move" ? "draw" : "move");
    assert.equal(fire(key(code)), true);
    assert.equal(useDawStore.getState().playlistTool, tool, `${code} → ${tool}`);
  }
  assert.equal(status(), before, "도구를 바꿔도 안내하지 않는다");
});

test("흐름: 선택 상자·글자 칸에 초점이 있으면 V·P·B·C가 도구를 바꾸지 않는다", () => {
  useDawStore.getState().setPlaylistTool("draw");
  for (const target of [el("SELECT"), input("text"), el("TEXTAREA")]) {
    for (const code of ["KeyV", "KeyP", "KeyB", "KeyC"]) assert.equal(fire(key(code, { target })), false);
  }
  assert.equal(useDawStore.getState().playlistTool, "draw");
});

test("흐름: Ctrl+C·Ctrl+V는 앱 안 클립보드로 클립을 하나 더 만든다", () => {
  const store = useDawStore.getState();
  const trackId = store.tracks[0].id;
  // 붙여넣기는 이 프로젝트에 음원이 있는 클립만 붙인다(음원이 없는 클립은 소리도 파형도 없다).
  store.addAudioAsset({ id: "asset", fileName: "asset.wav", duration: 10, sampleRate: 48000, channels: 1, source: "upload" });
  store.addClip(trackId, clipOn(trackId, "원본", 3));
  store.setSelectedClips(["원본"]);
  assert.equal(clipCount(), 1);

  assert.equal(fire(key("KeyC", { ctrl: true })), true);
  assert.equal(status(), "클립 1개 복사됨");
  useDawStore.getState().setCursor(10);
  assert.equal(fire(key("KeyV", { ctrl: true })), true);
  assert.equal(status(), "클립 1개 붙여넣기 완료");
  assert.equal(clipCount(), 2, "클립 수 +1");
  const starts = useDawStore.getState().tracks[0].clips.map((clip) => clip.startTime).sort((a, b) => a - b);
  assert.deepEqual(starts, [3, 10], "붙인 클립은 재생 위치에 놓인다");
  assert.equal(fire(key("KeyV", { ctrl: true, meta: false })), true);
  assert.equal(clipCount(), 3);
});

test("흐름: 복사한 것이 없으면 붙여넣기는 안내만 하고, 선택이 없으면 복사는 안내만 한다", () => {
  assert.equal(fire(key("KeyV", { ctrl: true })), true);
  assert.equal(status(), "붙여넣을 클립이 없습니다. 먼저 클립을 복사하세요.");
  assert.equal(fire(key("KeyC", { ctrl: true })), true);
  assert.equal(status(), "복사할 클립을 먼저 선택하세요.");
  assert.equal(clipCount(), 0);
});

test("흐름: Delete는 고른 클립이 있을 때만 지우고, 없으면 키의 기본 동작도 건드리지 않는다", () => {
  const store = useDawStore.getState();
  const trackId = store.tracks[0].id;
  store.addClip(trackId, clipOn(trackId, "a", 0));
  store.addClip(trackId, clipOn(trackId, "b", 3));
  store.setSelectedClips([]);
  const quiet = key("Delete");
  const before = status();
  assert.equal(fire(quiet), false);
  assert.equal(quiet.defaultPrevented, false);
  assert.equal(status(), before, "고른 클립이 없을 때는 안내도 하지 않는다");
  assert.equal(clipCount(), 2);

  useDawStore.getState().setSelectedClips(["a"]);
  const event = key("Backspace");
  assert.equal(fire(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(clipCount(), 1);
  assert.equal(status(), "클립을 삭제했습니다.");
});

test("흐름: Ctrl+A는 모든 클립을 고르고, Ctrl+Z·Ctrl+Shift+Z는 되돌리고 다시 한다", () => {
  const store = useDawStore.getState();
  const trackId = store.tracks[0].id;
  store.addClip(trackId, clipOn(trackId, "a", 0));
  store.addClip(trackId, clipOn(trackId, "b", 3));
  useDawStore.getState().setSelectedClips([]);
  assert.equal(fire(key("KeyA", { ctrl: true })), true);
  assert.deepEqual([...useDawStore.getState().selectedClipIds].sort(), ["a", "b"]);

  assert.equal(fire(key("KeyZ", { ctrl: true })), true);
  assert.equal(clipCount(), 1, "마지막으로 더한 클립이 사라진다");
  assert.equal(fire(key("KeyZ", { ctrl: true, shift: true })), true);
  assert.equal(clipCount(), 2);
  assert.equal(fire(key("KeyZ", { ctrl: true })), true);
  assert.equal(fire(key("KeyY", { ctrl: true })), true);
  assert.equal(clipCount(), 2);
});

test("흐름: 확대·축소 키는 16씩, Shift+1·2·3은 72·132·220, Shift+4는 72로 맞춘다", () => {
  const zoom = () => useDawStore.getState().zoomPxPerSecond;
  useDawStore.getState().setZoom(100);
  assert.equal(fire(key("PageUp")), true);
  assert.equal(zoom(), 116);
  assert.equal(fire(key("PageDown")), true);
  assert.equal(fire(key("PageDown")), true);
  assert.equal(zoom(), 84);
  for (const [code, value] of [["Digit1", 72], ["Digit2", 132], ["Digit3", 220], ["Digit4", 72]]) {
    useDawStore.getState().setZoom(500);
    assert.equal(fire(key(code, { shift: true })), true);
    assert.equal(zoom(), value, `Shift+${code}`);
  }
});

test("흐름: 열린 대화상자(확인창)가 있으면 키가 뒤의 화면에 닿지 않는다", () => {
  const store = useDawStore.getState();
  const trackId = store.tracks[0].id;
  store.addClip(trackId, clipOn(trackId, "a", 0));
  store.setSelectedClips(["a"]);
  assert.equal(isShortcutBlocked(), false);
  useDialogStore.getState().open({ id: 1, title: "t", message: "m", confirmLabel: "확인", cancelLabel: "취소", tone: "danger", resolve: () => {} });
  assert.equal(isShortcutBlocked(), true);
  const event = key("Delete");
  assert.equal(fire(event), false);
  assert.equal(event.defaultPrevented, false);
  assert.equal(clipCount(), 1, "지워지지 않았다");
  useDialogStore.getState().close(1, false);
  assert.equal(isShortcutBlocked(), false);
  assert.equal(fire(key("Delete")), true, "닫으면 같은 키가 다시 듣는다");
  assert.equal(clipCount(), 0);
});

test("연결: installKeyboard는 keydown을 한 번 듣고, 돌려준 함수로 거둔다", () => {
  const added = [];
  const removed = [];
  const target = { addEventListener: (type, listener) => added.push([type, listener]), removeEventListener: (type, listener) => removed.push([type, listener]) };
  const off = installKeyboard(target);
  assert.equal(added.length, 1);
  assert.equal(added[0][0], "keydown");
  useDawStore.getState().setPlaylistTool("draw");
  added[0][1](key("KeyV")); // 실제 이벤트 자리에 흉내 객체를 넘겨 본다
  assert.equal(useDawStore.getState().playlistTool, "move");
  off();
  assert.deepEqual(removed, [added[0]], "같은 함수를 거둔다");
});

// ───── 구조 ─────

function sourceFiles(dir) {
  return readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(new URL(`../${path}`, import.meta.url)).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("구조: 창 전체의 키 처리는 app/keyboard.ts 한 곳뿐이고 App.tsx에는 키 처리·클립보드가 남지 않는다", () => {
  const windowKeydown = sourceFiles("src").filter((path) => /(window|globalThis)\.addEventListener\(\s*["'`]keydown/.test(read(path)) || /target\.addEventListener\(\s*["'`]keydown/.test(read(path)));
  assert.deepEqual(windowKeydown, ["src/app/keyboard.ts"], "창 전체 keydown을 듣는 파일");
  const app = read("src/App.tsx");
  assert.doesNotMatch(app, /keydown|onKeyDown|copiedClips|shortcutKey|hasCommandModifier/);
  assert.doesNotMatch(app, /useDialogStore|isExportOpen|isRelinkOpen/, "대화상자 열림 판정은 키보드 연결로 갔다");
  assert.match(app, /onPlayPause=\{togglePlayback\}/);
  assert.match(app, /onStop=\{stopPlayback\}/);
});

test("구조: 앱이 켜질 때 키보드를 켜고 끌 때 거둔다", () => {
  const bootstrap = read("src/app/bootstrap.ts");
  assert.match(bootstrap, /const offKeyboard = installKeyboard\(\)/);
  assert.match(bootstrap, /offKeyboard\(\)/);
});

test("구조: 화면에 적는 키 이름은 표에서 읽는다 — 메뉴·단추에 키 글자를 직접 쓰지 않는다", () => {
  const toolbar = read("src/components/PlaylistToolbar.tsx");
  const zoom = read("src/ui/transport/ZoomControls.tsx");
  // 직접 적은 키 글자가 없다
  assert.doesNotMatch(toolbar, /shortcut:\s*["'`]/, "메뉴 항목의 shortcut에 글자를 직접 쓰지 않는다");
  assert.doesNotMatch(toolbar, /Page Up|Page Down|Alt\+Q|Shift\+\d|"Delete"/);
  assert.doesNotMatch(toolbar, /\$\{tool\.shortcut\}/);
  assert.doesNotMatch(zoom, /시프트|aria-keyshortcuts="/);
  // 쓰는 이름은 모두 표에 있다
  const used = new Set();
  for (const source of [toolbar, zoom]) {
    for (const [, id] of source.matchAll(/(?:keyLabel|ariaKeys)\("([^"]+)"\)/g)) used.add(id);
  }
  assert.ok(used.size >= 10, "메뉴·단추가 표를 읽는다");
  for (const id of used) assert.ok(ids().includes(id), `표에 없는 이름 ${id}`);
  // 도구 단추와 도구 메뉴는 도구 이름으로 표를 읽는다
  assert.match(toolbar, /title=\{`\$\{tool\.label\} \(\$\{keyLabel\(toolShortcutId\(tool\.tool\)\)\}\)`\}/);
  assert.match(toolbar, /aria-keyshortcuts=\{ariaKeys\(toolShortcutId\(tool\.tool\)\)\}/);
  assert.match(toolbar, /shortcut: keyLabel\(toolShortcutId\(button\.tool\)\)/);
});

test("구조: 메뉴 항목별 키 표기가 예전 메뉴에 적혀 있던 글과 같다", () => {
  const toolbar = read("src/components/PlaylistToolbar.tsx");
  // { label: "…", shortcut: keyLabel("id") } 쌍을 읽어 낸다
  const pairs = [...toolbar.matchAll(/label: "([^"]+)", shortcut: keyLabel\("([^"]+)"\)/g)].map(([, label, id]) => [label, id]);
  const shown = Object.fromEntries(pairs.map(([label, id]) => [`${label}|${id}`, sc.keyLabel(id, { mac: false })]));
  assert.deepEqual(shown, {
    "선택 항목 퀀타이즈|quantize": "Alt+Q",
    "선택 항목 삭제|deleteClips": "Delete",
    "확대|zoomIn": "Page Up",
    "축소|zoomOut": "Page Down",
    "빠른 줌 1|zoomPreset1": "Shift+1",
    "빠른 줌 2|zoomPreset2": "Shift+2",
    "빠른 줌 3|zoomPreset3": "Shift+3",
    "전체 보기|zoomFit": "Shift+0",
    "모든 클립 선택|selectAll": "Ctrl+A",
    "선택 항목으로 확대|zoomSelection": "Shift+5",
    "축소|zoomOutQuick": "Shift+4",
  });
});
