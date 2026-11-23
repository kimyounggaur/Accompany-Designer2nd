import type { DelaySettings } from "../../types";
import { clamp } from "../../utils/audioMath";
import { getDelayTimeMs, normalizeDelaySettings } from "../../utils/delay";
import { smooth, type EffectNode } from "./EffectNode";
import { delayTailSeconds } from "./tail";

/** 연결 모양이 달라지는 값: 핑퐁은 왼쪽·오른쪽 딜레이 둘을 엇갈려 잇는 다른 구조라 노드를 새로 만들어야 한다. */
export function delayStructureKey(settings: DelaySettings | undefined): string {
  return settings?.pingPong ? "pingpong" : "mono";
}

function createHighCut(context: BaseAudioContext, frequency: number): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(frequency, 1000, 20000);
  filter.Q.value = 0.3;
  return filter;
}

/** 딜레이: 원음(dry)과 되먹임 딜레이 소리(wet)를 섞어 내보낸다. 핑퐁이면 좌우로 번갈아 울린다. */
export function createDelay(context: BaseAudioContext, settings: DelaySettings, bpm: number): EffectNode<DelaySettings> {
  const value = normalizeDelaySettings(settings);
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const delayTime = getDelayTimeMs(value, bpm) / 1000;
  dry.gain.value = clamp(value.dry, 0, 1);
  wet.gain.value = clamp(value.wet, 0, 1);
  input.connect(dry);
  dry.connect(output);

  const delays: DelayNode[] = [];
  const feedbacks: GainNode[] = [];
  const filters: BiquadFilterNode[] = [];
  const extra: AudioNode[] = [];

  if (value.pingPong) {
    const leftDelay = context.createDelay(2);
    const rightDelay = context.createDelay(2);
    const leftFilter = createHighCut(context, value.highCutHz);
    const rightFilter = createHighCut(context, value.highCutHz);
    const leftPan = context.createStereoPanner();
    const rightPan = context.createStereoPanner();
    const leftFeedback = context.createGain();
    const rightFeedback = context.createGain();
    delays.push(leftDelay, rightDelay);
    feedbacks.push(leftFeedback, rightFeedback);
    filters.push(leftFilter, rightFilter);
    extra.push(leftPan, rightPan);
    leftDelay.delayTime.value = delayTime;
    rightDelay.delayTime.value = delayTime;
    leftPan.pan.value = -0.7;
    rightPan.pan.value = 0.7;
    leftFeedback.gain.value = clamp(value.feedback, 0, 0.95);
    rightFeedback.gain.value = clamp(value.feedback, 0, 0.95);

    input.connect(leftDelay);
    leftDelay.connect(leftFilter);
    leftFilter.connect(leftPan);
    leftPan.connect(wet);
    leftFilter.connect(rightFeedback);
    rightFeedback.connect(rightDelay);
    rightDelay.connect(rightFilter);
    rightFilter.connect(rightPan);
    rightPan.connect(wet);
    rightFilter.connect(leftFeedback);
    leftFeedback.connect(leftDelay);
  } else {
    const delay = context.createDelay(2);
    const feedback = context.createGain();
    const highCut = createHighCut(context, value.highCutHz);
    delays.push(delay);
    feedbacks.push(feedback);
    filters.push(highCut);
    delay.delayTime.value = delayTime;
    feedback.gain.value = clamp(value.feedback, 0, 0.95);

    input.connect(delay);
    delay.connect(highCut);
    highCut.connect(wet);
    highCut.connect(feedback);
    feedback.connect(delay);
  }
  wet.connect(output);

  return {
    input,
    output,
    update(next, nextBpm, time) {
      const normalized = normalizeDelaySettings(next);
      smooth(dry.gain, clamp(normalized.dry, 0, 1), time);
      smooth(wet.gain, clamp(normalized.wet, 0, 1), time);
      delays.forEach((node) => smooth(node.delayTime, getDelayTimeMs(normalized, nextBpm) / 1000, time));
      feedbacks.forEach((node) => smooth(node.gain, clamp(normalized.feedback, 0, 0.95), time));
      filters.forEach((node) => smooth(node.frequency, clamp(normalized.highCutHz, 1000, 20000), time));
    },
    tailSeconds: (next, nextBpm) => delayTailSeconds(next, nextBpm),
    dispose() {
      for (const node of [input, output, dry, wet, ...delays, ...feedbacks, ...filters, ...extra]) node.disconnect();
    },
  };
}
