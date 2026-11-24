/**
 * 단축키 표와 처리 규칙(설계서 §P5-2, 보고서 C3).
 *
 * 이 파일이 한 곳에서 정하는 것
 *  - 어떤 키가 어떤 동작인가(`SHORTCUTS`). 키는 글자가 아니라 키의 자리(`event.code`: KeyV, Digit1, PageUp …)로 적는다.
 *    그래서 한/영 상태나 자판 배열이 달라도 같은 자리의 키가 같은 동작을 한다.
 *  - 입력 칸 안에서 들을지(`inInputs`), 키를 누르고 있을 때 되풀이할지(`repeat`).
 *  - 메뉴·단추 설명에 적는 키 표기(`keyLabel`). 화면에 키 이름을 직접 적지 않고 반드시 여기서 읽는다.
 *  - 키 입력 하나를 어떻게 다룰지(`handleKeyEvent`): 한글 조합 중 무시, 입력 칸 판정, 대화상자가 열린 동안 막기.
 *
 * 이 파일은 순수하다(스토어·화면·`window`를 모른다). 동작 연결(어떤 키가 어떤 함수를 부르는가)은 `app/keyboard.ts`가 한다.
 *
 * 키 조합은 "Mod+Shift+KeyZ"처럼 적는다. Mod는 Ctrl(맥에서는 ⌘), 나머지는 Alt·Shift. 수정키는 정확히 일치해야 한다
 * (Ctrl+Z와 Ctrl+Shift+Z는 다른 키).
 */
import type { PlaylistTool } from "../domain/types";

/** 도구 키(V P B D T S C E Z Y)를 도구마다 하나씩. `Record<PlaylistTool, …>`라서 도구가 늘면 여기도 채우라고 컴파일러가 알려 준다. */
const TOOL_KEYS = {
  move: "KeyV",
  draw: "KeyP",
  paint: "KeyB",
  delete: "KeyD",
  mute: "KeyT",
  slip: "KeyS",
  slice: "KeyC",
  select: "KeyE",
  zoom: "KeyZ",
  "play-selected": "KeyY",
} as const satisfies Record<PlaylistTool, string>;

const TOOL_LABELS = {
  move: "이동",
  draw: "그리기",
  paint: "페인트",
  delete: "삭제",
  mute: "음소거",
  slip: "슬립 편집",
  slice: "자르기",
  select: "선택",
  zoom: "확대/축소",
  "play-selected": "선택 재생",
} as const satisfies Record<PlaylistTool, string>;

const TOOLS = Object.keys(TOOL_KEYS) as PlaylistTool[];

export type ToolShortcutId = `tool:${PlaylistTool}`;

export type ShortcutId =
  | "playPause"
  | "stop"
  | "record"
  | "undo"
  | "redo"
  | "save"
  | "copy"
  | "paste"
  | "selectAll"
  | "deleteClips"
  | "quantize"
  | "zoomIn"
  | "zoomOut"
  | "zoomPreset1"
  | "zoomPreset2"
  | "zoomPreset3"
  | "zoomOutQuick"
  | "zoomSelection"
  | "zoomFit"
  | ToolShortcutId;

/** 도구를 고르는 단축키의 이름. 메뉴·단추가 도구의 키 표기를 읽을 때 쓴다. */
export function toolShortcutId(tool: PlaylistTool): ToolShortcutId {
  return `tool:${tool}`;
}

export interface Shortcut {
  readonly id: ShortcutId;
  /** 사람이 읽는 이름(한국어) */
  readonly label: string;
  /** 같은 동작에 묶인 키 조합들. 첫째가 메뉴·단추 설명에 적힌다 */
  readonly keys: readonly string[];
  /** 글자를 치는 칸 안에서도 듣는가 */
  readonly inInputs: boolean;
  /** 키를 누르고 있어 같은 키가 되풀이될 때 동작도 되풀이하는가(아니면 처음 한 번만) */
  readonly repeat: boolean;
  /** 슬라이더·노브에 초점이 있으면 그쪽이 키를 쓰도록 비켜 주는가(PageUp·PageDown은 슬라이더도 쓴다) */
  readonly yieldToSlider: boolean;
}

interface RowOptions {
  inInputs?: boolean;
  repeat?: boolean;
  yieldToSlider?: boolean;
}

function row(id: ShortcutId, label: string, keys: string | readonly string[], options: RowOptions = {}): Shortcut {
  return {
    id,
    label,
    keys: typeof keys === "string" ? [keys] : keys,
    inInputs: options.inInputs ?? false,
    repeat: options.repeat ?? false,
    yieldToSlider: options.yieldToSlider ?? false,
  };
}

