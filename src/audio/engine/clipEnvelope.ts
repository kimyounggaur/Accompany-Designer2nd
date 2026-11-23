import type { Clip, FadeCurve } from "../../domain/types";
import type { VoicePlan } from "../../domain/timeline/clipMath";

function createFadeCurve(
  curve: FadeCurve,
  direction: "in" | "out",
  startRatio: number,
  endRatio: number,
  gain: number,
) {
  const sampleCount = 64;
  const values = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const position = startRatio + ((endRatio - startRatio) * index) / (sampleCount - 1);
    const safePosition = Math.min(1, Math.max(0, position));
    const value =
      direction === "in"
        ? curve === "linear"
          ? safePosition
          : Math.sin((Math.PI / 2) * safePosition)
        : curve === "linear"
          ? 1 - safePosition
          : Math.cos((Math.PI / 2) * safePosition);
    values[index] = Math.max(0.0001, value * gain);
  }

  return values;
}

function getFadeGainAt(
  position: number,
  clipGain: number,
  fadeIn: number,
  fadeOut: number,
  timelineDuration: number,
  curve: FadeCurve,
) {
  let gain = clipGain;

  if (fadeIn > 0 && position < fadeIn) {
    const ratio = Math.min(1, Math.max(0, position / fadeIn));
    gain *= curve === "linear" ? ratio : Math.sin((Math.PI / 2) * ratio);
  }

  if (fadeOut > 0 && position > timelineDuration - fadeOut) {
    const ratio = Math.min(1, Math.max(0, (position - (timelineDuration - fadeOut)) / fadeOut));
    gain *= curve === "linear" ? 1 - ratio : Math.cos((Math.PI / 2) * ratio);
  }

  return Math.max(0.0001, gain);
}

function scheduleFadeSegment(
  param: AudioParam,
  curve: FadeCurve,
  direction: "in" | "out",
  gain: number,
  when: number,
  segmentStart: number,
  segmentEnd: number,
  fadeStart: number,
  fadeDuration: number,
  playbackSegmentStart: number,
) {
  const duration = Math.max(0, segmentEnd - segmentStart);
  if (duration <= 0.001) {
    return;
  }

  const startRatio = Math.min(1, Math.max(0, (segmentStart - fadeStart) / fadeDuration));
  const endRatio = Math.min(1, Math.max(0, (segmentEnd - fadeStart) / fadeDuration));
  const startTime = when + (segmentStart - playbackSegmentStart);

  if (curve === "linear") {
    const startGain =
      direction === "in" ? gain * startRatio : gain * (1 - startRatio);
    const endGain = direction === "in" ? gain * endRatio : gain * (1 - endRatio);
    param.setValueAtTime(Math.max(0.0001, startGain), startTime);
    param.linearRampToValueAtTime(Math.max(0.0001, endGain), startTime + duration);
    return;
  }

  param.setValueCurveAtTime(
    createFadeCurve(curve, direction, startRatio, endRatio, gain),
    startTime,
    duration,
  );
}

export function scheduleClipGainEnvelope(
  param: AudioParam,
  clip: Clip,
  when: number,
  elapsedInsideClip: number,
  scheduledTimelineDuration: number,
  timelineDuration: number,
) {
  const gain = Math.max(0, clip.gain);
  const curve = clip.fadeCurve ?? "equalPower";
  const fadeLimit = Math.max(0, timelineDuration / 2);
  const fadeIn = Math.min(Math.max(0, clip.fadeIn || 0), fadeLimit);
  const fadeOut = Math.min(Math.max(0, clip.fadeOut || 0), fadeLimit);
  const segmentStart = Math.max(0, elapsedInsideClip);
  const segmentEnd = Math.min(timelineDuration, segmentStart + scheduledTimelineDuration);

  param.cancelScheduledValues(when);
  if (gain <= 0) {
    param.setValueAtTime(0, when);
    return;
  }

  param.setValueAtTime(
    getFadeGainAt(segmentStart, gain, fadeIn, fadeOut, timelineDuration, curve),
    when,
  );

  if (fadeIn > 0 && segmentStart < fadeIn && segmentEnd > 0) {
    scheduleFadeSegment(
      param,
      curve,
      "in",
      gain,
      when,
      Math.max(segmentStart, 0),
      Math.min(segmentEnd, fadeIn),
      0,
      fadeIn,
      segmentStart,
    );
  }

  if (fadeIn > 0 && segmentStart < fadeIn && segmentEnd > fadeIn) {
    param.setValueAtTime(gain, when + (fadeIn - segmentStart));
  }

  const fadeOutStart = Math.max(0, timelineDuration - fadeOut);
  if (fadeOut > 0 && segmentEnd > fadeOutStart) {
    scheduleFadeSegment(
      param,
      curve,
      "out",
      gain,
      when,
      Math.max(segmentStart, fadeOutStart),
      segmentEnd,
      fadeOutStart,
      fadeOut,
      segmentStart,
    );
  }
}

/** 클립의 `elapsedInsideClip`초 지점에서 클립 게인(음량·페이드)이 가지는 값. 예약의 첫 값과 같다. */
export function initialClipGain(clip: Clip, elapsedInsideClip: number, timelineDuration: number): number {
  const gain = Math.max(0, clip.gain);
  if (gain <= 0) return 0;
  const curve = clip.fadeCurve ?? "equalPower";
  const fadeLimit = Math.max(0, timelineDuration / 2);
  const fadeIn = Math.min(Math.max(0, clip.fadeIn || 0), fadeLimit);
  const fadeOut = Math.min(Math.max(0, clip.fadeOut || 0), fadeLimit);
  return getFadeGainAt(Math.max(0, elapsedInsideClip), gain, fadeIn, fadeOut, timelineDuration, curve);
}

/**
 * `planVoice`가 만든 계획대로 클립 게인(음량·페이드)을 예약한다.
 * 게인 노드의 기본값은 1이라, 예약한 첫 값이 적용되기 전의 첫 샘플이 새어 나가지 않도록 처음 값을 먼저 맞춘다.
 */
export function scheduleClipEnvelope(
  param: AudioParam,
  clip: Clip,
  plan: Pick<VoicePlan, "when" | "elapsed" | "duration" | "rate" | "timelineDuration">,
) {
  param.value = initialClipGain(clip, plan.elapsed, plan.timelineDuration);
  scheduleClipGainEnvelope(param, clip, plan.when, plan.elapsed, plan.duration / plan.rate, plan.timelineDuration);
}
