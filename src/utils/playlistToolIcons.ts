import deleteIcon from "../assets/icons/flicon_delete.png";
import moveIcon from "../assets/icons/flicon_move.svg";
import muteIcon from "../assets/icons/flicon_mute.png";
import paintIcon from "../assets/icons/flicon_paint.png";
import drawIcon from "../assets/icons/flicon_pencilup.png";
import playSelectedIcon from "../assets/icons/flicon_playback.png";
import selectIcon from "../assets/icons/flicon_select.png";
import sliceIcon from "../assets/icons/flicon_slice.png";
import slipIcon from "../assets/icons/flicon_slip.png";
import zoomIcon from "../assets/icons/flicon_zoom.png";
import type { PlaylistTool } from "../types";

export const playlistToolIcons: Record<PlaylistTool, string> = {
  move: moveIcon,
  draw: drawIcon,
  paint: paintIcon,
  delete: deleteIcon,
  mute: muteIcon,
  slip: slipIcon,
  slice: sliceIcon,
  select: selectIcon,
  zoom: zoomIcon,
  "play-selected": playSelectedIcon,
};
