import { test } from "node:test";
import assert from "node:assert/strict";
import { produce } from "immer";

const { createDefaultTrack } = await import("../src/state/docDefaults.ts");
const { effectOrder, isEffectActive, DEFAULT_EFFECT_ORDER } = await import("../src/audio/effects/chain.ts");
const {
  delayTailSeconds, reverbTailSeconds, effectTailSeconds, trackTailSeconds, projectTailSeconds, MAX_TAIL_SECONDS,
} = await import("../src/audio/effects/tail.ts");

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} ≠ ${expected}`);

/** 이펙트의 자기 켜기와 사슬 슬롯의 켜기를 함께 바꾼다(화면의 켜기 버튼이 하는 일) */
function setEffect(track, type, enabled) {
  const key = { eq: "eq", comp: "compressor", delay: "delay", reverb: "reverb" }[type];
  track[key].enabled = enabled;
  for (const slot of track.effectChain) if (slot.type === type) slot.enabled = enabled;
}

const withEffects = (changes) => produce(createDefaultTrack(1), (track) => {
  for (const [type, enabled] of Object.entries(changes)) setEffect(track, type, enabled);
});

test("이펙트 순서: 사슬의 종류 순서를 따르고, 같은 종류는 처음 것만, 사슬이 비면 기본 순서", () => {
  const track = createDefaultTrack(1);
  assert.deepEqual(effectOrder(track), ["eq", "comp", "delay", "reverb"]);
  assert.deepEqual(effectOrder(track), [...DEFAULT_EFFECT_ORDER]);

  const reordered = produce(track, (draft) => { draft.effectChain.reverse(); });
  assert.deepEqual(effectOrder(reordered), ["reverb", "delay", "comp", "eq"]);

  const duplicated = produce(track, (draft) => { draft.effectChain.push({ id: "again", type: "eq", enabled: true }); });
  assert.deepEqual(effectOrder(duplicated), ["eq", "comp", "delay", "reverb"]);

  const oldProject = produce(track, (draft) => { draft.effectChain = []; });
  assert.deepEqual(effectOrder(oldProject), ["eq", "comp", "delay", "reverb"]);
  assert.deepEqual(effectOrder({}), ["eq", "comp", "delay", "reverb"], "사슬 자체가 없어도 기본 순서");
});

test("이펙트가 켜졌는가: 이펙트 자신의 켜기와 사슬 슬롯의 켜기가 둘 다 켜져야 한다", () => {
  const track = withEffects({ delay: true });
  assert.equal(isEffectActive(track, "eq"), true, "EQ는 기본으로 켜져 있다");
  assert.equal(isEffectActive(track, "comp"), false);
  assert.equal(isEffectActive(track, "delay"), true);
  assert.equal(isEffectActive(track, "reverb"), false);

  const slotOff = produce(track, (draft) => { draft.effectChain.find((slot) => slot.type === "delay").enabled = false; });
  assert.equal(isEffectActive(slotOff, "delay"), false, "슬롯만 꺼도 꺼진다");
  const settingOff = produce(track, (draft) => { draft.delay.enabled = false; });
  assert.equal(isEffectActive(settingOff, "delay"), false, "이펙트 값만 꺼도 꺼진다");
});

test("옛 프로젝트: 사슬이 비어 있으면 이펙트 자신의 켜기만 보고, 딜레이·리버브 값이 없어도 꺼진 것으로 본다", () => {
  const oldProject = produce(createDefaultTrack(1), (draft) => {
    draft.effectChain = [];
    draft.compressor.enabled = true;
    delete draft.delay;
    delete draft.reverb;
  });
  assert.equal(isEffectActive(oldProject, "eq"), true);
  assert.equal(isEffectActive(oldProject, "comp"), true);
  assert.equal(isEffectActive(oldProject, "delay"), false);
  assert.equal(isEffectActive(oldProject, "reverb"), false);
});

test("딜레이 꼬리 = 딜레이 시간 × ⌈log(0.001) / log(피드백)⌉", () => {
  const delay = (changes) => ({ ...createDefaultTrack(1).delay, ...changes });
  near(delayTailSeconds(delay({}), 120), 0.375 * 7, "기본값: 피드백 0.35 → 7번 × 375ms");
  near(delayTailSeconds(delay({ delayTimeMs: 500, feedback: 0.5 }), 120), 0.5 * 10, "피드백 0.5 → 10번");
  near(delayTailSeconds(delay({ delayTimeMs: 400, feedback: 0 }), 120), 0.4, "피드백 0이어도 한 번은 울린다");
  near(delayTailSeconds(delay({ delayTimeMs: 100, feedback: 0.95 }), 120), 0.1 * 135, "피드백 0.95 → 135번(여기서는 상한 없음)");
  near(delayTailSeconds(delay({ syncEnabled: true, syncDivision: "1/4", feedback: 0.5 }), 120), 0.5 * 10, "박자에 맞추면 120bpm 1/4 = 500ms");
  near(delayTailSeconds(delay({ syncEnabled: true, syncDivision: "1/4", feedback: 0.5 }), 60), 1 * 10, "템포가 느려지면 꼬리가 길어진다");
  assert.equal(delayTailSeconds(undefined, 120), 0);
});

test("리버브 꼬리 = 프리딜레이 + 잔향 길이", () => {
  const reverb = (changes) => ({ ...createDefaultTrack(1).reverb, ...changes });
  near(reverbTailSeconds(reverb({})), 2.4 + 0.02);
  near(reverbTailSeconds(reverb({ decay: 6, preDelayMs: 100 })), 6.1);
  near(reverbTailSeconds(reverb({ decay: 100, preDelayMs: 1000 })), 12 + 0.25, "범위를 벗어난 값은 보정한 뒤 계산한다");
  assert.equal(reverbTailSeconds(undefined), 0);
});

test("꼬리는 켜진 이펙트만: EQ·컴프레서는 0, 꺼진 딜레이·리버브도 0", () => {
  const track = withEffects({ comp: true, delay: true, reverb: false });
  assert.equal(effectTailSeconds(track, "eq", 120), 0);
  assert.equal(effectTailSeconds(track, "comp", 120), 0);
  near(effectTailSeconds(track, "delay", 120), 0.375 * 7);
  assert.equal(effectTailSeconds(track, "reverb", 120), 0, "꺼져 있으면 0");
});

test("트랙 꼬리는 켜진 딜레이와 리버브의 꼬리를 더한다", () => {
  near(trackTailSeconds(withEffects({ delay: true, reverb: true }), 120), 0.375 * 7 + 2.42);
  near(trackTailSeconds(withEffects({ reverb: true }), 120), 2.42);
  assert.equal(trackTailSeconds(withEffects({}), 120), 0);
});

test("곡 꼬리는 트랙 중 가장 긴 것이고, 30초를 넘지 않는다", () => {
  const short = withEffects({ reverb: true });
  const long = produce(withEffects({ delay: true }), (draft) => { draft.delay.delayTimeMs = 1000; draft.delay.feedback = 0.5; });
  near(projectTailSeconds({ bpm: 120, tracks: [short, long] }), 10, "리버브 2.42초와 딜레이 10초 중 긴 쪽");
  assert.equal(projectTailSeconds({ bpm: 120, tracks: [withEffects({})] }), 0);
  assert.equal(projectTailSeconds({ bpm: 120, tracks: [] }), 0);

  const endless = produce(withEffects({ delay: true }), (draft) => { draft.delay.delayTimeMs = 2000; draft.delay.feedback = 0.95; });
  assert.equal(projectTailSeconds({ bpm: 120, tracks: [endless] }), MAX_TAIL_SECONDS);
  assert.equal(MAX_TAIL_SECONDS, 30);
});
