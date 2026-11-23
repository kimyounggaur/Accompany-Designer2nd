import { useEffect, useState } from "react";

/** CSS 미디어 쿼리 결과를 따라가는 훅. 상단 바가 폭에 따라 부품 배치를 바꿀 때 쓴다. */
export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
