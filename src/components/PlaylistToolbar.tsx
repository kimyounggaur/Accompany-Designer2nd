import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ko } from "../i18n/ko";
import { useDawStore } from "../store/useDawStore";
import {
  clearSelection,
  clearTimeMarkers,
  deleteSelectedClips,
  groupSelectedClips,
  quantizeSelectedClips,
  quickZoom,
  resetSelectedClipSource,
  selectAllClips,
  ungroupSelectedClips,
  zoomIn,
  zoomOut,
  zoomToFit,
  zoomToSelectedClips,
} from "../app/actions";
import type { PlaylistSnap, PlaylistTool } from "../domain/types";
import { ariaKeys, keyLabel, toolShortcutId } from "../services/shortcuts";
import { menuIcon, playlistToolIcons, snapIcon } from "../utils/playlistToolIcons";

/** 도구 단추. 단추에 적는 키는 단축키 표(services/shortcuts.ts)에서 읽는다. */
const toolButtons: Array<{
  tool: PlaylistTool;
  label: string;
  icon: string;
}> = [
  { tool: "move", label: "이동", icon: playlistToolIcons.move },
  { tool: "draw", label: "그리기", icon: playlistToolIcons.draw },
  { tool: "paint", label: "페인트", icon: playlistToolIcons.paint },
  { tool: "delete", label: "삭제", icon: playlistToolIcons.delete },
  { tool: "mute", label: "음소거", icon: playlistToolIcons.mute },
  { tool: "slip", label: "슬립 편집", icon: playlistToolIcons.slip },
  { tool: "slice", label: "자르기", icon: playlistToolIcons.slice },
  { tool: "select", label: "선택", icon: playlistToolIcons.select },
  { tool: "zoom", label: "확대/축소", icon: playlistToolIcons.zoom },
  { tool: "play-selected", label: "선택 재생", icon: playlistToolIcons["play-selected"] },
];

const snapOptions: Array<{ value: PlaylistSnap; label: string }> = [
  { value: "main", label: "메인" },
  { value: "line", label: "라인" },
  { value: "beat", label: "박" },
  { value: "halfBeat", label: "1/2박" },
  { value: "quarterBeat", label: "1/4박" },
  { value: "none", label: "없음" },
];

const globalSnapOptions = snapOptions.filter(
  (option): option is { value: Exclude<PlaylistSnap, "main">; label: string } =>
    option.value !== "main",
);

interface CommandItem {
  label: string;
  shortcut?: string;
  selected?: boolean;
  action: () => void;
}

interface CommandSection {
  title: string;
  items: CommandItem[];
}

