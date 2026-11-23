import { ChevronDown, Download, FolderOpen, Link2, Save, Upload } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ko } from "../../i18n/ko";
import { useDismiss } from "../useDismiss";

interface FileMenuProps {
  onFiles: (files: FileList) => void;
  onLoadProject: (file: File) => void;
  onSaveProject: () => void;
  onExportMix: () => void;
  onRelink: () => void;
}

/** 오디오 업로드 · 프로젝트 불러오기 · 저장 · 믹스 WAV 내보내기 · 음원 다시 연결을 한 메뉴로 모은다. */
export function FileMenu({ onFiles, onLoadProject, onSaveProject, onExportMix, onRelink }: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  useDismiss(rootRef, open, () => setOpen(false), () => triggerRef.current?.focus());

  // 메뉴가 열리면 첫 항목으로 초점을 옮긴다(방향키로 이동할 수 있도록).
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div className="transport-group file-menu popover-host" ref={rootRef}>
      {/* 숨은 입력은 메뉴가 닫혀 있어도 항상 렌더링한다(자동 시험·접근성 도구가 직접 접근). */}
      <input
        ref={fileInputRef}
        accept="audio/*,.mp3,.wav,.m4a"
        data-testid="upload-input"
        hidden
        multiple
        onChange={(event) => {
          if (event.target.files) {
            onFiles(event.target.files);
            event.target.value = "";
          }
        }}
        type="file"
      />
      <input
        ref={projectInputRef}
        accept=".adproj,application/zip,application/json,.json"
        data-testid="project-input"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onLoadProject(file);
            event.target.value = "";
          }
        }}
        type="file"
      />

      <button
        ref={triggerRef}
        className={`text-button ${open ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="file-menu-trigger"
        type="button"
      >
        <span>파일</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="popover-panel file-menu-panel"
          role="menu"
          aria-label="파일"
          data-testid="file-menu-panel"
          onKeyDown={onMenuKeyDown}
        >
          <button role="menuitem" type="button" onClick={() => choose(() => fileInputRef.current?.click())}>
            <Upload size={16} />
            <span>오디오 업로드</span>
          </button>
          <button role="menuitem" type="button" onClick={() => choose(() => projectInputRef.current?.click())}>
            <FolderOpen size={16} />
            <span>프로젝트 불러오기</span>
          </button>
          <button role="menuitem" type="button" onClick={() => choose(onSaveProject)}>
            <Save size={16} />
            <span>프로젝트 저장</span>
          </button>
          <button role="menuitem" type="button" onClick={() => choose(onExportMix)} aria-label="완성 믹스 WAV 내보내기">
            <Download size={16} />
            <span>믹스 WAV 내보내기</span>
          </button>
          <button role="menuitem" type="button" onClick={() => choose(onRelink)}>
            <Link2 size={16} />
            <span>{ko.relink.menuItem}</span>
          </button>
        </div>
      )}
    </div>
  );
}
