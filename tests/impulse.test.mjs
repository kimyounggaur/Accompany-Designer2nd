import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";

const { mulberry32, hashString, impulseKey, createImpulseChannels, createImpulseBuffer } = await import("../src/audio/effects/impulse.ts");

const settings = { mode: "plate", decay: 0.5, modEnabled: false, modAmount: 0.15 };
const sameValues = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

test("mulberry32: 같은 씨앗이면 같은 수열, 다른 씨앗이면 다른 수열, 값은 0 이상 1 미만", () => {
  const take = (seed, count = 200) => { const random = mulberry32(seed); return Array.from({ length: count }, random); };
  assert.deepEqual(take(7), take(7));
  assert.notDeepEqual(take(7), take(8));
  assert.ok(take(123456, 5000).every((value) => value >= 0 && value < 1));
  assert.equal(take(0).length, 200, "씨앗 0도 쓸 수 있다");
});

test("hashString: 같은 글자는 같은 수, 다른 글자는 (거의 항상) 다른 수", () => {
  assert.equal(hashString("plate:2.4:false:0.15"), hashString("plate:2.4:false:0.15"));
  assert.notEqual(hashString("plate:2.4:false:0.15"), hashString("plate:2.5:false:0.15"));
  assert.ok(Number.isInteger(hashString("가나다")) && hashString("가나다") >= 0);
});

test("잔향 열쇠는 모양을 정하는 네 값만 본다(다른 노브를 돌려도 잔향을 다시 만들지 않는다)", () => {
  const full = { ...settings, wet: 0.9, dry: 0.2, preDelayMs: 90, width: 0.1, drive: 1, highPassHz: 900 };
  assert.equal(impulseKey(full), impulseKey(settings));
  assert.notEqual(impulseKey({ ...settings, decay: 0.6 }), impulseKey(settings));
  assert.notEqual(impulseKey({ ...settings, mode: "hall" }), impulseKey(settings));
  assert.notEqual(impulseKey({ ...settings, modEnabled: true }), impulseKey(settings));
  assert.notEqual(impulseKey({ ...settings, modAmount: 0.3 }), impulseKey(settings));
});

test("같은 설정으로 잔향을 두 번 만들면 값이 똑같다", () => {
  const [leftA, rightA] = createImpulseChannels(settings, 44100);
  const [leftB, rightB] = createImpulseChannels({ ...settings }, 44100);
  assert.ok(sameValues(leftA, leftB));
  assert.ok(sameValues(rightA, rightB));
});

test("설정이 다르면 잔향도 다르다: 모드·길이·흔들림", () => {
  const [base] = createImpulseChannels(settings, 44100);
  assert.ok(!sameValues(base, createImpulseChannels({ ...settings, mode: "room" }, 44100)[0]));
  assert.ok(!sameValues(base, createImpulseChannels({ ...settings, mode: "hall" }, 44100)[0]));
  assert.ok(!sameValues(base, createImpulseChannels({ ...settings, modEnabled: true, modAmount: 0.8 }, 44100)[0]));
  assert.equal(createImpulseChannels({ ...settings, decay: 1 }, 44100)[0].length, 44100);
});

test("길이는 샘플레이트 × 잔향 길이, 두 채널은 서로 다르고, 소리 크기는 0.72를 넘지 않으며 뒤로 갈수록 줄어든다", () => {
  const [left, right] = createImpulseChannels(settings, 48000);
  assert.equal(left.length, 24000);
  assert.equal(right.length, 24000);
  assert.ok(!sameValues(left, right), "좌우가 같으면 퍼짐이 없다");
  const peak = (data, from, to) => data.slice(from, to).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak(left, 0, 24000) <= 0.72);
  assert.ok(peak(left, 0, 2400) > peak(left, 21600, 24000) * 5, "앞쪽이 끝쪽보다 훨씬 크다");
  assert.ok(Array.from(left).every(Number.isFinite));
});

test("오디오 버퍼에 담으면 같은 값이 들어가고, 두 번 담아도 같다", () => {
  const context = new FakeContext();
  const first = createImpulseBuffer(context, settings);
  const second = createImpulseBuffer(context, settings);
  const [left, right] = createImpulseChannels(settings, context.sampleRate);
  assert.equal(first.numberOfChannels, 2);
  assert.equal(first.length, left.length);
  assert.ok(sameValues(first.getChannelData(0), left));
  assert.ok(sameValues(first.getChannelData(1), right));
  assert.ok(sameValues(first.getChannelData(0), second.getChannelData(0)));
  assert.ok(sameValues(first.getChannelData(1), second.getChannelData(1)));
  assert.equal(context.buffersCreated.length, 2);
});
