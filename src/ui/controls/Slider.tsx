import { useEffect, useRef } from "react";
import { CommittedNumberInput } from "./CommittedNumberInput";
import type { ValueEntryConfig } from "./ValueEntry";

/** 슬라이더 바로 뒤에 놓이는 숫자 칸(설계서 §P4-4에서 넘어온 "직접 입력") */
export interface SliderEntry extends ValueEntryConfig {
  className?: string;
  testId?: string;
}

export interface SliderProps {
  /** 화면 낭독기가 읽는 이름 */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 더블클릭으로 돌아갈 값 */
  defaultValue?: number;
  /** 값 글자(aria-valuetext) */
  format?: (value: number) => string;
  disabled?: boolean;
  /** 끌기를 시작했을 때(→ 실행 취소 묶음 시작) */
  onChangeStart?: () => void;
  onChange: (value: number) => void;
  /** 끌기를 마쳤을 때(→ 실행 취소 묶음 끝) */
  onChangeEnd?: () => void;
  className?: string;
  id?: string;
  testId?: string;
  /** 숫자 칸. 있으면 슬라이더 바로 뒤에 놓인다 */
  entry?: SliderEntry;
}

/**
 * 공용 슬라이더(설계서 §P5-0). 브라우저의 `<input type="range">`(키보드·접근성은 브라우저가 맡는다)에
 * 끌기 묶음(`onChangeStart`·`onChangeEnd`)과 더블클릭 기본값, 숫자 칸을 더한 것이다.
 * 슬라이더는 이 부품으로만 만든다. 모듈 맨 위에 한 번만 정의한다(다른 부품 안에서 만들면 다시 그릴 때마다 지워지고 새로 생긴다).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  format,
  disabled,
  onChangeStart,
  onChange,
  onChangeEnd,
  className,
  id,
  testId,
  entry,
}: SliderProps) {
  /** 끌기 묶음이 열려 있으면 그것을 닫는 함수 */
  const closeRef = useRef<(() => void) | null>(null);

  // 끌기가 끝나기 전에 슬라이더가 사라져도 묶음은 닫는다
  useEffect(() => () => { closeRef.current?.(); }, []);

  function beginGesture() {
    if (closeRef.current) return;
    onChangeStart?.();
    const close = () => {
      document.removeEventListener("pointerup", close);
      document.removeEventListener("pointercancel", close);
      closeRef.current = null;
      onChangeEnd?.();
    };
    document.addEventListener("pointerup", close);
    document.addEventListener("pointercancel", close);
    closeRef.current = close;
  }

  function resetToDefault() {
    if (disabled || defaultValue === undefined || defaultValue === value) return;
    onChangeStart?.();
    onChange(defaultValue);
    onChangeEnd?.();
  }

  function commitEntry(input: number) {
    if (!entry) return;
    const next = Math.max(min, Math.min(max, Number(entry.fromInput(input).toFixed(8))));
    if (next === value) return;
    onChangeStart?.();
    onChange(next);
    onChangeEnd?.();
  }

  return (
    <>
      <input
        id={id}
        className={className}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={format ? format(value) : undefined}
        data-testid={testId}
        onPointerDown={beginGesture}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={resetToDefault}
      />
      {entry && (
        <CommittedNumberInput
          className={entry.className}
          label={entry.label}
          testId={entry.testId}
          min={entry.min}
          max={entry.max}
          step={entry.step}
          disabled={disabled}
          value={Number(entry.toInput(value).toFixed(6))}
          onCommit={commitEntry}
        />
      )}
    </>
  );
}
