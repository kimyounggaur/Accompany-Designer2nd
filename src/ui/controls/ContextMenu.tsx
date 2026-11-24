import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useMenuStore } from "../../state/menuStore";
import { useDismiss } from "../useDismiss";
import { edgeMenuIndex, placeMenu, stepMenuIndex, type Point } from "./menuMath";

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** 되돌리기 어려운 항목(삭제)은 빨갛게 보인다 */
  danger?: boolean;
  /** 오른쪽에 흐리게 적는 단축키 글자 */
  hint?: string;
  /** 이 항목 위에 가로줄을 긋는다 */
  separatorBefore?: boolean;
}

export interface ContextMenuProps {
  /** 화면 낭독기가 읽는 메뉴 이름(예: "클립 메뉴") */
  label: string;
  /** 누른 자리(화면 좌표) */
  anchor: Point;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

function itemButtons(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) : [];
}

/**
 * 공용 우클릭 메뉴(설계 P5-4). 클립 메뉴와 트랙 메뉴가 같이 쓴다.
 *  - 화면 맨 위(body)에 그려서 클립·트랙 칸의 가장자리에 잘리지 않고, 화면 밖으로 나가면 안쪽으로 옮긴다.
 *  - 바깥을 누르거나 Esc를 누르면 닫힌다(Esc는 열기 전에 초점이 있던 곳으로 돌아간다). 창을 떠나거나 크기가 바뀌거나 메뉴 밖에서 휠을 돌려도 닫힌다.
 *  - 위·아래 화살표로 항목을 옮기고(쓸 수 없는 항목은 건너뛰고 끝에서 돌아감), Home·End는 처음·끝, Enter·Space는 고름, Tab은 닫기.
 *  - 항목을 고르면 먼저 닫고 나서 그 일을 한다(확인창이 뜨는 일이 메뉴 위에 겹치지 않게).
 *  - 열려 있는 동안에는 창 전체의 단축키가 비켜 선다(state/menuStore).
 */
export function ContextMenu({ label, anchor, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<Point>(anchor);

  useEffect(() => {
    useMenuStore.getState().opened();
    return () => useMenuStore.getState().closed();
  }, []);

  // 그리기 전에 크기를 재서 화면 안으로 옮긴다(옮기기 전 자리는 화면에 한 번도 그려지지 않는다).
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(placeMenu(anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor, items.length]);

  // 열릴 때: 열기 전에 초점이 있던 곳을 기억하고 첫 항목으로 초점을 옮긴다.
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    itemButtons(ref.current)[edgeMenuIndex(items, "first")]?.focus();
    // 항목이 바뀌어도(열린 채로 다시 그려져도) 초점을 다시 뺏지 않으려고 열릴 때 한 번만 한다.
  }, []);

  const restoreFocus = useCallback(() => {
    if (opener.current?.isConnected) opener.current.focus();
  }, []);
  useDismiss(ref, true, onClose, restoreFocus);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onWheel);
    };
  }, [onClose]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // 메뉴 안의 키가 React 트리의 윗대(클립의 Enter·Space 선택 같은 것)로 올라가 항목 고르기를 막지 않게 한다.
    event.stopPropagation();
    const buttons = itemButtons(ref.current);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = stepMenuIndex(items, current, 1);
        break;
      case "ArrowUp":
        next = stepMenuIndex(items, current, -1);
        break;
      case "Home":
        next = edgeMenuIndex(items, "first");
        break;
      case "End":
        next = edgeMenuIndex(items, "last");
        break;
      case "Tab":
        onClose(); // 초점은 브라우저 기본 동작대로 메뉴 밖으로 간다
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next >= 0) buttons[next]?.focus();
  }

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      data-testid="context-menu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
      // 메뉴 안의 조작이 React 트리의 윗대(클립·트랙 머리)의 포인터·클릭 처리로 올라가지 않게 한다.
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <div className="context-menu__separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            data-testid={`menu-${item.id}`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <span className="context-menu__hint">{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
