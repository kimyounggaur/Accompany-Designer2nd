import type { PlaylistTool } from "../types";

// Lightweight, original line icons shared by the toolbar and timeline cursor.
function icon(paths: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#202020" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const menuIcon = icon('<path d="M4 6h16M4 12h16M4 18h16"/>');
export const snapIcon = icon('<path d="M5 4v6a7 7 0 0 0 14 0V4h-4v6a3 3 0 0 1-6 0V4z"/><path d="M5 8h4M15 8h4"/>');

export const playlistToolIcons: Record<PlaylistTool, string> = {
  move: icon('<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>'),
  draw: icon('<path d="M4 20l1-5L16 4a2 2 0 0 1 3 3L8 18zM14 6l4 4"/>'),
  paint: icon('<path d="M14 4l6 6-9 9-6 1 1-6zM12 6l6 6M5 20c-2 0-2-3 0-5"/>'),
  delete: icon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/>'),
  mute: icon('<path d="M4 10h4l5-4v12l-5-4H4zM16 9l5 6M21 9l-5 6"/>'),
  slip: icon('<path d="M3 7h18v10H3zM8 12h8M6 12l2-2M6 12l2 2M18 12l-2-2M18 12l-2 2"/>'),
  slice: icon('<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5L20 18M8 15.5L20 6"/>'),
  select: icon('<path stroke-dasharray="3 2" d="M4 4h16v16H4z"/>'),
  zoom: icon('<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M7 10h6M10 7v6"/>'),
  "play-selected": icon('<path d="M6 4v16l13-8z"/>'),
};
