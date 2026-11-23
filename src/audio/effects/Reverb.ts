import type { ReverbSettings } from "../../types";
import { clamp } from "../../utils/audioMath";
import { normalizeReverbSettings } from "../../utils/reverb";
import { fadeTo, realTimers, smooth, type EffectNode, type EffectTimers } from "./EffectNode";
import { createImpulseBuffer, impulseKey } from "./impulse";
import { reverbTailSeconds } from "./tail";

/** 잔향 모양(모드·길이·흔들림)이 바뀐 뒤 이만큼 조용해지면 그때 한 번만 새 잔향을 만든다(노브를 끄는 동안은 만들지 않는다). */
export const IR_DEBOUNCE_MS = 150;
/** 옛 잔향에서 새 잔향으로 넘어가는 시간(초) */
export const IR_CROSSFADE_SECONDS = 0.05;
/** 넘어간 뒤 옛 컨볼버를 치우기까지(ms). 교차가 끝난 뒤여야 한다. */
const IR_RETIRE_MS = 120;

export interface ReverbOptions {
  timers?: EffectTimers;
  /** 시험에서 잔향 만들기를 세거나 바꿀 때 */
  makeImpulse?: (context: BaseAudioContext, settings: ReverbSettings) => AudioBuffer;
}

interface Tap {
  convolver: ConvolverNode;
  gain: GainNode;
}

function createDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const curve = new Float32Array(samples);
  const drive = 1 + clamp(amount, 0, 1) * 18;
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

function createGainNode(context: BaseAudioContext, value: number): GainNode {
  const gain = context.createGain();
  gain.gain.value = value;
  return gain;
}

/** 좌우 폭: 0이면 모노, 1이면 그대로. 왼쪽·오른쪽을 서로 섞는 비율을 바꾼다. */
function createWidthStage(context: BaseAudioContext, width: number) {
  const input = context.createGain();
  const output = context.createGain();
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const stereoWidth = clamp(width, 0, 1);
  const direct = (1 + stereoWidth) / 2;
  const cross = (1 - stereoWidth) / 2;
  const leftToLeft = createGainNode(context, direct);
  const rightToLeft = createGainNode(context, cross);
  const leftToRight = createGainNode(context, cross);
  const rightToRight = createGainNode(context, direct);
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
  const nodes: AudioNode[] = [input, output, splitter, merger, leftToLeft, rightToLeft, leftToRight, rightToRight];
  return {
    input,
    output,
    update(value: number, time: number) {
      const next = clamp(value, 0, 1);
      smooth(leftToLeft.gain, (1 + next) / 2, time);
      smooth(rightToRight.gain, (1 + next) / 2, time);
      smooth(leftToRight.gain, (1 - next) / 2, time);
      smooth(rightToLeft.gain, (1 - next) / 2, time);
    },
    dispose() {
      for (const node of nodes) node.disconnect();
    },
  };
}

/**
 * 리버브: 프리딜레이 → 드라이브 → 필터 → 컨볼버(잔향) → 후단 EQ → 폭.
 * 잔향(IR)은 설정의 해시를 씨앗으로 만들어서 같은 설정이면 늘 같다. 잔향 모양이 바뀌면 150ms 조용해진 뒤 한 번 만들고,
 * 컨볼버 둘을 50ms 동안 교차해 바꾼다(컨볼버의 버퍼를 직접 바꾸면 클릭이 난다).
 */