/**
 * 단축키 표(설계서 §P5-2). 입력 칸 안에서 듣는 것은 Ctrl+S 하나뿐이다.
 * Ctrl+D(복제)·Ctrl+E(재생선에서 자르기)는 그 기능이 들어오는 P5-5에서 이 표에 더한다(기능 없는 키가 브라우저 기본 동작만 막지 않도록).
 */
export const SHORTCUTS: readonly Shortcut[] = [
  row("playPause", "재생/일시정지", "Space"),
  row("stop", "정지(처음으로)", "Shift+Space"),
  row("record", "녹음 시작/끝", "KeyR"),
  row("undo", "실행 취소", "Mod+KeyZ", { repeat: true }),
  row("redo", "다시 실행", ["Mod+Shift+KeyZ", "Mod+KeyY"], { repeat: true }),
  row("save", "프로젝트 파일 저장", "Mod+KeyS", { inInputs: true }),
  row("copy", "클립 복사", "Mod+KeyC"),
  row("paste", "클립 붙여넣기", "Mod+KeyV"),
  row("selectAll", "모든 클립 선택", "Mod+KeyA"),
  row("deleteClips", "선택 항목 삭제", ["Delete", "Backspace"]),
  ...TOOLS.map((tool) => row(toolShortcutId(tool), TOOL_LABELS[tool], TOOL_KEYS[tool])),
  row("quantize", "선택 항목 퀀타이즈", "Alt+KeyQ"),
  row("zoomIn", "확대", "PageUp", { repeat: true, yieldToSlider: true }),
  row("zoomOut", "축소", "PageDown", { repeat: true, yieldToSlider: true }),
  row("zoomPreset1", "빠른 확대 1", "Shift+Digit1"),
  row("zoomPreset2", "빠른 확대 2", "Shift+Digit2"),
  row("zoomPreset3", "빠른 확대 3", "Shift+Digit3"),
  row("zoomOutQuick", "빠른 축소", "Shift+Digit4"),
  // Shift+Z는 예전부터 쓰던 같은 동작의 두 번째 키다(표기에는 첫째 키만 적힌다).
  row("zoomSelection", "선택 항목으로 확대", ["Shift+Digit5", "Shift+KeyZ"]),
  row("zoomFit", "전체 보기", "Shift+Digit0"),
];

// ───── 키 조합 ─────