export function PlaylistToolbar() {
  const [openMenu, setOpenMenu] = useState<"menu" | "snap" | undefined>();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const playlistTool = useDawStore((state) => state.playlistTool);
  const playlistSnap = useDawStore((state) => state.playlistSnap);
  const globalSnap = useDawStore((state) => state.globalSnap);
  const performanceMode = useDawStore((state) => state.performanceMode);
  const playlistDetached = useDawStore((state) => state.playlistDetached);
  const selectedClipIds = useDawStore((state) => state.selectedClipIds);
  const tracks = useDawStore((state) => state.tracks);
  const playhead = useDawStore((state) => state.playhead);
  const setPlaylistTool = useDawStore((state) => state.setPlaylistTool);
  const setPlaylistSnap = useDawStore((state) => state.setPlaylistSnap);
  const setGlobalSnap = useDawStore((state) => state.setGlobalSnap);
  const addTimeMarker = useDawStore((state) => state.addTimeMarker);
  const togglePerformanceMode = useDawStore(
    (state) => state.togglePerformanceMode,
  );
  const togglePlaylistDetached = useDawStore(
    (state) => state.togglePlaylistDetached,
  );
  const setPlayhead = useDawStore((state) => state.setPlayhead);

  const selectedSnapLabel = useMemo(() => {
    const localLabel =
      snapOptions.find((option) => option.value === playlistSnap)?.label ?? ko.playlist.snapFallback;
    const globalLabel =
      globalSnapOptions.find((option) => option.value === globalSnap)?.label ??
      "라인";

    return playlistSnap === "main" ? `메인: ${globalLabel}` : localLabel;
  }, [globalSnap, playlistSnap]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && toolbarRef.current?.contains(target)) {
        return;
      }

      setOpenMenu(undefined);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(undefined);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  const goToSelectionStart = () => {
    const selected = new Set(selectedClipIds);
    const selectedClips = tracks.flatMap((track) =>
      track.clips.filter((clip) => selected.has(clip.id)),
    );

    if (!selectedClips.length) {
      return;
    }

    setPlayhead(Math.min(...selectedClips.map((clip) => clip.startTime)));
  };

  const commandSections: CommandSection[] = [
    {
      title: "편집",
      items: [
        { label: "선택 항목 퀀타이즈", shortcut: keyLabel("quantize"), action: quantizeSelectedClips },
        { label: "선택 항목 삭제", shortcut: keyLabel("deleteClips"), action: deleteSelectedClips },
      ],
    },
    {
      title: "도구",
      items: toolButtons.map((button) => ({
        label: button.label,
        shortcut: keyLabel(toolShortcutId(button.tool)),
        selected: playlistTool === button.tool,
        action: () => setPlaylistTool(button.tool),
      })),
    },
    {
      title: "보기",
      items: [
        { label: "확대", shortcut: keyLabel("zoomIn"), action: zoomIn },
        { label: "축소", shortcut: keyLabel("zoomOut"), action: zoomOut },
        { label: "빠른 줌 1", shortcut: keyLabel("zoomPreset1"), action: () => quickZoom("preset1") },
        { label: "빠른 줌 2", shortcut: keyLabel("zoomPreset2"), action: () => quickZoom("preset2") },
        { label: "빠른 줌 3", shortcut: keyLabel("zoomPreset3"), action: () => quickZoom("preset3") },
        { label: "전체 보기", shortcut: keyLabel("zoomFit"), action: zoomToFit },
      ],
    },
    {
      title: "스냅",
      items: [
        {
          label: "스냅 선택 열기",
          action: () => setOpenMenu("snap"),
        },
      ],
    },
    {
      title: "선택",
      items: [
        { label: "모든 클립 선택", shortcut: keyLabel("selectAll"), action: selectAllClips },
        { label: "선택 해제", action: clearSelection },
      ],
    },
    {
      title: "그룹",
      items: [
        { label: "선택 항목 그룹화", action: groupSelectedClips },
        { label: "선택 항목 그룹 해제", action: ungroupSelectedClips },
      ],
    },
    {
      title: "확대/축소",
      items: [
        { label: "선택 항목으로 확대", shortcut: keyLabel("zoomSelection"), action: zoomToSelectedClips },
        { label: "축소", shortcut: keyLabel("zoomOutQuick"), action: () => quickZoom("out") },
      ],
    },
    {
      title: "타임 마커",
      items: [
        { label: "재생 헤드에 추가", action: () => addTimeMarker(playhead) },
        { label: "마커 지우기", action: clearTimeMarkers },
      ],
    },
    {
      title: "클립 소스",
      items: [
        { label: "선택 소스 초기화", action: resetSelectedClipSource },
      ],
    },
    {
      title: "퍼포먼스 모드",
      items: [
        {
          label: performanceMode ? "퍼포먼스 모드 끄기" : "퍼포먼스 모드 켜기",
          selected: performanceMode,
          action: togglePerformanceMode,
        },
      ],
    },
    {
      title: "재생 헤드",
      items: [
        { label: "곡 처음으로 이동", action: () => setPlayhead(0) },
        { label: "선택 시작점으로 이동", action: goToSelectionStart },
      ],
    },
    {
      title: "분리",
      items: [
        {
          label: playlistDetached ? "플레이리스트 붙이기" : "플레이리스트 분리",
          selected: playlistDetached,
          action: togglePlaylistDetached,
        },
      ],
    },
  ];

  function runCommand(command: CommandItem) {
    command.action();
    if (command.label !== "스냅 선택 열기") {
      setOpenMenu(undefined);
    }
  }

  return (
    <div className="playlist-toolbar" aria-label="플레이리스트 도구" ref={toolbarRef}>
      <div className="playlist-toolbar-section">
        <div className="toolbar-menu-wrapper">
          <button
            className={`playlist-tool-button ${openMenu === "menu" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "menu" ? undefined : "menu")}
            title="플레이리스트 메뉴"
          >
            <img alt="" src={menuIcon} />
            <ChevronDown size={13} />
          </button>
          {openMenu === "menu" && (
            <div className="toolbar-dropdown menu-dropdown">
              {commandSections.map((section) => (
                <div className="toolbar-dropdown-section" key={section.title}>
                  <div className="toolbar-dropdown-label">{section.title}</div>
                  {section.items.map((item) => (
                    <button
                      className={item.selected ? "selected" : ""}
                      key={`${section.title}-${item.label}`}
                      onClick={() => runCommand(item)}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <small>{item.shortcut}</small>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-menu-wrapper">
          <button
            className={`playlist-tool-button snap-tool ${
              playlistSnap !== "none" ? "active" : ""
            }`}
            onClick={() => setOpenMenu(openMenu === "snap" ? undefined : "snap")}
            title={`스냅: ${selectedSnapLabel}`}
          >
            <img alt="" src={snapIcon} />
            <span>{selectedSnapLabel}</span>
            <ChevronDown size={13} />
          </button>
          {openMenu === "snap" && (
            <div className="toolbar-dropdown snap-dropdown">
              <div className="toolbar-dropdown-label">로컬 스냅</div>
              {snapOptions.map((option) => (
                <button
                  className={playlistSnap === option.value ? "selected" : ""}
                  key={option.value}
                  onClick={() => {
                    setPlaylistSnap(option.value);
                    setOpenMenu(undefined);
                  }}
                >
                  <span>{option.label}</span>
                </button>
              ))}
              <div className="toolbar-dropdown-label">글로벌 스냅</div>
              {globalSnapOptions.map((option) => (
                <button
                  className={globalSnap === option.value ? "selected" : ""}
                  key={`global-${option.value}`}
                  onClick={() => setGlobalSnap(option.value)}
                >
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="playlist-toolbar-section">
        {toolButtons.map((tool) => (
          <button
            className={`playlist-tool-button ${
              playlistTool === tool.tool ? "active" : ""
            }`}
            key={tool.tool}
            aria-keyshortcuts={ariaKeys(toolShortcutId(tool.tool))}
            onClick={() => setPlaylistTool(tool.tool)}
            title={`${tool.label} (${keyLabel(toolShortcutId(tool.tool))})`}
          >
            <img alt="" src={tool.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}
