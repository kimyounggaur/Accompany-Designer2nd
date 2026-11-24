/**
 * 도구 동작 표(P4-6, 보고서 B9, 결정 4).
 * 재생목록에서 고른 도구에 따라 포인터(마우스·터치)가 하는 일을 한 표에 모았다. 지금 동작을 그대로 옮긴 것이라 바뀐 동작은 없다.
 * `Timeline`(빈 곳)과 `ClipView`(클립·다듬기 손잡이)는 포인터를 누를 때 도구마다 if를 따로 쓰지 않고 이 표에서 할 일을 찾아 실행한다.
 * 화면·스토어를 모르는 순수한 표라, 모든 칸이 처리기에 연결돼 있는지 시험할 수 있다(tests/tool-behavior.test.mjs).
 *
 * - '수정 키'는 Shift 또는 Ctrl이 눌린 것이다(지금 코드가 보는 키는 이 둘뿐이다).
 * - 눈금자는 도구와 관계없다: 클릭 = 재생 위치 이동, 좌우로 끌기 = 확대·축소(`Timeline`의 `beginRulerDrag`).
 * - 클립의 페이드 손잡이도 도구와 관계없이 늘 페이드 조절이다. 오른쪽 클릭(메뉴)도 표 밖이다.
 * - 도구를 바꾸는 키(V·P·B·D·T·S·C·E·Z·Y)는 이 표가 아니라 단축키 표(`services/shortcuts.ts`, P5-2)에 있다.
 */
import type { PlaylistTool } from "../types";

/**
 * 빈 곳(트랙 칸)을 눌렀을 때 하는 일
 * - seek: 선택을 풀고 재생 위치를 누른 자리로 옮긴다.
 * - stamp-and-move: 선택한 클립의 복사본을 놓고, 끌면 그 복사본을 옮긴다(그리기).
 * - stamp-along: 선택한 클립의 복사본을 놓고, 끌면서 칸마다 하나씩 더 놓는다(페인트).
 *   (둘 다 선택한 클립이 없으면 문서의 첫 음원으로 새 클립을 놓는다. 음원이 하나도 없으면 아무 일도 없다.)
 * - box-select: 끌어서 상자로 선택한다. 수정 키가 있으면 이미 선택한 것에 더하고, 없으면 먼저 선택을 푼다.
 * - zoom-box: 끌어서 그 범위로 확대한다.
 */
export const EMPTY_AREA_ACTIONS = ["seek", "stamp-and-move", "stamp-along", "box-select", "zoom-box"] as const;
export type EmptyAreaAction = (typeof EMPTY_AREA_ACTIONS)[number];

/**
 * 클립을 눌렀을 때 하는 일
 * - select: 클립을 선택한다(수정 키가 있으면 이미 선택한 것에 더하거나 뺀다). 끌어도 옮기지 않는다.
 * - select-and-move: 선택하고, 끌면 클립을 옮긴다(다른 트랙으로도).
 * - select-and-slip: 선택하고, 끌면 클립의 길이는 그대로 두고 안의 내용(원본 시작 위치)을 민다.
 * - delete: 클립을 지운다(실행 취소로 되돌릴 수 있다).
 * - toggle-mute: 클립 음소거를 켜고 끈다.
 * - slice: 누른 자리에서 클립을 둘로 자른다(Alt를 누르면 눈금에 붙이지 않는다).
 * - select-and-play: 선택하고, 누른 자리(클립 안)부터 재생한다.
 */
export const CLIP_ACTIONS = [
  "select",
  "select-and-move",
  "select-and-slip",
  "delete",
  "toggle-mute",
  "slice",
  "select-and-play",
] as const;
export type ClipAction = (typeof CLIP_ACTIONS)[number];

/**
 * 클립 양끝의 다듬기 손잡이를 눌렀을 때
 * - trim: 끌어서 클립의 시작·끝을 다듬는다.
 * - same-as-clip: 손잡이가 아니라 클립을 누른 것으로 처리한다(삭제·음소거·자르기·선택 재생 도구는 손잡이 위에서도 같은 일을 한다).
 */
export const TRIM_HANDLE_ACTIONS = ["trim", "same-as-clip"] as const;
export type TrimHandleAction = (typeof TRIM_HANDLE_ACTIONS)[number];

export interface ToolBehavior {
  /** 빈 곳을 누를 때 */
  readonly emptyArea: EmptyAreaAction;
  /** 빈 곳을 수정 키(Shift·Ctrl)와 함께 누를 때 */
  readonly emptyAreaWithModifier: EmptyAreaAction;
  /** 클립을 누를 때 */
  readonly clip: ClipAction;
  /** 클립을 수정 키와 함께 누를 때 */
  readonly clipWithModifier: ClipAction;
  /** 클립 양끝의 다듬기 손잡이를 누를 때 */
  readonly trimHandle: TrimHandleAction;
}

/**
 * 도구마다 하는 일. `Record<PlaylistTool, …>`라서 도구가 늘면 여기에 줄을 더하기 전에는 타입 검사가 통과하지 않는다.
 * 수정 키를 눌러도 일이 바뀌지 않는 도구(그리기·페인트의 빈 곳, 삭제·음소거·자르기·선택 재생의 클립)는 두 칸이 같다.
 */
