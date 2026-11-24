import { useEffect, useRef, useState, type FocusEvent } from "react";

interface CommittedNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  label?: string;
  testId?: string;
  /** 나타나자마자 초점을 받고 글자를 모두 고른다(노브 값 글자를 눌러 열 때) */
  autoFocus?: boolean;
  /** 정하거나 취소해 칸을 떠났을 때. `focusMoved`는 초점이 다른 곳으로 옮겨 갔는가(아니면 되돌려 줘도 된다) */
  onClose?: (focusMoved: boolean) => void;
}

/** 숫자 칸. 쓰는 동안은 비어 있어도 되고, Enter나 초점이 나갈 때 정한다(Esc는 취소). 범위를 벗어나면 끝값으로 맞춘다. */
export function CommittedNumberInput({ value, onCommit, min, max, step, disabled, className, label, testId, autoFocus, onClose }: CommittedNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [autoFocus]);
  const commit = (event: FocusEvent<HTMLInputElement>) => {
    const focusMoved = event.relatedTarget !== null;
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(String(value));
      setEditing(false);
      onClose?.(focusMoved);
      return;
    }
    const next = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(next)) onCommit(Math.max(min, Math.min(max, next)));
    else setDraft(String(value));
    setEditing(false);
    onClose?.(focusMoved);
  };
  return <input ref={inputRef} aria-label={label} data-testid={testId} className={className} disabled={disabled} type="number" min={min} max={max} step={step}
    value={draft} onFocus={() => setEditing(true)} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { cancelRef.current = true; event.currentTarget.blur(); }
    }} />;
}
