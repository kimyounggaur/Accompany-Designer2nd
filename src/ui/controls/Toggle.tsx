import type { ReactNode } from "react";

export interface ToggleProps {
  /** 화면 낭독기가 읽는 이름 */
  label: string;
  pressed: boolean;
  /** 누르면 바뀔 값을 알려 준다 */
  onChange: (pressed: boolean) => void;
  disabled?: boolean;
  /** 모양. 켜짐 표시(on·active 등)는 부르는 쪽이 `pressed`에 맞춰 붙인다 */
  className?: string;
  testId?: string;
  title?: string;
  children?: ReactNode;
}

/**
 * 공용 켜고 끄는 단추(설계서 §P5-0). 이름과 `aria-pressed`를 한 곳에서 붙인다.
 * 모듈 맨 위에 한 번만 정의한다(다른 부품 안에서 만들면 다시 그릴 때마다 지워지고 새로 생긴다).
 */
export function Toggle({ label, pressed, onChange, disabled, className, testId, title, children }: ToggleProps) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      title={title}
      onClick={() => onChange(!pressed)}
    >
      {children}
    </button>
  );
}