export const TOOL_BEHAVIOR: Readonly<Record<PlaylistTool, ToolBehavior>> = {
  // 이동(V, 기본): 빈 곳 = 선택을 풀고 재생 위치 이동 · 클립 = 선택하고 끌면 옮김 · 수정 키 = 추가 선택·상자 선택
  move: { emptyArea: "seek", emptyAreaWithModifier: "box-select", clip: "select-and-move", clipWithModifier: "select", trimHandle: "trim" },
  // 그리기(P): 빈 곳 = 선택한 클립의 복사본 놓기(끌면 옮김) · 수정 키를 눌러도 놓기
  draw: { emptyArea: "stamp-and-move", emptyAreaWithModifier: "stamp-and-move", clip: "select-and-move", clipWithModifier: "select", trimHandle: "trim" },
  // 페인트(B): 빈 곳 = 복사본 놓기(끌면 칸마다 하나씩) · 수정 키를 눌러도 놓기
  paint: { emptyArea: "stamp-along", emptyAreaWithModifier: "stamp-along", clip: "select-and-move", clipWithModifier: "select", trimHandle: "trim" },
  // 삭제(D): 클립 = 지우기(수정 키 무시) · 손잡이도 같음 · 빈 곳은 이동과 같음
  delete: { emptyArea: "seek", emptyAreaWithModifier: "box-select", clip: "delete", clipWithModifier: "delete", trimHandle: "same-as-clip" },
  // 음소거(T): 클립 = 음소거 전환(수정 키 무시) · 손잡이도 같음 · 빈 곳은 이동과 같음
  mute: { emptyArea: "seek", emptyAreaWithModifier: "box-select", clip: "toggle-mute", clipWithModifier: "toggle-mute", trimHandle: "same-as-clip" },
  // 슬립(S): 클립 = 선택하고 끌면 안의 내용 밀기 · 빈 곳은 이동과 같음
  slip: { emptyArea: "seek", emptyAreaWithModifier: "box-select", clip: "select-and-slip", clipWithModifier: "select", trimHandle: "trim" },
  // 자르기(C): 클립 = 누른 자리에서 자르기(수정 키 무시, Alt = 눈금에 안 붙임) · 손잡이도 같음 · 빈 곳은 이동과 같음
  slice: { emptyArea: "seek", emptyAreaWithModifier: "box-select", clip: "slice", clipWithModifier: "slice", trimHandle: "same-as-clip" },
  // 선택(E): 빈 곳 = 상자 선택(수정 키 없으면 먼저 선택을 풂) · 클립 = 선택(끌어도 안 옮김)
  select: { emptyArea: "box-select", emptyAreaWithModifier: "box-select", clip: "select", clipWithModifier: "select", trimHandle: "trim" },
  // 확대(Z): 빈 곳 = 끌어서 범위 확대(수정 키 = 상자 선택) · 클립 = 이동과 같음
  zoom: { emptyArea: "zoom-box", emptyAreaWithModifier: "box-select", clip: "select-and-move", clipWithModifier: "select", trimHandle: "trim" },
  // 선택 재생(Y): 클립 = 선택하고 그 지점부터 재생(수정 키 = 추가 선택) · 손잡이도 같음 · 빈 곳은 이동과 같음
  "play-selected": { emptyArea: "seek", emptyAreaWithModifier: "box-select", clip: "select-and-play", clipWithModifier: "select-and-play", trimHandle: "same-as-clip" },
};

/** 표에 있는 도구 전부(표의 줄 순서) */
export const PLAYLIST_TOOLS = Object.keys(TOOL_BEHAVIOR) as PlaylistTool[];

/** 표에서 도구의 줄을 찾는다. 표에 없는 이름이 들어와도(타입을 무시한 호출 등) 멈추지 않고 기본 도구(이동)처럼 다룬다. */
export function toolBehavior(tool: PlaylistTool): ToolBehavior {
  return TOOL_BEHAVIOR[tool] ?? TOOL_BEHAVIOR.move;
}

export function emptyAreaActionFor(tool: PlaylistTool, withModifier: boolean): EmptyAreaAction {
  const behavior = toolBehavior(tool);
  return withModifier ? behavior.emptyAreaWithModifier : behavior.emptyArea;
}

export function clipActionFor(tool: PlaylistTool, withModifier: boolean): ClipAction {
  const behavior = toolBehavior(tool);
  return withModifier ? behavior.clipWithModifier : behavior.clip;
}

export function trimHandleActionFor(tool: PlaylistTool): TrimHandleAction {
  return toolBehavior(tool).trimHandle;
}

/** 할 일마다 처리기 하나씩. `Record`라서 할 일이 늘었는데 처리기를 안 만들면 타입 검사가 통과하지 않는다. */
export type EmptyAreaHandlers = Readonly<Record<EmptyAreaAction, () => void>>;
export type ClipHandlers = Readonly<Record<ClipAction, () => void>>;

/** 빈 곳을 눌렀을 때: 표에서 할 일을 찾아 그 처리기를 부르고, 무엇을 했는지 돌려준다. */
export function runEmptyAreaAction(tool: PlaylistTool, withModifier: boolean, handlers: EmptyAreaHandlers): EmptyAreaAction {
  const action = emptyAreaActionFor(tool, withModifier);
  handlers[action]();
  return action;
}

/** 클립을 눌렀을 때: 표에서 할 일을 찾아 그 처리기를 부르고, 무엇을 했는지 돌려준다. */
export function runClipAction(tool: PlaylistTool, withModifier: boolean, handlers: ClipHandlers): ClipAction {
  const action = clipActionFor(tool, withModifier);
  handlers[action]();
  return action;
}
