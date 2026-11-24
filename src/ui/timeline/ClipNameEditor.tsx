import { useEffect, useRef, useState } from "react";

interface ClipNameEditorProps {
  name: string;
  /** 화면 낭독기가 읽는 칸 이름 */
  label: string;
  /** Enter나 칸을 떠날 때 부른다(바꾼 게 없어도 부른다) */
  onCommit: (name: string) => void;
  /** Esc에서 부른다 */
  onCancel: () => void;
}

/**
 * 클립 위에서 바로 이름을 바꾸는 칸(클립 메뉴의 "이름 바꾸기"). 열리면 이름 전체가 선택된 채 초점이 온다.
 * Enter·칸 떠나기 = 확정, Esc = 취소. 확정할 때 한 번만 문서를 바꾸므로 실행 취소 한 단계다.
 */
export function ClipNameEditor({ name, label, onCommit, onCancel }: ClipNameEditorProps) {
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  /** Enter·Esc 뒤에 칸이 사라지며 생기는 blur로 한 번 더 확정하지 않게 한다 */
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(commit: boolean) {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(draft);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      className="clip-name-editor"
      data-testid="clip-name-editor"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        // 이 칸 안의 키(Space·Enter·Esc)가 클립의 키 처리로 올라가 글자 입력을 막지 않게 한다.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      // 칸을 눌러도 클립 끌기·선택이 시작되지 않고, 우클릭은 글자 칸의 기본 메뉴(복사·붙여넣기)가 뜨게 둔다.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    />
  );
}
