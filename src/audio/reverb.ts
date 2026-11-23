import type { ReverbSettings } from "../types";
import { clamp } from "../utils/audioMath";
import { normalizeReverbSettings } from "../utils/reverb";
import { createImpulseBuffer, impulseKey } from "./effects/impulse";

interface ReverbInsert {
  input: GainNode;
  output: GainNode;
  update: (settings: ReverbSettings) => void;
}

export function createReverbInsert(
  context: BaseAudioContext,
  settings: ReverbSettings,
): ReverbInsert {
  const reverb = normalizeReverbSettings(settings);
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const preDelay = context.createDelay(0.25);
  const drive = context.createWaveShaper();
  const highPass = context.createBiquadFilter();
  const lowPass = context.createBiquadFilter();
  const convolver = context.createConvolver();
  const lowEq = context.createBiquadFilter();
  const midEq = context.createBiquadFilter();
  const highEq = context.createBiquadFilter();
  const width = createWidthStage(context, reverb.width);

  dry.gain.value = reverb.dry;
  wet.gain.value = reverb.wet;
  preDelay.delayTime.value = reverb.preDelayMs / 1000;
  drive.curve = createDriveCurve(reverb.drive);
  drive.oversample = "2x";

  highPass.type = "highpass";
  highPass.frequency.value = reverb.highPassHz;
  highPass.Q.value = 0.6;

  lowPass.type = "lowpass";
  lowPass.frequency.value = reverb.lowPassHz;
  lowPass.Q.value = 0.45;

  lowEq.type = "lowshelf";
  lowEq.frequency.value = 220;
  lowEq.gain.value = reverb.postEqLowGain;

  midEq.type = "peaking";
  midEq.frequency.value = 1600;
  midEq.Q.value = 0.9;
  midEq.gain.value = reverb.postEqMidGain;

  highEq.type = "highshelf";
  highEq.frequency.value = 6500;
  highEq.gain.value = reverb.postEqHighGain;

  convolver.buffer = createImpulseResponse(context, reverb);

  input.connect(dry);
  dry.connect(output);

  input.connect(preDelay);
  preDelay.connect(drive);
  drive.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(convolver);
  convolver.connect(lowEq);
  lowEq.connect(midEq);
  midEq.connect(highEq);
  highEq.connect(width.input);
  width.output.connect(wet);
  wet.connect(output);

  let activeImpulseKey = impulseKey(reverb);
  let driveAmount = reverb.drive;
  return { input, output, update: (next) => {
    const value = normalizeReverbSettings(next), now = context.currentTime;
    const set = (param: AudioParam, amount: number) => param.setTargetAtTime(amount, now, 0.01);
    set(dry.gain, value.dry); set(wet.gain, value.wet); set(preDelay.delayTime, value.preDelayMs / 1000);
    set(highPass.frequency, value.highPassHz); set(lowPass.frequency, value.lowPassHz);
    set(lowEq.gain, value.postEqLowGain); set(midEq.gain, value.postEqMidGain); set(highEq.gain, value.postEqHighGain);
    width.update(value.width);
    if (driveAmount !== value.drive) { drive.curve = createDriveCurve(value.drive); driveAmount = value.drive; }
    const key = impulseKey(value);
    if (key !== activeImpulseKey) { convolver.buffer = createImpulseResponse(context, value); activeImpulseKey = key; }
  } };
}

function createImpulseResponse(
  context: BaseAudioContext,
  settings: ReverbSettings,
) {
  // 잔향 계산은 새 엔진과 같은 코드(effects/impulse.ts)를 쓴다: 같은 설정이면 재생과 내보내기가 같은 잔향이다.
  return createImpulseBuffer(context, settings);
}

function createDriveCurve(amount: number) {
  const samples = 512;
  const curve = new Float32Array(samples);
  const drive = 1 + clamp(amount, 0, 1) * 18;

  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }

  return curve;
}

function createWidthStage(context: BaseAudioContext, width: number) {
  const input = context.createGain();
  const output = context.createGain();
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const stereoWidth = clamp(width, 0, 1);
  const direct = (1 + stereoWidth) / 2;
  const cross = (1 - stereoWidth) / 2;
  const leftToLeft = createGain(context, direct);
  const rightToLeft = createGain(context, cross);
  const leftToRight = createGain(context, cross);
  const rightToRight = createGain(context, direct);

  input.connect(splitter);
  splitter.connect(leftToLeft, 0);
  splitter.connect(leftToRight, 0);
  splitter.connect(rightToLeft, 1);
  splitter.connect(rightToRight, 1);

  leftToLeft.connect(merger, 0, 0);
  rightToLeft.connect(merger, 0, 0);
  leftToRight.connect(merger, 0, 1);
  rightToRight.connect(merger, 0, 1);
  merger.connect(output);

  return { input, output, update: (value: number) => {
    const next = clamp(value, 0, 1);
    const now = context.currentTime;
    leftToLeft.gain.setTargetAtTime((1 + next) / 2, now, 0.01);
    rightToRight.gain.setTargetAtTime((1 + next) / 2, now, 0.01);
    leftToRight.gain.setTargetAtTime((1 - next) / 2, now, 0.01);
    rightToLeft.gain.setTargetAtTime((1 - next) / 2, now, 0.01);
  } };
}

function createGain(context: BaseAudioContext, value: number) {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}
