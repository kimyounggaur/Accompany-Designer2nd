import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { KNOB_FACES, type KnobFaceName } from "./knobFaces";
import { ValueEntry, type ValueEntryConfig } from "./ValueEntry";
import {
  clampValue,
  dragValue,
  keyboardValue,
  roundTo,
  toNormalized,
  type KnobCurve,
} from "./knobMath";

/** 노브 값 글자를 눌러(또는 노브에서 Enter) 여는 숫자 칸의 설정(설계서 §P4-4에서 넘어온 "직접 입력") */
export type KnobEntry = ValueEntryConfig;

export interface KnobProps {
  /** 화면 낭독기가 읽는 이름 */
  label: string;
  value: number;
  min: number;
  max: number;
  /** 키보드 한 칸이자 값을 맞추는 간격(0을 기준으로 센다). 없으면 키보드는 범위의 1/100 */
  step?: number;
  /** 더블클릭으로 돌아갈 값 */
  defaultValue?: number;
  /** 값 글자(화면 표시와 aria-valuetext) */
  format?: (value: number) => string;
  /** 주파수 노브는 "log" */
  curve?: KnobCurve;
  disabled?: boolean;
  /** 끌기를 시작했을 때(→ 실행 취소 묶음 시작) */
  onChangeStart?: () => void;
  onChange: (value: number) => void;
  /** 끌기를 마쳤을 때(→ 실행 취소 묶음 끝) */
  onChangeEnd?: () => void;
  /** 숫자 칸. 없으면 값 글자는 그냥 글자다 */
  entry?: KnobEntry;
  /** 겉모습. 동작은 모두 같고 그리는 모양만 다르다 */
  face?: KnobFaceName;
  /** 화면에 보이는 이름(없으면 label) */
  caption?: string;
  color?: string;
  size?: "small" | "medium" | "large";
  /** 값 글자를 따로 정할 때(값과 표시가 다른 노브, 예: 동기화 중인 딜레이 시간) */
  valueText?: string;
}

/**
 * 노브의 동작 속성들. 모양(`knobFaces`)이 노브의 눈에 보이는 한 요소(svg 또는 span)에 그대로 펼쳐 놓는다.
 * 끌기·키보드·더블클릭·이름·값은 모두 이 한 곳(`Knob`)에서 만들어지므로 모양이 달라도 같은 약속으로 움직인다.
 */
export interface DialAttributes {
  ref: (element: Element | null) => void;
  role: "slider";
  tabIndex: number;
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  "aria-valuetext": string;
  "aria-disabled": boolean;
  onPointerDown: (event: PointerEvent<Element>) => void;
  onPointerMove: (event: PointerEvent<Element>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onKeyDown: (event: KeyboardEvent<Element>) => void;
  onDoubleClick: () => void;
}

/** 모양이 받는 것: 위치(0~1)·이름·값 글자와 위의 동작 속성 */
export interface FaceProps {
  caption: string;
  /** 위치 0~1(로그 눈금이면 로그 위치) */
  norm: number;
  /** 값 글자. 숫자 칸이 있으면 눌러 여는 단추거나 숫자 칸 */
  valueNode: ReactNode;
  disabled: boolean;
  color?: string;
  size?: "small" | "medium" | "large";
  dial: DialAttributes;
}

interface DragState {
  pointerId: number;
  /** 기준이 되는 눌린 높이(Shift를 바꾸면 그 자리에서 다시 잡는다) */
  startY: number;
  startNorm: number;
  fine: boolean;
  /** 마지막으로 알린 값 */
  last: number;
}

type FocusableElement = HTMLElement | SVGElement;

/**
 * 공용 노브(설계서 §P5-0). 이 앱의 노브 동작은 여기 한 곳뿐이다.
 *
 * 반드시 모듈 맨 위에 한 번만 정의한다. 다른 부품 안에서 만들면 부모가 다시 그려질 때마다 React가
 * "새 종류의 부품"으로 보고 지웠다 다시 만들어, 키보드로 한 번 바꾸면 초점이 사라진다(보고서 C12·D6).
 *
 * 동작: 포인터를 붙잡고(마우스·터치·펜 공통) 위로 180px 끌면 전체 범위 / Shift는 1/10 / 더블클릭은 기본값 /
 * ←↓ 한 칸 내림, →↑ 한 칸 올림, PageUp·PageDown 10칸, Home·End 최소·최대 / Enter는 숫자 칸 열기(숫자 칸이 있을 때) /
 * `role="slider"`와 `aria-valuemin·max·now·text`.
 */
export function Knob({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  format,
  curve,
  disabled = false,
  onChangeStart,
  onChange,
  onChangeEnd,
  entry,
  face = "trax",
  caption,
  color,
  size,
  valueText,
}: KnobProps) {
  const dialRef = useRef<Element | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [editing, setEditing] = useState(false);
  const canEdit = entry !== undefined && !disabled;
  const norm = toNormalized(value, min, max, curve);
  const text = valueText ?? (format ? format(value) : String(roundTo(value, 6)));

  const finishDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onChangeEnd?.();
  };

