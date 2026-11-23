import { useEffect, useRef, useState } from "react";

/** Keep an editable draft until the user commits it, including temporary empty input. */
export function CommittedNumberInput({ value, onCommit, min, max, step, disabled, className, label }: {
  value: number; onCommit: (value: number) => void; min: number; max: number;
  step?: number; disabled?: boolean; className?: string; label?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelRef = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const commit = () => {
    if (cancelRef.current) { cancelRef.current = false; setDraft(String(value)); setEditing(false); return; }
    const next = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(next)) onCommit(Math.max(min, Math.min(max, next)));
    else setDraft(String(value));
    setEditing(false);
  };
  return <input aria-label={label} className={className} disabled={disabled} type="number" min={min} max={max} step={step}
    value={draft} onFocus={() => setEditing(true)} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { cancelRef.current = true; event.currentTarget.blur(); }
    }} />;
}
