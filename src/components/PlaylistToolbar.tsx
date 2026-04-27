import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import deleteIcon from "../assets/icons/flicon_delete.png";
import menuIcon from "../assets/icons/flicon_menu.png";
import muteIcon from "../assets/icons/flicon_mute.png";
import paintIcon from "../assets/icons/flicon_paint.png";
import drawIcon from "../assets/icons/flicon_pencilup.png";
import playSelectedIcon from "../assets/icons/flicon_play.png";
import snapIcon from "../assets/icons/flicon_snap.png";
import { useDawStore } from "../store/useDawStore";
import type { PlaylistSnap, PlaylistTool } from "../types";

const toolButtons: Array<{
  tool: PlaylistTool;
  label: string;
  shortcut: string;
  icon: string;
}> = [
  { tool: "draw", label: "Draw", shortcut: "P", icon: drawIcon },
  { tool: "paint", label: "Paint", shortcut: "B", icon: paintIcon },
  { tool: "delete", label: "Delete", shortcut: "D", icon: deleteIcon },
  { tool: "mute", label: "Mute", shortcut: "T", icon: muteIcon },
  {
    tool: "play-selected",
    label: "Play Selected",
    shortcut: "Y",
    icon: playSelectedIcon,
  },
];

const snapOptions: Array<{ value: PlaylistSnap; label: string }> = [
  { value: "main", label: "Main" },
  { value: "line", label: "Line" },
  { value: "beat", label: "Beat" },
  { value: "halfBeat", label: "1/2 beat" },
  { value: "quarterBeat", label: "1/4 beat" },
  { value: "none", label: "None" },
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
  const deleteSelectedClips = useDawStore((state) => state.deleteSelectedClips);
  const quantizeSelectedClips = useDawStore((state) => state.quantizeSelectedClips);
  const selectAllClips = useDawStore((state) => state.selectAllClips);
  const clearSelection = useDawStore((state) => state.clearSelection);
  const groupSelectedClips = useDawStore((state) => state.groupSelectedClips);
  const ungroupSelectedClips = useDawStore((state) => state.ungroupSelectedClips);
  const zoomToSelectedClips = useDawStore((state) => state.zoomToSelectedClips);
  const resetSelectedClipSource = useDawStore(
    (state) => state.resetSelectedClipSource,
  );
  const addTimeMarker = useDawStore((state) => state.addTimeMarker);
  const clearTimeMarkers = useDawStore((state) => state.clearTimeMarkers);
  const togglePerformanceMode = useDawStore(
    (state) => state.togglePerformanceMode,
  );
  const togglePlaylistDetached = useDawStore(
    (state) => state.togglePlaylistDetached,
  );
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const setZoom = useDawStore((state) => state.setZoom);

  const selectedSnapLabel = useMemo(() => {
    const localLabel =
      snapOptions.find((option) => option.value === playlistSnap)?.label ?? "Line";
    const globalLabel =
      globalSnapOptions.find((option) => option.value === globalSnap)?.label ??
      "Line";

    return playlistSnap === "main" ? `Main: ${globalLabel}` : localLabel;
  }, [globalSnap, playlistSnap]);

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
      title: "Edit",
      items: [
        { label: "Quantize selected", shortcut: "Alt+Q", action: quantizeSelectedClips },
        { label: "Delete selected", shortcut: "Delete", action: deleteSelectedClips },
      ],
    },
    {
      title: "Tools",
      items: [
        { label: "Draw", shortcut: "P", selected: playlistTool === "draw", action: () => setPlaylistTool("draw") },
        { label: "Paint", shortcut: "B", selected: playlistTool === "paint", action: () => setPlaylistTool("paint") },
        { label: "Delete", shortcut: "D", selected: playlistTool === "delete", action: () => setPlaylistTool("delete") },
        { label: "Mute", shortcut: "T", selected: playlistTool === "mute", action: () => setPlaylistTool("mute") },
        { label: "Slip Edit", shortcut: "S", selected: playlistTool === "slip", action: () => setPlaylistTool("slip") },
        { label: "Slice", shortcut: "C", selected: playlistTool === "slice", action: () => setPlaylistTool("slice") },
        { label: "Select", shortcut: "E", selected: playlistTool === "select", action: () => setPlaylistTool("select") },
        { label: "Zoom", shortcut: "Z", selected: playlistTool === "zoom", action: () => setPlaylistTool("zoom") },
        { label: "Play selected", shortcut: "Y", selected: playlistTool === "play-selected", action: () => setPlaylistTool("play-selected") },
      ],
    },
    {
      title: "View",
      items: [
        { label: "Zoom in", shortcut: "Page Up", action: () => setZoom(useDawStore.getState().zoomPxPerSecond + 16) },
        { label: "Zoom out", shortcut: "Page Down", action: () => setZoom(useDawStore.getState().zoomPxPerSecond - 16) },
        { label: "Quick zoom 1", shortcut: "Shift+1", action: () => setZoom(72) },
        { label: "Quick zoom 2", shortcut: "Shift+2", action: () => setZoom(132) },
        { label: "Quick zoom 3", shortcut: "Shift+3", action: () => setZoom(220) },
      ],
    },
    {
      title: "Snap",
      items: [
        {
          label: "Open snap selector",
          action: () => setOpenMenu("snap"),
        },
      ],
    },
    {
      title: "Select",
      items: [
        { label: "Select all clips", action: selectAllClips },
        { label: "Clear selection", action: clearSelection },
      ],
    },
    {
      title: "Group",
      items: [
        { label: "Group selected", action: groupSelectedClips },
        { label: "Ungroup selected", action: ungroupSelectedClips },
      ],
    },
    {
      title: "Zoom",
      items: [
        { label: "On selection", shortcut: "Shift+5", action: zoomToSelectedClips },
        { label: "Zoom out", shortcut: "Shift+4", action: () => setZoom(72) },
      ],
    },
    {
      title: "Time Marker",
      items: [
        { label: "Add at playhead", action: () => addTimeMarker(playhead) },
        { label: "Clear markers", action: clearTimeMarkers },
      ],
    },
    {
      title: "Clip Source",
      items: [
        { label: "Reset selected source", action: resetSelectedClipSource },
      ],
    },
    {
      title: "Performance Mode",
      items: [
        {
          label: performanceMode ? "Disable performance mode" : "Enable performance mode",
          selected: performanceMode,
          action: togglePerformanceMode,
        },
      ],
    },
    {
      title: "Playhead",
      items: [
        { label: "Go to song start", action: () => setPlayhead(0) },
        { label: "Go to selection start", action: goToSelectionStart },
      ],
    },
    {
      title: "Detach",
      items: [
        {
          label: playlistDetached ? "Attach playlist" : "Detach playlist",
          selected: playlistDetached,
          action: togglePlaylistDetached,
        },
      ],
    },
  ];

  function runCommand(command: CommandItem) {
    command.action();
    if (command.label !== "Open snap selector") {
      setOpenMenu(undefined);
    }
  }

  return (
    <div className="playlist-toolbar" aria-label="Playlist tools">
      <div className="playlist-toolbar-section">
        <div className="toolbar-menu-wrapper">
          <button
            className={`playlist-tool-button ${openMenu === "menu" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "menu" ? undefined : "menu")}
            title="Playlist Menu"
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
            title={`Snap: ${selectedSnapLabel}`}
          >
            <img alt="" src={snapIcon} />
            <span>{selectedSnapLabel}</span>
            <ChevronDown size={13} />
          </button>
          {openMenu === "snap" && (
            <div className="toolbar-dropdown snap-dropdown">
              <div className="toolbar-dropdown-label">Local Snap</div>
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
              <div className="toolbar-dropdown-label">Global Snap</div>
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
            onClick={() => setPlaylistTool(tool.tool)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <img alt="" src={tool.icon} />
          </button>
        ))}
      </div>
    </div>
  );
}