  const dial: DialAttributes = {
    ref: (element) => { dialRef.current = element; },
    role: "slider",
    tabIndex: disabled ? -1 : 0,
    "aria-label": label,
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": roundTo(value, 6),
    "aria-valuetext": text,
    "aria-disabled": disabled,
    onPointerDown: (event) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      (event.currentTarget as FocusableElement).focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startNorm: norm, fine: event.shiftKey, last: value };
      onChangeStart?.();
    },
    onPointerMove: (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const fine = event.shiftKey;
      if (fine !== drag.fine) {
        // Shift를 눌렀다 뗀 순간 값이 튀지 않게, 지금 값과 지금 높이를 새 기준으로 삼는다
        drag.startY = event.clientY;
        drag.startNorm = toNormalized(drag.last, min, max, curve);
        drag.fine = fine;
      }
      const next = dragValue({ min, max, step, curve, startNorm: drag.startNorm, deltaPx: drag.startY - event.clientY, fine });
      if (next !== drag.last) {
        drag.last = next;
        onChange(next);
      }
    },
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onLostPointerCapture: finishDrag,
    onKeyDown: (event) => {
      if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Enter" && canEdit) {
        event.preventDefault();
        setEditing(true);
        return;
      }
      const next = keyboardValue({ key: event.key, value, min, max, step, curve });
      if (next === undefined) return;
      event.preventDefault();
      if (next !== value) onChange(next);
    },
    onDoubleClick: () => {
      if (disabled || defaultValue === undefined) return;
      const target = clampValue(defaultValue, min, max);
      if (target === value) return;
      onChangeStart?.();
      onChange(target);
      onChangeEnd?.();
    },
  };

  const commitEntry = (input: number) => {
    if (!entry) return;
    const next = clampValue(roundTo(entry.fromInput(input), 8), min, max);
    if (next === value) return;
    onChangeStart?.();
    onChange(next);
    onChangeEnd?.();
  };

  const valueNode: ReactNode = canEdit
    ? (
      <ValueEntry
        text={text}
        config={entry}
        value={value}
        editing={editing}
        onOpen={() => setEditing(true)}
        onCommit={commitEntry}
        onClose={(focusMoved) => {
          setEditing(false);
          // 키보드로 열었다 닫았으면 노브로 돌아간다. 다른 곳을 눌러 닫았으면 그곳의 초점을 뺏지 않는다.
          if (!focusMoved) (dialRef.current as FocusableElement | null)?.focus();
        }}
      />
    )
    : text;

  const Face = KNOB_FACES[face];
  return <Face caption={caption ?? label} norm={norm} valueNode={valueNode} disabled={disabled} color={color} size={size} dial={dial} />;
}
