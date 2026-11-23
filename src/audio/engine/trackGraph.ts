import type { Track } from "../../types";
import { createDelayInsert } from "../delay";
import { createReverbInsert } from "../reverb";

/** 트랙 하나의 소리 경로(EQ → 컴프레서 → 딜레이 → 리버브 → 팬 → 볼륨 → 미터). P3-3에서 TrackStrip으로 바뀐다. */
export interface TrackGraph {
  input: GainNode; output: GainNode; analyser: AnalyserNode; signature: string;
  pan: StereoPannerNode; eq: BiquadFilterNode[]; compressor: DynamicsCompressorNode;
  delay?: ReturnType<typeof createDelayInsert>; reverb?: ReturnType<typeof createReverbInsert>;
}

export function disposeGraph(graph: TrackGraph) {
  graph.input.disconnect(); graph.output.disconnect(); graph.analyser.disconnect();
  graph.delay?.dispose();
}

export function graphSignature(track: Track, _bpm: number) {
  // Effect topology and effect settings require a new graph. Mixer and EQ/comp parameters update in place.
  return JSON.stringify([track.effectChain, track.eq.enabled, track.compressor.enabled,
    track.delay?.enabled, track.delay?.pingPong, track.reverb?.enabled]);
}

export function updateTrackGraph(graph: TrackGraph, track: Track, solo: boolean, time: number, bpm: number) {
  const smooth = (param: AudioParam, value: number) => param.setTargetAtTime(value, time, 0.01);
  smooth(graph.output.gain, track.muted || (solo && !track.solo) ? 0 : track.volume);
  smooth(graph.pan.pan, track.pan);
  [track.eq.bassGain, track.eq.middleLowGain, track.eq.middleHighGain, track.eq.highGain, track.eq.presenceGain]
    .forEach((gain, i) => smooth(graph.eq[i].gain, gain));
  smooth(graph.compressor.threshold, track.compressor.threshold);
  smooth(graph.compressor.ratio, track.compressor.ratio);
  smooth(graph.compressor.attack, track.compressor.attack);
  smooth(graph.compressor.release, track.compressor.release);
  graph.delay?.update(track.delay, bpm);
  graph.reverb?.update(track.reverb);
}

export function createTrackGraph(context: BaseAudioContext, master: AudioNode, track: Track, bpm: number): TrackGraph {
  const input = context.createGain();
  const eq = [context.createBiquadFilter(), context.createBiquadFilter(), context.createBiquadFilter(),
    context.createBiquadFilter(), context.createBiquadFilter()];
  const [bass, middleLow, middleHigh, high, presence] = eq;
  bass.type = "lowshelf"; bass.frequency.value = 110; bass.gain.value = track.eq.bassGain;
  middleLow.type = "peaking"; middleLow.frequency.value = 360; middleLow.Q.value = 0.9; middleLow.gain.value = track.eq.middleLowGain;
  middleHigh.type = "peaking"; middleHigh.frequency.value = 1800; middleHigh.Q.value = 0.85; middleHigh.gain.value = track.eq.middleHighGain;
  high.type = "highshelf"; high.frequency.value = 5600; high.gain.value = track.eq.highGain;
  presence.type = "peaking"; presence.frequency.value = 10000; presence.Q.value = 0.75; presence.gain.value = track.eq.presenceGain;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = track.compressor.threshold; compressor.ratio.value = track.compressor.ratio;
  compressor.attack.value = track.compressor.attack; compressor.release.value = track.compressor.release;
  const pan = context.createStereoPanner(); pan.pan.value = track.pan;
  const output = context.createGain(); output.gain.value = track.volume;
  const analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
  let delay: ReturnType<typeof createDelayInsert> | undefined;
  let reverb: ReturnType<typeof createReverbInsert> | undefined;
  let effectOutput: AudioNode = input;
  const chain = track.effectChain?.length ? track.effectChain : [
    {id: "eq", type: "eq" as const, enabled: track.eq.enabled},
    {id: "comp", type: "comp" as const, enabled: track.compressor.enabled},
    {id: "delay", type: "delay" as const, enabled: track.delay?.enabled ?? false},
    {id: "reverb", type: "reverb" as const, enabled: track.reverb?.enabled ?? false},
  ];
  for (const slot of chain) {
    if (!slot.enabled) continue;
    if (slot.type === "eq" && track.eq.enabled) {
      effectOutput.connect(bass); bass.connect(middleLow); middleLow.connect(middleHigh); middleHigh.connect(high); high.connect(presence); effectOutput = presence;
    } else if (slot.type === "comp" && track.compressor.enabled) {
      effectOutput.connect(compressor); effectOutput = compressor;
    } else if (slot.type === "delay" && track.delay?.enabled) {
      delay = createDelayInsert(context, track.delay, bpm); effectOutput.connect(delay.input); effectOutput = delay.output;
    } else if (slot.type === "reverb" && track.reverb?.enabled) {
      reverb = createReverbInsert(context, track.reverb); effectOutput.connect(reverb.input); effectOutput = reverb.output;
    }
  }
  effectOutput.connect(pan); pan.connect(output); output.connect(analyser); analyser.connect(master);
  return { input, output, analyser, signature: graphSignature(track, bpm), pan, eq, compressor, delay, reverb };
}
