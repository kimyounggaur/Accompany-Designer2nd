import type { Clip } from "../../types";
import { getClipPlaybackRate } from "../../utils/audioMath";

/** 클립의 소리에 영향을 주는 값만 모은 표시. 이름·그룹처럼 소리와 무관한 값이 바뀌어도 같다. */
export function clipSignature(trackId: string, clip: Clip, bpm: number) {
  return JSON.stringify([trackId, clip.audioBufferId, clip.startTime, clip.offset, clip.duration,
    getClipPlaybackRate(bpm, clip), clip.gain, clip.fadeIn, clip.fadeOut, clip.fadeCurve]);
}
