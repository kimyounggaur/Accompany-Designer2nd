import { ChevronDown } from "lucide-react";
import { useState } from "react";
import deleteIcon from "../assets/icons/flicon_delete.png";
import menuIcon from "../assets/icons/flicon_menu.png";
import muteIcon from "../assets/icons/flicon_mute.png";
import paintIcon from "../assets/icons/flicon_paint.png";
import drawIcon from "../assets/icons/flicon_pencilup.png";
import playSelectedIcon from "../assets/icons/flicon_play.png";
import snapIcon from "../assets/icons/flicon_snap.png";
import { useDawStore } from "../store/useDawStore";
import type { PlaylistSnap, PlaylistTool } from "../types";

const menuItems = [
  "Edit",
  "Tools",
  "View",
  "Snap",
  "Select",
  "Group",
  "Zoom",
  "Time Marker",
  "Clip Source",
  "Performance Mode",
  "Playhead",
  "Detach",
];

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

export function PlaylistToolbar() {
  const [openMenu, setOpenMenu] = useState<"menu" | "snap" | undefined>();
  const playlistTool = useDawStore((state) => state.playlistTool);
  const playlistSnap = useDawStore((state) => state.playlistSnap);
  const setPlaylistTool = useDawStore((state) => state.setPlaylistTool);
  const setPlaylistSnap = useDawStore((state) => state.setPlaylistSnap);
  const selectedSnapLabel =
    snapOptions.find((option) => option.value === playlistSnap)?.label ?? "Line";

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
              {menuItems.map((item) => (
                <button key={item} onClick={() => setOpenMenu(undefined)}>
                  {item}
                </button>
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
              {snapOptions.map((option) => (
                <button
                  className={playlistSnap === option.value ? "selected" : ""}
                  key={option.value}
                  onClick={() => {
                    setPlaylistSnap(option.value);
                    setOpenMenu(undefined);
                  }}
                >
                  {option.label}
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