export interface KeyCombo {
  readonly code: string;
  /** Ctrl 또는 ⌘ */
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** "Mod+Shift+KeyZ" 같은 글을 키 조합으로 바꾼다. 알 수 없는 수정키는 오류. */
export function parseCombo(spec: string): KeyCombo {
  const parts = spec.split("+");
  const code = parts.pop();
  if (!code) throw new Error(`키 조합이 비어 있습니다: "${spec}"`);
  let mod = false;
  let alt = false;
  let shift = false;
  for (const part of parts) {
    if (part === "Mod") mod = true;
    else if (part === "Alt") alt = true;
    else if (part === "Shift") shift = true;
    else throw new Error(`알 수 없는 수정키 "${part}" ("${spec}")`);
  }
  return { code, mod, alt, shift };
}

/** 같은 조합이면 같은 글이 되도록 만든다(수정키를 적은 순서와 무관). 충돌 검사와 찾기에 쓴다. */
export function comboKey(combo: KeyCombo): string {
  return [combo.mod && "Mod", combo.alt && "Alt", combo.shift && "Shift", combo.code].filter(Boolean).join("+");
}

export interface KeyEventLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** 키 이벤트가 나타내는 조합. Ctrl과 ⌘는 같은 Mod로 본다. */
export function eventCombo(event: KeyEventLike): KeyCombo {
  return { code: event.code, mod: event.ctrlKey || event.metaKey, alt: event.altKey, shift: event.shiftKey };
}

/** 표에서 같은 키 조합이 둘 이상의 줄(또는 한 줄 안에서 두 번)에 있으면 그 목록을 돌려준다. */
export function findConflicts(shortcuts: readonly Shortcut[]): Array<{ combo: string; ids: ShortcutId[] }> {
  const owners = new Map<string, ShortcutId[]>();
  for (const shortcut of shortcuts) {
    for (const spec of shortcut.keys) {
      const key = comboKey(parseCombo(spec));
      owners.set(key, [...(owners.get(key) ?? []), shortcut.id]);
    }
  }
  return [...owners].filter(([, ids]) => ids.length > 1).map(([combo, ids]) => ({ combo, ids }));
}

/** 키 조합 → 단축키. 같은 조합이 두 번 등록되어 있으면 만들 때 오류를 낸다. */
export function buildKeymap(shortcuts: readonly Shortcut[]): ReadonlyMap<string, Shortcut> {
  const conflicts = findConflicts(shortcuts);
  if (conflicts.length) {
    const detail = conflicts.map((conflict) => `${conflict.combo} (${conflict.ids.join(", ")})`).join("; ");
    throw new Error(`같은 키 조합이 두 번 등록되었습니다: ${detail}`);
  }
  const keymap = new Map<string, Shortcut>();
  for (const shortcut of shortcuts) {
    for (const spec of shortcut.keys) keymap.set(comboKey(parseCombo(spec)), shortcut);
  }
  return keymap;
}

const KEYMAP = buildKeymap(SHORTCUTS);
const BY_ID = new Map<ShortcutId, Shortcut>(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

/** 이름으로 표의 한 줄을 찾는다. */
export function shortcutOf(id: ShortcutId): Shortcut {
  const shortcut = BY_ID.get(id);
  if (!shortcut) throw new Error(`단축키 표에 없는 이름: ${id}`);
  return shortcut;
}

/** 이 키 이벤트에 해당하는 표의 줄(수정키까지 정확히 같아야 한다). 없으면 undefined. */
export function findShortcut(event: KeyEventLike): Shortcut | undefined {
  return KEYMAP.get(comboKey(eventCombo(event)));
}

/** 이 키 이벤트가 이 줄의 키 조합 중 하나와 같은가(`event.code` + 수정키 비교). */
export function matches(event: KeyEventLike, shortcut: Shortcut): boolean {
  const key = comboKey(eventCombo(event));
  return shortcut.keys.some((spec) => comboKey(parseCombo(spec)) === key);
}

// ───── 키 이벤트 판정 ─────

/** 키 이벤트가 닿은 곳을 판정하는 데 필요한 부분만 적은 모양(실제 HTMLElement도, 시험용 흉내 객체도 맞는다). */
interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

function elementLike(target: unknown): ElementLike | undefined {
  return typeof target === "object" && target !== null && "tagName" in target ? (target as ElementLike) : undefined;
}

/** 글자를 치지 않는 입력 칸(슬라이더·체크 상자·라디오·단추)은 단축키를 막지 않는다. */
const NON_TEXT_INPUT_TYPES = new Set(["range", "checkbox", "radio", "button"]);

/** 글자를 치는 곳인가: 글자 칸·여러 줄 칸·선택 상자·편집 가능 영역. */
export function isTypingTarget(target: unknown): boolean {
  const element = elementLike(target);
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((element.type ?? "text").toLowerCase());
  return false;
}

/** 슬라이더(`input[type=range]`)나 `role="slider"`인 노브인가. */
export function isSliderTarget(target: unknown): boolean {
  const element = elementLike(target);
  if (!element) return false;
  if (element.tagName?.toUpperCase() === "INPUT" && (element.type ?? "").toLowerCase() === "range") return true;
  return element.getAttribute?.("role") === "slider";
}

export interface ShortcutEvent extends KeyEventLike {
  /** 한글 같은 입력기로 글자를 조합하는 중인가 */
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly target: unknown;
}

/**
 * 이 키 이벤트를 이 단축키로 처리해야 하는가(설계서 §P5-2의 `shouldHandle`).
 *  - 한글 조합 중에는 무시한다.
 *  - 입력 칸 안에서는 `inInputs`인 단축키만 듣는다.
 *  - 슬라이더·노브에 초점이 있으면 `yieldToSlider`인 키(PageUp·PageDown)는 그쪽에 맡긴다.
 *
 * 설계서 코드와 다른 한 곳: `keyCode === 229`("입력기가 처리 중")는 글자를 치는 곳에서만 조합으로 본다. 초점이 입력 칸이 아닐 때는 한글
 * 입력 상태에서 누른 V·P·B·C도 `event.code`로 알아보고 동작해야 하므로(수동 점검 기준) 229를 이유로 버리지 않는다.
 */
export function shouldHandle(event: ShortcutEvent, shortcut: Shortcut): boolean {
  if (event.isComposing) return false;
  const typing = isTypingTarget(event.target);
  if (event.keyCode === 229 && typing) return false;
  if (typing && !shortcut.inInputs) return false;
  if (shortcut.yieldToSlider && isSliderTarget(event.target)) return false;
  return matches(event, shortcut);
}

// ───── 처리 ─────

/** 단축키가 부르는 함수. `false`를 돌려주면 "할 일이 없었다"는 뜻이라 키의 기본 동작을 막지 않는다(그 밖의 값은 처리했다는 뜻). */
export type KeyHandler = () => void | boolean;
export type KeyHandlers = Readonly<Record<ShortcutId, KeyHandler>>;

export interface HandledKeyEvent extends ShortcutEvent {
  /** 키를 누르고 있어서 되풀이된 이벤트인가 */
  readonly repeat: boolean;
  preventDefault(): void;
}

/**
 * 키 이벤트 하나를 처리한다. 처리(또는 일부러 삼킴)했으면 true.
 *  - `isBlocked()`가 true인 동안(대화상자가 열려 있을 때)에는 어떤 키도 듣지 않고 기본 동작도 건드리지 않는다.
 *  - 되풀이되는 키는 `repeat`가 아닌 단축키에서는 동작을 다시 하지 않는다(Space를 누르고 있어도 재생이 깜빡이지 않게).
 *    다만 기본 동작(쪽 넘김·단추 눌림)은 계속 막는다.
 *  - 핸들러가 `false`를 돌려주면 기본 동작을 막지 않는다.
 */
export function handleKeyEvent(event: HandledKeyEvent, handlers: KeyHandlers, isBlocked: () => boolean = () => false): boolean {
  const shortcut = findShortcut(event);
  if (!shortcut || !shouldHandle(event, shortcut) || isBlocked()) return false;
  if (event.repeat && !shortcut.repeat) {
    event.preventDefault();
    return true;
  }
  let handled = true;
  try {
    handled = handlers[shortcut.id]() !== false;
  } finally {
    if (handled) event.preventDefault();
  }
  return handled;
}

// ───── 표기 ─────

/** 맥(⌘ 표기)인가. 화면 표기에만 쓰며 키 판정에는 쓰지 않는다(Ctrl과 ⌘는 어느 쪽이든 같은 Mod로 듣는다). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const info = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(info.userAgentData?.platform ?? info.platform ?? "");
}

export interface LabelOptions {
  /** 맥 표기(⌘)로 쓸지. 생략하면 지금 브라우저로 판단한다. */
  mac?: boolean;
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: "Space",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Delete: "Delete",
  Backspace: "Backspace",
};

/** `event.code`를 자판에 적힌 이름으로: KeyV → V, Digit1 → 1, PageUp → Page Up. */
function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return KEY_NAMES[code] ?? code;
}

