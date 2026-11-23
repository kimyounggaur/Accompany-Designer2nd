import type { Clip } from "../types";
import { getClipPlaybackRate, getClipTimelineDuration } from "../../utils/audioMath";

/** 클립 하나를 지금 위치에서 어떻게 재생할지 정한 계획. 소리 노드를 만들지 않는 순수한 값이다. */
export interface VoicePlan {
  /** 재생 배율(WARP를 켠 클립만 1이 아님) */
  rate: number;
  /** 음원 안에서 시작할 위치(초) */
  offset: number;
  /** 음원에서 재생할 길이(초) */
  duration: number;
  /** 클립 안에서 이미 지난 타임라인 시간(초). 클립이 시작되기 전이면 0 */
  elapsed: number;
  /** 클립 전체의 타임라인 길이(초) */
  timelineDuration: number;
  /** 소리를 시작할 오디오 시각(context 시간) */
  when: number;
  /** 클립 중간에서 시작하는가. 그렇다면 시작 클릭을 막는 짧은 페이드 인이 필요하다. */
  startsMidClip: boolean;
}

/**
 * `position`(타임라인 초)에서 재생을 이어 갈 때 이 클립을 어떻게 재생할지 계산한다. 더 재생할 소리가 없으면 `undefined`.
 * 옛 엔진의 `scheduleClip` 계산을 노드 만들기와 분리한 것이다.
 *
 * @param bufferDuration 음원 버퍼의 길이(초)
 * @param contextTimeAt 타임라인 위치 → 오디오 시각(재생 시계가 알려 준다)
 */
export function planVoice(
  clip: Clip,
  bpm: number,
  position: number,
  bufferDuration: number,
  contextTimeAt: (position: number) => number,
): VoicePlan | undefined {
  const rate = getClipPlaybackRate(bpm, clip);
  const timelineDuration = getClipTimelineDuration(bpm, clip);
  if (clip.startTime + timelineDuration <= position) return undefined;
  const elapsed = Math.max(0, position - clip.startTime);
  const offset = clip.offset + elapsed * rate;
  const duration = Math.min(clip.duration - elapsed * rate, bufferDuration - offset);
  if (!(duration > 0)) return undefined;
  return {
    rate,
    offset,
    duration,
    elapsed,
    timelineDuration,
    when: contextTimeAt(Math.max(position, clip.startTime)),
    startsMidClip: elapsed > 0,
  };
}