export function createReverb(context: BaseAudioContext, settings: ReverbSettings, options: ReverbOptions = {}): EffectNode<ReverbSettings> {
  const timers = options.timers ?? realTimers;
  const makeImpulse = options.makeImpulse ?? createImpulseBuffer;
  const initial = normalizeReverbSettings(settings);

  const input = context.createGain();
  const output = context.createGain();
  const dry = createGainNode(context, initial.dry);
  const wet = createGainNode(context, initial.wet);
  const preDelay = context.createDelay(0.25);
  const drive = context.createWaveShaper();
  const highPass = context.createBiquadFilter();
  const lowPass = context.createBiquadFilter();
  const lowEq = context.createBiquadFilter();
  const midEq = context.createBiquadFilter();
  const highEq = context.createBiquadFilter();
  const width = createWidthStage(context, initial.width);

  preDelay.delayTime.value = initial.preDelayMs / 1000;
  drive.curve = createDriveCurve(initial.drive);
  drive.oversample = "2x";
  highPass.type = "highpass"; highPass.frequency.value = initial.highPassHz; highPass.Q.value = 0.6;
  lowPass.type = "lowpass"; lowPass.frequency.value = initial.lowPassHz; lowPass.Q.value = 0.45;
  lowEq.type = "lowshelf"; lowEq.frequency.value = 220; lowEq.gain.value = initial.postEqLowGain;
  midEq.type = "peaking"; midEq.frequency.value = 1600; midEq.Q.value = 0.9; midEq.gain.value = initial.postEqMidGain;
  highEq.type = "highshelf"; highEq.frequency.value = 6500; highEq.gain.value = initial.postEqHighGain;

  input.connect(dry);
  dry.connect(output);
  input.connect(preDelay);
  preDelay.connect(drive);
  drive.connect(highPass);
  highPass.connect(lowPass);
  lowEq.connect(midEq);
  midEq.connect(highEq);
  highEq.connect(width.input);
  width.output.connect(wet);
  wet.connect(output);

  const addTap = (buffer: AudioBuffer, level: number): Tap => {
    const convolver = context.createConvolver();
    convolver.buffer = buffer;
    const gain = createGainNode(context, level);
    lowPass.connect(convolver);
    convolver.connect(gain);
    gain.connect(lowEq);
    return { convolver, gain };
  };
  const removeTap = (tap: Tap) => {
    // 들어오는 쪽(lowPass → 컨볼버)도 끊어야 치운 컨볼버가 메모리에 남지 않는다.
    lowPass.disconnect(tap.convolver);
    tap.convolver.disconnect();
    tap.gain.disconnect();
  };

  let current = addTap(makeImpulse(context, initial), 1);
  let activeKey = impulseKey(initial);
  let driveAmount = initial.drive;
  let wanted: ReverbSettings | undefined;
  let cancelWait: (() => void) | undefined;
  const retiring = new Map<Tap, () => void>();

  const swapImpulse = (target: ReverbSettings) => {
    cancelWait = undefined;
    wanted = undefined;
    const previous = current;
    const now = context.currentTime;
    const next = addTap(makeImpulse(context, target), 0);
    fadeTo(next.gain.gain, 1, now, IR_CROSSFADE_SECONDS);
    fadeTo(previous.gain.gain, 0, now, IR_CROSSFADE_SECONDS);
    current = next;
    activeKey = impulseKey(target);
    retiring.set(previous, timers.after(IR_RETIRE_MS, () => {
      retiring.delete(previous);
      removeTap(previous);
    }));
  };

  return {
    input,
    output,
    update(next, _bpm, time) {
      const value = normalizeReverbSettings(next);
      smooth(dry.gain, value.dry, time);
      smooth(wet.gain, value.wet, time);
      smooth(preDelay.delayTime, value.preDelayMs / 1000, time);
      smooth(highPass.frequency, value.highPassHz, time);
      smooth(lowPass.frequency, value.lowPassHz, time);
      smooth(lowEq.gain, value.postEqLowGain, time);
      smooth(midEq.gain, value.postEqMidGain, time);
      smooth(highEq.gain, value.postEqHighGain, time);
      width.update(value.width, time);
      if (driveAmount !== value.drive) {
        drive.curve = createDriveCurve(value.drive);
        driveAmount = value.drive;
      }
      if (impulseKey(value) === activeKey) {
        // 노브를 되돌려 지금 잔향과 같아졌다: 기다리던 새 잔향은 필요 없다.
        cancelWait?.();
        cancelWait = undefined;
        wanted = undefined;
        return;
      }
      wanted = value;
      cancelWait?.();
      cancelWait = timers.after(IR_DEBOUNCE_MS, () => {
        if (wanted) swapImpulse(wanted);
      });
    },
    tailSeconds: (next) => reverbTailSeconds(next),
    dispose() {
      cancelWait?.();
      cancelWait = undefined;
      for (const cancel of retiring.values()) cancel();
      for (const tap of retiring.keys()) removeTap(tap);
      retiring.clear();
      removeTap(current);
      width.dispose();
      for (const node of [input, output, dry, wet, preDelay, drive, highPass, lowPass, lowEq, midEq, highEq]) node.disconnect();
    },
  };
}
