import type { DelaySettings } from "../types";
import { clamp } from "../utils/audioMath";
import { getDelayTimeMs, normalizeDelaySettings } from "../utils/delay";

interface DelayInsert {
  input: GainNode;
  output: GainNode;
  update: (settings: DelaySettings, bpm: number) => void;
  dispose: () => void;
}

export function createDelayInsert(
  context: BaseAudioContext,
  settings: DelaySettings,
  bpm: number,
): DelayInsert {
  const delaySettings = normalizeDelaySettings(settings);
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const delay = context.createDelay(2);
  const feedback = context.createGain();
  const highCut = context.createBiquadFilter();
  const delayTime = getDelayTimeMs(delaySettings, bpm) / 1000;

  feedback.gain.value = clamp(delaySettings.feedback, 0, 0.95);
  dry.gain.value = clamp(delaySettings.dry, 0, 1);
  wet.gain.value = clamp(delaySettings.wet, 0, 1);

  input.connect(dry);
  dry.connect(output);

  const delayNodes: DelayNode[] = [];
  const feedbackNodes: GainNode[] = [];
  const filterNodes: BiquadFilterNode[] = [];
  if (delaySettings.pingPong) {
    const leftDelay = context.createDelay(2);
    const rightDelay = context.createDelay(2);
    const leftFilter = createHighCut(context, delaySettings.highCutHz);
    const rightFilter = createHighCut(context, delaySettings.highCutHz);
    const leftPan = context.createStereoPanner();
    const rightPan = context.createStereoPanner();
    const leftFeedback = context.createGain();
    const rightFeedback = context.createGain();

    delayNodes.push(leftDelay, rightDelay);
    feedbackNodes.push(leftFeedback, rightFeedback);
    filterNodes.push(leftFilter, rightFilter);
    leftDelay.delayTime.value = delayTime;
    rightDelay.delayTime.value = delayTime;
    leftPan.pan.value = -0.7;
    rightPan.pan.value = 0.7;
    leftFeedback.gain.value = feedback.gain.value;
    rightFeedback.gain.value = feedback.gain.value;

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
    delayNodes.push(delay); feedbackNodes.push(feedback); filterNodes.push(highCut);
    delay.delayTime.value = delayTime;
    highCut.type = "lowpass";
    highCut.frequency.value = clamp(delaySettings.highCutHz, 1000, 20000);
    highCut.Q.value = 0.3;

    input.connect(delay);
    delay.connect(highCut);
    highCut.connect(wet);

    highCut.connect(feedback);
    feedback.connect(delay);
  }

  wet.connect(output);

  return { input, output, dispose: () => { feedbackNodes.forEach((node) => node.disconnect()); input.disconnect(); output.disconnect(); }, update: (next, nextBpm) => {
    const value = normalizeDelaySettings(next);
    const now = context.currentTime;
    dry.gain.setTargetAtTime(clamp(value.dry, 0, 1), now, 0.01);
    wet.gain.setTargetAtTime(clamp(value.wet, 0, 1), now, 0.01);
    delayNodes.forEach((node) => node.delayTime.setTargetAtTime(getDelayTimeMs(value, nextBpm) / 1000, now, 0.01));
    feedbackNodes.forEach((node) => node.gain.setTargetAtTime(clamp(value.feedback, 0, 0.95), now, 0.01));
    filterNodes.forEach((node) => node.frequency.setTargetAtTime(clamp(value.highCutHz, 1000, 20000), now, 0.01));
  } };
}

function createHighCut(context: BaseAudioContext, frequency: number) {
  const highCut = context.createBiquadFilter();
  highCut.type = "lowpass";
  highCut.frequency.value = clamp(frequency, 1000, 20000);
  highCut.Q.value = 0.3;
  return highCut;
}
