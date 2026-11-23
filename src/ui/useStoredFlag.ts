import { useCallback, useState } from "react";

/** 접기·펴기 같은 화면 상태를 localStorage에 기억한다. 저장소를 못 쓰는 환경에서는 메모리에서만 동작한다. */
export function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writeStoredFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* 저장하지 못해도 이번 화면에서는 동작한다 */
  }
}

export function useStoredFlag(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => readStoredFlag(key, fallback));
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      writeStoredFlag(key, next);
    },
    [key],
  );
  return [value, set];
}
