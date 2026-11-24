/**
 * 앱 안 클립보드(설계서 P5-5). 복사한 클립의 사본을 "트랙 사이 위치"와 함께 기억한다.
 * 시스템 클립보드는 쓰지 않는다: 클립은 이 프로젝트의 음원 id를 가리켜서 다른 곳에 붙일 수 없다.
 *
 * 여기는 기억만 한다. 붙일 자리를 정하는 일은 `domain/timeline/clipMath`(planPaste·pasteBaseRow)가,
 * 문서에 놓는 일은 `state/commands`(pasteClips)가, 둘을 잇고 안내하는 일은 `app/actions`가 맡는다.
 * (예전에는 `app/actions` 안의 변수여서 클립이 있던 트랙이 사라지면 붙일 수 없었다.)
 */
import type { PasteItem } from "../domain/timeline/clipMath";
import type { Clip, Track } from "../domain/types";

export interface ClipboardContent {
  /** 복사한 클립들. `row`는 복사한 것 중 가장 위 트랙을 0으로 센 트랙 칸이다. */
  readonly items: readonly PasteItem[];
  /** 복사한 클립들 중 가장 위 트랙의 id: 붙일 트랙을 따로 고르지 않았을 때 돌아갈 곳 */
  readonly originTrackId: string;
}

let content: ClipboardContent | undefined;

/**
 * `tracks`에서 `clipIds`에 든 클립을 복사해 둔다. 복사한 클립 수를 돌려준다.
 * 하나도 없으면 0을 돌려주고, 먼저 복사해 둔 것은 그대로 둔다.
 */
export function copyClips(tracks: readonly Track[], clipIds: readonly string[]): number {
  const wanted = new Set(clipIds);
  const found: Array<{ clip: Clip; trackIndex: number }> = [];
  tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) if (wanted.has(clip.id)) found.push({ clip, trackIndex });
  });
  if (!found.length) return 0;
  const top = Math.min(...found.map((entry) => entry.trackIndex));
  content = {
    items: found.map(({ clip, trackIndex }) => ({ clip: { ...clip }, row: trackIndex - top })),
    originTrackId: tracks[top].id,
  };
  return found.length;
}

/** 복사해 둔 것. 없으면 undefined */
export function readClipboard(): ClipboardContent | undefined {
  return content;
}

/** 복사해 둔 것을 비운다(시험·새 세션) */
export function clearClipboard(): void {
  content = undefined;
}