/** 키 조합 하나의 화면 표기: "Ctrl+Shift+Z", 맥은 "⌘+Shift+Z". */
export function formatKey(spec: string, options: LabelOptions = {}): string {
  const combo = parseCombo(spec);
  const mac = options.mac ?? isMacPlatform();
  const parts: string[] = [];
  if (combo.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(keyName(combo.code));
  return parts.join("+");
}

/** 메뉴·단추 설명에 적는 키 표기(첫째 키). 화면에 키 이름을 적을 때는 항상 이 함수로 읽는다. */
export function keyLabel(id: ShortcutId, options: LabelOptions = {}): string {
  return formatKey(shortcutOf(id).keys[0], options);
}

/** 같은 동작의 모든 키 표기("Ctrl+Shift+Z / Ctrl+Y"). */
export function keyLabels(id: ShortcutId, options: LabelOptions = {}): string {
  return shortcutOf(id).keys.map((spec) => formatKey(spec, options)).join(" / ");
}

/** `aria-keyshortcuts` 값(보조 기술에 알리는 형식). Mod는 Control과 Meta 둘 다 적는다. */
export function ariaKeys(id: ShortcutId): string {
  const names: Readonly<Record<string, string>> = { Space: "Space", PageUp: "PageUp", PageDown: "PageDown", Delete: "Delete", Backspace: "Backspace" };
  const letter = (code: string) => (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : (names[code] ?? code));
  return shortcutOf(id)
    .keys.flatMap((spec) => {
      const combo = parseCombo(spec);
      const tail = [combo.alt && "Alt", combo.shift && "Shift", letter(combo.code)].filter(Boolean) as string[];
      return combo.mod ? [["Control", ...tail], ["Meta", ...tail]] : [tail];
    })
    .map((parts) => parts.join("+"))
    .join(" ");
}
