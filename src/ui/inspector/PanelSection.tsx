import { ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useStoredFlag } from "../useStoredFlag";

interface PanelSectionProps {
  /** 접힘 상태를 기억하는 이름. 바꾸면 기억이 초기화되므로 한 번 정하면 유지한다. */
  id: string;
  title: string;
  className?: string;
  /** 처음 열 때의 상태(기억된 값이 있으면 그 값이 우선) */
  defaultOpen?: boolean;
  /** 제목 줄 오른쪽에 둘 단추(예: 이펙트 전원, 클립 삭제) */
  actions?: ReactNode;
  children: ReactNode;
}

/** 오른쪽 패널의 한 칸. 제목 줄을 누르면 접고 펴며, 상태는 이 브라우저에 기억된다. */
export function PanelSection({ id, title, className = "", defaultOpen = true, actions, children }: PanelSectionProps) {
  const [open, setOpen] = useStoredFlag(`ad.ui.panel.${id}`, defaultOpen);
  const bodyId = useId();

  return (
    <section className={`panel panel-section ${className}`.trim()} data-open={open} data-panel={id}>
      <div className="panel-section__header">
        <h2 className="panel-section__heading">
          <button
            type="button"
            className="panel-section__toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown className="panel-section__chevron" size={14} aria-hidden="true" />
            <span>{title}</span>
          </button>
        </h2>
        {actions && <div className="panel-section__actions">{actions}</div>}
      </div>
      <div id={bodyId} className="panel-section__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
