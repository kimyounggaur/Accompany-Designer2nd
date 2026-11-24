/**
 * 이펙트 설정 변경 만들기(P5-0): Inspector 안에 네 벌로 복사되어 있던 `updateEq`·`updateCompressor`·`updateDelay`·`updateReverb`를
 * 하나로 합친 순수 함수. 같은 일을 하는지(설정 합치기 + 켜고 끌 때 이펙트 사슬 슬롯 맞추기)를 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { effectPatch } = await import("../src/domain/project/effectPatch.ts");
const { createDefaultTrack } = await import("../src/domain/project/defaults.ts");

/** 옛 Inspector의 복사본 네 벌과 같은 일을 하는 기준 구현(슬롯 동기화는 네 벌이 같았다) */
function oldUpdate(track, key, type, patch) {
  const sync = (enabled) => track.effectChain.map((slot) => (slot.type === type ? { ...slot, enabled } : slot));
  return {
    [key]: { ...track[key], ...patch },
    ...(typeof patch.enabled === "boolean" ? { effectChain: sync(patch.enabled) } : {}),
  };
}

const CASES = [
  ["eq", "eq", { bassGain: 3 }],
  ["eq", "eq", { enabled: false }],
  ["compressor", "comp", { threshold: -30 }],
  ["compressor", "comp", { enabled: true, ratio: 4 }],
  ["delay", "delay", { feedback: 0.5 }],
  ["delay", "delay", { enabled: true }],
  ["reverb", "reverb", { wet: 0.4 }],
  ["reverb", "reverb", { enabled: true }],
];

test("네 이펙트 모두 옛 복사본과 같은 변경을 만든다", () => {
  for (const [key, type, patch] of CASES) {
    const track = createDefaultTrack(1);
    assert.deepEqual(effectPatch(track, key, patch), oldUpdate(track, key, type, patch), `${key} ${JSON.stringify(patch)}`);
  }
});

test("설정은 합쳐지고, 고치지 않은 값은 그대로", () => {
  const track = createDefaultTrack(1);
  const patch = effectPatch(track, "delay", { feedback: 0.5 });
  assert.equal(patch.delay.feedback, 0.5);
  assert.equal(patch.delay.delayTimeMs, track.delay.delayTimeMs);
  assert.equal(patch.effectChain, undefined, "enabled가 없으면 사슬은 건드리지 않는다");
});

test("켜고 끄면 같은 종류의 슬롯만 바뀐다(컴프레서는 comp 슬롯)", () => {
  const track = createDefaultTrack(1);
  const patch = effectPatch(track, "compressor", { enabled: true });
  assert.equal(patch.compressor.enabled, true);
  const enabledByType = Object.fromEntries(patch.effectChain.map((slot) => [slot.type, slot.enabled]));
  assert.equal(enabledByType.comp, true);
  assert.equal(enabledByType.eq, track.eq.enabled);
  assert.equal(enabledByType.delay, false);
  assert.equal(enabledByType.reverb, false);
  // 슬롯의 id와 순서는 그대로
  assert.deepEqual(patch.effectChain.map((slot) => slot.id), track.effectChain.map((slot) => slot.id));
});

test("원래 트랙은 바뀌지 않는다", () => {
  const track = createDefaultTrack(1);
  const before = JSON.stringify(track);
  effectPatch(track, "reverb", { enabled: true, wet: 0.9 });
  assert.equal(JSON.stringify(track), before);
});

test("enabled가 불리언이 아니면(없거나 다른 형) 사슬을 건드리지 않는다", () => {
  const track = createDefaultTrack(1);
  assert.equal(effectPatch(track, "eq", { enabled: undefined }).effectChain, undefined);
});
