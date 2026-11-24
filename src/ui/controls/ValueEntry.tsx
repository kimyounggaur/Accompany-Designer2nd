import { roundTo } from "./knobMath";
import { CommittedNumberInput } from "./CommittedNumberInput";

/** 값 글자를 눌러 열리는 숫자 칸의 설정(노브·슬라이더 공통) */
export interface ValueEntryConfig {
  /** 숫자 칸의 이름(화면 낭독기가 읽는다) */
  label: string;
  /** 화면 값 → 칸에 보이는 수(예: 초 → 밀리초) */
  toInput: (value: number) => number;
  /** 칸에 쓴 수 → 화면 값 */
  fromInput: (input: number) => number;
  /** 칸의 범위(칸에 보이는 단위로) */
  min: number;
  max: number;
  step?: number;
}

interface ValueEntryProps {
  /** 평소에 보이는 값 글자 */
  text: string;
  config: ValueEntryConfig;
  /** 지금 값(화면 값 단위) */
  value: number;
  /** 숫자 칸이 열려 있는가. 열고 닫는 것은 부르는 쪽이 정한다(노브는 Enter로도 연다) */
  editing: boolean;
  onOpen: () => void;
  /** 칸에 쓴 수를 정했을 때 */
  onCommit: (input: number) => void;
  /** 정하거나 취소해 칸을 떠났을 때. `focusMoved`는 초점이 다른 곳으로 옮겨 갔는가 */
  onClose: (focusMoved: boolean) => void;
}

/**
 * 값 글자 자리. 평소에는 글자처럼 보이는 단추이고, 누르면 숫자 칸으로 바뀐다(Enter로 정하고 Esc로 취소).
 * 단추는 키보드 순서에 넣지 않는다: 키보드로는 노브에서 Enter를 눌러 연다.
 * 모듈 맨 위에 한 번만 정의한다(다른 부품 안에서 만들면 다시 그릴 때마다 지워지고 새로 생긴다).
 *
 * 단추의 이름은 눈에 보이는 글자(`text`)로 시작한다(WCAG 2.5.3 "이름에 보이는 글자 넣기"):
 * 음성으로 "80퍼센트 누르기"라고 말하는 사람이 같은 단추를 부를 수 있어야 한다.
 */
export function ValueEntry({ text, config, value, editing, onOpen, onCommit, onClose }: ValueEntryProps) {
  if (!editing) {
    return <button type="button" className="knob-value" tabIndex={-1} aria-label={`${text} ${config.label} 입력`} onClick={onOpen}>{text}</button>;
  }
  return (
    <CommittedNumberInput
      className="knob-entry"
      label={config.label}
      value={roundTo(config.toInput(value), 6)}
      min={config.min}
      max={config.max}
      step={config.step}
      autoFocus
      onCommit={onCommit}
      onClose={onClose}
    />
  );
}
