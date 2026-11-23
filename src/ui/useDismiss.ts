import { useEffect, type RefObject } from "react";

/**
 * 열려 있는 메뉴·팝오버를 바깥 클릭이나 Escape로 닫는다.
 * Escape로 닫힐 때는 onEscape가 있으면 먼저 부른다(초점을 단추로 되돌릴 때 쓴다).
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  onEscape?: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onEscape?.();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [ref, open, onClose, onEscape]);
}
