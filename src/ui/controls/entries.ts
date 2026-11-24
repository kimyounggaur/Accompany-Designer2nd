/**
 * 숫자 칸 설정을 만드는 도우미(노브·슬라이더 공통). 화면 값과 칸에 보이는 수가 같으면 `plainEntry`,
 * 단위만 다르면(0~1 ↔ 0~100%, 초 ↔ 밀리초) `scaledEntry`를 쓴다. 순수한 함수라 단위 시험으로 확인한다.
 */
import type { ValueEntryConfig } from "./ValueEntry";

/** 칸에 보이는 수가 값과 같다(이퀄라이저 dB, 컴프레서 비율, 딜레이 ms 등) */
export function plainEntry(label: string, min: number, max: number, step?: number): ValueEntryConfig {
  return { label, toInput: (value) => value, fromInput: (input) => input, min, max, step };
}

/** 칸에 보이는 수 = 값 × `scale`(퍼센트는 100, 밀리초는 1000). 범위는 칸의 단위로 쓴다. */
export function scaledEntry(label: string, scale: number, min: number, max: number, step?: number): ValueEntryConfig {
  return { label, toInput: (value) => value * scale, fromInput: (input) => input / scale, min, max, step };
}
