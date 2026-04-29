import type { ReverbMode, ReverbSettings } from "../types";
import { clamp } from "../utils/audioMath";
import { normalizeReverbSettings } from "../utils/reverb";

interface ReverbInsert {
  input: GainNode;
  output: GainNode;
}

export function createReverbInsert(
  context: AudioContext,
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

  return { input, output };
}

function createImpulseResponse(
  context: AudioContext,
  settings: ReverbSettings,
) {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * settings.decay));
  const impulse = context.createBuffer(2, length, sampleRate);
  const decayCurve = getDecayCurve(settings.mode);
  const color = getModeColor(settings.mode);
  const modDepth = settings.modEnabled ? settings.modAmount * 0.28 : 0;

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let last = 0;

    for (let sample = 0; sample < length; sample += 1) {
      const progress = sample / length;
      const envelope = Math.pow(1 - progress, decayCurve);
      const noise = Math.random() * 2 - 1;
      const filtered = noise * color + last * (1 - color);
      const phase = channel === 0 ? 0 : Math.PI * 0.43;
      const modulation =
        1 + Math.sin(progress * Math.PI * 18 + phase) * modDepth;

      last = filtered;
      data[sample] = filtered * envelope * modulation * 0.72;
    }
  }

  return impulse;
}

function getDecayCurve(mode: ReverbMode) {
  if (mode === "room") {
    return 1.35;
  }

  if (mode === "hall") {
    return 1.1;
  }

  return 2.2;
}

function getModeColor(mode: ReverbMode) {
  if (mode === "room") {
    return 0.74;
  }

  if (mode === "hall") {
    return 0.56;
  }

  return 0.68;
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

function createWidthStage(context: AudioContext, width: number) {
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

  return { input, output };
}

function createGain(context: AudioContext, value: number) {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}
